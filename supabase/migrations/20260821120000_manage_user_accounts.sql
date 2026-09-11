drop index if exists public.user_access_profiles_login_name_unique;

alter table public.user_access_profiles
  alter column login_name drop expression,
  add column display_name text,
  add column deleted_at timestamptz,
  add constraint user_access_profiles_login_name_format_check check (
    login_name = btrim(login_name)
    and login_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
  ),
  add constraint user_access_profiles_display_name_check check (
    display_name is null
    or (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 80
    )
  ),
  add constraint user_access_profiles_deleted_state_check check (
    deleted_at is null or not active
  );

create unique index user_access_profiles_login_name_key_unique
  on public.user_access_profiles (lower(login_name));

create function private.normalize_access_profile_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.login_name is null or btrim(new.login_name) = '' then
    new.login_name := split_part(lower(btrim(new.email)), '@', 1);
  else
    new.login_name := btrim(new.login_name);
  end if;

  new.display_name := nullif(btrim(new.display_name), '');
  new.notification_email := nullif(lower(btrim(new.notification_email)), '');
  return new;
end
$$;

create trigger normalize_access_profile_identity_before_write
before insert or update of email, login_name, display_name, notification_email
on public.user_access_profiles
for each row execute function private.normalize_access_profile_identity();

create function private.can_fully_manage_access_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_memberships as membership
    where membership.user_access_profile_id = target_profile_id
  )
  and not exists (
    select 1
    from public.access_memberships as membership
    left join public.institutions as institution
      on institution.id = membership.institution_id
    where membership.user_access_profile_id = target_profile_id
      and not private.has_laundry_supervisor_site_access(
        coalesce(membership.operating_site_id, institution.operating_site_id)
      )
  )
$$;

revoke all on function private.can_fully_manage_access_profile(uuid) from public;

create table private.account_management_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  request_payload jsonb not null,
  target_profile_id uuid references public.user_access_profiles(id),
  created_at timestamptz not null default now(),
  constraint account_management_requests_operation_check check (
    operation in ('manage', 'password_reset', 'retire')
  )
);

revoke all on table private.account_management_requests from public;
revoke all on table private.account_management_requests from anon, authenticated;

create function public.list_manageable_user_accounts()
returns table (
  profile_id uuid,
  login_name text,
  display_name text,
  notification_email text,
  account_active boolean,
  must_change_password boolean,
  deleted_at timestamptz,
  auth_identity_configured boolean,
  is_current_account boolean,
  memberships jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.login_name,
    profile.display_name,
    profile.notification_email,
    profile.active,
    profile.must_change_password,
    profile.deleted_at,
    profile.auth_user_id is not null,
    profile.auth_user_id = (select auth.uid()),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'membership_id', membership.id,
          'role', membership.role,
          'site_code', site.code,
          'site_name', site.name,
          'institution_code', institution.code,
          'institution_name', institution.name,
          'active', membership.active
        ) order by membership.created_at, membership.id
      ) filter (where membership.id is not null),
      '[]'::jsonb
    )
  from public.user_access_profiles as profile
  left join public.access_memberships as membership
    on membership.user_access_profile_id = profile.id
  left join public.operating_sites as site
    on site.id = membership.operating_site_id
  left join public.institutions as institution
    on institution.id = membership.institution_id
  where private.can_fully_manage_access_profile(profile.id)
  group by profile.id
  order by profile.deleted_at nulls first, lower(profile.login_name), profile.id
$$;

revoke all on function public.list_manageable_user_accounts() from public;
grant execute on function public.list_manageable_user_accounts() to authenticated;

create function public.manage_user_account(
  target_profile_id uuid,
  requested_login_name text,
  requested_display_name text,
  requested_notification_email text,
  requested_account_active boolean,
  requested_memberships jsonb,
  change_request_id uuid,
  change_reason text
)
returns table (
  user_access_profile_id uuid,
  internal_auth_email text,
  created_account boolean,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor_auth_user_id uuid := auth.uid();
  actor_profile_id uuid;
  normalized_login_name text := btrim(requested_login_name);
  normalized_display_name text := nullif(btrim(requested_display_name), '');
  normalized_notification_email text := nullif(lower(btrim(requested_notification_email)), '');
  normalized_reason text := btrim(change_reason);
  normalized_memberships jsonb;
  normalized_payload jsonb;
  existing_request private.account_management_requests%rowtype;
  target_profile public.user_access_profiles%rowtype;
  was_created boolean := false;
  membership_row jsonb;
  requested_role text;
  requested_site_code text;
  requested_institution_code text;
  resolved_site_id uuid;
  resolved_institution_id uuid;
  affected_site_ids uuid[] := array[]::uuid[];
  existing_site_ids uuid[] := array[]::uuid[];
  before_state jsonb;
begin
  if actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if change_request_id is null then
    raise exception 'change request id is required' using errcode = '22023';
  end if;
  if normalized_reason is null or normalized_reason = ''
    or char_length(normalized_reason) > 500 then
    raise exception 'valid change reason is required' using errcode = '22023';
  end if;
  if normalized_login_name is null
    or normalized_login_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$' then
    raise exception 'invalid login name' using errcode = '22023';
  end if;
  if normalized_display_name is not null and char_length(normalized_display_name) > 80 then
    raise exception 'display name is too long' using errcode = '22023';
  end if;
  if normalized_notification_email is not null
    and normalized_notification_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid notification email' using errcode = '22023';
  end if;
  if requested_account_active is null then
    raise exception 'account active state is required' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_memberships) <> 'array'
    or jsonb_array_length(requested_memberships) = 0
    or jsonb_array_length(requested_memberships) > 100 then
    raise exception 'one to one hundred memberships are required' using errcode = '22023';
  end if;

  select profile.id
  into actor_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = actor_auth_user_id
    and profile.active
    and profile.deleted_at is null;

  if actor_profile_id is null then
    raise exception 'active access profile required' using errcode = '42501';
  end if;

  normalized_memberships := (
    select jsonb_agg(
      jsonb_build_object(
        'role', row_value ->> 'role',
        'site_code', nullif(upper(btrim(row_value ->> 'site_code')), ''),
        'institution_code', nullif(upper(btrim(row_value ->> 'institution_code')), '')
      ) order by
        row_value ->> 'role',
        coalesce(row_value ->> 'site_code', ''),
        coalesce(row_value ->> 'institution_code', '')
    )
    from jsonb_array_elements(requested_memberships) as rows(row_value)
  );

  if exists (
    select 1
    from jsonb_array_elements(normalized_memberships) as rows(row_value)
    group by row_value ->> 'role', row_value ->> 'site_code', row_value ->> 'institution_code'
    having count(*) > 1
  ) then
    raise exception 'duplicate membership requested' using errcode = '22023';
  end if;

  for membership_row in select value from jsonb_array_elements(normalized_memberships)
  loop
    requested_role := membership_row ->> 'role';
    requested_site_code := nullif(membership_row ->> 'site_code', '');
    requested_institution_code := nullif(membership_row ->> 'institution_code', '');
    resolved_site_id := null;
    resolved_institution_id := null;

    if requested_role in ('laundry_worker', 'laundry_supervisor')
      and requested_site_code is not null
      and requested_institution_code is null then
      select site.id into resolved_site_id
      from public.operating_sites as site
      where site.code = requested_site_code and site.active;
    elsif requested_role = 'institution_supervisor'
      and requested_site_code is null
      and requested_institution_code is not null then
      select institution.operating_site_id, institution.id
      into resolved_site_id, resolved_institution_id
      from public.institutions as institution
      join public.operating_sites as site on site.id = institution.operating_site_id
      where institution.code = requested_institution_code
        and institution.active and site.active;
    else
      raise exception 'invalid role and scope combination' using errcode = '22023';
    end if;

    if resolved_site_id is null then
      raise exception 'active access scope not found' using errcode = '22023';
    end if;
    if not private.has_laundry_supervisor_site_access(resolved_site_id) then
      raise exception 'access scope is outside supervisor authority' using errcode = '42501';
    end if;
    affected_site_ids := array_append(affected_site_ids, resolved_site_id);
  end loop;

  normalized_payload := jsonb_build_object(
    'target_profile_id', target_profile_id,
    'login_name', normalized_login_name,
    'display_name', normalized_display_name,
    'notification_email', normalized_notification_email,
    'account_active', requested_account_active,
    'memberships', normalized_memberships,
    'reason', normalized_reason
  );

  select request.* into existing_request
  from private.account_management_requests as request
  where request.id = change_request_id;

  if found then
    if existing_request.actor_auth_user_id <> actor_auth_user_id
      or existing_request.operation <> 'manage'
      or existing_request.request_payload <> normalized_payload then
      raise exception 'request id cannot be reused for different account changes' using errcode = '22023';
    end if;
    select profile.* into target_profile
    from public.user_access_profiles as profile
    where profile.id = existing_request.target_profile_id;
    return query select target_profile.id, target_profile.email,
      target_profile_id is null, true;
    return;
  end if;

  if target_profile_id is null then
    if exists (
      select 1 from public.user_access_profiles as profile
      where lower(profile.login_name) = lower(normalized_login_name)
    ) then
      raise exception 'login name already exists' using errcode = '23505';
    end if;
    insert into public.user_access_profiles (
      email, login_name, display_name, notification_email, active,
      must_change_password
    ) values (
      lower(normalized_login_name) || '@auth.wash-room.invalid',
      normalized_login_name, normalized_display_name, normalized_notification_email,
      requested_account_active, true
    ) returning * into target_profile;
    was_created := true;
  else
    select profile.* into target_profile
    from public.user_access_profiles as profile
    where profile.id = target_profile_id
    for update;

    if not found or not private.can_fully_manage_access_profile(target_profile_id) then
      raise exception 'account is outside supervisor authority' using errcode = '42501';
    end if;
    if target_profile.deleted_at is not null then
      raise exception 'deleted account cannot be edited' using errcode = '22023';
    end if;
    if target_profile.auth_user_id = actor_auth_user_id then
      raise exception 'current account must be managed through self service' using errcode = '42501';
    end if;

    select coalesce(array_agg(distinct coalesce(
      membership.operating_site_id, institution.operating_site_id
    )), array[]::uuid[])
    into existing_site_ids
    from public.access_memberships as membership
    left join public.institutions as institution on institution.id = membership.institution_id
    where membership.user_access_profile_id = target_profile.id;
    affected_site_ids := affected_site_ids || existing_site_ids;

    before_state := jsonb_build_object(
      'login_name', target_profile.login_name,
      'display_name', target_profile.display_name,
      'notification_email', target_profile.notification_email,
      'active', target_profile.active
    );

    update public.user_access_profiles
    set email = lower(normalized_login_name) || '@auth.wash-room.invalid',
        login_name = normalized_login_name,
        display_name = normalized_display_name,
        notification_email = normalized_notification_email,
        active = requested_account_active,
        updated_at = now()
    where id = target_profile.id
    returning * into target_profile;

    update public.access_memberships
    set active = false, updated_at = now()
    where user_access_profile_id = target_profile.id;
  end if;

  for membership_row in select value from jsonb_array_elements(normalized_memberships)
  loop
    requested_role := membership_row ->> 'role';
    requested_site_code := nullif(membership_row ->> 'site_code', '');
    requested_institution_code := nullif(membership_row ->> 'institution_code', '');

    if requested_site_code is not null then
      select site.id into resolved_site_id
      from public.operating_sites as site where site.code = requested_site_code;
      resolved_institution_id := null;
    else
      select institution.operating_site_id, institution.id
      into resolved_site_id, resolved_institution_id
      from public.institutions as institution
      where institution.code = requested_institution_code;
    end if;

    if resolved_institution_id is null then
      insert into public.access_memberships (
        user_access_profile_id, role, operating_site_id, institution_id, active
      ) values (
        target_profile.id, requested_role, resolved_site_id, null, true
      )
      on conflict (user_access_profile_id, role, operating_site_id)
        where operating_site_id is not null
      do update set active = true, valid_until = null, updated_at = now();
    else
      insert into public.access_memberships (
        user_access_profile_id, role, operating_site_id, institution_id, active
      ) values (
        target_profile.id, requested_role, null, resolved_institution_id, true
      )
      on conflict (user_access_profile_id, role, institution_id)
        where institution_id is not null
      do update set active = true, valid_until = null, updated_at = now();
    end if;
  end loop;

  perform site.id from public.operating_sites as site
  where site.id = any(affected_site_ids) order by site.id for update;

  if exists (
    select 1 from unnest(affected_site_ids) as affected(site_id)
    join public.operating_sites as site on site.id = affected.site_id
    where site.active and not exists (
      select 1
      from public.access_memberships as membership
      join public.user_access_profiles as profile
        on profile.id = membership.user_access_profile_id
      where membership.role = 'laundry_supervisor'
        and membership.operating_site_id = affected.site_id
        and membership.active and profile.active and profile.deleted_at is null
        and membership.valid_from <= now()
        and (membership.valid_until is null or membership.valid_until > now())
    )
  ) then
    raise exception 'cannot remove the last active laundry supervisor' using errcode = '42501';
  end if;

  insert into private.account_management_requests (
    id, actor_auth_user_id, operation, request_payload, target_profile_id
  ) values (
    change_request_id, actor_auth_user_id, 'manage', normalized_payload, target_profile.id
  );

  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id, action,
    operating_site_id, outcome, reason, before_state, after_state, request_id
  )
  select distinct
    'authenticated_user', actor_auth_user_id, actor_profile_id,
    case when was_created then 'user_account_created' else 'user_account_updated' end,
    affected.site_id, 'succeeded', normalized_reason, before_state,
    jsonb_build_object(
      'profile_id', target_profile.id,
      'login_name', target_profile.login_name,
      'display_name', target_profile.display_name,
      'notification_email', target_profile.notification_email,
      'active', target_profile.active,
      'memberships', normalized_memberships
    ), change_request_id
  from unnest(affected_site_ids) as affected(site_id);

  return query select target_profile.id, target_profile.email, was_created, false;
end
$$;

revoke all on function public.manage_user_account(
  uuid, text, text, text, boolean, jsonb, uuid, text
) from public;
grant execute on function public.manage_user_account(
  uuid, text, text, text, boolean, jsonb, uuid, text
) to authenticated;

create function public.mark_managed_account_password_reset(
  target_profile_id uuid,
  change_request_id uuid,
  change_reason text
)
returns table (user_access_profile_id uuid, already_applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor_auth_user_id uuid := auth.uid();
  actor_profile_id uuid;
  target_profile public.user_access_profiles%rowtype;
  normalized_reason text := btrim(change_reason);
  payload jsonb;
  audit_site_id uuid;
begin
  if actor_auth_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if change_request_id is null or normalized_reason is null or normalized_reason = ''
    or char_length(normalized_reason) > 500 then
    raise exception 'valid password reset request is required' using errcode = '22023';
  end if;
  select profile.id into actor_profile_id from public.user_access_profiles as profile
  where profile.auth_user_id = actor_auth_user_id and profile.active and profile.deleted_at is null;
  select profile.* into target_profile from public.user_access_profiles as profile
  where profile.id = target_profile_id for update;
  if not found or not private.can_fully_manage_access_profile(target_profile_id) then
    raise exception 'account is outside supervisor authority' using errcode = '42501';
  end if;
  if target_profile.auth_user_id = actor_auth_user_id then
    raise exception 'current account password uses self service' using errcode = '42501';
  end if;
  if not target_profile.active or target_profile.deleted_at is not null
    or target_profile.auth_user_id is null then
    raise exception 'active Auth account is required' using errcode = '22023';
  end if;
  payload := jsonb_build_object('target_profile_id', target_profile_id, 'reason', normalized_reason);
  if exists (select 1 from private.account_management_requests where id = change_request_id) then
    if not exists (
      select 1 from private.account_management_requests
      where id = change_request_id and actor_auth_user_id = mark_managed_account_password_reset.actor_auth_user_id
        and operation = 'password_reset' and request_payload = payload
    ) then raise exception 'request id cannot be reused' using errcode = '22023'; end if;
    return query select target_profile_id, true; return;
  end if;
  update public.user_access_profiles set must_change_password = true, updated_at = now()
  where id = target_profile_id;
  delete from private.password_change_baselines where user_access_profile_id = target_profile_id;
  select coalesce(membership.operating_site_id, institution.operating_site_id)
  into audit_site_id
  from public.access_memberships as membership
  left join public.institutions as institution on institution.id = membership.institution_id
  where membership.user_access_profile_id = target_profile_id limit 1;
  insert into private.account_management_requests values (
    change_request_id, actor_auth_user_id, 'password_reset', payload, target_profile_id, now()
  );
  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id, action,
    operating_site_id, outcome, reason, before_state, after_state, request_id
  ) values (
    'authenticated_user', actor_auth_user_id, actor_profile_id,
    'user_password_reset_required', audit_site_id, 'succeeded', normalized_reason,
    jsonb_build_object('password_change_required', target_profile.must_change_password),
    jsonb_build_object('password_change_required', true), change_request_id
  );
  return query select target_profile_id, false;
end
$$;

revoke all on function public.mark_managed_account_password_reset(uuid, uuid, text) from public;
grant execute on function public.mark_managed_account_password_reset(uuid, uuid, text) to authenticated;

create function public.retire_managed_user_account(
  target_profile_id uuid,
  change_request_id uuid,
  change_reason text
)
returns table (user_access_profile_id uuid, already_applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor_auth_user_id uuid := auth.uid();
  actor_profile_id uuid;
  target_profile public.user_access_profiles%rowtype;
  normalized_reason text := btrim(change_reason);
  payload jsonb;
  affected_site_ids uuid[];
begin
  if actor_auth_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if change_request_id is null or normalized_reason is null or normalized_reason = ''
    or char_length(normalized_reason) > 500 then
    raise exception 'valid account deletion request is required' using errcode = '22023';
  end if;
  select profile.id into actor_profile_id from public.user_access_profiles as profile
  where profile.auth_user_id = actor_auth_user_id and profile.active and profile.deleted_at is null;
  select profile.* into target_profile from public.user_access_profiles as profile
  where profile.id = target_profile_id for update;
  if not found or not private.can_fully_manage_access_profile(target_profile_id) then
    raise exception 'account is outside supervisor authority' using errcode = '42501';
  end if;
  if target_profile.auth_user_id = actor_auth_user_id then
    raise exception 'current account cannot be deleted' using errcode = '42501';
  end if;
  payload := jsonb_build_object('target_profile_id', target_profile_id, 'reason', normalized_reason);
  if exists (select 1 from private.account_management_requests where id = change_request_id) then
    if not exists (
      select 1 from private.account_management_requests
      where id = change_request_id and actor_auth_user_id = retire_managed_user_account.actor_auth_user_id
        and operation = 'retire' and request_payload = payload
    ) then raise exception 'request id cannot be reused' using errcode = '22023'; end if;
    return query select target_profile_id, true; return;
  end if;
  if target_profile.deleted_at is not null then
    raise exception 'account is already deleted' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct coalesce(
    membership.operating_site_id, institution.operating_site_id
  )), array[]::uuid[])
  into affected_site_ids
  from public.access_memberships as membership
  left join public.institutions as institution on institution.id = membership.institution_id
  where membership.user_access_profile_id = target_profile_id;
  update public.access_memberships set active = false, updated_at = now()
  where user_access_profile_id = target_profile_id;
  update public.user_access_profiles
  set active = false, must_change_password = false, deleted_at = now(), updated_at = now()
  where id = target_profile_id;
  perform site.id from public.operating_sites as site
  where site.id = any(affected_site_ids) order by site.id for update;
  if exists (
    select 1 from unnest(affected_site_ids) as affected(site_id)
    join public.operating_sites as site on site.id = affected.site_id
    where site.active and not exists (
      select 1 from public.access_memberships as membership
      join public.user_access_profiles as profile on profile.id = membership.user_access_profile_id
      where membership.role = 'laundry_supervisor'
        and membership.operating_site_id = affected.site_id
        and membership.active and profile.active and profile.deleted_at is null
    )
  ) then raise exception 'cannot delete the last active laundry supervisor' using errcode = '42501'; end if;
  insert into private.account_management_requests values (
    change_request_id, actor_auth_user_id, 'retire', payload, target_profile_id, now()
  );
  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id, action,
    operating_site_id, outcome, reason, before_state, after_state, request_id
  )
  select distinct 'authenticated_user', actor_auth_user_id, actor_profile_id,
    'user_account_deleted', affected.site_id, 'succeeded', normalized_reason,
    jsonb_build_object('login_name', target_profile.login_name, 'active', target_profile.active),
    jsonb_build_object('login_name', target_profile.login_name, 'active', false, 'deleted', true),
    change_request_id
  from unnest(affected_site_ids) as affected(site_id);
  return query select target_profile_id, false;
end
$$;

revoke all on function public.retire_managed_user_account(uuid, uuid, text) from public;
grant execute on function public.retire_managed_user_account(uuid, uuid, text) to authenticated;

create function public.internal_get_managed_auth_identity(target_profile_id uuid)
returns table (auth_user_id uuid, auth_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select auth_user.id, lower(auth_user.email)
  from public.user_access_profiles as profile
  join auth.users as auth_user on auth_user.id = profile.auth_user_id
  where profile.id = target_profile_id
$$;

create function public.internal_bind_managed_auth_identity(
  target_profile_id uuid,
  target_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_email text;
  auth_email text;
begin
  select profile.email into profile_email
  from public.user_access_profiles as profile
  where profile.id = target_profile_id and profile.deleted_at is null
  for update;
  select lower(auth_user.email) into auth_email
  from auth.users as auth_user where auth_user.id = target_auth_user_id;
  if profile_email is null or auth_email is null or profile_email <> auth_email then
    raise exception 'Auth identity does not match managed account' using errcode = '22023';
  end if;
  update public.user_access_profiles
  set auth_user_id = target_auth_user_id, updated_at = now()
  where id = target_profile_id
    and (auth_user_id is null or auth_user_id = target_auth_user_id);
  if not found then
    raise exception 'managed account is already bound to another identity' using errcode = '23505';
  end if;
  return true;
end
$$;

revoke all on function public.internal_get_managed_auth_identity(uuid) from public;
revoke all on function public.internal_bind_managed_auth_identity(uuid, uuid) from public;
grant execute on function public.internal_get_managed_auth_identity(uuid) to service_role;
grant execute on function public.internal_bind_managed_auth_identity(uuid, uuid) to service_role;

alter function public.apply_access_changes(jsonb, uuid, text)
  rename to apply_access_changes_legacy;
revoke all on function public.apply_access_changes_legacy(jsonb, uuid, text) from public;

create function public.apply_access_changes(
  change_rows jsonb,
  change_request_id uuid,
  change_reason text
)
returns table (applied_count integer, already_applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row record;
  change_row jsonb;
  requested_login_name text;
  normalized_email text;
begin
  select * into result_row
  from public.apply_access_changes_legacy(change_rows, change_request_id, change_reason);

  for change_row in select value from jsonb_array_elements(change_rows)
  loop
    normalized_email := lower(btrim(change_row ->> 'email'));
    requested_login_name := coalesce(
      nullif(btrim(change_row ->> 'login_name'), ''),
      split_part(normalized_email, '@', 1)
    );
    if requested_login_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$' then
      raise exception 'invalid login name' using errcode = '22023';
    end if;
    update public.user_access_profiles
    set login_name = requested_login_name, updated_at = now()
    where email = normalized_email;
  end loop;

  return query select result_row.applied_count, result_row.already_applied;
end
$$;

revoke all on function public.apply_access_changes(jsonb, uuid, text) from public;
grant execute on function public.apply_access_changes(jsonb, uuid, text) to authenticated;

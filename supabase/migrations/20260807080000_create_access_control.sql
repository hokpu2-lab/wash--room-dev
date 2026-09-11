create table public.operating_sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operating_sites_code_format_check
    check (code = upper(btrim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]*$'),
  constraint operating_sites_name_check check (length(btrim(name)) > 0)
);

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  operating_site_id uuid not null references public.operating_sites(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint institutions_code_format_check
    check (code = upper(btrim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]*$'),
  constraint institutions_name_check check (length(btrim(name)) > 0)
);

create index institutions_operating_site_id_idx
  on public.institutions (operating_site_id);

create table public.user_access_profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_access_profiles_email_normalized_check
    check (email = lower(btrim(email))),
  constraint user_access_profiles_email_format_check
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

create table public.access_memberships (
  id uuid primary key default gen_random_uuid(),
  user_access_profile_id uuid not null
    references public.user_access_profiles(id) on delete cascade,
  role text not null,
  operating_site_id uuid references public.operating_sites(id),
  institution_id uuid references public.institutions(id),
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_memberships_role_check
    check (role in (
      'laundry_worker',
      'laundry_supervisor',
      'institution_supervisor'
    )),
  constraint access_memberships_role_scope_check check (
    (
      role in ('laundry_worker', 'laundry_supervisor')
      and operating_site_id is not null
      and institution_id is null
    )
    or
    (
      role = 'institution_supervisor'
      and operating_site_id is null
      and institution_id is not null
    )
  ),
  constraint access_memberships_validity_check
    check (valid_until is null or valid_until > valid_from)
);

create unique index access_memberships_profile_role_site_unique
  on public.access_memberships (user_access_profile_id, role, operating_site_id)
  where operating_site_id is not null;

create unique index access_memberships_profile_role_institution_unique
  on public.access_memberships (user_access_profile_id, role, institution_id)
  where institution_id is not null;

create index access_memberships_operating_site_id_idx
  on public.access_memberships (operating_site_id)
  where operating_site_id is not null;

create index access_memberships_institution_id_idx
  on public.access_memberships (institution_id)
  where institution_id is not null;

create function public.current_access_context()
returns table (
  membership_id uuid,
  role text,
  operating_site_id uuid,
  institution_id uuid,
  scope_code text,
  scope_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    membership.id,
    membership.role,
    coalesce(membership.operating_site_id, institution.operating_site_id),
    membership.institution_id,
    coalesce(site.code, institution.code),
    coalesce(site.name, institution.name)
  from public.access_memberships as membership
  join public.user_access_profiles as profile
    on profile.id = membership.user_access_profile_id
  left join public.operating_sites as site
    on site.id = membership.operating_site_id
  left join public.institutions as institution
    on institution.id = membership.institution_id
  left join public.operating_sites as institution_site
    on institution_site.id = institution.operating_site_id
  where profile.auth_user_id = (select auth.uid())
    and profile.active
    and membership.active
    and membership.valid_from <= now()
    and (membership.valid_until is null or membership.valid_until > now())
    and (
      (site.id is not null and site.active)
      or
      (
        institution.id is not null
        and institution.active
        and institution_site.active
      )
    )
  order by membership.created_at, membership.id
$$;

create table public.authorization_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_type text not null,
  actor_auth_user_id uuid,
  actor_access_profile_id uuid references public.user_access_profiles(id),
  action text not null,
  target_membership_id uuid references public.access_memberships(id),
  operating_site_id uuid references public.operating_sites(id),
  institution_id uuid references public.institutions(id),
  outcome text not null,
  reason text,
  before_state jsonb,
  after_state jsonb,
  request_id uuid not null default gen_random_uuid(),
  constraint authorization_audit_events_actor_type_check
    check (actor_type in ('authenticated_user', 'system')),
  constraint authorization_audit_events_outcome_check
    check (outcome in ('allowed', 'denied', 'succeeded', 'failed'))
);

create index authorization_audit_events_actor_auth_user_id_idx
  on public.authorization_audit_events (actor_auth_user_id, occurred_at desc);

create index authorization_audit_events_operating_site_id_idx
  on public.authorization_audit_events (operating_site_id, occurred_at desc)
  where operating_site_id is not null;

create index authorization_audit_events_institution_id_idx
  on public.authorization_audit_events (institution_id, occurred_at desc)
  where institution_id is not null;

create function public.prevent_authorization_audit_event_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'authorization audit events are immutable';
end
$$;

create trigger authorization_audit_events_are_immutable
before update or delete on public.authorization_audit_events
for each row execute function public.prevent_authorization_audit_event_changes();

create schema private;
revoke all on schema private from public;

create table private.authorization_denial_audit_throttle (
  actor_auth_user_id uuid not null,
  reason text not null,
  last_recorded_at timestamptz not null,
  primary key (actor_auth_user_id, reason)
);

create function private.record_login_denial(
  event_actor_auth_user_id uuid,
  event_actor_access_profile_id uuid,
  event_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if event_actor_auth_user_id is null or event_reason is null then
    return;
  end if;

  with accepted_attempt as (
    insert into private.authorization_denial_audit_throttle (
      actor_auth_user_id,
      reason,
      last_recorded_at
    ) values (
      event_actor_auth_user_id,
      event_reason,
      now()
    )
    on conflict (actor_auth_user_id, reason) do update
    set last_recorded_at = excluded.last_recorded_at
    where private.authorization_denial_audit_throttle.last_recorded_at
      <= excluded.last_recorded_at - interval '1 hour'
    returning 1
  )
  insert into public.authorization_audit_events (
    actor_type,
    actor_auth_user_id,
    actor_access_profile_id,
    action,
    outcome,
    reason
  )
  select
    'authenticated_user',
    event_actor_auth_user_id,
    event_actor_access_profile_id,
    'login_denied',
    'denied',
    event_reason
  where exists (select 1 from accepted_attempt);
end
$$;

revoke all on function private.record_login_denial(uuid, uuid, text)
  from public;

create function public.authorize_current_user()
returns table (
  authorized boolean,
  denial_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auth_user_id uuid := auth.uid();
  normalized_email text;
  email_is_confirmed boolean;
  auth_provider text;
  access_profile public.user_access_profiles%rowtype;
  has_valid_membership boolean;
begin
  if current_auth_user_id is null then
    return query select false, 'unauthenticated'::text;
    return;
  end if;

  select
    lower(btrim(auth_user.email)),
    auth_user.email_confirmed_at is not null,
    auth_user.raw_app_meta_data ->> 'provider'
  into normalized_email, email_is_confirmed, auth_provider
  from auth.users as auth_user
  where auth_user.id = current_auth_user_id;

  if normalized_email is null or not coalesce(email_is_confirmed, false) then
    perform private.record_login_denial(
      current_auth_user_id,
      null,
      'verified_email_missing'
    );

    return query select false, 'not_authorized'::text;
    return;
  end if;

  if auth_provider is distinct from 'google' then
    perform private.record_login_denial(
      current_auth_user_id,
      null,
      'non_google_provider'
    );

    return query select false, 'not_authorized'::text;
    return;
  end if;

  select profile.*
  into access_profile
  from public.user_access_profiles as profile
  where profile.email = normalized_email
  for update;

  if not found then
    perform private.record_login_denial(
      current_auth_user_id,
      null,
      'allowlist_miss'
    );

    return query select false, 'not_authorized'::text;
    return;
  end if;

  if not access_profile.active then
    perform private.record_login_denial(
      current_auth_user_id,
      access_profile.id,
      'account_disabled'
    );

    return query select false, 'not_authorized'::text;
    return;
  end if;

  if access_profile.auth_user_id is not null
    and access_profile.auth_user_id <> current_auth_user_id then
    perform private.record_login_denial(
      current_auth_user_id,
      access_profile.id,
      'identity_mismatch'
    );

    return query select false, 'not_authorized'::text;
    return;
  end if;

  select exists (
    select 1
    from public.access_memberships as membership
    left join public.operating_sites as site
      on site.id = membership.operating_site_id
    left join public.institutions as institution
      on institution.id = membership.institution_id
    left join public.operating_sites as institution_site
      on institution_site.id = institution.operating_site_id
    where membership.user_access_profile_id = access_profile.id
      and membership.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and (
        (site.id is not null and site.active)
        or
        (
          institution.id is not null
          and institution.active
          and institution_site.active
        )
      )
  ) into has_valid_membership;

  if not has_valid_membership then
    perform private.record_login_denial(
      current_auth_user_id,
      access_profile.id,
      'no_valid_membership'
    );

    return query select false, 'not_authorized'::text;
    return;
  end if;

  if access_profile.auth_user_id is null then
    update public.user_access_profiles
    set auth_user_id = current_auth_user_id,
        updated_at = now()
    where id = access_profile.id;

    insert into public.authorization_audit_events (
      actor_type,
      actor_auth_user_id,
      actor_access_profile_id,
      action,
      outcome,
      after_state
    ) values (
      'authenticated_user',
      current_auth_user_id,
      access_profile.id,
      'identity_bound',
      'succeeded',
      jsonb_build_object('auth_user_id', current_auth_user_id)
    );
  end if;

  return query select true, null::text;
end
$$;

create function private.has_site_access(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_memberships as membership
    join public.user_access_profiles as profile
      on profile.id = membership.user_access_profile_id
    join public.operating_sites as target_site
      on target_site.id = target_site_id
    left join public.institutions as institution
      on institution.id = membership.institution_id
    left join public.operating_sites as membership_site
      on membership_site.id = membership.operating_site_id
    left join public.operating_sites as institution_site
      on institution_site.id = institution.operating_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and target_site.active
      and (
        (membership_site.id is not null and membership_site.active)
        or
        (
          institution.id is not null
          and institution.active
          and institution_site.active
        )
      )
      and coalesce(membership.operating_site_id, institution.operating_site_id)
        = target_site_id
  )
$$;

create function private.has_laundry_supervisor_site_access(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_memberships as membership
    join public.user_access_profiles as profile
      on profile.id = membership.user_access_profile_id
    join public.operating_sites as site
      on site.id = membership.operating_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and membership.role = 'laundry_supervisor'
      and membership.operating_site_id = target_site_id
      and site.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
  )
$$;

create function private.has_institution_access(target_institution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.institutions as target_institution
    join public.operating_sites as target_site
      on target_site.id = target_institution.operating_site_id
    join public.access_memberships as membership
      on membership.institution_id = target_institution.id
      or membership.operating_site_id = target_institution.operating_site_id
    join public.user_access_profiles as profile
      on profile.id = membership.user_access_profile_id
    where target_institution.id = target_institution_id
      and target_institution.active
      and target_site.active
      and profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
  )
$$;

create function private.has_current_access_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_access_profiles as profile
    join public.access_memberships as membership
      on membership.user_access_profile_id = profile.id
    left join public.operating_sites as site
      on site.id = membership.operating_site_id
    left join public.institutions as institution
      on institution.id = membership.institution_id
    left join public.operating_sites as institution_site
      on institution_site.id = institution.operating_site_id
    where profile.id = target_profile_id
      and profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and (
        (site.id is not null and site.active)
        or
        (
          institution.id is not null
          and institution.active
          and institution_site.active
        )
      )
  )
$$;

create function private.can_manage_membership(target_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_memberships as target_membership
    left join public.institutions as target_institution
      on target_institution.id = target_membership.institution_id
    where target_membership.id = target_membership_id
      and private.has_laundry_supervisor_site_access(
        coalesce(
          target_membership.operating_site_id,
          target_institution.operating_site_id
        )
      )
  )
$$;

create function private.can_manage_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_memberships as target_membership
    where target_membership.user_access_profile_id = target_profile_id
      and private.can_manage_membership(target_membership.id)
  )
$$;

create function private.can_view_authorization_audit_event(
  event_operating_site_id uuid,
  event_institution_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when event_operating_site_id is not null then
      private.has_laundry_supervisor_site_access(event_operating_site_id)
    when event_institution_id is not null then
      exists (
        select 1
        from public.institutions as institution
        where institution.id = event_institution_id
          and private.has_laundry_supervisor_site_access(
            institution.operating_site_id
          )
      )
    else false
  end
$$;

alter table public.operating_sites enable row level security;
alter table public.institutions enable row level security;
alter table public.user_access_profiles enable row level security;
alter table public.access_memberships enable row level security;
alter table public.authorization_audit_events enable row level security;

create policy operating_sites_select_in_scope
on public.operating_sites
for select
to authenticated
using (private.has_site_access(id));

create policy institutions_select_in_scope
on public.institutions
for select
to authenticated
using (private.has_institution_access(id));

create policy user_access_profiles_select_in_scope
on public.user_access_profiles
for select
to authenticated
using (
  private.has_current_access_profile(id)
  or private.can_manage_profile(id)
);

create policy access_memberships_select_in_scope
on public.access_memberships
for select
to authenticated
using (
  private.has_current_access_profile(user_access_profile_id)
  or private.can_manage_membership(id)
);

create policy authorization_audit_events_select_in_scope
on public.authorization_audit_events
for select
to authenticated
using (
  private.can_view_authorization_audit_event(
    operating_site_id,
    institution_id
  )
);

revoke all on table public.operating_sites from anon, authenticated;
revoke all on table public.institutions from anon, authenticated;
revoke all on table public.user_access_profiles from anon, authenticated;
revoke all on table public.access_memberships from anon, authenticated;
revoke all on table public.authorization_audit_events from anon, authenticated;

grant usage on schema public to authenticated;
grant usage on schema private to authenticated;
grant select on table public.operating_sites to authenticated;
grant select on table public.institutions to authenticated;
grant select on table public.user_access_profiles to authenticated;
grant select on table public.access_memberships to authenticated;
grant select on table public.authorization_audit_events to authenticated;
grant select on table public.authorization_audit_events to service_role;

revoke all on function public.current_access_context() from public;
revoke all on function public.authorize_current_user() from public;
grant execute on function public.current_access_context() to authenticated;
grant execute on function public.authorize_current_user() to authenticated;

revoke all on function private.has_site_access(uuid) from public;
revoke all on function private.has_laundry_supervisor_site_access(uuid) from public;
revoke all on function private.has_institution_access(uuid) from public;
revoke all on function private.has_current_access_profile(uuid) from public;
revoke all on function private.can_manage_membership(uuid) from public;
revoke all on function private.can_manage_profile(uuid) from public;
revoke all on function private.can_view_authorization_audit_event(uuid, uuid)
  from public;

grant execute on function private.has_site_access(uuid) to authenticated;
grant execute on function private.has_laundry_supervisor_site_access(uuid)
  to authenticated;
grant execute on function private.has_institution_access(uuid) to authenticated;
grant execute on function private.has_current_access_profile(uuid)
  to authenticated;
grant execute on function private.can_manage_membership(uuid) to authenticated;
grant execute on function private.can_manage_profile(uuid) to authenticated;
grant execute on function private.can_view_authorization_audit_event(uuid, uuid)
  to authenticated;

create table private.authorization_bootstrap_guard (
  singleton boolean primary key default true,
  constraint authorization_bootstrap_guard_singleton_check check (singleton)
);

insert into private.authorization_bootstrap_guard (singleton) values (true);

create table private.authorization_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  change_payload jsonb not null,
  applied_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Application roles have no direct DML privileges on access-control tables.
-- This atomic boundary derives its actor from auth.uid(), enforces the same
-- active-site supervisor scope used by RLS reads, and writes immutable audits.
create function public.apply_access_changes(
  change_rows jsonb,
  change_request_id uuid,
  change_reason text
)
returns table (
  applied_count integer,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_change_reason text;
  normalized_change_payload jsonb;
  change_row jsonb;
  normalized_email text;
  requested_role text;
  requested_site_code text;
  requested_institution_code text;
  requested_account_active boolean;
  requested_membership_active boolean;
  target_site_id uuid;
  target_institution_id uuid;
  target_profile public.user_access_profiles%rowtype;
  target_membership public.access_memberships%rowtype;
  target_profile_exists boolean;
  protected_supervisor_site_ids uuid[] := array[]::uuid[];
  profile_supervisor_site_ids uuid[];
  previous_state jsonb;
  inserted_request_count integer;
  changed_count integer := 0;
  has_duplicate_membership boolean := false;
  has_inconsistent_account_active boolean := false;
begin
  normalized_change_reason := regexp_replace(
    change_reason,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );

  if normalized_change_reason is null or normalized_change_reason = '' then
    raise exception 'change reason is required' using errcode = '22023';
  end if;

  if char_length(normalized_change_reason) > 500 then
    raise exception 'change reason must not exceed 500 characters'
      using errcode = '22023';
  end if;

  normalized_change_payload := jsonb_build_object(
    'change_rows', change_rows,
    'change_reason', normalized_change_reason
  );

  if current_actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if change_request_id is null then
    raise exception 'change request id is required' using errcode = '22023';
  end if;

  if jsonb_typeof(change_rows) <> 'array'
    or jsonb_array_length(change_rows) = 0
    or jsonb_array_length(change_rows) > 500 then
    raise exception 'change rows must contain between 1 and 500 entries'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from (
      select jsonb_build_array(
        lower(btrim(row_value ->> 'email')),
        row_value ->> 'role',
        nullif(upper(btrim(row_value ->> 'site_code')), ''),
        nullif(upper(btrim(row_value ->> 'institution_code')), '')
      ) as membership_key
      from jsonb_array_elements(change_rows) as rows(row_value)
    ) as normalized_rows
    group by membership_key
    having count(*) > 1
  ) into has_duplicate_membership;

  if has_duplicate_membership then
    raise exception 'duplicate membership in change rows'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(change_rows) as rows(row_value)
    group by lower(btrim(row_value ->> 'email'))
    having count(distinct row_value ->> 'account_active') > 1
  ) into has_inconsistent_account_active;

  if has_inconsistent_account_active then
    raise exception 'account_active must be consistent for each email'
      using errcode = '22023';
  end if;

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;

  if actor_access_profile_id is null then
    raise exception 'active access profile required' using errcode = '42501';
  end if;

  for change_row in
    select value from jsonb_array_elements(change_rows)
  loop
    normalized_email := lower(btrim(change_row ->> 'email'));
    requested_role := change_row ->> 'role';
    requested_site_code := nullif(upper(btrim(change_row ->> 'site_code')), '');
    requested_institution_code := nullif(
      upper(btrim(change_row ->> 'institution_code')),
      ''
    );

    if normalized_email is null
      or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'invalid access email' using errcode = '22023';
    end if;

    if jsonb_typeof(change_row -> 'account_active') <> 'boolean'
      or jsonb_typeof(change_row -> 'membership_active') <> 'boolean' then
      raise exception 'active flags must be boolean' using errcode = '22023';
    end if;

    requested_account_active := (change_row ->> 'account_active')::boolean;
    requested_membership_active :=
      (change_row ->> 'membership_active')::boolean;

    if requested_role in ('laundry_worker', 'laundry_supervisor') then
      if requested_site_code is null or requested_institution_code is not null then
        raise exception 'laundry roles require exactly one operating site'
          using errcode = '22023';
      end if;

      select site.id
      into target_site_id
      from public.operating_sites as site
      where site.code = requested_site_code
        and site.active;

      target_institution_id := null;
    elsif requested_role = 'institution_supervisor' then
      if requested_site_code is not null
        or requested_institution_code is null then
        raise exception 'institution supervisor requires exactly one institution'
          using errcode = '22023';
      end if;

      select institution.operating_site_id, institution.id
      into target_site_id, target_institution_id
      from public.institutions as institution
      join public.operating_sites as site
        on site.id = institution.operating_site_id
      where institution.code = requested_institution_code
        and institution.active
        and site.active;
    else
      raise exception 'unknown access role' using errcode = '22023';
    end if;

    if target_site_id is null then
      raise exception 'active access scope not found' using errcode = '22023';
    end if;

    if not private.has_laundry_supervisor_site_access(target_site_id) then
      raise exception 'access scope is outside supervisor authority'
        using errcode = '42501';
    end if;

    if exists (
      select 1
      from public.user_access_profiles as existing_profile
      join public.access_memberships as existing_membership
        on existing_membership.user_access_profile_id = existing_profile.id
      left join public.institutions as existing_institution
        on existing_institution.id = existing_membership.institution_id
      where existing_profile.email = normalized_email
        and existing_profile.active is distinct from requested_account_active
        and not private.has_laundry_supervisor_site_access(
          coalesce(
            existing_membership.operating_site_id,
            existing_institution.operating_site_id
          )
        )
    ) then
      raise exception 'account status is outside supervisor authority'
        using errcode = '42501';
    end if;
  end loop;

  insert into private.authorization_change_requests (
    id,
    actor_auth_user_id,
    change_payload
  ) values (
    change_request_id,
    current_actor_auth_user_id,
    normalized_change_payload
  )
  on conflict (id) do nothing;

  get diagnostics inserted_request_count = row_count;

  if inserted_request_count = 0 then
    if not exists (
      select 1
      from private.authorization_change_requests as request
      where request.id = change_request_id
        and request.actor_auth_user_id = current_actor_auth_user_id
        and request.change_payload = normalized_change_payload
    ) then
      raise exception 'request id cannot be reused for different changes'
        using errcode = '22023';
    end if;

    return query
      select request.applied_count, true
      from private.authorization_change_requests as request
      where request.id = change_request_id;
    return;
  end if;

  for change_row in
    select value from jsonb_array_elements(change_rows)
  loop
    normalized_email := lower(btrim(change_row ->> 'email'));
    requested_role := change_row ->> 'role';
    requested_site_code := nullif(upper(btrim(change_row ->> 'site_code')), '');
    requested_institution_code := nullif(
      upper(btrim(change_row ->> 'institution_code')),
      ''
    );
    requested_account_active := (change_row ->> 'account_active')::boolean;
    requested_membership_active :=
      (change_row ->> 'membership_active')::boolean;

    if requested_site_code is not null then
      select site.id
      into target_site_id
      from public.operating_sites as site
      where site.code = requested_site_code;
      target_institution_id := null;
    else
      select institution.operating_site_id, institution.id
      into target_site_id, target_institution_id
      from public.institutions as institution
      where institution.code = requested_institution_code;
    end if;

    if requested_role = 'laundry_supervisor' then
      protected_supervisor_site_ids := array_append(
        protected_supervisor_site_ids,
        target_site_id
      );
    end if;

    select profile.*
    into target_profile
    from public.user_access_profiles as profile
    where profile.email = normalized_email
    for update;

    target_profile_exists := found;

    if target_profile_exists
      and target_profile.active
      and not requested_account_active then
      select coalesce(
        array_agg(distinct membership.operating_site_id),
        array[]::uuid[]
      )
      into profile_supervisor_site_ids
      from public.access_memberships as membership
      join public.operating_sites as site
        on site.id = membership.operating_site_id
      where membership.user_access_profile_id = target_profile.id
        and membership.role = 'laundry_supervisor'
        and membership.active
        and membership.valid_from <= now()
        and (membership.valid_until is null or membership.valid_until > now())
        and site.active;

      protected_supervisor_site_ids :=
        protected_supervisor_site_ids || profile_supervisor_site_ids;
    end if;

    if target_profile_exists then
      previous_state := jsonb_build_object(
        'email', target_profile.email,
        'account_active', target_profile.active
      );

      update public.user_access_profiles
      set active = requested_account_active,
          updated_at = now()
      where id = target_profile.id
      returning * into target_profile;
    else
      previous_state := null;

      insert into public.user_access_profiles (email, active)
      values (normalized_email, requested_account_active)
      returning * into target_profile;
    end if;

    select membership.*
    into target_membership
    from public.access_memberships as membership
    where membership.user_access_profile_id = target_profile.id
      and membership.role = requested_role
      and (
        (
          target_institution_id is null
          and membership.operating_site_id = target_site_id
        )
        or membership.institution_id = target_institution_id
      )
    for update;

    if found then
      previous_state := coalesce(previous_state, '{}'::jsonb)
        || jsonb_build_object(
          'membership_active', target_membership.active,
          'role', target_membership.role,
          'valid_from', target_membership.valid_from,
          'valid_until', target_membership.valid_until
        );

      update public.access_memberships
      set active = requested_membership_active,
          valid_from = case
            when requested_membership_active
              then least(valid_from, now())
            else valid_from
          end,
          valid_until = case
            when requested_membership_active then null
            else valid_until
          end,
          updated_at = now()
      where id = target_membership.id
      returning * into target_membership;
    else
      insert into public.access_memberships (
        user_access_profile_id,
        role,
        operating_site_id,
        institution_id,
        active
      ) values (
        target_profile.id,
        requested_role,
        case when target_institution_id is null then target_site_id end,
        target_institution_id,
        requested_membership_active
      )
      returning * into target_membership;
    end if;

    insert into public.authorization_audit_events (
      actor_type,
      actor_auth_user_id,
      actor_access_profile_id,
      action,
      target_membership_id,
      operating_site_id,
      institution_id,
      outcome,
      reason,
      before_state,
      after_state,
      request_id
    ) values (
      'authenticated_user',
      current_actor_auth_user_id,
      actor_access_profile_id,
      'access_membership_upserted',
      target_membership.id,
      target_site_id,
      target_institution_id,
      'succeeded',
      normalized_change_reason,
      previous_state,
      jsonb_build_object(
        'email', target_profile.email,
        'account_active', target_profile.active,
        'role', target_membership.role,
        'membership_active', target_membership.active,
        'valid_from', target_membership.valid_from,
        'valid_until', target_membership.valid_until,
        'site_code', requested_site_code,
        'institution_code', requested_institution_code
      ),
      change_request_id
    );

    changed_count := changed_count + 1;
  end loop;

  perform site.id
  from public.operating_sites as site
  where site.id = any(protected_supervisor_site_ids)
  order by site.id
  for update;

  if exists (
    select 1
    from (
      select distinct protected_site_id
      from unnest(protected_supervisor_site_ids)
        as protected_sites(protected_site_id)
    ) as protected_site
    join public.operating_sites as site
      on site.id = protected_site.protected_site_id
    where site.active
      and not exists (
        select 1
        from public.access_memberships as supervisor_membership
        join public.user_access_profiles as supervisor_profile
          on supervisor_profile.id =
            supervisor_membership.user_access_profile_id
        where supervisor_membership.role = 'laundry_supervisor'
          and supervisor_membership.operating_site_id = site.id
          and supervisor_profile.active
          and supervisor_membership.active
          and supervisor_membership.valid_from <= now()
          and (
            supervisor_membership.valid_until is null
            or supervisor_membership.valid_until > now()
          )
      )
  ) then
    raise exception 'cannot deactivate the last active laundry supervisor'
      using errcode = '42501';
  end if;

  update private.authorization_change_requests
  set applied_count = changed_count
  where id = change_request_id;

  return query select changed_count, false;
end
$$;

revoke all on function public.apply_access_changes(jsonb, uuid, text) from public;
grant execute on function public.apply_access_changes(jsonb, uuid, text)
  to authenticated;

create function public.bootstrap_first_laundry_supervisor(
  bootstrap_email text,
  bootstrap_site_code text,
  bootstrap_request_id uuid
)
returns table (
  user_access_profile_id uuid,
  access_membership_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(bootstrap_email));
  normalized_site_code text := upper(btrim(bootstrap_site_code));
  target_site_id uuid;
  created_profile_id uuid;
  created_membership_id uuid;
begin
  if bootstrap_request_id is null then
    raise exception 'bootstrap request id is required' using errcode = '22023';
  end if;

  if normalized_email is null
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid bootstrap email' using errcode = '22023';
  end if;

  perform guard.singleton
  from private.authorization_bootstrap_guard as guard
  where guard.singleton
  for update;

  if not found then
    raise exception 'authorization bootstrap guard is unavailable';
  end if;

  select site.id
  into target_site_id
  from public.operating_sites as site
  where site.code = normalized_site_code
    and site.active;

  if target_site_id is null then
    raise exception 'active operating site not found' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.access_memberships as membership
    join public.user_access_profiles as profile
      on profile.id = membership.user_access_profile_id
    join public.operating_sites as site
      on site.id = membership.operating_site_id
    where membership.role = 'laundry_supervisor'
      and membership.operating_site_id = target_site_id
      and profile.active
      and membership.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and site.active
  ) then
    raise exception 'active laundry supervisor already exists'
      using errcode = '42501';
  end if;

  insert into public.user_access_profiles (email, active)
  values (normalized_email, true)
  on conflict (email) do update
  set active = true,
      updated_at = now()
  returning id into created_profile_id;

  select membership.id
  into created_membership_id
  from public.access_memberships as membership
  where membership.user_access_profile_id = created_profile_id
    and membership.role = 'laundry_supervisor'
    and membership.operating_site_id = target_site_id
  for update;

  if found then
    update public.access_memberships
    set active = true,
        valid_from = now(),
        valid_until = null,
        updated_at = now()
    where id = created_membership_id;
  else
    insert into public.access_memberships (
      user_access_profile_id,
      role,
      operating_site_id,
      active
    ) values (
      created_profile_id,
      'laundry_supervisor',
      target_site_id,
      true
    )
    returning id into created_membership_id;
  end if;

  insert into public.authorization_audit_events (
    actor_type,
    action,
    target_membership_id,
    operating_site_id,
    outcome,
    reason,
    after_state,
    request_id
  ) values (
    'system',
    'first_laundry_supervisor_bootstrapped',
    created_membership_id,
    target_site_id,
    'succeeded',
    'initial_access_bootstrap',
    jsonb_build_object(
      'email', normalized_email,
      'role', 'laundry_supervisor',
      'site_code', normalized_site_code
    ),
    bootstrap_request_id
  );

  return query select created_profile_id, created_membership_id;
end
$$;

revoke all on function public.bootstrap_first_laundry_supervisor(
  text,
  text,
  uuid
) from public;
grant execute on function public.bootstrap_first_laundry_supervisor(
  text,
  text,
  uuid
) to service_role;

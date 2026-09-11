alter table public.user_access_profiles
  add column login_name text generated always as (
    lower(split_part(email, '@', 1))
  ) stored,
  add column notification_email text,
  add column must_change_password boolean not null default false,
  add constraint user_access_profiles_notification_email_check check (
    notification_email is null
    or (
      notification_email = lower(btrim(notification_email))
      and notification_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create unique index user_access_profiles_login_name_unique
  on public.user_access_profiles (login_name);

create table private.password_change_baselines (
  user_access_profile_id uuid primary key
    references public.user_access_profiles(id) on delete cascade,
  password_fingerprint bytea not null,
  captured_at timestamptz not null default now()
);

revoke all on table private.password_change_baselines from public;
revoke all on table private.password_change_baselines from anon, authenticated;

create or replace function public.authorize_current_user()
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
  encrypted_password text;
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
    auth_user.raw_app_meta_data ->> 'provider',
    auth_user.encrypted_password
  into normalized_email, email_is_confirmed, auth_provider, encrypted_password
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

  if auth_provider is distinct from 'email' then
    perform private.record_login_denial(
      current_auth_user_id,
      null,
      'non_password_provider'
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

  if not access_profile.active and not access_profile.must_change_password then
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

  if access_profile.must_change_password then
    if encrypted_password is null or encrypted_password = '' then
      perform private.record_login_denial(
        current_auth_user_id,
        access_profile.id,
        'password_credential_missing'
      );

      return query select false, 'not_authorized'::text;
      return;
    end if;

    insert into private.password_change_baselines (
      user_access_profile_id,
      password_fingerprint
    ) values (
      access_profile.id,
      extensions.digest(
        pg_catalog.convert_to(encrypted_password, 'utf8'),
        'sha256'
      )
    )
    on conflict (user_access_profile_id) do nothing;
  end if;

  return query select true, null::text;
end
$$;

revoke all on function public.authorize_current_user() from public;
grant execute on function public.authorize_current_user() to authenticated;

create function public.current_account_security_state()
returns table (
  login_name text,
  password_change_required boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.login_name, profile.must_change_password
  from public.user_access_profiles as profile
  join auth.users as auth_user
    on auth_user.id = profile.auth_user_id
  where profile.auth_user_id = (select auth.uid())
    and (
      profile.active
      or profile.must_change_password
    )
    and auth_user.email_confirmed_at is not null
    and auth_user.raw_app_meta_data ->> 'provider' = 'email'
$$;

create function public.complete_required_password_change()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auth_user_id uuid := auth.uid();
  access_profile public.user_access_profiles%rowtype;
  baseline_fingerprint bytea;
  current_fingerprint bytea;
begin
  if current_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select profile.*
  into access_profile
  from public.user_access_profiles as profile
  join auth.users as auth_user
    on auth_user.id = profile.auth_user_id
  where profile.auth_user_id = current_auth_user_id
    and auth_user.email_confirmed_at is not null
    and auth_user.raw_app_meta_data ->> 'provider' = 'email'
  for update of profile;

  if not found then
    raise exception 'authorized password account required' using errcode = '42501';
  end if;

  if not access_profile.must_change_password then
    return false;
  end if;

  select baseline.password_fingerprint
  into baseline_fingerprint
  from private.password_change_baselines as baseline
  where baseline.user_access_profile_id = access_profile.id;

  select extensions.digest(
    pg_catalog.convert_to(auth_user.encrypted_password, 'utf8'),
    'sha256'
  )
  into current_fingerprint
  from auth.users as auth_user
  where auth_user.id = current_auth_user_id
    and auth_user.encrypted_password is not null
    and auth_user.encrypted_password <> '';

  if baseline_fingerprint is null
    or current_fingerprint is null
    or baseline_fingerprint = current_fingerprint then
    raise exception 'password has not changed' using errcode = '42501';
  end if;

  update public.user_access_profiles
  set active = true,
      must_change_password = false,
      updated_at = now()
  where id = access_profile.id;

  insert into public.authorization_audit_events (
    actor_type,
    actor_auth_user_id,
    actor_access_profile_id,
    action,
    outcome,
    before_state,
    after_state
  ) values (
    'authenticated_user',
    current_auth_user_id,
    access_profile.id,
    'required_password_change_completed',
    'succeeded',
    jsonb_build_object('password_change_required', true),
    jsonb_build_object('password_change_required', false)
  );

  return true;
end
$$;

revoke all on function public.current_account_security_state() from public;
revoke all on function public.complete_required_password_change() from public;
grant execute on function public.current_account_security_state() to authenticated;
grant execute on function public.complete_required_password_change() to authenticated;

create table private.password_supervisor_bootstrap_requests (
  request_id uuid primary key,
  login_name text not null,
  notification_email text,
  operating_site_id uuid not null references public.operating_sites(id),
  user_access_profile_id uuid not null references public.user_access_profiles(id),
  access_membership_id uuid not null references public.access_memberships(id),
  created_at timestamptz not null default now()
);

revoke all on table private.password_supervisor_bootstrap_requests from public;
revoke all on table private.password_supervisor_bootstrap_requests
  from anon, authenticated;

create function public.bootstrap_first_password_laundry_supervisor(
  bootstrap_login_name text,
  bootstrap_notification_email text,
  bootstrap_site_code text,
  bootstrap_request_id uuid
)
returns table (
  user_access_profile_id uuid,
  access_membership_id uuid,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  normalized_login_name text := lower(btrim(bootstrap_login_name));
  normalized_notification_email text := nullif(
    lower(btrim(bootstrap_notification_email)),
    ''
  );
  normalized_site_code text := upper(btrim(bootstrap_site_code));
  internal_auth_email text;
  target_site_id uuid;
  created_profile_id uuid;
  created_membership_id uuid;
  previous_request private.password_supervisor_bootstrap_requests%rowtype;
begin
  if bootstrap_request_id is null then
    raise exception 'bootstrap request id is required' using errcode = '22023';
  end if;

  if normalized_login_name is null
    or normalized_login_name !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    raise exception 'invalid login name' using errcode = '22023';
  end if;

  if normalized_notification_email is not null
    and normalized_notification_email
      !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid notification email' using errcode = '22023';
  end if;

  internal_auth_email := normalized_login_name || '@auth.wash-room.invalid';

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

  select request.*
  into previous_request
  from private.password_supervisor_bootstrap_requests as request
  where request.request_id = bootstrap_request_id;

  if found then
    if previous_request.login_name <> normalized_login_name
      or previous_request.notification_email
        is distinct from normalized_notification_email
      or previous_request.operating_site_id <> target_site_id then
      raise exception 'bootstrap request id payload mismatch'
        using errcode = '22023';
    end if;

    return query select
      previous_request.user_access_profile_id,
      previous_request.access_membership_id,
      true;
    return;
  end if;

  if exists (
    select 1
    from public.access_memberships as membership
    join public.user_access_profiles as profile
      on profile.id = membership.user_access_profile_id
    where membership.role = 'laundry_supervisor'
      and membership.operating_site_id = target_site_id
      and profile.active
      and membership.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
  ) then
    raise exception 'active laundry supervisor already exists'
      using errcode = '42501';
  end if;

  insert into public.user_access_profiles (
    email,
    notification_email,
    active,
    must_change_password
  ) values (
    internal_auth_email,
    normalized_notification_email,
    false,
    true
  )
  on conflict (email) do update
  set notification_email = coalesce(
        excluded.notification_email,
        public.user_access_profiles.notification_email
      ),
      updated_at = now()
  returning id into created_profile_id;

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
  on conflict (user_access_profile_id, role, operating_site_id)
    where operating_site_id is not null
  do update
  set active = true,
      valid_from = now(),
      valid_until = null,
      updated_at = now()
  returning id into created_membership_id;

  insert into private.password_supervisor_bootstrap_requests (
    request_id,
    login_name,
    notification_email,
    operating_site_id,
    user_access_profile_id,
    access_membership_id
  ) values (
    bootstrap_request_id,
    normalized_login_name,
    normalized_notification_email,
    target_site_id,
    created_profile_id,
    created_membership_id
  );

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
    'first_password_laundry_supervisor_bootstrapped',
    created_membership_id,
    target_site_id,
    'succeeded',
    'initial_password_access_bootstrap',
    jsonb_build_object(
      'login_name', normalized_login_name,
      'role', 'laundry_supervisor',
      'site_code', normalized_site_code,
      'password_change_required', true
    ),
    bootstrap_request_id
  );

  return query select created_profile_id, created_membership_id, false;
end
$$;

revoke all on function public.bootstrap_first_password_laundry_supervisor(
  text,
  text,
  text,
  uuid
) from public;
grant execute on function public.bootstrap_first_password_laundry_supervisor(
  text,
  text,
  text,
  uuid
) to service_role;

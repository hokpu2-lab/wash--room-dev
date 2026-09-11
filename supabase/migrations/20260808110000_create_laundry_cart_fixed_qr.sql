create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.laundry_carts (
  id uuid primary key default gen_random_uuid(),
  cart_number text not null unique,
  institution_id uuid not null references public.institutions(id),
  active boolean not null default true,
  current_qr_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint laundry_carts_number_format_check check (
    cart_number = upper(btrim(cart_number))
    and cart_number ~ '^[A-Z0-9][A-Z0-9_-]*$'
    and char_length(cart_number) <= 40
  ),
  constraint laundry_carts_qr_version_check
    check (current_qr_version > 0)
);

create index laundry_carts_institution_id_idx
  on public.laundry_carts (institution_id, cart_number);

create table private.fixed_asset_qr_signing_keys (
  id smallint primary key,
  signing_secret bytea not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint fixed_asset_qr_signing_keys_secret_check
    check (octet_length(signing_secret) = 32)
);

insert into private.fixed_asset_qr_signing_keys (id, signing_secret)
values (1, extensions.gen_random_bytes(32));

create function private.protect_fixed_asset_qr_signing_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    or new.id <> old.id
    or new.signing_secret <> old.signing_secret
    or new.created_at <> old.created_at then
    raise exception 'fixed asset QR signing key is immutable'
      using errcode = '55000';
  end if;

  return new;
end
$$;

create trigger protect_fixed_asset_qr_signing_key
before update or delete on private.fixed_asset_qr_signing_keys
for each row execute function private.protect_fixed_asset_qr_signing_key();

create table private.laundry_cart_qr_credentials (
  id uuid primary key default gen_random_uuid(),
  laundry_cart_id uuid not null references public.laundry_carts(id),
  version integer not null,
  nonce bytea not null,
  signing_key_id smallint not null
    references private.fixed_asset_qr_signing_keys(id),
  token_hash bytea not null unique,
  issued_by_auth_user_id uuid not null,
  issued_at timestamptz not null default now(),
  issuance_reason text not null,
  revoked_by_auth_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  constraint laundry_cart_qr_credentials_version_check
    check (version > 0),
  constraint laundry_cart_qr_credentials_nonce_check
    check (octet_length(nonce) = 32),
  constraint laundry_cart_qr_credentials_hash_check
    check (octet_length(token_hash) = 32),
  constraint laundry_cart_qr_credentials_reason_check
    check (
      char_length(btrim(issuance_reason)) between 1 and 500
    ),
  constraint laundry_cart_qr_credentials_revocation_check check (
    (
      revoked_at is null
      and revoked_by_auth_user_id is null
      and revocation_reason is null
    )
    or
    (
      revoked_at is not null
      and revoked_by_auth_user_id is not null
      and char_length(btrim(revocation_reason)) between 1 and 500
    )
  ),
  unique (laundry_cart_id, version)
);

create unique index laundry_cart_qr_credentials_one_current_idx
  on private.laundry_cart_qr_credentials (laundry_cart_id)
  where revoked_at is null;

create function private.protect_laundry_cart_qr_credential_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'QR credential history is immutable'
      using errcode = '55000';
  end if;

  if old.revoked_at is not null
    or new.id <> old.id
    or new.laundry_cart_id <> old.laundry_cart_id
    or new.version <> old.version
    or new.nonce <> old.nonce
    or new.signing_key_id <> old.signing_key_id
    or new.token_hash <> old.token_hash
    or new.issued_by_auth_user_id <> old.issued_by_auth_user_id
    or new.issued_at <> old.issued_at
    or new.issuance_reason <> old.issuance_reason
    or new.revoked_at is null
    or new.revoked_by_auth_user_id is null
    or new.revocation_reason is null then
    raise exception 'QR credential history is immutable'
      using errcode = '55000';
  end if;

  return new;
end
$$;

create trigger protect_laundry_cart_qr_credential_history
before update or delete on private.laundry_cart_qr_credentials
for each row execute function
  private.protect_laundry_cart_qr_credential_history();

create table private.laundry_cart_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  laundry_cart_id uuid references public.laundry_carts(id),
  result_qr_version integer,
  created_at timestamptz not null default now(),
  constraint laundry_cart_change_requests_operation_check check (
    operation in ('register', 'set_active', 'reissue_qr')
  ),
  constraint laundry_cart_change_requests_result_check check (
    (laundry_cart_id is null and result_qr_version is null)
    or
    (laundry_cart_id is not null and result_qr_version > 0)
  )
);

create table public.laundry_cart_denial_audit_aggregates (
  actor_auth_user_id uuid not null,
  operation text not null,
  scope_key text not null,
  operating_site_id uuid references public.operating_sites(id),
  institution_id uuid references public.institutions(id),
  laundry_cart_id uuid references public.laundry_carts(id),
  first_attempted_at timestamptz not null,
  last_attempted_at timestamptz not null,
  total_attempt_count bigint not null default 1,
  window_started_at timestamptz not null,
  window_attempt_count bigint not null default 1,
  primary key (actor_auth_user_id, operation, scope_key),
  constraint laundry_cart_denial_audit_aggregates_operation_check check (
    operation in ('register', 'set_active', 'reissue_qr')
  ),
  constraint laundry_cart_denial_audit_aggregates_scope_key_check check (
    char_length(scope_key) between 1 and 160
  ),
  constraint laundry_cart_denial_audit_aggregates_time_check check (
    first_attempted_at <= window_started_at
    and window_started_at <= last_attempted_at
  ),
  constraint laundry_cart_denial_audit_aggregates_count_check check (
    total_attempt_count >= window_attempt_count
    and window_attempt_count > 0
  ),
  constraint laundry_cart_denial_audit_aggregates_scope_check check (
    (institution_id is null or operating_site_id is not null)
    and (
      laundry_cart_id is null
      or (
        operating_site_id is not null
        and institution_id is not null
      )
    )
  )
);

alter table public.authorization_audit_events
  add column laundry_cart_id uuid references public.laundry_carts(id);

create index authorization_audit_events_laundry_cart_id_idx
  on public.authorization_audit_events (laundry_cart_id, occurred_at desc)
  where laundry_cart_id is not null;

create function private.base64url(value bytea)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select translate(
    rtrim(pg_catalog.encode(value, 'base64'), '='),
    '+/',
    '-_'
  )
$$;

create function private.is_safe_laundry_cart_change_reason(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    value is not null
    and char_length(value) between 1 and 500
    and value !~* 'wrq_v[0-9]+\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
$$;

create function private.should_audit_laundry_cart_denial(
  target_actor_auth_user_id uuid,
  target_operation text,
  target_operating_site_id uuid,
  target_institution_id uuid,
  target_laundry_cart_id uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  attempted_at timestamptz := now();
  target_scope_key text;
  inserted_aggregate_count integer;
begin
  if target_actor_auth_user_id is null
    or target_operation is null
    or target_operation not in ('register', 'set_active', 'reissue_qr')
    or (
      target_institution_id is not null
      and target_operating_site_id is null
    )
    or (
      target_laundry_cart_id is not null
      and (
        target_operating_site_id is null
        or target_institution_id is null
      )
    ) then
    raise exception 'invalid laundry cart denial throttle input'
      using errcode = '22023';
  end if;

  target_scope_key := case
    when target_laundry_cart_id is not null then
      'site:' || target_operating_site_id::text
      || ':institution:' || target_institution_id::text
      || ':cart:' || target_laundry_cart_id::text
    when target_institution_id is not null then
      'site:' || target_operating_site_id::text
      || ':institution:' || target_institution_id::text
    when target_operating_site_id is not null then
      'site:' || target_operating_site_id::text
    else 'unscoped'
  end;

  insert into public.laundry_cart_denial_audit_aggregates as aggregate (
    actor_auth_user_id,
    operation,
    scope_key,
    operating_site_id,
    institution_id,
    laundry_cart_id,
    first_attempted_at,
    last_attempted_at,
    total_attempt_count,
    window_started_at,
    window_attempt_count
  ) values (
    target_actor_auth_user_id,
    target_operation,
    target_scope_key,
    target_operating_site_id,
    target_institution_id,
    target_laundry_cart_id,
    attempted_at,
    attempted_at,
    1,
    attempted_at,
    1
  )
  on conflict (actor_auth_user_id, operation, scope_key) do nothing;

  get diagnostics inserted_aggregate_count = row_count;

  if inserted_aggregate_count = 1 then
    return true;
  end if;

  update public.laundry_cart_denial_audit_aggregates as aggregate
  set window_started_at = case
        when aggregate.window_started_at
          <= attempted_at - interval '1 hour'
          then attempted_at
        else aggregate.window_started_at
      end,
      last_attempted_at = attempted_at,
      total_attempt_count = aggregate.total_attempt_count + 1,
      window_attempt_count = case
        when aggregate.window_started_at
          <= attempted_at - interval '1 hour'
          then 1
        else aggregate.window_attempt_count + 1
      end
  where aggregate.actor_auth_user_id = target_actor_auth_user_id
    and aggregate.operation = target_operation
    and aggregate.scope_key = target_scope_key;

  return false;
end
$$;

create function private.build_laundry_cart_qr_token(
  target_laundry_cart_id uuid,
  target_version integer,
  target_nonce bytea,
  signing_secret bytea
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select
    'wrq_v1.'
    || private.base64url(target_nonce)
    || '.'
    || private.base64url(
      extensions.hmac(
        pg_catalog.convert_to(
          target_laundry_cart_id::text
          || ':'
          || target_version::text
          || ':'
          || pg_catalog.encode(target_nonce, 'hex'),
          'utf8'
        ),
        signing_secret,
        'sha256'
      )
    )
$$;

create function private.has_laundry_cart_supervisor_access(
  target_laundry_cart_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.laundry_carts as cart
    join public.institutions as institution
      on institution.id = cart.institution_id
    where cart.id = target_laundry_cart_id
      and private.has_laundry_supervisor_site_access(
        institution.operating_site_id
      )
  )
$$;

alter table public.laundry_carts enable row level security;
alter table public.laundry_cart_denial_audit_aggregates
  enable row level security;

create policy laundry_carts_select_in_supervised_site
on public.laundry_carts
for select
to authenticated
using (private.has_laundry_cart_supervisor_access(id));

create policy laundry_cart_denial_audit_aggregates_select_in_scope
on public.laundry_cart_denial_audit_aggregates
for select
to authenticated
using (
  operating_site_id is not null
  and private.has_laundry_supervisor_site_access(operating_site_id)
);

revoke all on table public.laundry_carts
  from anon, authenticated, service_role;
revoke all on table private.fixed_asset_qr_signing_keys
  from public, anon, authenticated, service_role;
revoke all on table private.laundry_cart_qr_credentials
  from public, anon, authenticated, service_role;
revoke all on table private.laundry_cart_change_requests
  from public, anon, authenticated, service_role;
revoke all on table public.laundry_cart_denial_audit_aggregates
  from anon, authenticated, service_role;
grant select on table public.laundry_carts to authenticated;
grant select on table public.laundry_cart_denial_audit_aggregates
  to authenticated, service_role;

create function public.register_laundry_cart(
  requested_cart_number text,
  target_institution_code text,
  change_request_id uuid,
  change_reason text
)
returns table (
  laundry_cart_id uuid,
  qr_version integer,
  already_applied boolean,
  outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_cart_number text := upper(btrim(requested_cart_number));
  normalized_institution_code text := upper(btrim(target_institution_code));
  normalized_change_reason text := regexp_replace(
    change_reason,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  target_institution_id uuid;
  target_site_id uuid;
  target_site_code text;
  created_laundry_cart_id uuid;
  credential_nonce bytea;
  signing_key_id smallint;
  signing_secret bytea;
  qr_token text;
  normalized_change_payload jsonb;
  inserted_request_count integer;
  existing_request private.laundry_cart_change_requests%rowtype;
begin
  if current_actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if change_request_id is null then
    raise exception 'change request id is required' using errcode = '22023';
  end if;

  if normalized_cart_number is null
    or char_length(normalized_cart_number) > 40
    or normalized_cart_number !~ '^[A-Z0-9][A-Z0-9_-]*$' then
    raise exception 'invalid laundry cart number' using errcode = '22023';
  end if;

  if not private.is_safe_laundry_cart_change_reason(
    normalized_change_reason
  ) then
    raise exception 'invalid change reason' using errcode = '22023';
  end if;

  select institution.id, site.id, site.code
  into target_institution_id, target_site_id, target_site_code
  from public.institutions as institution
  join public.operating_sites as site
    on site.id = institution.operating_site_id
  where institution.code = normalized_institution_code
    and institution.active
    and site.active
  for share of institution, site;

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;

  if target_institution_id is null
    or not private.has_laundry_supervisor_site_access(target_site_id) then
    if private.should_audit_laundry_cart_denial(
      current_actor_auth_user_id,
      'register',
      target_site_id,
      target_institution_id,
      null
    ) then
      insert into public.authorization_audit_events (
      actor_type,
      actor_auth_user_id,
      actor_access_profile_id,
      action,
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
      'laundry_cart_registration_denied',
      target_site_id,
      target_institution_id,
      'denied',
      normalized_change_reason,
      null,
      jsonb_build_object(
        'cart_number', normalized_cart_number,
        'institution_code', normalized_institution_code,
        'active', true
      ),
        change_request_id
      );
    end if;

    return query
    select null::uuid, null::integer, false, 'denied'::text;
    return;
  end if;

  normalized_change_payload := jsonb_build_object(
    'cart_number', normalized_cart_number,
    'institution_code', normalized_institution_code,
    'change_reason', normalized_change_reason
  );

  insert into private.laundry_cart_change_requests (
    id,
    actor_auth_user_id,
    operation,
    change_payload
  ) values (
    change_request_id,
    current_actor_auth_user_id,
    'register',
    normalized_change_payload
  )
  on conflict (id) do nothing;

  get diagnostics inserted_request_count = row_count;

  if inserted_request_count = 0 then
    select request.*
    into existing_request
    from private.laundry_cart_change_requests as request
    where request.id = change_request_id;

    if existing_request.actor_auth_user_id <> current_actor_auth_user_id then
      raise exception 'request id belongs to another actor'
        using errcode = '42501';
    end if;

    if existing_request.operation <> 'register'
      or existing_request.change_payload <> normalized_change_payload then
      raise exception 'request id already used with different change'
        using errcode = '22023';
    end if;

    if existing_request.laundry_cart_id is null
      or existing_request.result_qr_version is null then
      raise exception 'request result unavailable';
    end if;

    return query
    select
      existing_request.laundry_cart_id,
      existing_request.result_qr_version,
      true,
      'applied'::text;
    return;
  end if;

  insert into public.laundry_carts (
    cart_number,
    institution_id
  ) values (
    normalized_cart_number,
    target_institution_id
  )
  returning id into created_laundry_cart_id;

  select signing_key.id, signing_key.signing_secret
  into signing_key_id, signing_secret
  from private.fixed_asset_qr_signing_keys as signing_key
  where signing_key.active
  order by signing_key.id desc
  limit 1;

  if signing_key_id is null then
    raise exception 'QR signing key unavailable';
  end if;

  credential_nonce := extensions.gen_random_bytes(32);
  qr_token := private.build_laundry_cart_qr_token(
    created_laundry_cart_id,
    1,
    credential_nonce,
    signing_secret
  );

  insert into private.laundry_cart_qr_credentials (
    laundry_cart_id,
    version,
    nonce,
    signing_key_id,
    token_hash,
    issued_by_auth_user_id,
    issuance_reason
  ) values (
    created_laundry_cart_id,
    1,
    credential_nonce,
    signing_key_id,
    extensions.digest(pg_catalog.convert_to(qr_token, 'utf8'), 'sha256'),
    current_actor_auth_user_id,
    normalized_change_reason
  );

  insert into public.authorization_audit_events (
    actor_type,
    actor_auth_user_id,
    actor_access_profile_id,
    action,
    operating_site_id,
    institution_id,
    laundry_cart_id,
    outcome,
    reason,
    before_state,
    after_state,
    request_id
  ) values (
    'authenticated_user',
    current_actor_auth_user_id,
    actor_access_profile_id,
    'laundry_cart_registered',
    target_site_id,
    target_institution_id,
    created_laundry_cart_id,
    'succeeded',
    normalized_change_reason,
    null,
    jsonb_build_object(
      'cart_number', normalized_cart_number,
      'institution_code', normalized_institution_code,
      'site_code', target_site_code,
      'active', true,
      'qr_version', 1
    ),
    change_request_id
  );

  update private.laundry_cart_change_requests
  set laundry_cart_id = created_laundry_cart_id,
      result_qr_version = 1
  where id = change_request_id;

  return query
  select created_laundry_cart_id, 1, false, 'applied'::text;
end
$$;

create function public.get_current_laundry_cart_qr(
  target_laundry_cart_id uuid
)
returns table (
  laundry_cart_id uuid,
  cart_number text,
  qr_version integer,
  qr_token text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    cart.id,
    cart.cart_number,
    credential.version,
    private.build_laundry_cart_qr_token(
      cart.id,
      credential.version,
      credential.nonce,
      signing_key.signing_secret
    )
  from public.laundry_carts as cart
  join private.laundry_cart_qr_credentials as credential
    on credential.laundry_cart_id = cart.id
   and credential.version = cart.current_qr_version
   and credential.revoked_at is null
  join private.fixed_asset_qr_signing_keys as signing_key
    on signing_key.id = credential.signing_key_id
  where cart.id = target_laundry_cart_id
    and private.has_laundry_cart_supervisor_access(cart.id)
$$;

create function public.set_laundry_cart_active(
  target_laundry_cart_id uuid,
  target_active boolean,
  change_request_id uuid,
  change_reason text
)
returns table (
  laundry_cart_id uuid,
  qr_version integer,
  already_applied boolean,
  outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_change_reason text := regexp_replace(
    change_reason,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  existing_cart_id uuid;
  existing_cart_active boolean;
  existing_cart_qr_version integer;
  target_institution_id uuid;
  target_institution_code text;
  target_site_id uuid;
  target_site_code text;
  normalized_change_payload jsonb;
  inserted_request_count integer;
  existing_request private.laundry_cart_change_requests%rowtype;
  audit_action text;
begin
  if current_actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_laundry_cart_id is null
    or target_active is null
    or change_request_id is null then
    raise exception 'invalid laundry cart active-state request'
      using errcode = '22023';
  end if;

  if not private.is_safe_laundry_cart_change_reason(
    normalized_change_reason
  ) then
    raise exception 'invalid change reason' using errcode = '22023';
  end if;

  select
    cart.id,
    cart.active,
    cart.current_qr_version,
    institution.id,
    institution.code,
    site.id,
    site.code
  into
    existing_cart_id,
    existing_cart_active,
    existing_cart_qr_version,
    target_institution_id,
    target_institution_code,
    target_site_id,
    target_site_code
  from public.laundry_carts as cart
  join public.institutions as institution
    on institution.id = cart.institution_id
  join public.operating_sites as site
    on site.id = institution.operating_site_id
  where cart.id = target_laundry_cart_id
  for update of cart
  for share of institution, site;

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;

  if existing_cart_id is null
    or not private.has_laundry_cart_supervisor_access(
      target_laundry_cart_id
    ) then
    if private.should_audit_laundry_cart_denial(
      current_actor_auth_user_id,
      'set_active',
      target_site_id,
      target_institution_id,
      existing_cart_id
    ) then
      insert into public.authorization_audit_events (
      actor_type,
      actor_auth_user_id,
      actor_access_profile_id,
      action,
      operating_site_id,
      institution_id,
      laundry_cart_id,
      outcome,
      reason,
      before_state,
      after_state,
      request_id
      ) values (
      'authenticated_user',
      current_actor_auth_user_id,
      actor_access_profile_id,
      'laundry_cart_active_change_denied',
      target_site_id,
      target_institution_id,
      existing_cart_id,
      'denied',
      normalized_change_reason,
      case
        when existing_cart_id is null then null
        else jsonb_build_object(
          'active', existing_cart_active,
          'qr_version', existing_cart_qr_version
        )
      end,
      jsonb_build_object('active', target_active),
        change_request_id
      );
    end if;

    return query
    select null::uuid, null::integer, false, 'denied'::text;
    return;
  end if;

  normalized_change_payload := jsonb_build_object(
    'laundry_cart_id', target_laundry_cart_id,
    'active', target_active,
    'change_reason', normalized_change_reason
  );

  insert into private.laundry_cart_change_requests (
    id,
    actor_auth_user_id,
    operation,
    change_payload
  ) values (
    change_request_id,
    current_actor_auth_user_id,
    'set_active',
    normalized_change_payload
  )
  on conflict (id) do nothing;

  get diagnostics inserted_request_count = row_count;

  if inserted_request_count = 0 then
    select request.*
    into existing_request
    from private.laundry_cart_change_requests as request
    where request.id = change_request_id;

    if existing_request.actor_auth_user_id <> current_actor_auth_user_id then
      raise exception 'request id belongs to another actor'
        using errcode = '42501';
    end if;

    if existing_request.operation <> 'set_active'
      or existing_request.change_payload <> normalized_change_payload then
      raise exception 'request id already used with different change'
        using errcode = '22023';
    end if;

    return query
    select
      existing_request.laundry_cart_id,
      existing_request.result_qr_version,
      true,
      'applied'::text;
    return;
  end if;

  if existing_cart_active <> target_active then
    update public.laundry_carts
    set active = target_active,
        updated_at = now()
    where id = target_laundry_cart_id;

    audit_action := case
      when target_active then 'laundry_cart_activated'
      else 'laundry_cart_deactivated'
    end;

    insert into public.authorization_audit_events (
      actor_type,
      actor_auth_user_id,
      actor_access_profile_id,
      action,
      operating_site_id,
      institution_id,
      laundry_cart_id,
      outcome,
      reason,
      before_state,
      after_state,
      request_id
    ) values (
      'authenticated_user',
      current_actor_auth_user_id,
      actor_access_profile_id,
      audit_action,
      target_site_id,
      target_institution_id,
      target_laundry_cart_id,
      'succeeded',
      normalized_change_reason,
      jsonb_build_object(
        'active', existing_cart_active,
        'qr_version', existing_cart_qr_version
      ),
      jsonb_build_object(
        'active', target_active,
        'qr_version', existing_cart_qr_version
      ),
      change_request_id
    );
  end if;

  update private.laundry_cart_change_requests
  set laundry_cart_id = target_laundry_cart_id,
      result_qr_version = existing_cart_qr_version
  where id = change_request_id;

  return query
  select
    target_laundry_cart_id,
    existing_cart_qr_version,
    false,
    'applied'::text;
end
$$;

create function public.reissue_laundry_cart_qr(
  target_laundry_cart_id uuid,
  change_request_id uuid,
  change_reason text
)
returns table (
  laundry_cart_id uuid,
  qr_version integer,
  already_applied boolean,
  outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_change_reason text := regexp_replace(
    change_reason,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  existing_cart_id uuid;
  existing_cart_active boolean;
  existing_qr_version integer;
  target_institution_id uuid;
  target_site_id uuid;
  target_site_code text;
  normalized_change_payload jsonb;
  inserted_request_count integer;
  existing_request private.laundry_cart_change_requests%rowtype;
  next_qr_version integer;
  next_nonce bytea;
  next_signing_key_id smallint;
  next_signing_secret bytea;
  next_qr_token text;
  revoked_credential_count integer;
begin
  if current_actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_laundry_cart_id is null or change_request_id is null then
    raise exception 'invalid laundry cart QR reissue request'
      using errcode = '22023';
  end if;

  if not private.is_safe_laundry_cart_change_reason(
    normalized_change_reason
  ) then
    raise exception 'invalid change reason' using errcode = '22023';
  end if;

  select
    cart.id,
    cart.active,
    cart.current_qr_version,
    institution.id,
    site.id,
    site.code
  into
    existing_cart_id,
    existing_cart_active,
    existing_qr_version,
    target_institution_id,
    target_site_id,
    target_site_code
  from public.laundry_carts as cart
  join public.institutions as institution
    on institution.id = cart.institution_id
  join public.operating_sites as site
    on site.id = institution.operating_site_id
  where cart.id = target_laundry_cart_id
  for update of cart
  for share of institution, site;

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;

  if existing_cart_id is null
    or not private.has_laundry_cart_supervisor_access(
      target_laundry_cart_id
    ) then
    if private.should_audit_laundry_cart_denial(
      current_actor_auth_user_id,
      'reissue_qr',
      target_site_id,
      target_institution_id,
      existing_cart_id
    ) then
      insert into public.authorization_audit_events (
      actor_type,
      actor_auth_user_id,
      actor_access_profile_id,
      action,
      operating_site_id,
      institution_id,
      laundry_cart_id,
      outcome,
      reason,
      before_state,
      after_state,
      request_id
      ) values (
      'authenticated_user',
      current_actor_auth_user_id,
      actor_access_profile_id,
      'laundry_cart_qr_reissue_denied',
      target_site_id,
      target_institution_id,
      existing_cart_id,
      'denied',
      normalized_change_reason,
      case
        when existing_cart_id is null then null
        else jsonb_build_object(
          'active', existing_cart_active,
          'qr_version', existing_qr_version
        )
      end,
      null,
        change_request_id
      );
    end if;

    return query
    select null::uuid, null::integer, false, 'denied'::text;
    return;
  end if;

  normalized_change_payload := jsonb_build_object(
    'laundry_cart_id', target_laundry_cart_id,
    'change_reason', normalized_change_reason
  );

  insert into private.laundry_cart_change_requests (
    id,
    actor_auth_user_id,
    operation,
    change_payload
  ) values (
    change_request_id,
    current_actor_auth_user_id,
    'reissue_qr',
    normalized_change_payload
  )
  on conflict (id) do nothing;

  get diagnostics inserted_request_count = row_count;

  if inserted_request_count = 0 then
    select request.*
    into existing_request
    from private.laundry_cart_change_requests as request
    where request.id = change_request_id;

    if existing_request.actor_auth_user_id <> current_actor_auth_user_id then
      raise exception 'request id belongs to another actor'
        using errcode = '42501';
    end if;

    if existing_request.operation <> 'reissue_qr'
      or existing_request.change_payload <> normalized_change_payload then
      raise exception 'request id already used with different change'
        using errcode = '22023';
    end if;

    if existing_request.laundry_cart_id is null
      or existing_request.result_qr_version is null then
      raise exception 'request result unavailable';
    end if;

    return query
    select
      existing_request.laundry_cart_id,
      existing_request.result_qr_version,
      true,
      'applied'::text;
    return;
  end if;

  next_qr_version := existing_qr_version + 1;

  select signing_key.id, signing_key.signing_secret
  into next_signing_key_id, next_signing_secret
  from private.fixed_asset_qr_signing_keys as signing_key
  where signing_key.active
  order by signing_key.id desc
  limit 1;

  if next_signing_key_id is null then
    raise exception 'QR signing key unavailable';
  end if;

  update private.laundry_cart_qr_credentials as credential
  set revoked_by_auth_user_id = current_actor_auth_user_id,
      revoked_at = now(),
      revocation_reason = normalized_change_reason
  where credential.laundry_cart_id = target_laundry_cart_id
    and credential.version = existing_qr_version
    and credential.revoked_at is null;

  get diagnostics revoked_credential_count = row_count;

  if revoked_credential_count <> 1 then
    raise exception 'current QR credential unavailable';
  end if;

  next_nonce := extensions.gen_random_bytes(32);
  next_qr_token := private.build_laundry_cart_qr_token(
    target_laundry_cart_id,
    next_qr_version,
    next_nonce,
    next_signing_secret
  );

  insert into private.laundry_cart_qr_credentials (
    laundry_cart_id,
    version,
    nonce,
    signing_key_id,
    token_hash,
    issued_by_auth_user_id,
    issuance_reason
  ) values (
    target_laundry_cart_id,
    next_qr_version,
    next_nonce,
    next_signing_key_id,
    extensions.digest(
      pg_catalog.convert_to(next_qr_token, 'utf8'),
      'sha256'
    ),
    current_actor_auth_user_id,
    normalized_change_reason
  );

  update public.laundry_carts
  set current_qr_version = next_qr_version,
      updated_at = now()
  where id = target_laundry_cart_id;

  insert into public.authorization_audit_events (
    actor_type,
    actor_auth_user_id,
    actor_access_profile_id,
    action,
    operating_site_id,
    institution_id,
    laundry_cart_id,
    outcome,
    reason,
    before_state,
    after_state,
    request_id
  ) values (
    'authenticated_user',
    current_actor_auth_user_id,
    actor_access_profile_id,
    'laundry_cart_qr_reissued',
    target_site_id,
    target_institution_id,
    target_laundry_cart_id,
    'succeeded',
    normalized_change_reason,
    jsonb_build_object(
      'active', existing_cart_active,
      'qr_version', existing_qr_version
    ),
    jsonb_build_object(
      'active', existing_cart_active,
      'qr_version', next_qr_version
    ),
    change_request_id
  );

  update private.laundry_cart_change_requests
  set laundry_cart_id = target_laundry_cart_id,
      result_qr_version = next_qr_version
  where id = change_request_id;

  return query
  select target_laundry_cart_id, next_qr_version, false, 'applied'::text;
end
$$;

create function public.resolve_laundry_cart_qr(qr_token text)
returns table (
  laundry_cart_id uuid,
  cart_number text,
  institution_id uuid,
  operating_site_id uuid,
  qr_version integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    cart.id,
    cart.cart_number,
    institution.id,
    site.id,
    credential.version
  from private.laundry_cart_qr_credentials as credential
  join public.laundry_carts as cart
    on cart.id = credential.laundry_cart_id
   and cart.current_qr_version = credential.version
  join public.institutions as institution
    on institution.id = cart.institution_id
  join public.operating_sites as site
    on site.id = institution.operating_site_id
  where qr_token ~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$'
    and credential.token_hash = extensions.digest(
      pg_catalog.convert_to(qr_token, 'utf8'),
      'sha256'
    )
    and credential.revoked_at is null
    and cart.active
    and institution.active
    and site.active
$$;

revoke all on function private.base64url(bytea) from public;
revoke all on function private.protect_fixed_asset_qr_signing_key()
  from public;
revoke all on function private.is_safe_laundry_cart_change_reason(text)
  from public;
revoke all on function private.should_audit_laundry_cart_denial(
  uuid,
  text,
  uuid,
  uuid,
  uuid
) from public;
revoke all on function private.build_laundry_cart_qr_token(
  uuid,
  integer,
  bytea,
  bytea
) from public;
revoke all on function private.has_laundry_cart_supervisor_access(uuid)
  from public;
grant execute on function private.has_laundry_cart_supervisor_access(uuid)
  to authenticated;
revoke all on function public.register_laundry_cart(text, text, uuid, text)
  from public;
revoke all on function public.get_current_laundry_cart_qr(uuid)
  from public;
revoke all on function public.set_laundry_cart_active(
  uuid,
  boolean,
  uuid,
  text
) from public;
revoke all on function public.reissue_laundry_cart_qr(uuid, uuid, text)
  from public;
revoke all on function public.resolve_laundry_cart_qr(text)
  from public;

grant execute on function public.register_laundry_cart(text, text, uuid, text)
  to authenticated;
grant execute on function public.get_current_laundry_cart_qr(uuid)
  to authenticated;
grant execute on function public.set_laundry_cart_active(
  uuid,
  boolean,
  uuid,
  text
) to authenticated;
grant execute on function public.reissue_laundry_cart_qr(uuid, uuid, text)
  to authenticated;
grant execute on function public.resolve_laundry_cart_qr(text)
  to service_role;

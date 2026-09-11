create table public.laundry_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  laundry_cart_id uuid not null references public.laundry_carts(id),
  institution_id uuid not null references public.institutions(id),
  operating_site_id uuid not null references public.operating_sites(id),
  status text not null default 'awaiting_receipt',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint laundry_orders_number_check check (
    order_number ~ '^[A-Z0-9][A-Z0-9_-]*-[0-9]{8}-[0-9]{4}$'
  ),
  constraint laundry_orders_status_check check (
    status in ('awaiting_receipt', 'awaiting_cleaning', 'in_process', 'ready_for_pickup', 'picked_up')
  ),
  constraint laundry_orders_closed_check check (
    (status = 'picked_up' and closed_at is not null)
    or (status <> 'picked_up' and closed_at is null)
  )
);

create index laundry_orders_site_status_idx
  on public.laundry_orders (operating_site_id, status, created_at desc);
create index laundry_orders_institution_idx
  on public.laundry_orders (institution_id, created_at desc);
create unique index laundry_orders_one_open_cart_idx
  on public.laundry_orders (laundry_cart_id)
  where closed_at is null;

create table private.laundry_order_sequences (
  operating_site_id uuid not null references public.operating_sites(id),
  sequence_date date not null,
  next_value integer not null default 1,
  primary key (operating_site_id, sequence_date),
  constraint laundry_order_sequences_next_value_check check (next_value > 0)
);

create table private.laundry_order_change_requests (
  id uuid primary key,
  token_hash bytea not null,
  operation text not null,
  laundry_order_id uuid references public.laundry_orders(id),
  result_order_number text,
  result_status text,
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_order_change_operation_check check (operation = 'create_from_cart_qr'),
  constraint laundry_order_change_outcome_check check (outcome in ('applied', 'denied')),
  constraint laundry_order_change_reason_check check (
    reason_code in ('created', 'already_applied', 'invalid_qr', 'revoked_qr',
      'inactive_cart', 'inactive_institution', 'inactive_site', 'missing_pairing',
      'existing_open_order', 'rate_limited', 'request_replay')
  )
);

create table private.laundry_order_anonymous_rate_limit (
  bucket_key text primary key default 'global',
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  constraint laundry_order_rate_limit_bucket_check check (bucket_key = 'global'),
  constraint laundry_order_rate_limit_count_check check (attempt_count >= 0)
);

alter table public.laundry_orders enable row level security;

create policy laundry_orders_select_in_site_scope
on public.laundry_orders
for select to authenticated
using (
  private.has_site_access(operating_site_id)
  or exists (
    select 1
    from public.access_memberships membership
    join public.user_access_profiles profile
      on profile.id = membership.user_access_profile_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and membership.role = 'institution_supervisor'
      and membership.institution_id = laundry_orders.institution_id
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
  )
);

revoke all on table public.laundry_orders from anon, authenticated, service_role;
revoke all on table private.laundry_order_sequences,
  private.laundry_order_change_requests,
  private.laundry_order_anonymous_rate_limit
  from public, anon, authenticated, service_role;
grant select on table public.laundry_orders to authenticated;

create function private.allow_laundry_order_anonymous_attempt()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_value timestamptz := now();
  current_count integer;
begin
  insert into private.laundry_order_anonymous_rate_limit (
    bucket_key, window_started_at, attempt_count
  ) values ('global', now_value, 1)
  on conflict (bucket_key) do update
  set window_started_at = case
        when private.laundry_order_anonymous_rate_limit.window_started_at
          <= now_value - interval '1 minute'
          then now_value
        else private.laundry_order_anonymous_rate_limit.window_started_at
      end,
      attempt_count = case
        when private.laundry_order_anonymous_rate_limit.window_started_at
          <= now_value - interval '1 minute'
          then 1
        else private.laundry_order_anonymous_rate_limit.attempt_count + 1
      end
  returning attempt_count into current_count;
  return current_count <= 120;
end
$$;

create function public.create_laundry_order_from_cart_qr(
  qr_token text,
  change_request_id uuid
)
returns table (
  laundry_order_id uuid,
  order_number text,
  status text,
  already_applied boolean,
  outcome text,
  reason_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_token text := btrim(qr_token);
  request_hash bytea;
  current_request private.laundry_order_change_requests%rowtype;
  inserted_request_count integer;
  cart_id uuid;
  cart_active boolean;
  institution_id uuid;
  institution_active boolean;
  site_id uuid;
  site_code text;
  site_active boolean;
  credential_version integer;
  existing_order public.laundry_orders%rowtype;
  target_sequence_date date := current_date;
  next_sequence integer;
  created_order_id uuid;
  created_order_number text;
begin
  if change_request_id is null then
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'request_replay'::text;
    return;
  end if;

  if normalized_token is null
    or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'invalid_qr'::text;
    return;
  end if;

  request_hash := extensions.digest(
    pg_catalog.convert_to(normalized_token, 'utf8'), 'sha256'
  );

  select request.*
  into current_request
  from private.laundry_order_change_requests request
  where request.id = change_request_id;

  if found then
    if current_request.token_hash <> request_hash
      or current_request.operation <> 'create_from_cart_qr' then
      return query select null::uuid, null::text, null::text, false, 'denied'::text, 'request_replay'::text;
      return;
    end if;
    return query select
      current_request.laundry_order_id,
      current_request.result_order_number,
      current_request.result_status,
      true,
      current_request.outcome,
      case when current_request.outcome = 'applied'
        then 'already_applied' else current_request.reason_code end;
    return;
  end if;

  if not private.allow_laundry_order_anonymous_attempt() then
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'rate_limited'::text;
    return;
  end if;

  select
    cart.id,
    cart.active,
    institution.id,
    institution.active,
    site.id,
    site.code,
    site.active,
    credential.version
  into
    cart_id,
    cart_active,
    institution_id,
    institution_active,
    site_id,
    site_code,
    site_active,
    credential_version
  from private.laundry_cart_qr_credentials credential
  join public.laundry_carts cart
    on cart.id = credential.laundry_cart_id
   and cart.current_qr_version = credential.version
  join public.institutions institution
    on institution.id = cart.institution_id
  join public.operating_sites site
    on site.id = institution.operating_site_id
  where credential.token_hash = request_hash
    and credential.revoked_at is null
  for update of cart
  for share of institution, site;

  if cart_id is null then
    insert into private.laundry_order_change_requests (
      id, token_hash, operation, outcome, reason_code
    ) values (
      change_request_id, request_hash, 'create_from_cart_qr', 'denied', 'invalid_qr'
    ) on conflict (id) do nothing;
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'invalid_qr'::text;
    return;
  end if;

  if not cart_active then
    insert into private.laundry_order_change_requests (
      id, token_hash, operation, outcome, reason_code
    ) values (change_request_id, request_hash, 'create_from_cart_qr', 'denied', 'inactive_cart')
    on conflict (id) do nothing;
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'inactive_cart'::text;
    return;
  end if;
  if institution_id is null then
    insert into private.laundry_order_change_requests (
      id, token_hash, operation, outcome, reason_code
    ) values (change_request_id, request_hash, 'create_from_cart_qr', 'denied', 'missing_pairing')
    on conflict (id) do nothing;
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'missing_pairing'::text;
    return;
  end if;
  if not institution_active then
    insert into private.laundry_order_change_requests (
      id, token_hash, operation, outcome, reason_code
    ) values (change_request_id, request_hash, 'create_from_cart_qr', 'denied', 'inactive_institution')
    on conflict (id) do nothing;
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'inactive_institution'::text;
    return;
  end if;
  if site_id is null then
    insert into private.laundry_order_change_requests (
      id, token_hash, operation, outcome, reason_code
    ) values (change_request_id, request_hash, 'create_from_cart_qr', 'denied', 'missing_pairing')
    on conflict (id) do nothing;
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'missing_pairing'::text;
    return;
  end if;
  if not site_active then
    insert into private.laundry_order_change_requests (
      id, token_hash, operation, outcome, reason_code
    ) values (change_request_id, request_hash, 'create_from_cart_qr', 'denied', 'inactive_site')
    on conflict (id) do nothing;
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'inactive_site'::text;
    return;
  end if;

  select existing_candidate.*
  into existing_order
  from public.laundry_orders existing_candidate
  where existing_candidate.laundry_cart_id = cart_id
    and existing_candidate.closed_at is null
  order by existing_candidate.created_at desc
  limit 1;

  if found then
    insert into private.laundry_order_change_requests (
      id, token_hash, operation, outcome, reason_code
    ) values (change_request_id, request_hash, 'create_from_cart_qr', 'denied', 'existing_open_order')
    on conflict (id) do nothing;
    return query select null::uuid, null::text, null::text, false, 'denied'::text, 'existing_open_order'::text;
    return;
  end if;

  insert into private.laundry_order_sequences (operating_site_id, sequence_date, next_value)
  values (site_id, target_sequence_date, 1)
  on conflict (operating_site_id, sequence_date) do nothing;
  select order_sequence.next_value
  into next_sequence
  from private.laundry_order_sequences order_sequence
  where order_sequence.operating_site_id = site_id
    and order_sequence.sequence_date = target_sequence_date
  for update;
  update private.laundry_order_sequences order_sequence
  set next_value = next_sequence + 1
  where order_sequence.operating_site_id = site_id
    and order_sequence.sequence_date = target_sequence_date;

  created_order_number := site_code || '-' || to_char(target_sequence_date, 'YYYYMMDD')
    || '-' || lpad(next_sequence::text, 4, '0');
  insert into public.laundry_orders (
    order_number, laundry_cart_id, institution_id, operating_site_id, status
  ) values (
    created_order_number, cart_id, institution_id, site_id, 'awaiting_receipt'
  ) returning id into created_order_id;

  insert into private.laundry_order_change_requests (
    id, token_hash, operation, laundry_order_id, result_order_number,
    result_status, outcome, reason_code
  ) values (
    change_request_id, request_hash, 'create_from_cart_qr', created_order_id,
    created_order_number, 'awaiting_receipt', 'applied', 'created'
  );

  insert into public.authorization_audit_events (
    actor_type, action, operating_site_id, institution_id,
    laundry_cart_id, outcome, reason, before_state, after_state, request_id
  ) values (
    'system', 'laundry_order_created_from_cart_qr', site_id, institution_id,
    cart_id, 'succeeded', 'anonymous fixed QR送單', null,
    jsonb_build_object(
      'laundry_order_id', created_order_id,
      'order_number', created_order_number,
      'status', 'awaiting_receipt',
      'cart_qr_version', credential_version
    ), change_request_id
  );

  return query select created_order_id, created_order_number,
    'awaiting_receipt'::text, false, 'applied'::text, 'created'::text;
end
$$;

revoke all on function private.allow_laundry_order_anonymous_attempt() from public;
revoke all on function public.create_laundry_order_from_cart_qr(text, uuid) from public;
grant execute on function public.create_laundry_order_from_cart_qr(text, uuid) to anon, authenticated;

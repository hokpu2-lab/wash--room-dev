create table public.laundry_batches (
  id uuid primary key default gen_random_uuid(),
  laundry_order_id uuid not null references public.laundry_orders(id),
  source_laundry_cart_id uuid not null references public.laundry_carts(id),
  operating_site_id uuid not null references public.operating_sites(id),
  laundry_category_id uuid not null references public.laundry_categories(id),
  procedure_template_id uuid not null references public.procedure_templates(id),
  procedure_version_id uuid not null references public.procedure_template_versions(id),
  status text not null default 'not_started',
  quantity_scale text not null default 'one_cart',
  current_stage_order integer not null default 1,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint laundry_batches_status_check check (
    status in ('not_started', 'in_progress', 'paused', 'completed', 'failed', 'cancelled')
  ),
  constraint laundry_batches_quantity_scale_check check (quantity_scale = 'one_cart'),
  constraint laundry_batches_stage_order_check check (current_stage_order > 0),
  constraint laundry_batches_completed_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  unique (laundry_order_id, laundry_category_id)
);

create index laundry_batches_site_status_idx
  on public.laundry_batches (operating_site_id, status, created_at);
create index laundry_batches_order_idx
  on public.laundry_batches (laundry_order_id, created_at);

create table private.laundry_receipt_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  laundry_order_id uuid references public.laundry_orders(id),
  batch_count integer,
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_receipt_operation_check check (operation = 'receive_order'),
  constraint laundry_receipt_outcome_check check (outcome in ('applied', 'denied')),
  constraint laundry_receipt_reason_check check (
    reason_code in ('received', 'already_applied', 'invalid_qr', 'worker_scope_denied',
      'inactive_cart', 'order_not_receivable', 'invalid_categories',
      'incompatible_category', 'missing_published_procedure', 'request_replay')
  )
);

create function private.has_laundry_worker_site_access(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_memberships membership
    join public.user_access_profiles profile
      on profile.id = membership.user_access_profile_id
    join public.operating_sites site
      on site.id = membership.operating_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.role = 'laundry_worker'
      and membership.active
      and membership.operating_site_id = target_site_id
      and site.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
  )
$$;

alter table public.laundry_batches enable row level security;

create policy laundry_batches_select_in_site_scope
on public.laundry_batches
for select to authenticated
using (private.has_site_access(operating_site_id));

revoke all on table public.laundry_batches from anon, authenticated, service_role;
revoke all on table private.laundry_receipt_change_requests
  from public, anon, authenticated, service_role;
grant select on table public.laundry_batches to authenticated;

create function public.receive_laundry_order_from_cart_qr(
  qr_token text,
  selected_category_codes jsonb,
  change_request_id uuid
)
returns table (
  laundry_order_id uuid,
  batch_count integer,
  already_applied boolean,
  outcome text,
  status text,
  reason_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_token text := btrim(qr_token);
  request_hash bytea;
  normalized_categories jsonb;
  existing_request private.laundry_receipt_change_requests%rowtype;
  inserted_request_count integer;
  target_cart_id uuid;
  target_cart_active boolean;
  target_institution_id uuid;
  target_site_id uuid;
  target_order public.laundry_orders%rowtype;
  category_code text;
  category_id uuid;
  template_id uuid;
  published_version_id uuid;
  category_count integer;
  batch_ids jsonb := '[]'::jsonb;
  normalized_payload jsonb;
begin
  if actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if change_request_id is null
    or normalized_token is null
    or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$'
    or selected_category_codes is null
    or jsonb_typeof(selected_category_codes) <> 'array'
    or jsonb_array_length(selected_category_codes) = 0
    or jsonb_array_length(selected_category_codes) > 30 then
    return query select null::uuid, 0, false, 'denied'::text,
      null::text, 'invalid_categories'::text;
    return;
  end if;

  select jsonb_agg(code order by code)
  into normalized_categories
  from (
    select distinct upper(btrim(value)) as code
    from jsonb_array_elements_text(selected_category_codes)
  ) category_values;
  if normalized_categories is null
    or jsonb_array_length(normalized_categories) = 0
    or exists (
      select 1 from jsonb_array_elements_text(normalized_categories) item
      where item.value is null or item.value !~ '^[A-Z][A-Z0-9_-]{0,39}$'
    ) then
    return query select null::uuid, 0, false, 'denied'::text,
      null::text, 'invalid_categories'::text;
    return;
  end if;

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles profile
  where profile.auth_user_id = actor_auth_user_id
    and profile.active;
  request_hash := extensions.digest(
    pg_catalog.convert_to(normalized_token, 'utf8'), 'sha256'
  );

  select request.*
  into existing_request
  from private.laundry_receipt_change_requests request
  where request.id = change_request_id;
  if found then
    if existing_request.actor_auth_user_id <> actor_auth_user_id
      or existing_request.change_payload <> jsonb_build_object(
        'qr_token_hash', encode(request_hash, 'hex'),
        'category_codes', normalized_categories
      ) then
      return query select null::uuid, 0, false, 'denied'::text,
        null::text, 'request_replay'::text;
      return;
    end if;
    return query select existing_request.laundry_order_id,
      coalesce(existing_request.batch_count, 0), true,
      existing_request.outcome, case when existing_request.outcome = 'applied'
        then 'awaiting_cleaning' else null end,
      case when existing_request.outcome = 'applied'
        then 'already_applied' else existing_request.reason_code end;
    return;
  end if;

  select cart.id, cart.active, institution.id, institution.operating_site_id
  into target_cart_id, target_cart_active, target_institution_id, target_site_id
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
    and institution.active
    and site.active
  for update of cart
  for share of institution, site;

  if target_cart_id is null then
    return query select null::uuid, 0, false, 'denied'::text,
      null::text, 'invalid_qr'::text;
    return;
  end if;
  if not target_cart_active then
    return query select null::uuid, 0, false, 'denied'::text,
      null::text, 'inactive_cart'::text;
    return;
  end if;
  if not private.has_laundry_worker_site_access(target_site_id) then
    return query select null::uuid, 0, false, 'denied'::text,
      null::text, 'worker_scope_denied'::text;
    return;
  end if;

  select order_record.*
  into target_order
  from public.laundry_orders order_record
  where order_record.laundry_cart_id = target_cart_id
    and order_record.closed_at is null
    and order_record.status = 'awaiting_receipt'
  order by order_record.created_at desc
  limit 1
  for update;
  if not found then
    return query select null::uuid, 0, false, 'denied'::text,
      null::text, 'order_not_receivable'::text;
    return;
  end if;

  -- Validate every selected category and its published procedure before any
  -- batch row is written. This keeps a mixed valid/invalid selection atomic.
  for category_code in
    select value from jsonb_array_elements_text(normalized_categories)
  loop
    select category.id
    into category_id
    from public.laundry_categories category
    where category.code = category_code
      and category.active;
    if category_id is null then
      return query select null::uuid, 0, false, 'denied'::text,
        null::text, 'incompatible_category'::text;
      return;
    end if;
    select template.id, version.id
    into template_id, published_version_id
    from public.procedure_templates template
    join public.procedure_template_versions version
      on version.procedure_template_id = template.id
     and version.status = 'published'
    where template.operating_site_id = target_site_id
      and template.laundry_category_id = category_id
      and template.active
    order by version.version_no desc
    limit 1;
    if template_id is null or published_version_id is null then
      return query select null::uuid, 0, false, 'denied'::text,
        null::text, 'missing_published_procedure'::text;
      return;
    end if;
  end loop;

  normalized_payload := jsonb_build_object(
    'qr_token_hash', encode(request_hash, 'hex'),
    'category_codes', normalized_categories
  );
  insert into private.laundry_receipt_change_requests (
    id, actor_auth_user_id, operation, change_payload, laundry_order_id,
    outcome, reason_code
  ) values (
    change_request_id, actor_auth_user_id, 'receive_order', normalized_payload,
    target_order.id, 'denied', 'invalid_categories'
  ) on conflict (id) do nothing;
  get diagnostics inserted_request_count = row_count;
  if inserted_request_count = 0 then
    raise exception 'receipt request replay rejected' using errcode = '42501';
  end if;

  for category_code in
    select value from jsonb_array_elements_text(normalized_categories)
  loop
    select category.id
    into category_id
    from public.laundry_categories category
    where category.code = category_code
      and category.active;
    if category_id is null then
      update private.laundry_receipt_change_requests
      set outcome = 'denied', reason_code = 'incompatible_category'
      where id = change_request_id;
      return query select null::uuid, 0, false, 'denied'::text,
        null::text, 'incompatible_category'::text;
      return;
    end if;

    select template.id, version.id
    into template_id, published_version_id
    from public.procedure_templates template
    join public.procedure_template_versions version
      on version.procedure_template_id = template.id
     and version.status = 'published'
    where template.operating_site_id = target_site_id
      and template.laundry_category_id = category_id
      and template.active
    order by version.version_no desc
    limit 1;
    if template_id is null or published_version_id is null then
      update private.laundry_receipt_change_requests
      set outcome = 'denied', reason_code = 'missing_published_procedure'
      where id = change_request_id;
      return query select null::uuid, 0, false, 'denied'::text,
        null::text, 'missing_published_procedure'::text;
      return;
    end if;

    insert into public.laundry_batches (
      laundry_order_id, source_laundry_cart_id, operating_site_id,
      laundry_category_id, procedure_template_id, procedure_version_id,
      status, quantity_scale, current_stage_order, created_by_auth_user_id
    ) values (
      target_order.id, target_cart_id, target_site_id, category_id,
      template_id, published_version_id, 'not_started', 'one_cart', 1,
      actor_auth_user_id
    ) returning id into template_id;
    batch_ids := batch_ids || jsonb_build_array(template_id);
  end loop;

  category_count := jsonb_array_length(normalized_categories);
  update public.laundry_orders
  set status = 'awaiting_cleaning', updated_at = now()
  where id = target_order.id;
  update private.laundry_receipt_change_requests
  set outcome = 'applied', reason_code = 'received', batch_count = category_count
  where id = change_request_id;
  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id,
    operating_site_id, institution_id, laundry_cart_id,
    action, outcome, reason, before_state, after_state, request_id
  ) values (
    'authenticated_user', actor_auth_user_id, actor_access_profile_id,
    target_site_id, target_institution_id, target_cart_id,
    'laundry_order_received', 'succeeded', '洗衣員掃車收單並選擇分類',
    jsonb_build_object('status', 'awaiting_receipt'),
    jsonb_build_object(
      'status', 'awaiting_cleaning',
      'category_codes', normalized_categories,
      'batch_ids', batch_ids,
      'quantity_scale', 'one_cart'
    ), change_request_id
  );
  return query select target_order.id, category_count, false,
    'applied'::text, 'awaiting_cleaning'::text, 'received'::text;
end
$$;

revoke all on function private.has_laundry_worker_site_access(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.receive_laundry_order_from_cart_qr(text, jsonb, uuid)
  from public;
grant execute on function public.receive_laundry_order_from_cart_qr(text, jsonb, uuid)
  to authenticated;

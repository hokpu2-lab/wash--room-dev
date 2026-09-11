alter table public.laundry_batches add column loaded_at timestamptz;
alter table public.laundry_batches add constraint laundry_batches_loaded_check check (
  (status = 'loaded' and loaded_at is not null) or (status <> 'loaded' and loaded_at is null)
);
alter table public.authorization_audit_events
  add column laundry_order_id uuid references public.laundry_orders(id);
create index authorization_audit_events_laundry_order_idx
  on public.authorization_audit_events (laundry_order_id, occurred_at desc)
  where laundry_order_id is not null;

create table private.laundry_loading_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  laundry_batch_id uuid references public.laundry_batches(id),
  laundry_order_id uuid references public.laundry_orders(id),
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_loading_operation_check check (operation = 'load_batch'),
  constraint laundry_loading_outcome_check check (outcome in ('applied', 'denied')),
  constraint laundry_loading_reason_check check (
    reason_code in ('loaded', 'invalid_qr', 'worker_scope_denied', 'cart_scope_denied',
      'cart_unavailable', 'batch_not_ready', 'wrong_stage', 'request_replay')
  )
);

create table private.laundry_pickup_change_requests (
  id uuid primary key,
  token_hash bytea not null,
  laundry_order_id uuid references public.laundry_orders(id),
  result_order_number text,
  result_status text,
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_pickup_outcome_check check (outcome in ('applied', 'denied')),
  constraint laundry_pickup_reason_check check (
    reason_code in ('picked_up', 'already_picked_up', 'invalid_qr', 'not_pickup_ready', 'request_replay')
  )
);

revoke all on table private.laundry_loading_change_requests,
  private.laundry_pickup_change_requests from public, anon, authenticated, service_role;

create function public.load_laundry_batch_to_source_cart(
  target_laundry_batch_id uuid,
  cart_qr_token text,
  change_request_id uuid
)
returns table (
  laundry_batch_id uuid,
  laundry_order_id uuid,
  already_applied boolean,
  outcome text,
  batch_status text,
  order_status text,
  reason_code text
)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); profile_id uuid;
  normalized_token text := btrim(cart_qr_token); token_digest bytea; payload jsonb;
  existing private.laundry_loading_change_requests%rowtype;
  batch public.laundry_batches%rowtype; order_record public.laundry_orders%rowtype;
  cart public.laundry_carts%rowtype; current_run public.laundry_batch_stage_runs%rowtype;
  inserted_count integer; remaining integer; all_loaded boolean;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if target_laundry_batch_id is null or change_request_id is null
    or normalized_token is null or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return query select target_laundry_batch_id, null::uuid, false, 'denied'::text, null::text, null::text, 'invalid_qr'::text; return;
  end if;
  token_digest := extensions.digest(pg_catalog.convert_to(normalized_token,'utf8'),'sha256');
  payload := jsonb_build_object('qr_token_hash', encode(token_digest,'hex'), 'laundry_batch_id', target_laundry_batch_id);
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id = actor and p.active;
  select r.* into existing from private.laundry_loading_change_requests r where r.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select target_laundry_batch_id, null::uuid, false, 'denied'::text, null::text, null::text, 'request_replay'::text; return;
    end if;
    return query select existing.laundry_batch_id, existing.laundry_order_id, true, existing.outcome,
      'loaded'::text, 'ready_for_pickup'::text, existing.reason_code; return;
  end if;
  select b.* into batch from public.laundry_batches b where b.id = target_laundry_batch_id for update;
  if not found then return query select target_laundry_batch_id, null::uuid, false, 'denied'::text, null::text, null::text, 'batch_not_ready'::text; return; end if;
  select o.* into order_record from public.laundry_orders o where o.id = batch.laundry_order_id for update;
  if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then
    return query select batch.id, batch.laundry_order_id, false, 'denied'::text, null::text, null::text, 'worker_scope_denied'::text; return;
  end if;
  select c.* into cart
  from private.laundry_cart_qr_credentials credential
  join public.laundry_carts c on c.id = credential.laundry_cart_id and c.current_qr_version = credential.version
  where credential.token_hash = token_digest and credential.revoked_at is null for update;
  if not found then return query select batch.id, batch.laundry_order_id, false, 'denied'::text, null::text, null::text, 'invalid_qr'::text; return; end if;
  if cart.id <> batch.source_laundry_cart_id then return query select batch.id, batch.laundry_order_id, false, 'denied'::text, null::text, null::text, 'cart_scope_denied'::text; return; end if;
  if not cart.active then return query select batch.id, batch.laundry_order_id, false, 'denied'::text, null::text, null::text, 'cart_unavailable'::text; return; end if;
  if batch.status = 'loaded' then
    return query select batch.id, batch.laundry_order_id, true, 'applied'::text, 'loaded'::text, order_record.status, 'loaded'::text; return;
  end if;
  if batch.status not in ('awaiting_cart', 'in_progress') then
    return query select batch.id, batch.laundry_order_id, false, 'denied'::text, batch.status, order_record.status, 'batch_not_ready'::text; return;
  end if;
  if batch.status = 'in_progress' then
    select run.* into current_run from public.laundry_batch_stage_runs run where run.id = batch.active_stage_run_id for update;
    if not found or current_run.status <> 'in_progress' or exists (
      select 1 from public.procedure_template_stages stage
      where stage.procedure_version_id = batch.procedure_version_id and stage.stage_order > batch.current_stage_order
    ) then
      return query select batch.id, batch.laundry_order_id, false, 'denied'::text, batch.status, order_record.status, 'wrong_stage'::text; return;
    end if;
    update public.laundry_batch_stage_runs set status = 'completed', completed_at = now(), updated_at = now() where id = current_run.id;
    update public.laundry_equipment set occupied = false, updated_at = now() where id = current_run.laundry_equipment_id;
  end if;
  insert into private.laundry_loading_change_requests(
    id, actor_auth_user_id, operation, change_payload, laundry_batch_id, laundry_order_id, outcome, reason_code
  ) values(change_request_id, actor, 'load_batch', payload, batch.id, order_record.id, 'applied', 'loaded') on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then raise exception 'loading request replay rejected' using errcode = '42501'; end if;
  update public.laundry_batches set status = 'loaded', loaded_at = now(), active_stage_run_id = null, updated_at = now() where id = batch.id;
  select not exists (
    select 1 from public.laundry_batches sibling
    where sibling.laundry_order_id = order_record.id and sibling.status not in ('loaded','cancelled')
  ) into all_loaded;
  if all_loaded then
    update public.laundry_orders set status = 'ready_for_pickup', updated_at = now() where id = order_record.id;
  end if;
  insert into public.authorization_audit_events(
    actor_type, actor_auth_user_id, actor_access_profile_id, operating_site_id,
    laundry_order_id, laundry_batch_id, laundry_cart_id, action, outcome, reason, before_state, after_state, request_id
  ) values('authenticated_user', actor, profile_id, batch.operating_site_id, order_record.id, batch.id, batch.source_laundry_cart_id,
    'laundry_batch_loaded_to_source_cart', 'succeeded', '洗衣員裝回來源車',
    jsonb_build_object('batch_status', batch.status, 'order_status', order_record.status),
    jsonb_build_object('batch_status','loaded','order_status',case when all_loaded then 'ready_for_pickup' else order_record.status end), change_request_id);
  return query select batch.id, order_record.id, false, 'applied'::text, 'loaded'::text,
    case when all_loaded then 'ready_for_pickup' else order_record.status end, 'loaded'::text;
end
$$;

create function public.pickup_laundry_order_from_cart_qr(
  qr_token text,
  change_request_id uuid
)
returns table (
  laundry_order_id uuid,
  order_number text,
  already_applied boolean,
  outcome text,
  status text,
  reason_code text
)
language plpgsql security definer set search_path = '' as $$
declare
  normalized_token text := btrim(qr_token); token_digest bytea;
  existing private.laundry_pickup_change_requests%rowtype;
  order_record public.laundry_orders%rowtype; cart_id uuid; inserted_count integer;
begin
  if change_request_id is null or normalized_token is null
    or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return query select null::uuid, null::text, false, 'denied'::text, null::text, 'invalid_qr'::text; return;
  end if;
  token_digest := extensions.digest(pg_catalog.convert_to(normalized_token,'utf8'),'sha256');
  select r.* into existing from private.laundry_pickup_change_requests r where r.id = change_request_id;
  if found then
    return query select existing.laundry_order_id, existing.result_order_number, true, existing.outcome,
      existing.result_status, case when existing.outcome = 'applied' then 'already_picked_up' else existing.reason_code end; return;
  end if;
  select c.id into cart_id
  from private.laundry_cart_qr_credentials credential
  join public.laundry_carts c on c.id = credential.laundry_cart_id and c.current_qr_version = credential.version
  join public.institutions institution on institution.id = c.institution_id
  join public.operating_sites site on site.id = institution.operating_site_id
  where credential.token_hash = token_digest and credential.revoked_at is null
    and c.active and institution.active and site.active;
  if cart_id is null then return query select null::uuid, null::text, false, 'denied'::text, null::text, 'invalid_qr'::text; return; end if;
  select o.* into order_record from public.laundry_orders o where o.laundry_cart_id = cart_id and o.status = 'ready_for_pickup' and o.closed_at is null order by o.created_at desc limit 1 for update;
  if not found then return query select null::uuid, null::text, false, 'denied'::text, null::text, 'not_pickup_ready'::text; return; end if;
  insert into private.laundry_pickup_change_requests(id, token_hash, laundry_order_id, result_order_number, result_status, outcome, reason_code)
    values(change_request_id, token_digest, order_record.id, order_record.order_number, 'picked_up', 'applied', 'picked_up') on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then raise exception 'pickup request replay rejected' using errcode = '42501'; end if;
  update public.laundry_orders set status = 'picked_up', closed_at = now(), updated_at = now() where id = order_record.id;
  insert into public.authorization_audit_events(actor_type, operating_site_id, institution_id, laundry_order_id, laundry_cart_id, action, outcome, reason, before_state, after_state, request_id)
    values('system', order_record.operating_site_id, order_record.institution_id, order_record.id, order_record.laundry_cart_id,
      'laundry_order_picked_up', 'succeeded', '送洗人員掃車取件', jsonb_build_object('status','ready_for_pickup'), jsonb_build_object('status','picked_up'), change_request_id);
  return query select order_record.id, order_record.order_number, false, 'applied'::text, 'picked_up'::text, 'picked_up'::text;
end
$$;

revoke all on function public.load_laundry_batch_to_source_cart(uuid,text,uuid), public.pickup_laundry_order_from_cart_qr(text,uuid)
  from public, anon, service_role;
grant execute on function public.load_laundry_batch_to_source_cart(uuid,text,uuid) to authenticated;
grant execute on function public.pickup_laundry_order_from_cart_qr(text,uuid) to anon, authenticated;

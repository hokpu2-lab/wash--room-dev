create or replace function public.complete_laundry_batch_stage_from_equipment_qr(
  qr_token text,
  target_laundry_batch_id uuid,
  change_request_id uuid
)
returns table (
  laundry_batch_id uuid,
  completed_stage_run_id uuid,
  laundry_equipment_id uuid,
  stage_order integer,
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
  actor uuid := auth.uid();
  batch public.laundry_batches%rowtype;
  current_run public.laundry_batch_stage_runs%rowtype;
  equipment public.laundry_equipment%rowtype;
  existing private.laundry_stage_complete_change_requests%rowtype;
  next_stage_id uuid;
  next_stage_order integer;
  normalized_token text := btrim(qr_token);
  token_digest bytea;
  payload jsonb;
  inserted_count integer;
  remaining integer;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if target_laundry_batch_id is null or change_request_id is null
    or normalized_token is null
    or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'invalid_qr'::text;
    return;
  end if;
  token_digest := extensions.digest(pg_catalog.convert_to(normalized_token, 'utf8'), 'sha256');
  payload := jsonb_build_object(
    'qr_token_hash', encode(token_digest, 'hex'),
    'laundry_batch_id', target_laundry_batch_id
  );
  select request.* into existing
  from private.laundry_stage_complete_change_requests as request
  where request.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer,
        false, 'denied'::text, null::text, 'request_replay'::text;
      return;
    end if;
    return query select existing.laundry_batch_id, existing.completed_stage_run_id,
      existing.laundry_equipment_id, null::integer, true, existing.outcome,
      case when existing.reason_code = 'procedure_completed' then 'completed' else 'not_started' end,
      existing.reason_code;
    return;
  end if;
  select target.* into batch
  from public.laundry_batches as target
  where target.id = target_laundry_batch_id
  for update;
  select run.* into current_run
  from public.laundry_batch_stage_runs as run
  where run.id = batch.active_stage_run_id
  for update;
  if not found or current_run.status <> 'in_progress' then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'batch_not_ready'::text;
    return;
  end if;
  if not private.has_laundry_worker_site_access(batch.operating_site_id) then
    return query select batch.id, current_run.id, current_run.laundry_equipment_id,
      batch.current_stage_order, false, 'denied'::text, null::text, 'worker_scope_denied'::text;
    return;
  end if;
  select machine.* into equipment
  from private.laundry_equipment_qr_credentials as credential
  join public.laundry_equipment as machine
    on machine.id = credential.laundry_equipment_id
    and machine.current_qr_version = credential.version
  where credential.token_hash = token_digest
    and credential.revoked_at is null
  for update;
  if not found then
    return query select batch.id, current_run.id, null::uuid, batch.current_stage_order,
      false, 'denied'::text, null::text, 'invalid_qr'::text;
    return;
  end if;
  if equipment.id is distinct from current_run.laundry_equipment_id then
    return query select batch.id, current_run.id, equipment.id, batch.current_stage_order,
      false, 'denied'::text, null::text, 'wrong_stage'::text;
    return;
  end if;
  select stage.id, stage.stage_order into next_stage_id, next_stage_order
  from public.procedure_template_stages as stage
  where stage.procedure_version_id = batch.procedure_version_id
    and stage.stage_order = batch.current_stage_order + 1;
  insert into private.laundry_stage_complete_change_requests (
    id, actor_auth_user_id, change_payload, laundry_batch_id, laundry_equipment_id,
    completed_stage_run_id, outcome, reason_code
  ) values (
    change_request_id, actor, payload, batch.id, equipment.id, current_run.id, 'applied',
    case when next_stage_id is null then 'procedure_completed' else 'stage_completed' end
  ) on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    raise exception 'stage complete request replay rejected' using errcode = '42501';
  end if;
  update public.laundry_batch_stage_runs
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = current_run.id;
  update public.laundry_equipment
  set occupied = false, updated_at = now()
  where id = equipment.id;
  if next_stage_id is null then
    update public.laundry_batches
    set status = 'completed', completed_at = now(), active_stage_run_id = null, updated_at = now()
    where id = batch.id;
    select count(*) into remaining
    from public.laundry_batches as sibling
    where sibling.laundry_order_id = batch.laundry_order_id
      and sibling.status not in ('completed', 'cancelled', 'loaded');
    if remaining = 0 then
      update public.laundry_orders
      set status = 'ready_for_pickup', updated_at = now()
      where id = batch.laundry_order_id
        and public.laundry_orders.status not in ('picked_up', 'ready_for_pickup');
    end if;
    return query select batch.id, current_run.id, equipment.id, batch.current_stage_order,
      false, 'applied'::text, 'completed'::text, 'procedure_completed'::text;
    return;
  end if;
  update public.laundry_batches
  set status = 'not_started',
      current_stage_order = next_stage_order,
      active_stage_run_id = null,
      updated_at = now()
  where id = batch.id;
  return query select batch.id, current_run.id, equipment.id, next_stage_order,
    false, 'applied'::text, 'not_started'::text, 'stage_completed'::text;
end
$$;

revoke all on function public.complete_laundry_batch_stage_from_equipment_qr(text, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.complete_laundry_batch_stage_from_equipment_qr(text, uuid, uuid)
  to authenticated;

create or replace function public.dispatch_laundry_cart_qr(qr_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  cart_id uuid;
  site_id uuid;
  open_order public.laundry_orders%rowtype;
  pending_source public.laundry_batch_sources%rowtype;
begin
  if qr_token is null or qr_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;
  select laundry_cart.id, institution.operating_site_id
  into cart_id, site_id
  from private.laundry_cart_qr_credentials as credential
  join public.laundry_carts as laundry_cart
    on laundry_cart.id = credential.laundry_cart_id
    and laundry_cart.current_qr_version = credential.version
  join public.institutions as institution
    on institution.id = laundry_cart.institution_id
  where credential.token_hash = extensions.digest(pg_catalog.convert_to(qr_token, 'utf8'), 'sha256')
    and credential.revoked_at is null
    and laundry_cart.active
    and institution.active;
  if cart_id is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;
  if actor is null then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/scan/cart', 'mode', 'anonymous_dropoff');
  end if;
  if not private.has_laundry_worker_site_access(site_id) then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'worker_scope_denied');
  end if;
  select laundry_order.* into open_order
  from public.laundry_orders as laundry_order
  where laundry_order.laundry_cart_id = cart_id
    and laundry_order.closed_at is null
  order by laundry_order.created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/scan/cart', 'mode', 'anonymous_dropoff');
  end if;
  if open_order.status = 'awaiting_receipt' then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/app/operations/receive', 'mode', 'receive');
  end if;
  if open_order.status = 'ready_for_pickup' then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/scan/pickup', 'mode', 'pickup');
  end if;
  select source.* into pending_source
  from public.laundry_batch_sources as source
  where source.source_laundry_cart_id = cart_id
    and source.load_status = 'pending'
  order by source.created_at
  limit 1;
  if found then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/app/operations/loading', 'mode', 'load');
  end if;
  return jsonb_build_object('outcome', 'ok', 'next_path', '/app/operations', 'mode', 'workspace');
end
$$;

revoke all on function public.dispatch_laundry_cart_qr(text)
  from public, anon, service_role;
grant execute on function public.dispatch_laundry_cart_qr(text)
  to authenticated, anon;

do $$
declare
  repair record;
begin
  for repair in
    select batch.id as batch_id, batch.operating_site_id, batch.status as batch_status,
      order_record.id as laundry_order_id, order_record.institution_id,
      order_record.status as order_status
    from public.laundry_batches as batch
    join public.laundry_batch_sources as source
      on source.shared_batch_id = batch.id
      and source.load_status = 'pending'
    join public.laundry_orders as order_record
      on order_record.id = batch.laundry_order_id
      and order_record.status <> 'picked_up'
    where batch.status = 'awaiting_cart'
  loop
    update public.laundry_batches
    set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
    where id = repair.batch_id;

    insert into public.authorization_audit_events(
      actor_type, operating_site_id, institution_id, laundry_order_id, laundry_batch_id,
      action, outcome, reason, before_state, after_state
    ) values (
      'system', repair.operating_site_id, repair.institution_id, repair.laundry_order_id, repair.batch_id,
      'laundry_batch_completed_without_source_loading', 'succeeded', '依預設流程取消烘乾後的額外裝車步驟',
      jsonb_build_object('batch_status', repair.batch_status, 'order_status', repair.order_status),
      jsonb_build_object('batch_status', 'completed', 'order_status', repair.order_status)
    );
  end loop;

  update public.laundry_orders as order_record
  set status = 'ready_for_pickup', updated_at = now()
  where order_record.status <> 'picked_up'
    and exists (
      select 1
      from public.laundry_batches as batch
      where batch.laundry_order_id = order_record.id
    )
    and not exists (
      select 1
      from public.laundry_batches as pending
      where pending.laundry_order_id = order_record.id
        and pending.status not in ('completed', 'cancelled', 'loaded')
    );
end
$$;

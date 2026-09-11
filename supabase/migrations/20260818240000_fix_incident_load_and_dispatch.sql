alter table public.laundry_batch_incidents
  add column if not exists severity text not null default 'normal';

alter table public.laundry_batch_incidents
  drop constraint if exists laundry_batch_incident_severity_check;

alter table public.laundry_batch_incidents
  add constraint laundry_batch_incident_severity_check
  check (severity in ('normal', 'high', 'critical'));

create or replace function private.enqueue_batch_incident_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  summary text;
  site_id uuid;
  institution_id uuid;
begin
  if new.severity is distinct from 'critical' then
    return new;
  end if;
  select batch.operating_site_id, laundry_order.institution_id
  into site_id, institution_id
  from public.laundry_batches as batch
  join public.laundry_orders as laundry_order
    on laundry_order.id = batch.laundry_order_id
  where batch.id = new.laundry_batch_id;
  summary := '洗滌批次發生嚴重異常：' || new.incident_type;
  perform private.enqueue_laundry_notification_event(
    'batch_incident_critical',
    new.id,
    site_id,
    institution_id,
    'critical',
    summary
  );
  return new;
end;
$$;

drop function if exists public.record_laundry_batch_incident(uuid, uuid, text, text, text, uuid);

create function public.record_laundry_batch_incident(
  target_laundry_batch_id uuid,
  target_incident_type text,
  target_responsibility text,
  incident_description text,
  change_request_id uuid,
  target_stage_run_id uuid default null
)
returns table(incident_id uuid, already_applied boolean, outcome text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  batch public.laundry_batches%rowtype;
  run public.laundry_batch_stage_runs%rowtype;
  payload jsonb;
  existing private.laundry_incident_change_requests%rowtype;
  inserted_count integer;
  incident_id_value uuid;
  severity_value text := case
    when target_incident_type in ('equipment_failed', 'missing') then 'critical'
    when target_incident_type in ('damaged', 'rewash', 'redry') then 'high'
    else 'normal'
  end;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  payload := jsonb_build_object(
    'batch_id', target_laundry_batch_id,
    'stage_run_id', target_stage_run_id,
    'incident_type', target_incident_type,
    'responsibility', target_responsibility,
    'reason', btrim(incident_description)
  );
  select request.* into existing
  from private.laundry_incident_change_requests as request
  where request.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select null::uuid, false, 'denied'::text, 'request_replay'::text;
      return;
    end if;
    return query select existing.result_id, true, existing.outcome, existing.reason_code;
    return;
  end if;
  select laundry_batch.* into batch
  from public.laundry_batches as laundry_batch
  where laundry_batch.id = target_laundry_batch_id
  for update;
  if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then
    return query select null::uuid, false, 'denied'::text, 'worker_scope_denied'::text;
    return;
  end if;
  if target_incident_type not in ('refused', 'cancelled', 'missing', 'damaged', 'returned', 'equipment_failed', 'rewash', 'redry', 'correction')
    or target_responsibility not in ('送洗機構', '洗衣房', '設備', '未知')
    or incident_description is null
    or char_length(btrim(incident_description)) < 1 then
    return query select null::uuid, false, 'denied'::text, 'invalid_incident'::text;
    return;
  end if;
  if target_stage_run_id is not null then
    select stage_run.* into run
    from public.laundry_batch_stage_runs as stage_run
    where stage_run.id = target_stage_run_id
    for update;
  end if;
  insert into private.laundry_incident_change_requests(
    id, actor_auth_user_id, operation, change_payload, outcome, reason_code
  ) values (
    change_request_id, actor, 'record_incident', payload, 'applied', 'recorded'
  ) on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    raise exception 'incident request replay rejected' using errcode = '42501';
  end if;
  insert into public.laundry_batch_incidents(
    laundry_batch_id, stage_run_id, incident_type, responsibility, reason, severity, recorded_by_auth_user_id
  ) values (
    batch.id, target_stage_run_id, target_incident_type, target_responsibility,
    btrim(incident_description), severity_value, actor
  ) returning id into incident_id_value;
  if target_incident_type = 'equipment_failed' and target_stage_run_id is not null then
    update public.laundry_batch_stage_runs
      set status = 'failed', completed_at = now(), updated_at = now()
      where id = target_stage_run_id;
    update public.laundry_equipment
      set occupied = false, updated_at = now()
      where id = run.laundry_equipment_id;
    update public.laundry_batches
      set status = 'failed', active_stage_run_id = null, updated_at = now()
      where id = batch.id;
  end if;
  insert into public.authorization_audit_events(
    actor_type, actor_auth_user_id, operating_site_id, laundry_batch_id, action, outcome, reason, before_state, after_state, request_id
  ) values (
    'authenticated_user', actor, batch.operating_site_id, batch.id, 'laundry_batch_incident_recorded', 'succeeded',
    btrim(incident_description), jsonb_build_object('incident_type', target_incident_type),
    jsonb_build_object('incident_id', incident_id_value, 'severity', severity_value), change_request_id
  );
  update private.laundry_incident_change_requests
    set result_id = incident_id_value
    where id = change_request_id;
  return query select incident_id_value, false, 'applied'::text, 'recorded'::text;
end;
$$;

revoke all on function public.record_laundry_batch_incident(uuid, text, text, text, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.record_laundry_batch_incident(uuid, text, text, text, uuid, uuid)
  to authenticated;

drop trigger if exists sync_shared_batch_source_loads_after_load on public.laundry_batches;
drop function if exists private.sync_shared_batch_source_loads();

create or replace function private.ensure_laundry_batch_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  insert into public.laundry_batch_sources(
    shared_batch_id, laundry_order_id, source_laundry_cart_id, operating_site_id,
    laundry_category_id, procedure_version_id
  ) values (
    new.id, new.laundry_order_id, new.source_laundry_cart_id, new.operating_site_id,
    new.laundry_category_id, new.procedure_version_id
  )
  on conflict on constraint laundry_batch_sources_shared_batch_id_laundry_order_id_key do nothing;
  return new;
end;
$$;

drop trigger if exists ensure_laundry_batch_source_after_insert on public.laundry_batches;
create trigger ensure_laundry_batch_source_after_insert
after insert on public.laundry_batches
for each row execute function private.ensure_laundry_batch_source();

create or replace function public.merge_compatible_laundry_batches(
  target_batch_id uuid,
  source_batch_id uuid,
  change_request_id uuid
)
returns table (shared_batch_id uuid, merged_source_batch_id uuid, already_applied boolean, outcome text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.laundry_batches%rowtype;
  source public.laundry_batches%rowtype;
  payload jsonb;
  existing private.laundry_batch_merge_requests%rowtype;
  inserted_count integer;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  payload := jsonb_build_object('target_batch_id', target_batch_id, 'source_batch_id', source_batch_id);
  select request.* into existing
  from private.laundry_batch_merge_requests as request
  where request.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select target_batch_id, source_batch_id, false, 'denied'::text, 'request_replay'::text;
      return;
    end if;
    return query select existing.target_batch_id, existing.source_batch_id, true, existing.outcome, existing.reason_code;
    return;
  end if;
  select laundry_batch.* into target from public.laundry_batches as laundry_batch where laundry_batch.id = target_batch_id for update;
  select laundry_batch.* into source from public.laundry_batches as laundry_batch where laundry_batch.id = source_batch_id for update;
  if target.id is null or source.id is null then
    return query select target_batch_id, source_batch_id, false, 'denied'::text, 'batch_not_ready'::text;
    return;
  end if;
  if not private.has_laundry_worker_site_access(target.operating_site_id)
    or source.operating_site_id <> target.operating_site_id then
    return query select target.id, source.id, false, 'denied'::text, 'worker_scope_denied'::text;
    return;
  end if;
  if target.id = source.id or target.status <> 'not_started' or source.status <> 'not_started' then
    return query select target.id, source.id, false, 'denied'::text, 'batch_not_ready'::text;
    return;
  end if;
  if target.laundry_category_id <> source.laundry_category_id
    or target.procedure_version_id <> source.procedure_version_id then
    return query select target.id, source.id, false, 'denied'::text, 'batch_not_compatible'::text;
    return;
  end if;
  insert into private.laundry_batch_merge_requests(
    id, actor_auth_user_id, change_payload, target_batch_id, source_batch_id, outcome, reason_code
  ) values (
    change_request_id, actor, payload, target.id, source.id, 'applied', 'merged'
  ) on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    raise exception 'merge request replay rejected' using errcode = '42501';
  end if;
  insert into public.laundry_batch_sources(
    shared_batch_id, laundry_order_id, source_laundry_cart_id, operating_site_id,
    laundry_category_id, procedure_version_id
  )
  select target.id, source_row.laundry_order_id, source_row.source_laundry_cart_id,
    source_row.operating_site_id, source_row.laundry_category_id, source_row.procedure_version_id
  from public.laundry_batch_sources as source_row
  where source_row.shared_batch_id = source.id
  on conflict on constraint laundry_batch_sources_shared_batch_id_laundry_order_id_key do nothing;
  update public.laundry_batches
    set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by_auth_user_id = actor,
      cancellation_reason = '合併至共享批次'
    where id = source.id;
  insert into public.authorization_audit_events(
    actor_type, actor_auth_user_id, operating_site_id, laundry_batch_id, action, outcome, reason, before_state, after_state, request_id
  ) values (
    'authenticated_user', actor, target.operating_site_id, target.id, 'laundry_batches_merged', 'succeeded', '合併相容批次',
    jsonb_build_object('source_batch_id', source.id), jsonb_build_object('shared_batch_id', target.id), change_request_id
  );
  return query select target.id, source.id, false, 'applied'::text, 'merged'::text;
end;
$$;

create or replace function public.load_laundry_batch_to_source_cart(
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  profile_id uuid;
  normalized_token text := btrim(cart_qr_token);
  token_digest bytea;
  payload jsonb;
  existing private.laundry_loading_change_requests%rowtype;
  batch public.laundry_batches%rowtype;
  order_record public.laundry_orders%rowtype;
  cart public.laundry_carts%rowtype;
  current_run public.laundry_batch_stage_runs%rowtype;
  source_row public.laundry_batch_sources%rowtype;
  inserted_count integer;
  remaining integer;
  all_sources_loaded boolean;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if target_laundry_batch_id is null or change_request_id is null
    or normalized_token is null
    or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return query select target_laundry_batch_id, null::uuid, false, 'denied'::text, null::text, null::text, 'invalid_qr'::text;
    return;
  end if;
  token_digest := extensions.digest(pg_catalog.convert_to(normalized_token, 'utf8'), 'sha256');
  payload := jsonb_build_object('qr_token_hash', encode(token_digest, 'hex'), 'laundry_batch_id', target_laundry_batch_id);
  select profile.id into profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = actor and profile.active;
  select request.* into existing
  from private.laundry_loading_change_requests as request
  where request.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select target_laundry_batch_id, null::uuid, false, 'denied'::text, null::text, null::text, 'request_replay'::text;
      return;
    end if;
    return query select existing.laundry_batch_id, existing.laundry_order_id, true, existing.outcome,
      'loaded'::text, 'ready_for_pickup'::text, existing.reason_code;
    return;
  end if;
  select laundry_batch.* into batch
  from public.laundry_batches as laundry_batch
  where laundry_batch.id = target_laundry_batch_id
  for update;
  if not found then
    return query select target_laundry_batch_id, null::uuid, false, 'denied'::text, null::text, null::text, 'batch_not_ready'::text;
    return;
  end if;
  if not private.has_laundry_worker_site_access(batch.operating_site_id) then
    return query select batch.id, batch.laundry_order_id, false, 'denied'::text, null::text, null::text, 'worker_scope_denied'::text;
    return;
  end if;
  select laundry_cart.* into cart
  from private.laundry_cart_qr_credentials as credential
  join public.laundry_carts as laundry_cart
    on laundry_cart.id = credential.laundry_cart_id
    and laundry_cart.current_qr_version = credential.version
  where credential.token_hash = token_digest
    and credential.revoked_at is null
  for update;
  if not found then
    return query select batch.id, batch.laundry_order_id, false, 'denied'::text, null::text, null::text, 'invalid_qr'::text;
    return;
  end if;
  if not cart.active then
    return query select batch.id, batch.laundry_order_id, false, 'denied'::text, null::text, null::text, 'cart_unavailable'::text;
    return;
  end if;
  select source.* into source_row
  from public.laundry_batch_sources as source
  where source.shared_batch_id = batch.id
    and source.source_laundry_cart_id = cart.id
  for update;
  if not found then
    if cart.id = batch.source_laundry_cart_id then
      insert into public.laundry_batch_sources(
        shared_batch_id, laundry_order_id, source_laundry_cart_id, operating_site_id,
        laundry_category_id, procedure_version_id
      ) values (
        batch.id, batch.laundry_order_id, batch.source_laundry_cart_id, batch.operating_site_id,
        batch.laundry_category_id, batch.procedure_version_id
      )
      on conflict on constraint laundry_batch_sources_shared_batch_id_laundry_order_id_key do nothing;
      select source.* into source_row
      from public.laundry_batch_sources as source
      where source.shared_batch_id = batch.id
        and source.source_laundry_cart_id = cart.id
      for update;
    end if;
    if source_row.id is null then
      return query select batch.id, batch.laundry_order_id, false, 'denied'::text, batch.status, null::text, 'cart_scope_denied'::text;
      return;
    end if;
  end if;
  select laundry_order.* into order_record
  from public.laundry_orders as laundry_order
  where laundry_order.id = source_row.laundry_order_id
  for update;
  if source_row.load_status = 'loaded' then
    return query select batch.id, order_record.id, true, 'applied'::text, batch.status, order_record.status, 'loaded'::text;
    return;
  end if;
  if batch.status not in ('awaiting_cart', 'in_progress', 'not_started') and batch.status <> 'loaded' then
    return query select batch.id, order_record.id, false, 'denied'::text, batch.status, order_record.status, 'batch_not_ready'::text;
    return;
  end if;
  if batch.status = 'in_progress' then
    select stage_run.* into current_run
    from public.laundry_batch_stage_runs as stage_run
    where stage_run.id = batch.active_stage_run_id
    for update;
    if found and current_run.status = 'in_progress' then
      if exists (
        select 1
        from public.procedure_template_stages as stage
        where stage.procedure_version_id = batch.procedure_version_id
          and stage.stage_order > batch.current_stage_order
      ) then
        return query select batch.id, order_record.id, false, 'denied'::text, batch.status, order_record.status, 'wrong_stage'::text;
        return;
      end if;
      update public.laundry_batch_stage_runs
        set status = 'completed', completed_at = now(), updated_at = now()
        where id = current_run.id;
      update public.laundry_equipment
        set occupied = false, updated_at = now()
        where id = current_run.laundry_equipment_id;
      update public.laundry_batches
        set active_stage_run_id = null, updated_at = now()
        where id = batch.id;
    end if;
  end if;
  insert into private.laundry_loading_change_requests(
    id, actor_auth_user_id, operation, change_payload, laundry_batch_id, laundry_order_id, outcome, reason_code
  ) values (
    change_request_id, actor, 'load_batch', payload, batch.id, order_record.id, 'applied', 'loaded'
  ) on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    raise exception 'loading request replay rejected' using errcode = '42501';
  end if;
  update public.laundry_batch_sources
    set load_status = 'loaded', loaded_at = now()
    where id = source_row.id;
  if (
    select not exists (
      select 1
      from public.laundry_batch_sources as pending
      join public.laundry_batches as shared
        on shared.id = pending.shared_batch_id
      where pending.laundry_order_id = order_record.id
        and pending.load_status <> 'loaded'
        and shared.status <> 'cancelled'
    )
  ) then
    update public.laundry_orders
      set status = 'ready_for_pickup', updated_at = now()
      where id = order_record.id
        and status not in ('picked_up', 'ready_for_pickup');
    order_record.status := 'ready_for_pickup';
  end if;
  select not exists (
    select 1
    from public.laundry_batch_sources as pending
    where pending.shared_batch_id = batch.id
      and pending.load_status <> 'loaded'
  ) into all_sources_loaded;
  if all_sources_loaded then
    update public.laundry_batches
      set status = 'loaded', loaded_at = now(), active_stage_run_id = null, updated_at = now()
      where id = batch.id;
    batch.status := 'loaded';
  end if;
  insert into public.authorization_audit_events(
    actor_type, actor_auth_user_id, actor_access_profile_id, operating_site_id,
    laundry_order_id, laundry_batch_id, laundry_cart_id, action, outcome, reason, before_state, after_state, request_id
  ) values (
    'authenticated_user', actor, profile_id, batch.operating_site_id, order_record.id, batch.id, cart.id,
    'laundry_batch_loaded_to_source_cart', 'succeeded', '洗衣員裝回來源車',
    jsonb_build_object('batch_status', batch.status, 'order_status', order_record.status),
    jsonb_build_object('source_load_status', 'loaded', 'batch_status', batch.status, 'order_status', order_record.status),
    change_request_id
  );
  return query select batch.id, order_record.id, false, 'applied'::text, batch.status, order_record.status, 'loaded'::text;
end;
$$;

create or replace function public.dispatch_laundry_equipment_qr(qr_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  equipment record;
begin
  if actor is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'authentication_required');
  end if;
  if qr_token is null or qr_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;
  select resolved.*
  into equipment
  from public.resolve_laundry_equipment_qr(qr_token) as resolved;
  if equipment.laundry_equipment_id is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;
  if not private.has_laundry_worker_site_access(equipment.operating_site_id) then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'worker_scope_denied');
  end if;
  return jsonb_build_object(
    'outcome', 'ok',
    'equipment_type', equipment.equipment_type,
    'next_path', case equipment.equipment_type
      when 'disinfection_tank' then '/app/operations/disinfection'
      when 'washer' then '/app/operations/washing'
      when 'dryer' then '/app/operations/drying'
      else '/app/operations'
    end
  );
end;
$$;

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
  select laundry_order.*
  into open_order
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
  select source.*
  into pending_source
  from public.laundry_batch_sources as source
  where source.source_laundry_cart_id = cart_id
    and source.load_status = 'pending'
  order by source.created_at
  limit 1;
  if found then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/app/operations/loading', 'mode', 'load');
  end if;
  if open_order.status = 'ready_for_pickup' then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/scan/pickup', 'mode', 'pickup');
  end if;
  return jsonb_build_object('outcome', 'ok', 'next_path', '/app/operations', 'mode', 'workspace');
end;
$$;

revoke all on function public.dispatch_laundry_equipment_qr(text), public.dispatch_laundry_cart_qr(text)
  from public, anon, service_role;
grant execute on function public.dispatch_laundry_equipment_qr(text) to authenticated;
grant execute on function public.dispatch_laundry_cart_qr(text) to authenticated, anon;
grant execute on function public.resolve_laundry_equipment_qr(text) to authenticated;

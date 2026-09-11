create table if not exists private.laundry_stage_complete_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  change_payload jsonb not null,
  laundry_batch_id uuid references public.laundry_batches(id),
  laundry_equipment_id uuid references public.laundry_equipment(id),
  completed_stage_run_id uuid references public.laundry_batch_stage_runs(id),
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_stage_complete_outcome_check check (outcome in ('applied', 'denied')),
  constraint laundry_stage_complete_reason_check check (
    reason_code in (
      'stage_completed',
      'procedure_completed',
      'invalid_qr',
      'worker_scope_denied',
      'equipment_scope_denied',
      'batch_not_ready',
      'wrong_stage',
      'request_replay'
    )
  )
);

revoke all on table private.laundry_stage_complete_change_requests
  from public, anon, authenticated, service_role;

alter table private.laundry_batch_stage_change_requests
  drop constraint laundry_batch_stage_operation_check;
alter table private.laundry_batch_stage_change_requests
  add constraint laundry_batch_stage_operation_check
  check (operation in ('start_washing', 'start_drying'));
alter table private.laundry_batch_stage_change_requests
  drop constraint laundry_batch_stage_reason_check;
alter table private.laundry_batch_stage_change_requests
  add constraint laundry_batch_stage_reason_check
  check (reason_code in (
    'washing_started', 'drying_started', 'invalid_qr', 'worker_scope_denied',
    'equipment_scope_denied', 'equipment_unavailable', 'equipment_occupied',
    'incompatible_equipment', 'batch_not_ready', 'precondition_required',
    'wrong_stage', 'request_replay'
  ));

create or replace function private.start_batch_stage_from_equipment(
  qr_token text,
  target_laundry_batch_id uuid,
  change_request_id uuid,
  expected_equipment_type text,
  applied_reason text
)
returns table (
  laundry_batch_id uuid,
  stage_run_id uuid,
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
  profile_id uuid;
  normalized_token text := btrim(qr_token);
  token_digest bytea;
  payload jsonb;
  existing private.laundry_batch_stage_change_requests%rowtype;
  batch public.laundry_batches%rowtype;
  equipment public.laundry_equipment%rowtype;
  stage_id uuid;
  stage_type text;
  category_code text;
  template_id uuid;
  run_id uuid;
  inserted_count integer;
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
    'laundry_batch_id', target_laundry_batch_id,
    'expected_equipment_type', expected_equipment_type
  );
  select profile.id into profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = actor and profile.active;
  select request.* into existing
  from private.laundry_batch_stage_change_requests as request
  where request.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer,
        false, 'denied'::text, null::text, 'request_replay'::text;
      return;
    end if;
    return query select existing.laundry_batch_id, existing.stage_run_id, existing.laundry_equipment_id,
      existing.stage_order, true, existing.outcome,
      case when existing.outcome = 'applied' then 'in_progress' else null end,
      case when existing.outcome = 'applied' then applied_reason else existing.reason_code end;
    return;
  end if;
  select target.* into batch from public.laundry_batches as target
  where target.id = target_laundry_batch_id for update;
  if not found or batch.status <> 'not_started' or batch.active_stage_run_id is not null then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'batch_not_ready'::text;
    return;
  end if;
  if not private.has_laundry_worker_site_access(batch.operating_site_id) then
    return query select batch.id, null::uuid, null::uuid, batch.current_stage_order,
      false, 'denied'::text, null::text, 'worker_scope_denied'::text;
    return;
  end if;
  select stage.id, stage.equipment_type, category.code, template.id
  into stage_id, stage_type, category_code, template_id
  from public.procedure_template_stages as stage
  join public.procedure_template_versions as version on version.id = stage.procedure_version_id
  join public.procedure_templates as template on template.id = version.procedure_template_id
  join public.laundry_categories as category on category.id = template.laundry_category_id
  where version.id = batch.procedure_version_id
    and stage.stage_order = batch.current_stage_order;
  if stage_id is null or stage_type is distinct from expected_equipment_type then
    return query select batch.id, null::uuid, null::uuid, batch.current_stage_order,
      false, 'denied'::text, null::text, 'wrong_stage'::text;
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
    return query select batch.id, null::uuid, null::uuid, batch.current_stage_order,
      false, 'denied'::text, null::text, 'invalid_qr'::text;
    return;
  end if;
  if equipment.operating_site_id <> batch.operating_site_id
    or not private.has_laundry_worker_site_access(equipment.operating_site_id) then
    return query select batch.id, null::uuid, equipment.id, batch.current_stage_order,
      false, 'denied'::text, null::text, 'equipment_scope_denied'::text;
    return;
  end if;
  if equipment.equipment_type <> expected_equipment_type
    or not private.validate_laundry_equipment_for_stage(
      equipment.id, expected_equipment_type, batch.operating_site_id, category_code, template_id
    ) then
    return query select batch.id, null::uuid, equipment.id, batch.current_stage_order,
      false, 'denied'::text, null::text, 'incompatible_equipment'::text;
    return;
  end if;
  if equipment.status <> 'normal' then
    return query select batch.id, null::uuid, equipment.id, batch.current_stage_order,
      false, 'denied'::text, null::text, 'equipment_unavailable'::text;
    return;
  end if;
  if equipment.occupied then
    return query select batch.id, null::uuid, equipment.id, batch.current_stage_order,
      false, 'denied'::text, null::text, 'equipment_occupied'::text;
    return;
  end if;
  insert into private.laundry_batch_stage_change_requests (
    id, actor_auth_user_id, operation, change_payload,
    laundry_batch_id, laundry_equipment_id, stage_order, outcome, reason_code
  ) values (
    change_request_id, actor,
    case when expected_equipment_type = 'dryer' then 'start_drying' else 'start_washing' end,
    payload,
    batch.id, equipment.id, batch.current_stage_order, 'applied', applied_reason
  ) on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    raise exception 'stage request replay rejected' using errcode = '42501';
  end if;
  insert into public.laundry_batch_stage_runs (
    laundry_batch_id, procedure_stage_id, stage_order, attempt_no,
    laundry_equipment_id, operating_site_id, started_by_auth_user_id
  ) values (
    batch.id, stage_id, batch.current_stage_order, 1,
    equipment.id, batch.operating_site_id, actor
  ) returning id into run_id;
  update public.laundry_batches
  set status = 'in_progress', active_stage_run_id = run_id, updated_at = now()
  where id = batch.id;
  update public.laundry_equipment
  set occupied = true, updated_at = now()
  where id = equipment.id;
  update public.laundry_orders
  set status = 'in_process', updated_at = now()
  where id = batch.laundry_order_id and public.laundry_orders.status = 'awaiting_cleaning';
  update private.laundry_batch_stage_change_requests
  set stage_run_id = run_id
  where id = change_request_id;
  return query select batch.id, run_id, equipment.id, batch.current_stage_order,
    false, 'applied'::text, 'in_progress'::text, applied_reason;
end
$$;

create or replace function public.start_laundry_batch_washing_from_equipment_qr(
  qr_token text,
  target_laundry_batch_id uuid,
  change_request_id uuid
)
returns table (
  laundry_batch_id uuid,
  stage_run_id uuid,
  laundry_equipment_id uuid,
  stage_order integer,
  already_applied boolean,
  outcome text,
  status text,
  reason_code text
)
language sql
security definer
set search_path = ''
as $$
  select
    started.laundry_batch_id,
    started.stage_run_id,
    started.laundry_equipment_id,
    started.stage_order,
    started.already_applied,
    started.outcome,
    started.status,
    started.reason_code
  from private.start_batch_stage_from_equipment(
    qr_token, target_laundry_batch_id, change_request_id, 'washer', 'washing_started'
  ) as started;
$$;

create or replace function public.start_laundry_batch_drying_from_equipment_qr(
  qr_token text,
  target_laundry_batch_id uuid,
  change_request_id uuid
)
returns table (
  laundry_batch_id uuid,
  stage_run_id uuid,
  laundry_equipment_id uuid,
  stage_order integer,
  already_applied boolean,
  outcome text,
  status text,
  reason_code text
)
language sql
security definer
set search_path = ''
as $$
  select
    started.laundry_batch_id,
    started.stage_run_id,
    started.laundry_equipment_id,
    started.stage_order,
    started.already_applied,
    started.outcome,
    started.status,
    started.reason_code
  from private.start_batch_stage_from_equipment(
    qr_token, target_laundry_batch_id, change_request_id, 'dryer', 'drying_started'
  ) as started;
$$;

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
  profile_id uuid;
  normalized_token text := btrim(qr_token);
  token_digest bytea;
  payload jsonb;
  existing private.laundry_stage_complete_change_requests%rowtype;
  batch public.laundry_batches%rowtype;
  current_run public.laundry_batch_stage_runs%rowtype;
  equipment public.laundry_equipment%rowtype;
  next_stage_id uuid;
  next_stage_order integer;
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
  select profile.id into profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = actor and profile.active;
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
  select target.* into batch from public.laundry_batches as target
  where target.id = target_laundry_batch_id for update;
  select run.* into current_run from public.laundry_batch_stage_runs as run
  where run.id = batch.active_stage_run_id for update;
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
    set status = 'completed', active_stage_run_id = null, updated_at = now()
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

revoke all on function private.start_batch_stage_from_equipment(text, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.start_laundry_batch_washing_from_equipment_qr(text, uuid, uuid)
  from public, anon, service_role;
revoke all on function public.start_laundry_batch_drying_from_equipment_qr(text, uuid, uuid),
  public.complete_laundry_batch_stage_from_equipment_qr(text, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.start_laundry_batch_washing_from_equipment_qr(text, uuid, uuid)
  to authenticated;
grant execute on function public.start_laundry_batch_drying_from_equipment_qr(text, uuid, uuid)
  to authenticated;
grant execute on function public.complete_laundry_batch_stage_from_equipment_qr(text, uuid, uuid)
  to authenticated;

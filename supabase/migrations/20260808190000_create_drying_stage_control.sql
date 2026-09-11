alter table public.laundry_batches drop constraint laundry_batches_status_check;
alter table public.laundry_batches add constraint laundry_batches_status_check check (
  status in ('not_started', 'in_progress', 'paused', 'completed', 'failed', 'cancelled', 'awaiting_cart', 'loaded')
);

create table private.laundry_drying_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  laundry_batch_id uuid references public.laundry_batches(id),
  completed_stage_run_id uuid references public.laundry_batch_stage_runs(id),
  stage_run_id uuid references public.laundry_batch_stage_runs(id),
  laundry_equipment_id uuid references public.laundry_equipment(id),
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_drying_operation_check check (operation = 'complete_washing_start_drying'),
  constraint laundry_drying_outcome_check check (outcome in ('applied', 'denied')),
  constraint laundry_drying_reason_check check (
    reason_code in ('drying_started', 'washing_completed_waiting_cart', 'invalid_qr',
      'worker_scope_denied', 'equipment_scope_denied', 'equipment_unavailable',
      'equipment_occupied', 'incompatible_equipment', 'batch_not_ready',
      'wrong_stage', 'request_replay')
  )
);
revoke all on table private.laundry_drying_change_requests from public, anon, authenticated, service_role;

create function public.complete_laundry_washing_and_start_drying(
  target_laundry_batch_id uuid,
  dryer_qr_token text,
  change_request_id uuid
)
returns table (
  laundry_batch_id uuid,
  completed_stage_run_id uuid,
  stage_run_id uuid,
  laundry_equipment_id uuid,
  stage_order integer,
  already_applied boolean,
  outcome text,
  status text,
  reason_code text
)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); profile_id uuid;
  normalized_token text := btrim(dryer_qr_token);
  token_digest bytea; payload jsonb;
  existing private.laundry_drying_change_requests%rowtype;
  batch public.laundry_batches%rowtype;
  current_run public.laundry_batch_stage_runs%rowtype;
  dryer public.laundry_equipment%rowtype;
  next_stage_id uuid; next_stage_type text; category_code text; template_id uuid;
  next_run_id uuid; inserted_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if target_laundry_batch_id is null or change_request_id is null
    or normalized_token is null
    or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::uuid, null::integer, false,
      'denied'::text, null::text, 'invalid_qr'::text; return;
  end if;
  token_digest := extensions.digest(pg_catalog.convert_to(normalized_token, 'utf8'), 'sha256');
  payload := jsonb_build_object('qr_token_hash', encode(token_digest, 'hex'), 'laundry_batch_id', target_laundry_batch_id);
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id = actor and p.active;
  select request.* into existing from private.laundry_drying_change_requests request where request.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select target_laundry_batch_id, null::uuid, null::uuid, null::uuid, null::integer, false,
        'denied'::text, null::text, 'request_replay'::text; return;
    end if;
    return query select existing.laundry_batch_id, existing.completed_stage_run_id, existing.stage_run_id,
      existing.laundry_equipment_id, null::integer, true, existing.outcome,
      case when existing.outcome = 'applied' then 'in_progress' else null end,
      existing.reason_code;
    return;
  end if;
  select b.* into batch from public.laundry_batches b where b.id = target_laundry_batch_id for update;
  select run.* into current_run from public.laundry_batch_stage_runs run where run.id = batch.active_stage_run_id for update;
  if not found or current_run.status <> 'in_progress' then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::uuid, null::integer, false,
      'denied'::text, null::text, 'batch_not_ready'::text; return;
  end if;
  if not private.has_laundry_worker_site_access(batch.operating_site_id) then
    return query select batch.id, current_run.id, null::uuid, null::uuid, null::integer, false,
      'denied'::text, null::text, 'worker_scope_denied'::text; return;
  end if;
  select stage.id, stage.equipment_type, category.code, template.id
    into next_stage_id, next_stage_type, category_code, template_id
  from public.procedure_template_stages stage
  join public.procedure_template_versions version on version.id = stage.procedure_version_id
  join public.procedure_templates template on template.id = version.procedure_template_id
  join public.laundry_categories category on category.id = template.laundry_category_id
  where version.id = batch.procedure_version_id and stage.stage_order = batch.current_stage_order + 1;

  if next_stage_id is null then
    insert into private.laundry_drying_change_requests(
      id, actor_auth_user_id, operation, change_payload, laundry_batch_id,
      completed_stage_run_id, laundry_equipment_id, outcome, reason_code
    ) values(change_request_id, actor, 'complete_washing_start_drying', payload, batch.id,
      current_run.id, current_run.laundry_equipment_id, 'applied', 'washing_completed_waiting_cart')
    on conflict (id) do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count = 0 then raise exception 'drying request replay rejected' using errcode = '42501'; end if;
    update public.laundry_batch_stage_runs set status = 'completed', completed_at = now(), updated_at = now() where id = current_run.id;
    update public.laundry_equipment set occupied = false, updated_at = now() where id = current_run.laundry_equipment_id;
    update public.laundry_batches set status = 'awaiting_cart', active_stage_run_id = null, updated_at = now() where id = batch.id;
    insert into public.authorization_audit_events(
      actor_type, actor_auth_user_id, actor_access_profile_id, operating_site_id,
      laundry_batch_id, laundry_equipment_id, action, outcome, reason, before_state, after_state, request_id
    ) values('authenticated_user', actor, profile_id, batch.operating_site_id, batch.id, current_run.laundry_equipment_id,
      'laundry_batch_washing_completed', 'succeeded', '清洗完成等待裝車',
      jsonb_build_object('batch_status', batch.status), jsonb_build_object('batch_status', 'awaiting_cart'), change_request_id);
    return query select batch.id, current_run.id, null::uuid, current_run.laundry_equipment_id,
      batch.current_stage_order, false, 'applied'::text, 'awaiting_cart'::text, 'washing_completed_waiting_cart'::text;
    return;
  end if;
  if next_stage_type <> 'dryer' then
    return query select batch.id, current_run.id, null::uuid, null::uuid, batch.current_stage_order + 1, false,
      'denied'::text, null::text, 'wrong_stage'::text; return;
  end if;
  select e.* into dryer
  from private.laundry_equipment_qr_credentials credential
  join public.laundry_equipment e on e.id = credential.laundry_equipment_id and e.current_qr_version = credential.version
  where credential.token_hash = token_digest and credential.revoked_at is null for update;
  if not found then
    return query select batch.id, current_run.id, null::uuid, null::uuid, batch.current_stage_order + 1, false,
      'denied'::text, null::text, 'invalid_qr'::text; return;
  end if;
  if dryer.operating_site_id <> batch.operating_site_id then
    return query select batch.id, current_run.id, null::uuid, dryer.id, batch.current_stage_order + 1, false,
      'denied'::text, null::text, 'equipment_scope_denied'::text; return;
  end if;
  if dryer.equipment_type <> 'dryer' or not private.validate_laundry_equipment_for_stage(dryer.id, 'dryer', batch.operating_site_id, category_code, template_id) then
    return query select batch.id, current_run.id, null::uuid, dryer.id, batch.current_stage_order + 1, false,
      'denied'::text, null::text, 'incompatible_equipment'::text; return;
  end if;
  if dryer.status <> 'normal' then
    return query select batch.id, current_run.id, null::uuid, dryer.id, batch.current_stage_order + 1, false,
      'denied'::text, null::text, 'equipment_unavailable'::text; return;
  end if;
  if dryer.occupied then
    return query select batch.id, current_run.id, null::uuid, dryer.id, batch.current_stage_order + 1, false,
      'denied'::text, null::text, 'equipment_occupied'::text; return;
  end if;
  insert into private.laundry_drying_change_requests(
    id, actor_auth_user_id, operation, change_payload, laundry_batch_id,
    completed_stage_run_id, laundry_equipment_id, outcome, reason_code
  ) values(change_request_id, actor, 'complete_washing_start_drying', payload, batch.id,
    current_run.id, dryer.id, 'applied', 'drying_started') on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then raise exception 'drying request replay rejected' using errcode = '42501'; end if;
  update public.laundry_batch_stage_runs set status = 'completed', completed_at = now(), updated_at = now() where id = current_run.id;
  update public.laundry_equipment set occupied = false, updated_at = now() where id = current_run.laundry_equipment_id;
  insert into public.laundry_batch_stage_runs(
    laundry_batch_id, procedure_stage_id, stage_order, attempt_no,
    laundry_equipment_id, operating_site_id, started_by_auth_user_id
  ) values(batch.id, next_stage_id, batch.current_stage_order + 1, 1, dryer.id, batch.operating_site_id, actor)
  returning id into next_run_id;
  update public.laundry_batches set current_stage_order = batch.current_stage_order + 1,
    active_stage_run_id = next_run_id, status = 'in_progress', updated_at = now() where id = batch.id;
  update public.laundry_equipment set occupied = true, updated_at = now() where id = dryer.id;
  insert into public.authorization_audit_events(
    actor_type, actor_auth_user_id, actor_access_profile_id, operating_site_id,
    laundry_batch_id, laundry_equipment_id, action, outcome, reason, before_state, after_state, request_id
  ) values('authenticated_user', actor, profile_id, batch.operating_site_id, batch.id, dryer.id,
    'laundry_batch_washing_completed_drying_started', 'succeeded', '清洗完成並開始烘乾',
    jsonb_build_object('completed_stage_run_id', current_run.id), jsonb_build_object('stage_run_id', next_run_id), change_request_id);
  return query select batch.id, current_run.id, next_run_id, dryer.id, batch.current_stage_order + 1,
    false, 'applied'::text, 'in_progress'::text, 'drying_started'::text;
end
$$;

revoke all on function public.complete_laundry_washing_and_start_drying(uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.complete_laundry_washing_and_start_drying(uuid, text, uuid)
  to authenticated;

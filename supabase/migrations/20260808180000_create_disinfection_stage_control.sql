-- A procedure may contain several physical stage types. An equipment
-- capability is valid when the procedure contains at least one stage this
-- equipment can execute; the stage RPC still checks the exact current stage.
create or replace function private.validate_laundry_equipment_capabilities(
  target_site_id uuid,
  target_equipment_type text,
  target_category_codes jsonb,
  target_procedure_template_ids jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  template_id uuid;
begin
  for template_id in
    select value::uuid from jsonb_array_elements_text(target_procedure_template_ids)
  loop
    if not exists (
      select 1
      from public.procedure_template_versions version
      join public.procedure_templates template
        on template.id = version.procedure_template_id
      join public.procedure_template_stages stage
        on stage.procedure_version_id = version.id
      where template.id = template_id
        and template.operating_site_id = target_site_id
        and template.active
        and version.status = 'published'
        and stage.equipment_type in ('manual', target_equipment_type)
    ) then
      raise exception 'procedure requires a different equipment type' using errcode = '22023';
    end if;
  end loop;
end
$$;

create table private.laundry_disinfection_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  laundry_batch_id uuid references public.laundry_batches(id),
  stage_run_id uuid references public.laundry_batch_stage_runs(id),
  laundry_equipment_id uuid references public.laundry_equipment(id),
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_disinfection_operation_check check (
    operation in ('start_soak', 'complete_soak_start_washing')
  ),
  constraint laundry_disinfection_outcome_check check (outcome in ('applied', 'denied')),
  constraint laundry_disinfection_reason_check check (
    reason_code in ('soak_started', 'washing_started', 'invalid_qr',
      'worker_scope_denied', 'equipment_scope_denied', 'equipment_unavailable',
      'equipment_occupied', 'incompatible_equipment', 'batch_not_ready',
      'wrong_stage', 'request_replay')
  )
);

revoke all on table private.laundry_disinfection_change_requests
  from public, anon, authenticated, service_role;

create function public.start_laundry_batch_disinfection_from_equipment_qr(
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
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  profile_id uuid;
  normalized_token text := btrim(qr_token);
  token_digest bytea;
  payload jsonb;
  existing private.laundry_disinfection_change_requests%rowtype;
  batch public.laundry_batches%rowtype;
  equipment public.laundry_equipment%rowtype;
  stage_id uuid;
  stage_type text;
  category_code text;
  template_id uuid;
  run_id uuid;
  inserted_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if target_laundry_batch_id is null or change_request_id is null
    or normalized_token is null
    or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'invalid_qr'::text; return;
  end if;
  token_digest := extensions.digest(pg_catalog.convert_to(normalized_token, 'utf8'), 'sha256');
  payload := jsonb_build_object('qr_token_hash', encode(token_digest, 'hex'), 'laundry_batch_id', target_laundry_batch_id);
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id = actor and p.active;
  select r.* into existing from private.laundry_disinfection_change_requests r where r.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer, false,
        'denied'::text, null::text, 'request_replay'::text; return;
    end if;
    return query select existing.laundry_batch_id, existing.stage_run_id, existing.laundry_equipment_id,
      null::integer, true, existing.outcome,
      case when existing.outcome = 'applied' then 'in_progress' else null end,
      case when existing.outcome = 'applied' then 'soak_started' else existing.reason_code end;
    return;
  end if;
  select b.* into batch from public.laundry_batches b where b.id = target_laundry_batch_id for update;
  if not found or batch.status <> 'not_started' or batch.active_stage_run_id is not null then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer, false,
      'denied'::text, null::text, 'batch_not_ready'::text; return;
  end if;
  if not private.has_laundry_worker_site_access(batch.operating_site_id) then
    return query select batch.id, null::uuid, null::uuid, batch.current_stage_order, false,
      'denied'::text, null::text, 'worker_scope_denied'::text; return;
  end if;
  select stage.id, stage.equipment_type, category.code, template.id
    into stage_id, stage_type, category_code, template_id
  from public.procedure_template_stages stage
  join public.procedure_template_versions version on version.id = stage.procedure_version_id
  join public.procedure_templates template on template.id = version.procedure_template_id
  join public.laundry_categories category on category.id = template.laundry_category_id
  where version.id = batch.procedure_version_id and stage.stage_order = batch.current_stage_order;
  if stage_id is null or stage_type <> 'disinfection_tank' then
    return query select batch.id, null::uuid, null::uuid, batch.current_stage_order, false,
      'denied'::text, null::text, 'wrong_stage'::text; return;
  end if;
  select e.* into equipment
  from private.laundry_equipment_qr_credentials credential
  join public.laundry_equipment e on e.id = credential.laundry_equipment_id
    and e.current_qr_version = credential.version
  where credential.token_hash = token_digest and credential.revoked_at is null for update;
  if not found then
    return query select batch.id, null::uuid, null::uuid, batch.current_stage_order, false,
      'denied'::text, null::text, 'invalid_qr'::text; return;
  end if;
  if equipment.operating_site_id <> batch.operating_site_id then
    return query select batch.id, null::uuid, equipment.id, batch.current_stage_order, false,
      'denied'::text, null::text, 'equipment_scope_denied'::text; return;
  end if;
  if equipment.equipment_type <> 'disinfection_tank' then
    return query select batch.id, null::uuid, equipment.id, batch.current_stage_order, false,
      'denied'::text, null::text, 'incompatible_equipment'::text; return;
  end if;
  if equipment.status <> 'normal' then
    return query select batch.id, null::uuid, equipment.id, batch.current_stage_order, false,
      'denied'::text, null::text, 'equipment_unavailable'::text; return;
  end if;
  if equipment.occupied then
    return query select batch.id, null::uuid, equipment.id, batch.current_stage_order, false,
      'denied'::text, null::text, 'equipment_occupied'::text; return;
  end if;
  if not private.validate_laundry_equipment_for_stage(
    equipment.id, 'disinfection_tank', batch.operating_site_id, category_code, template_id
  ) then
    return query select batch.id, null::uuid, equipment.id, batch.current_stage_order, false,
      'denied'::text, null::text, 'incompatible_equipment'::text; return;
  end if;
  insert into private.laundry_disinfection_change_requests(
    id, actor_auth_user_id, operation, change_payload, laundry_batch_id,
    laundry_equipment_id, outcome, reason_code
  ) values(change_request_id, actor, 'start_soak', payload, batch.id, equipment.id, 'applied', 'soak_started')
  on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then raise exception 'disinfection request replay rejected' using errcode = '42501'; end if;
  insert into public.laundry_batch_stage_runs(
    laundry_batch_id, procedure_stage_id, stage_order, attempt_no,
    laundry_equipment_id, operating_site_id, started_by_auth_user_id
  ) values(batch.id, stage_id, batch.current_stage_order, 1, equipment.id, batch.operating_site_id, actor)
  returning id into run_id;
  update public.laundry_batches set status = 'in_progress', active_stage_run_id = run_id, updated_at = now() where id = batch.id;
  update public.laundry_equipment set occupied = true, updated_at = now() where id = equipment.id;
  insert into public.authorization_audit_events(
    actor_type, actor_auth_user_id, actor_access_profile_id, operating_site_id,
    laundry_batch_id, laundry_equipment_id, action, outcome, reason, before_state, after_state, request_id
  ) values('authenticated_user', actor, profile_id, batch.operating_site_id, batch.id, equipment.id,
    'laundry_batch_disinfection_started', 'succeeded', '洗衣員掃消毒鍋 QR 開始浸泡',
    jsonb_build_object('batch_status', batch.status), jsonb_build_object('batch_status', 'in_progress', 'stage_run_id', run_id), change_request_id);
  update private.laundry_disinfection_change_requests set stage_run_id = run_id where id = change_request_id;
  return query select batch.id, run_id, equipment.id, batch.current_stage_order, false,
    'applied'::text, 'in_progress'::text, 'soak_started'::text;
end
$$;

create function public.complete_laundry_disinfection_and_start_washing(
  target_laundry_batch_id uuid,
  washer_qr_token text,
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
  actor uuid := auth.uid();
  profile_id uuid;
  normalized_token text := btrim(washer_qr_token);
  token_digest bytea;
  payload jsonb;
  existing private.laundry_disinfection_change_requests%rowtype;
  batch public.laundry_batches%rowtype;
  current_run public.laundry_batch_stage_runs%rowtype;
  washer public.laundry_equipment%rowtype;
  next_stage_id uuid;
  next_stage_type text;
  category_code text;
  template_id uuid;
  next_run_id uuid;
  inserted_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if target_laundry_batch_id is null or change_request_id is null
    or normalized_token is null
    or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'invalid_qr'::text; return;
  end if;
  token_digest := extensions.digest(pg_catalog.convert_to(normalized_token, 'utf8'), 'sha256');
  payload := jsonb_build_object('qr_token_hash', encode(token_digest, 'hex'), 'laundry_batch_id', target_laundry_batch_id);
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id = actor and p.active;
  select r.* into existing from private.laundry_disinfection_change_requests r where r.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select target_laundry_batch_id, null::uuid, null::uuid, null::uuid, null::integer,
        false, 'denied'::text, null::text, 'request_replay'::text; return;
    end if;
    return query select existing.laundry_batch_id, existing.stage_run_id, existing.stage_run_id,
      existing.laundry_equipment_id, null::integer, true, existing.outcome,
      case when existing.outcome = 'applied' then 'in_progress' else null end,
      case when existing.outcome = 'applied' then 'washing_started' else existing.reason_code end;
    return;
  end if;
  select b.* into batch from public.laundry_batches b where b.id = target_laundry_batch_id for update;
  select run.* into current_run from public.laundry_batch_stage_runs run where run.id = batch.active_stage_run_id for update;
  if not found or current_run.status <> 'in_progress' then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'batch_not_ready'::text; return;
  end if;
  if not private.has_laundry_worker_site_access(batch.operating_site_id) then
    return query select batch.id, current_run.id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'worker_scope_denied'::text; return;
  end if;
  select stage.id, stage.equipment_type, category.code, template.id
    into next_stage_id, next_stage_type, category_code, template_id
  from public.procedure_template_stages stage
  join public.procedure_template_versions version on version.id = stage.procedure_version_id
  join public.procedure_templates template on template.id = version.procedure_template_id
  join public.laundry_categories category on category.id = template.laundry_category_id
  where version.id = batch.procedure_version_id and stage.stage_order = batch.current_stage_order + 1;
  if next_stage_id is null or next_stage_type <> 'washer' then
    return query select batch.id, current_run.id, null::uuid, null::uuid, batch.current_stage_order + 1,
      false, 'denied'::text, null::text, 'wrong_stage'::text; return;
  end if;
  select e.* into washer
  from private.laundry_equipment_qr_credentials credential
  join public.laundry_equipment e on e.id = credential.laundry_equipment_id and e.current_qr_version = credential.version
  where credential.token_hash = token_digest and credential.revoked_at is null for update;
  if not found then
    return query select batch.id, current_run.id, null::uuid, null::uuid, batch.current_stage_order + 1,
      false, 'denied'::text, null::text, 'invalid_qr'::text; return;
  end if;
  if washer.operating_site_id <> batch.operating_site_id then
    return query select batch.id, current_run.id, null::uuid, washer.id, batch.current_stage_order + 1,
      false, 'denied'::text, null::text, 'equipment_scope_denied'::text; return;
  end if;
  if washer.equipment_type <> 'washer' or not private.validate_laundry_equipment_for_stage(washer.id, 'washer', batch.operating_site_id, category_code, template_id) then
    return query select batch.id, current_run.id, null::uuid, washer.id, batch.current_stage_order + 1,
      false, 'denied'::text, null::text, 'incompatible_equipment'::text; return;
  end if;
  if washer.status <> 'normal' then
    return query select batch.id, current_run.id, null::uuid, washer.id, batch.current_stage_order + 1,
      false, 'denied'::text, null::text, 'equipment_unavailable'::text; return;
  end if;
  if washer.occupied then
    return query select batch.id, current_run.id, null::uuid, washer.id, batch.current_stage_order + 1,
      false, 'denied'::text, null::text, 'equipment_occupied'::text; return;
  end if;
  insert into private.laundry_disinfection_change_requests(
    id, actor_auth_user_id, operation, change_payload, laundry_batch_id,
    laundry_equipment_id, outcome, reason_code
  ) values(change_request_id, actor, 'complete_soak_start_washing', payload, batch.id, washer.id, 'applied', 'washing_started')
  on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then raise exception 'disinfection request replay rejected' using errcode = '42501'; end if;
  update public.laundry_batch_stage_runs set status = 'completed', completed_at = now(), updated_at = now() where id = current_run.id;
  update public.laundry_equipment set occupied = false, updated_at = now() where id = current_run.laundry_equipment_id;
  insert into public.laundry_batch_stage_runs(
    laundry_batch_id, procedure_stage_id, stage_order, attempt_no,
    laundry_equipment_id, operating_site_id, started_by_auth_user_id
  ) values(batch.id, next_stage_id, batch.current_stage_order + 1, 1, washer.id, batch.operating_site_id, actor)
  returning id into next_run_id;
  update public.laundry_batches set current_stage_order = batch.current_stage_order + 1,
    active_stage_run_id = next_run_id, status = 'in_progress', updated_at = now() where id = batch.id;
  update public.laundry_equipment set occupied = true, updated_at = now() where id = washer.id;
  insert into public.authorization_audit_events(
    actor_type, actor_auth_user_id, actor_access_profile_id, operating_site_id,
    laundry_batch_id, laundry_equipment_id, action, outcome, reason, before_state, after_state, request_id
  ) values('authenticated_user', actor, profile_id, batch.operating_site_id, batch.id, washer.id,
    'laundry_batch_disinfection_completed_washing_started', 'succeeded', '浸泡完成並開始清洗',
    jsonb_build_object('completed_stage_run_id', current_run.id, 'batch_stage_order', batch.current_stage_order),
    jsonb_build_object('stage_run_id', next_run_id, 'batch_stage_order', batch.current_stage_order + 1), change_request_id);
  update private.laundry_disinfection_change_requests set stage_run_id = next_run_id where id = change_request_id;
  return query select batch.id, current_run.id, next_run_id, washer.id, batch.current_stage_order + 1,
    false, 'applied'::text, 'in_progress'::text, 'washing_started'::text;
end
$$;

revoke all on function public.start_laundry_batch_disinfection_from_equipment_qr(text, uuid, uuid),
  public.complete_laundry_disinfection_and_start_washing(uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.start_laundry_batch_disinfection_from_equipment_qr(text, uuid, uuid),
  public.complete_laundry_disinfection_and_start_washing(uuid, text, uuid)
  to authenticated;

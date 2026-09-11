create table public.laundry_batch_stage_runs (
  id uuid primary key default gen_random_uuid(),
  laundry_batch_id uuid not null references public.laundry_batches(id),
  procedure_stage_id uuid not null references public.procedure_template_stages(id),
  stage_order integer not null,
  attempt_no integer not null default 1,
  laundry_equipment_id uuid not null references public.laundry_equipment(id),
  operating_site_id uuid not null references public.operating_sites(id),
  status text not null default 'in_progress',
  started_by_auth_user_id uuid not null,
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint laundry_batch_stage_runs_attempt_check check (attempt_no > 0),
  constraint laundry_batch_stage_runs_status_check check (
    status in ('in_progress', 'paused', 'completed', 'failed', 'cancelled')
  ),
  unique (laundry_batch_id, stage_order, attempt_no)
);

alter table public.laundry_batches
  add column active_stage_run_id uuid references public.laundry_batch_stage_runs(id);

alter table public.authorization_audit_events
  add column laundry_batch_id uuid references public.laundry_batches(id);

create index laundry_batch_stage_runs_batch_idx
  on public.laundry_batch_stage_runs (laundry_batch_id, stage_order, attempt_no);
create index laundry_batch_stage_runs_equipment_idx
  on public.laundry_batch_stage_runs (laundry_equipment_id, status, started_at desc);
create index authorization_audit_events_laundry_batch_idx
  on public.authorization_audit_events (laundry_batch_id, occurred_at desc)
  where laundry_batch_id is not null;

create table private.laundry_batch_stage_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  laundry_batch_id uuid references public.laundry_batches(id),
  stage_run_id uuid references public.laundry_batch_stage_runs(id),
  laundry_equipment_id uuid references public.laundry_equipment(id),
  stage_order integer,
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_batch_stage_operation_check check (operation = 'start_washing'),
  constraint laundry_batch_stage_outcome_check check (outcome in ('applied', 'denied')),
  constraint laundry_batch_stage_reason_check check (
    reason_code in ('washing_started', 'invalid_qr', 'worker_scope_denied',
      'equipment_scope_denied', 'equipment_unavailable', 'equipment_occupied',
      'incompatible_equipment', 'batch_not_ready', 'precondition_required',
      'request_replay')
  )
);

alter table public.laundry_batch_stage_runs enable row level security;

create policy laundry_batch_stage_runs_select_in_site_scope
on public.laundry_batch_stage_runs
for select to authenticated
using (private.has_site_access(operating_site_id));

revoke all on table public.laundry_batch_stage_runs from anon, authenticated, service_role;
grant select on table public.laundry_batch_stage_runs to authenticated;
revoke all on table private.laundry_batch_stage_change_requests
  from public, anon, authenticated, service_role;

create function public.start_laundry_batch_washing_from_equipment_qr(
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_token text := btrim(qr_token);
  qr_token_hash bytea;
  normalized_payload jsonb;
  existing_request private.laundry_batch_stage_change_requests%rowtype;
  inserted_request_count integer;
  target_batch public.laundry_batches%rowtype;
  target_order public.laundry_orders%rowtype;
  stage_id uuid;
  stage_equipment_type text;
  category_code text;
  procedure_template_id uuid;
  target_equipment public.laundry_equipment%rowtype;
  target_equipment_found boolean := false;
  target_stage_run_id uuid;
begin
  if actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if target_laundry_batch_id is null or change_request_id is null
    or normalized_token is null
    or normalized_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'invalid_qr'::text;
    return;
  end if;

  qr_token_hash := extensions.digest(
    pg_catalog.convert_to(normalized_token, 'utf8'), 'sha256'
  );
  select profile.id into actor_access_profile_id
  from public.user_access_profiles profile
  where profile.auth_user_id = actor_auth_user_id and profile.active;
  normalized_payload := jsonb_build_object(
    'qr_token_hash', encode(qr_token_hash, 'hex'),
    'laundry_batch_id', target_laundry_batch_id
  );

  select request.* into existing_request
  from private.laundry_batch_stage_change_requests request
  where request.id = change_request_id;
  if found then
    if existing_request.actor_auth_user_id <> actor_auth_user_id
      or existing_request.change_payload <> normalized_payload then
      return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer,
        false, 'denied'::text, null::text, 'request_replay'::text;
      return;
    end if;
    return query select existing_request.laundry_batch_id,
      existing_request.stage_run_id, existing_request.laundry_equipment_id,
      existing_request.stage_order, true, existing_request.outcome,
      case when existing_request.outcome = 'applied' then 'in_progress' else null end,
      case when existing_request.outcome = 'applied' then 'washing_started'
        else existing_request.reason_code end;
    return;
  end if;

  select batch.* into target_batch
  from public.laundry_batches batch
  where batch.id = target_laundry_batch_id
  for update;
  if not found then
    return query select target_laundry_batch_id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'batch_not_ready'::text;
    return;
  end if;
  select order_record.* into target_order
  from public.laundry_orders order_record
  where order_record.id = target_batch.laundry_order_id
  for update;
  if not found or target_order.operating_site_id <> target_batch.operating_site_id then
    return query select target_batch.id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'batch_not_ready'::text;
    return;
  end if;
  if not private.has_laundry_worker_site_access(target_batch.operating_site_id) then
    return query select target_batch.id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'worker_scope_denied'::text;
    return;
  end if;
  if target_batch.status <> 'not_started' or target_batch.active_stage_run_id is not null then
    return query select target_batch.id, null::uuid, null::uuid, target_batch.current_stage_order,
      false, 'denied'::text, null::text, 'batch_not_ready'::text;
    return;
  end if;

  select stage.id, stage.equipment_type, category.code, template.id
  into stage_id, stage_equipment_type, category_code, procedure_template_id
  from public.procedure_template_stages stage
  join public.procedure_template_versions version
    on version.id = stage.procedure_version_id
  join public.procedure_templates template
    on template.id = version.procedure_template_id
  join public.laundry_categories category
    on category.id = template.laundry_category_id
  where version.id = target_batch.procedure_version_id
    and stage.stage_order = target_batch.current_stage_order;
  if stage_id is null or stage_equipment_type is null then
    return query select target_batch.id, null::uuid, null::uuid, null::integer,
      false, 'denied'::text, null::text, 'batch_not_ready'::text;
    return;
  end if;
  if stage_equipment_type <> 'washer' then
    return query select target_batch.id, null::uuid, null::uuid, target_batch.current_stage_order,
      false, 'denied'::text, null::text, 'precondition_required'::text;
    return;
  end if;
  if exists (
    select 1
    from public.procedure_template_stages previous_stage
    where previous_stage.procedure_version_id = target_batch.procedure_version_id
      and previous_stage.stage_order < target_batch.current_stage_order
      and previous_stage.equipment_type = 'disinfection_tank'
  ) then
    return query select target_batch.id, null::uuid, null::uuid, target_batch.current_stage_order,
      false, 'denied'::text, null::text, 'precondition_required'::text;
    return;
  end if;

  select equipment.* into target_equipment
  from private.laundry_equipment_qr_credentials credential
  join public.laundry_equipment equipment
    on equipment.id = credential.laundry_equipment_id
   and equipment.current_qr_version = credential.version
  where credential.token_hash = qr_token_hash
    and credential.revoked_at is null
  for update;
  target_equipment_found := found;
  if not target_equipment_found then
    return query select target_batch.id, null::uuid, null::uuid, target_batch.current_stage_order,
      false, 'denied'::text, null::text, 'invalid_qr'::text;
    return;
  end if;
  if target_equipment.operating_site_id <> target_batch.operating_site_id
    or not private.has_laundry_worker_site_access(target_equipment.operating_site_id) then
    return query select target_batch.id, null::uuid, null::uuid, target_batch.current_stage_order,
      false, 'denied'::text, null::text, 'equipment_scope_denied'::text;
    return;
  end if;
  if target_equipment.equipment_type <> 'washer' then
    return query select target_batch.id, null::uuid, target_equipment.id, target_batch.current_stage_order,
      false, 'denied'::text, null::text, 'incompatible_equipment'::text;
    return;
  end if;
  if target_equipment.status <> 'normal' then
    return query select target_batch.id, null::uuid, target_equipment.id, target_batch.current_stage_order,
      false, 'denied'::text, null::text, 'equipment_unavailable'::text;
    return;
  end if;
  if target_equipment.occupied then
    return query select target_batch.id, null::uuid, target_equipment.id, target_batch.current_stage_order,
      false, 'denied'::text, null::text, 'equipment_occupied'::text;
    return;
  end if;
  if not private.validate_laundry_equipment_for_stage(
    target_equipment.id, 'washer', target_batch.operating_site_id,
    category_code, procedure_template_id
  ) then
    return query select target_batch.id, null::uuid, target_equipment.id, target_batch.current_stage_order,
      false, 'denied'::text, null::text, 'incompatible_equipment'::text;
    return;
  end if;

  insert into private.laundry_batch_stage_change_requests (
    id, actor_auth_user_id, operation, change_payload,
    laundry_batch_id, laundry_equipment_id, stage_order, outcome, reason_code
  ) values (
    change_request_id, actor_auth_user_id, 'start_washing', normalized_payload,
    target_batch.id, target_equipment.id, target_batch.current_stage_order,
    'applied', 'washing_started'
  ) on conflict (id) do nothing;
  get diagnostics inserted_request_count = row_count;
  if inserted_request_count = 0 then
    raise exception 'stage request replay rejected' using errcode = '42501';
  end if;

  insert into public.laundry_batch_stage_runs (
    laundry_batch_id, procedure_stage_id, stage_order, attempt_no,
    laundry_equipment_id, operating_site_id, started_by_auth_user_id
  ) values (
    target_batch.id, stage_id, target_batch.current_stage_order, 1,
    target_equipment.id, target_batch.operating_site_id, actor_auth_user_id
  ) returning id into target_stage_run_id;
  update public.laundry_batches
  set status = 'in_progress', active_stage_run_id = target_stage_run_id,
    updated_at = now()
  where id = target_batch.id;
  update public.laundry_equipment
  set occupied = true, updated_at = now()
  where id = target_equipment.id;
  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id,
    operating_site_id, laundry_batch_id, laundry_equipment_id,
    action, outcome, reason, before_state, after_state, request_id
  ) values (
    'authenticated_user', actor_auth_user_id, actor_access_profile_id,
    target_batch.operating_site_id, target_batch.id, target_equipment.id,
    'laundry_batch_washing_started', 'succeeded', '洗衣員掃洗衣機 QR 開始清洗',
    jsonb_build_object('batch_status', target_batch.status,
      'equipment_occupied', target_equipment.occupied),
    jsonb_build_object('batch_status', 'in_progress', 'stage_order', target_batch.current_stage_order,
      'stage_run_id', target_stage_run_id, 'equipment_occupied', true),
    change_request_id
  );
  update private.laundry_batch_stage_change_requests
  set stage_run_id = target_stage_run_id
  where id = change_request_id;
  return query select target_batch.id, target_stage_run_id, target_equipment.id,
    target_batch.current_stage_order, false, 'applied'::text, 'in_progress'::text,
    'washing_started'::text;
end
$$;

revoke all on function public.start_laundry_batch_washing_from_equipment_qr(text, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.start_laundry_batch_washing_from_equipment_qr(text, uuid, uuid)
  to authenticated;

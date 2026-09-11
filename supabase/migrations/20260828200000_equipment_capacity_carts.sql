comment on column public.laundry_equipment.capacity_kg is
  '設備一次可同時容納的洗衣車台數；欄位名稱沿用 capacity_kg，語意為車數而非公斤。';

create or replace function private.laundry_equipment_active_cart_count(target_equipment_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sum(load.carts)::integer
    from (
      select greatest(count(source.id), 1) as carts
      from public.laundry_batch_stage_runs as run
      left join public.laundry_batch_sources as source
        on source.shared_batch_id = run.laundry_batch_id
      where run.laundry_equipment_id = target_equipment_id
        and run.status in ('in_progress', 'paused')
      group by run.id
    ) as load
  ), 0);
$$;

create or replace function private.laundry_equipment_remaining_cart_slots(target_equipment_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce(
      (select equipment.capacity_kg from public.laundry_equipment as equipment where equipment.id = target_equipment_id),
      1
    ) - private.laundry_equipment_active_cart_count(target_equipment_id),
    0
  );
$$;

create or replace function private.refresh_laundry_equipment_occupied(target_equipment_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.laundry_equipment
  set
    occupied = private.laundry_equipment_active_cart_count(target_equipment_id) > 0,
    updated_at = now()
  where id = target_equipment_id;
$$;

create or replace function private.sync_laundry_equipment_occupied()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_laundry_equipment_occupied(old.laundry_equipment_id);
    return old;
  end if;
  perform private.refresh_laundry_equipment_occupied(new.laundry_equipment_id);
  if tg_op = 'UPDATE' and old.laundry_equipment_id is distinct from new.laundry_equipment_id then
    perform private.refresh_laundry_equipment_occupied(old.laundry_equipment_id);
  end if;
  return new;
end;
$$;

drop trigger if exists laundry_batch_stage_runs_sync_equipment_occupied
  on public.laundry_batch_stage_runs;

create trigger laundry_batch_stage_runs_sync_equipment_occupied
after insert or update of status, laundry_equipment_id or delete
on public.laundry_batch_stage_runs
for each row execute function private.sync_laundry_equipment_occupied();

create or replace function private.validate_laundry_equipment_for_stage(
  target_equipment_id uuid,
  expected_equipment_type text,
  expected_site_id uuid,
  expected_category_code text,
  expected_procedure_template_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.laundry_equipment as equipment
    join public.operating_sites as site
      on site.id = equipment.operating_site_id
    join public.laundry_categories as category
      on category.code = upper(btrim(expected_category_code))
      and category.active
    join public.procedure_templates as template
      on template.id = expected_procedure_template_id
      and template.operating_site_id = expected_site_id
      and template.active
    join public.procedure_template_versions as version
      on version.procedure_template_id = template.id
      and version.status = 'published'
    join public.procedure_template_stages as stage
      on stage.procedure_version_id = version.id
      and stage.equipment_type in ('manual', expected_equipment_type)
    where equipment.id = target_equipment_id
      and equipment.operating_site_id = expected_site_id
      and equipment.equipment_type = expected_equipment_type
      and equipment.status = 'normal'
      and private.laundry_equipment_remaining_cart_slots(equipment.id) > 0
      and site.active
      and (
        not exists (
          select 1
          from public.laundry_equipment_categories as capability
          where capability.laundry_equipment_id = equipment.id
        )
        or exists (
          select 1
          from public.laundry_equipment_categories as capability
          where capability.laundry_equipment_id = equipment.id
            and capability.laundry_category_id = category.id
        )
      )
      and (
        not exists (
          select 1
          from public.laundry_equipment_procedures as capability
          where capability.laundry_equipment_id = equipment.id
        )
        or exists (
          select 1
          from public.laundry_equipment_procedures as capability
          where capability.laundry_equipment_id = equipment.id
            and capability.procedure_template_id = template.id
        )
      )
  )
$$;

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
  incoming_carts integer;
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
  select greatest(count(*)::integer, 1)
  into incoming_carts
  from public.laundry_batch_sources as source
  where source.shared_batch_id = batch.id;
  if coalesce(incoming_carts, 0) < 1 then
    incoming_carts := 1;
  end if;
  if private.laundry_equipment_remaining_cart_slots(equipment.id) < incoming_carts then
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
  perform private.refresh_laundry_equipment_occupied(equipment.id);
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

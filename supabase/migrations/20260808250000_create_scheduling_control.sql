create table public.laundry_batch_priorities (
  laundry_batch_id uuid primary key references public.laundry_batches(id),
  priority text not null default 'normal',
  reason text,
  updated_by_auth_user_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint laundry_batch_priority_check check (priority in ('normal','priority','urgent')),
  constraint laundry_batch_priority_reason_check check (priority <> 'urgent' or (reason is not null and char_length(btrim(reason)) between 1 and 500))
);
alter table public.laundry_batch_priorities enable row level security;
create policy laundry_batch_priorities_select_in_scope on public.laundry_batch_priorities for select to authenticated using (exists(select 1 from public.laundry_batches b where b.id=laundry_batch_id and private.has_site_access(b.operating_site_id)));
revoke all on table public.laundry_batch_priorities from anon,authenticated,service_role; grant select on table public.laundry_batch_priorities to authenticated;

create table public.laundry_batch_equipment_assignments (
  id uuid primary key default gen_random_uuid(),
  laundry_batch_id uuid not null references public.laundry_batches(id),
  procedure_stage_id uuid not null references public.procedure_template_stages(id),
  laundry_equipment_id uuid not null references public.laundry_equipment(id),
  operating_site_id uuid not null references public.operating_sites(id),
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  selected_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint laundry_batch_assignment_window_check check (scheduled_end_at is null or scheduled_start_at is null or scheduled_end_at > scheduled_start_at),
  unique (laundry_batch_id, procedure_stage_id)
);
alter table public.laundry_batch_equipment_assignments enable row level security;
create policy laundry_batch_assignments_select_in_scope on public.laundry_batch_equipment_assignments for select to authenticated using (private.has_site_access(operating_site_id));
revoke all on table public.laundry_batch_equipment_assignments from anon,authenticated,service_role; grant select on table public.laundry_batch_equipment_assignments to authenticated;

create table public.laundry_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  operating_site_id uuid not null references public.operating_sites(id),
  version_no integer not null,
  schedule_kind text not null,
  snapshot jsonb not null,
  reason text not null,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (operating_site_id, version_no),
  constraint laundry_schedule_kind_check check (schedule_kind in ('suggestion','manual_assignment','replan'))
);
alter table public.laundry_schedule_versions enable row level security;
create policy laundry_schedule_versions_select_in_scope on public.laundry_schedule_versions for select to authenticated using (private.has_site_access(operating_site_id));
revoke all on table public.laundry_schedule_versions from anon,authenticated,service_role; grant select on table public.laundry_schedule_versions to authenticated;

create table private.laundry_scheduling_requests(id uuid primary key,actor_auth_user_id uuid not null,operation text not null,change_payload jsonb not null,result jsonb,outcome text not null,reason_code text not null,created_at timestamptz not null default now());
revoke all on table private.laundry_scheduling_requests from public,anon,authenticated,service_role;

create function public.set_laundry_batch_priority(target_laundry_batch_id uuid,target_priority text,target_reason text,change_request_id uuid)
returns table(laundry_batch_id uuid,priority text,already_applied boolean,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); batch public.laundry_batches%rowtype; existing private.laundry_scheduling_requests%rowtype; payload jsonb; inserted_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if; payload:=jsonb_build_object('batch_id',target_laundry_batch_id,'priority',target_priority,'reason',btrim(target_reason)); select r.* into existing from private.laundry_scheduling_requests r where r.id=change_request_id;
  if found then if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select target_laundry_batch_id,target_priority,false,'denied'::text,'request_replay'::text; return; end if; return query select target_laundry_batch_id,target_priority,true,existing.outcome,existing.reason_code; return; end if;
  select b.* into batch from public.laundry_batches b where b.id=target_laundry_batch_id for update; if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then return query select target_laundry_batch_id,target_priority,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  if target_priority not in ('normal','priority','urgent') or (target_priority='urgent' and (target_reason is null or char_length(btrim(target_reason))<1)) then return query select batch.id,target_priority,false,'denied'::text,'invalid_priority'::text; return; end if;
  insert into private.laundry_scheduling_requests(id,actor_auth_user_id,operation,change_payload,outcome,reason_code) values(change_request_id,actor,'set_priority',payload,'applied','priority_updated') on conflict(id) do nothing; get diagnostics inserted_count=row_count; if inserted_count=0 then raise exception 'priority request replay rejected' using errcode='42501'; end if;
  insert into public.laundry_batch_priorities(laundry_batch_id,priority,reason,updated_by_auth_user_id) values(batch.id,target_priority,btrim(target_reason),actor) on conflict(laundry_batch_id) do update set priority=excluded.priority,reason=excluded.reason,updated_by_auth_user_id=excluded.updated_by_auth_user_id,updated_at=now();
  insert into public.authorization_audit_events(actor_type,actor_auth_user_id,operating_site_id,laundry_batch_id,action,outcome,reason,after_state,request_id) values('authenticated_user',actor,batch.operating_site_id,batch.id,'laundry_batch_priority_updated','succeeded',btrim(target_reason),jsonb_build_object('priority',target_priority),change_request_id);
  return query select batch.id,target_priority,false,'applied'::text,'priority_updated'::text;
end
$$;

create function public.suggest_laundry_batch_schedule(target_site_id uuid)
returns table(laundry_batch_id uuid,batch_sequence integer,priority text,estimated_start_at timestamptz,estimated_end_at timestamptz,overdue_risk boolean,reason text)
language sql stable security definer set search_path = '' as $$
  with pending as (
    select b.id,b.batch_sequence,coalesce(priority.priority,'normal') as priority,
      row_number() over(order by case coalesce(priority.priority,'normal') when 'urgent' then 1 when 'priority' then 2 else 3 end,b.created_at,b.id) as queue_position,
      coalesce((select sum(stage.standard_minutes) from public.procedure_template_stages stage where stage.procedure_version_id=b.procedure_version_id),30) as minutes
    from public.laundry_batches b left join public.laundry_batch_priorities priority on priority.laundry_batch_id=b.id
    where b.operating_site_id=target_site_id and b.status in ('not_started','awaiting_cart') and private.has_laundry_worker_site_access(target_site_id)
  )
  select id,batch_sequence,priority,now()+(coalesce(sum(minutes) over(order by queue_position rows between unbounded preceding and 1 preceding),0)::double precision * interval '1 minute'),now()+(sum(minutes) over(order by queue_position)::double precision * interval '1 minute'),false,'確定性排序：優先級、建立時間與批次 ID' from pending order by queue_position
$$;

create function public.assign_laundry_batch_equipment(target_laundry_batch_id uuid,target_stage_id uuid,target_equipment_id uuid,scheduled_start timestamptz,scheduled_end timestamptz,change_request_id uuid)
returns table(assignment_id uuid,already_applied boolean,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); batch public.laundry_batches%rowtype; stage public.procedure_template_stages%rowtype; equipment public.laundry_equipment%rowtype; assignment_id_value uuid; payload jsonb; existing private.laundry_scheduling_requests%rowtype; inserted_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if; payload:=jsonb_build_object('batch_id',target_laundry_batch_id,'stage_id',target_stage_id,'equipment_id',target_equipment_id,'start',scheduled_start,'end',scheduled_end); select r.* into existing from private.laundry_scheduling_requests r where r.id=change_request_id;
  if found then if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select null::uuid,false,'denied'::text,'request_replay'::text; return; end if; return query select (existing.result->>'assignment_id')::uuid,true,existing.outcome,existing.reason_code; return; end if;
  select b.* into batch from public.laundry_batches b where b.id=target_laundry_batch_id for update; select s.* into stage from public.procedure_template_stages s where s.id=target_stage_id and s.procedure_version_id=batch.procedure_version_id; select e.* into equipment from public.laundry_equipment e where e.id=target_equipment_id for update;
  if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then return query select null::uuid,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  if equipment.operating_site_id<>batch.operating_site_id or not private.validate_laundry_equipment_for_stage(equipment.id,stage.equipment_type,batch.operating_site_id,(select category.code from public.laundry_categories category join public.procedure_templates template on template.laundry_category_id=category.id where template.id=(select version.procedure_template_id from public.procedure_template_versions version where version.id=batch.procedure_version_id)),(select procedure_template_id from public.procedure_template_versions where id=batch.procedure_version_id)) then return query select null::uuid,false,'denied'::text,'incompatible_equipment'::text; return; end if;
  insert into private.laundry_scheduling_requests(id,actor_auth_user_id,operation,change_payload,outcome,reason_code) values(change_request_id,actor,'assign_equipment',payload,'applied','assigned') on conflict(id) do nothing; get diagnostics inserted_count=row_count; if inserted_count=0 then raise exception 'assignment request replay rejected' using errcode='42501'; end if;
  insert into public.laundry_batch_equipment_assignments(laundry_batch_id,procedure_stage_id,laundry_equipment_id,operating_site_id,scheduled_start_at,scheduled_end_at,selected_by_auth_user_id) values(batch.id,stage.id,equipment.id,batch.operating_site_id,scheduled_start,scheduled_end,actor) on conflict(laundry_batch_id,procedure_stage_id) do update set laundry_equipment_id=excluded.laundry_equipment_id,scheduled_start_at=excluded.scheduled_start_at,scheduled_end_at=excluded.scheduled_end_at,selected_by_auth_user_id=excluded.selected_by_auth_user_id returning id into assignment_id_value;
  update private.laundry_scheduling_requests set result=jsonb_build_object('assignment_id',assignment_id_value) where id=change_request_id;
  return query select assignment_id_value,false,'applied'::text,'assigned'::text;
end
$$;

revoke all on function public.set_laundry_batch_priority(uuid,text,text,uuid),public.suggest_laundry_batch_schedule(uuid),public.assign_laundry_batch_equipment(uuid,uuid,uuid,timestamptz,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.set_laundry_batch_priority(uuid,text,text,uuid),public.suggest_laundry_batch_schedule(uuid),public.assign_laundry_batch_equipment(uuid,uuid,uuid,timestamptz,timestamptz,uuid) to authenticated;

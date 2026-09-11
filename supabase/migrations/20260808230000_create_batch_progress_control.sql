alter table public.laundry_batch_stage_runs add column total_paused_seconds bigint not null default 0;
alter table public.laundry_batch_stage_runs add column pause_reason text;
alter table public.laundry_batch_stage_runs add constraint laundry_batch_stage_runs_pause_check check (
  (status = 'paused' and paused_at is not null and pause_reason is not null)
  or (status <> 'paused' and paused_at is null)
);

create table private.laundry_batch_progress_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  laundry_batch_id uuid references public.laundry_batches(id),
  stage_run_id uuid references public.laundry_batch_stage_runs(id),
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_batch_progress_operation_check check (operation in ('pause','resume')),
  constraint laundry_batch_progress_outcome_check check (outcome in ('applied','denied')),
  constraint laundry_batch_progress_reason_check check (reason_code in ('paused','resumed','batch_not_running','worker_scope_denied','request_replay'))
);
revoke all on table private.laundry_batch_progress_change_requests from public,anon,authenticated,service_role;

create function public.pause_laundry_batch_stage(target_laundry_batch_id uuid, pause_reason text, change_request_id uuid)
returns table(laundry_batch_id uuid, stage_run_id uuid, already_applied boolean, outcome text, status text, reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); batch public.laundry_batches%rowtype; run public.laundry_batch_stage_runs%rowtype; payload jsonb; existing private.laundry_batch_progress_change_requests%rowtype; inserted_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  payload:=jsonb_build_object('laundry_batch_id',target_laundry_batch_id,'reason',btrim(pause_reason));
  select r.* into existing from private.laundry_batch_progress_change_requests r where r.id=change_request_id;
  if found then
    if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select target_laundry_batch_id,null::uuid,false,'denied'::text,null::text,'request_replay'::text; return; end if;
    return query select existing.laundry_batch_id,existing.stage_run_id,true,existing.outcome,'paused'::text,existing.reason_code; return;
  end if;
  select b.* into batch from public.laundry_batches b where b.id=target_laundry_batch_id for update;
  select r.* into run from public.laundry_batch_stage_runs r where r.id=batch.active_stage_run_id for update;
  if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then return query select target_laundry_batch_id,null::uuid,false,'denied'::text,null::text,'worker_scope_denied'::text; return; end if;
  if run.status<>'in_progress' or pause_reason is null or char_length(btrim(pause_reason))<1 then return query select batch.id,run.id,false,'denied'::text,run.status,'batch_not_running'::text; return; end if;
  payload:=payload||jsonb_build_object('stage_run_id',run.id);
  insert into private.laundry_batch_progress_change_requests(id,actor_auth_user_id,operation,change_payload,laundry_batch_id,stage_run_id,outcome,reason_code) values(change_request_id,actor,'pause',payload,batch.id,run.id,'applied','paused') on conflict(id) do nothing;
  get diagnostics inserted_count=row_count; if inserted_count=0 then raise exception 'progress request replay rejected' using errcode='42501'; end if;
  update public.laundry_batch_stage_runs set status='paused',paused_at=now(),pause_reason=btrim(pause_reason),updated_at=now() where id=run.id;
  update public.laundry_batches set status='paused',updated_at=now() where id=batch.id;
  insert into public.authorization_audit_events(actor_type,actor_auth_user_id,operating_site_id,laundry_batch_id,action,outcome,reason,before_state,after_state,request_id) values('authenticated_user',actor,batch.operating_site_id,batch.id,'laundry_batch_stage_paused','succeeded',btrim(pause_reason),jsonb_build_object('status','in_progress'),jsonb_build_object('status','paused'),change_request_id);
  return query select batch.id,run.id,false,'applied'::text,'paused'::text,'paused'::text;
end
$$;

create function public.resume_laundry_batch_stage(target_laundry_batch_id uuid, change_request_id uuid)
returns table(laundry_batch_id uuid, stage_run_id uuid, already_applied boolean, outcome text, status text, reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); batch public.laundry_batches%rowtype; run public.laundry_batch_stage_runs%rowtype; payload jsonb; existing private.laundry_batch_progress_change_requests%rowtype; inserted_count integer; pause_seconds bigint;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  payload:=jsonb_build_object('laundry_batch_id',target_laundry_batch_id);
  select r.* into existing from private.laundry_batch_progress_change_requests r where r.id=change_request_id;
  if found then
    if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select target_laundry_batch_id,null::uuid,false,'denied'::text,null::text,'request_replay'::text; return; end if;
    return query select existing.laundry_batch_id,existing.stage_run_id,true,existing.outcome,'in_progress'::text,existing.reason_code; return;
  end if;
  select b.* into batch from public.laundry_batches b where b.id=target_laundry_batch_id for update;
  select r.* into run from public.laundry_batch_stage_runs r where r.id=batch.active_stage_run_id for update;
  if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then return query select target_laundry_batch_id,null::uuid,false,'denied'::text,null::text,'worker_scope_denied'::text; return; end if;
  if run.status<>'paused' or run.paused_at is null then return query select batch.id,run.id,false,'denied'::text,run.status,'batch_not_running'::text; return; end if;
  pause_seconds:=greatest(0,extract(epoch from(now()-run.paused_at))::bigint); payload:=payload||jsonb_build_object('stage_run_id',run.id);
  insert into private.laundry_batch_progress_change_requests(id,actor_auth_user_id,operation,change_payload,laundry_batch_id,stage_run_id,outcome,reason_code) values(change_request_id,actor,'resume',payload,batch.id,run.id,'applied','resumed') on conflict(id) do nothing;
  get diagnostics inserted_count=row_count; if inserted_count=0 then raise exception 'progress request replay rejected' using errcode='42501'; end if;
  update public.laundry_batch_stage_runs set status='in_progress',paused_at=null,pause_reason=null,total_paused_seconds=total_paused_seconds+pause_seconds,updated_at=now() where id=run.id;
  update public.laundry_batches set status='in_progress',updated_at=now() where id=batch.id;
  insert into public.authorization_audit_events(actor_type,actor_auth_user_id,operating_site_id,laundry_batch_id,action,outcome,reason,before_state,after_state,request_id) values('authenticated_user',actor,batch.operating_site_id,batch.id,'laundry_batch_stage_resumed','succeeded','恢復處理',jsonb_build_object('status','paused'),jsonb_build_object('status','in_progress','paused_seconds',pause_seconds),change_request_id);
  return query select batch.id,run.id,false,'applied'::text,'in_progress'::text,'resumed'::text;
end
$$;

create function public.get_laundry_batch_progress(target_laundry_batch_id uuid)
returns table(laundry_batch_id uuid,batch_status text,stage_run_id uuid,stage_status text,stage_progress_percent numeric,overall_progress_percent numeric,estimated_stage_completed_at timestamptz,overdue_minutes integer,is_estimate boolean)
language sql stable security definer set search_path = '' as $$
  with target as (
    select b.id, b.status as batch_status, b.procedure_version_id, b.current_stage_order,
      run.id as stage_run_id, run.status as stage_status, run.started_at, run.paused_at,
      run.total_paused_seconds, stage.standard_minutes
    from public.laundry_batches b
    left join public.laundry_batch_stage_runs run on run.id=b.active_stage_run_id
    left join public.procedure_template_stages stage on stage.id=run.procedure_stage_id
    where b.id=target_laundry_batch_id and private.has_site_access(b.operating_site_id)
  ), duration as (
    select target.*, greatest(1,coalesce(standard_minutes,0)*60) as stage_seconds,
      coalesce((select sum(previous.standard_minutes) from public.procedure_template_stages previous where previous.procedure_version_id=target.procedure_version_id and previous.stage_order<target.current_stage_order),0)*60 as previous_seconds,
      greatest(1,coalesce((select sum(all_stage.standard_minutes) from public.procedure_template_stages all_stage where all_stage.procedure_version_id=target.procedure_version_id),0)*60) as total_seconds
    from target
  )
  select id, batch_status, stage_run_id, stage_status,
    case when stage_run_id is null then 0 else round(least(100,greatest(0,(extract(epoch from(now()-started_at))-total_paused_seconds-case when paused_at is not null then extract(epoch from(now()-paused_at)) else 0 end)/stage_seconds*100)),2) end,
    case when stage_run_id is null then 0 else round(least(100,greatest(0,(previous_seconds+extract(epoch from(now()-started_at))-total_paused_seconds-case when paused_at is not null then extract(epoch from(now()-paused_at)) else 0 end)/total_seconds*100)),2) end,
    case when stage_run_id is null then null else started_at+make_interval(secs=>stage_seconds+total_paused_seconds) end,
    case when stage_run_id is null then 0 else greatest(0,floor(((extract(epoch from(now()-started_at))-total_paused_seconds-case when paused_at is not null then extract(epoch from(now()-paused_at)) else 0 end)-stage_seconds)/60))::integer end,
    true
  from duration
$$;

revoke all on function public.pause_laundry_batch_stage(uuid,text,uuid),public.resume_laundry_batch_stage(uuid,uuid),public.get_laundry_batch_progress(uuid) from public,anon,service_role;
grant execute on function public.pause_laundry_batch_stage(uuid,text,uuid),public.resume_laundry_batch_stage(uuid,uuid),public.get_laundry_batch_progress(uuid) to authenticated;

alter table public.laundry_batch_stage_runs add column rework_of_stage_run_id uuid references public.laundry_batch_stage_runs(id);

create function private.assign_laundry_stage_attempt()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.attempt_no = 1 and exists(select 1 from public.laundry_batch_stage_runs existing where existing.laundry_batch_id=new.laundry_batch_id and existing.stage_order=new.stage_order) then
    select coalesce(max(existing.attempt_no),0)+1 into new.attempt_no from public.laundry_batch_stage_runs existing where existing.laundry_batch_id=new.laundry_batch_id and existing.stage_order=new.stage_order;
  end if;
  return new;
end
$$;
create trigger assign_laundry_stage_attempt_before_insert before insert on public.laundry_batch_stage_runs for each row execute function private.assign_laundry_stage_attempt();

create table public.laundry_batch_incidents (
  id uuid primary key default gen_random_uuid(),
  laundry_batch_id uuid not null references public.laundry_batches(id),
  stage_run_id uuid references public.laundry_batch_stage_runs(id),
  incident_type text not null,
  responsibility text not null,
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  recorded_by_auth_user_id uuid not null,
  occurred_at timestamptz not null default now(),
  constraint laundry_batch_incident_type_check check (incident_type in ('refused','cancelled','missing','damaged','returned','equipment_failed','rewash','redry','correction')),
  constraint laundry_batch_incident_responsibility_check check (responsibility in ('送洗機構','洗衣房','設備','未知')),
  constraint laundry_batch_incident_reason_check check (char_length(btrim(reason)) between 1 and 500),
  constraint laundry_batch_incident_details_check check (jsonb_typeof(details)='object')
);
alter table public.laundry_batch_incidents enable row level security;
create policy laundry_batch_incidents_select_in_scope on public.laundry_batch_incidents for select to authenticated using (exists(select 1 from public.laundry_batches b where b.id=laundry_batch_id and private.has_site_access(b.operating_site_id)));
revoke all on table public.laundry_batch_incidents from anon,authenticated,service_role; grant select on table public.laundry_batch_incidents to authenticated;

create table public.laundry_batch_rework_attempts (
  id uuid primary key default gen_random_uuid(),
  laundry_batch_id uuid not null references public.laundry_batches(id),
  source_stage_run_id uuid not null references public.laundry_batch_stage_runs(id),
  rework_type text not null,
  reason text not null,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint laundry_batch_rework_type_check check (rework_type in ('rewash','redry'))
);
alter table public.laundry_batch_rework_attempts enable row level security;
create policy laundry_batch_rework_select_in_scope on public.laundry_batch_rework_attempts for select to authenticated using (exists(select 1 from public.laundry_batches b where b.id=laundry_batch_id and private.has_site_access(b.operating_site_id)));
revoke all on table public.laundry_batch_rework_attempts from anon,authenticated,service_role; grant select on table public.laundry_batch_rework_attempts to authenticated;

create table public.laundry_data_corrections (
  id uuid primary key default gen_random_uuid(),
  laundry_batch_id uuid references public.laundry_batches(id),
  correction_kind text not null,
  reason text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  corrected_by_auth_user_id uuid not null,
  corrected_at timestamptz not null default now(),
  constraint laundry_data_correction_kind_check check (correction_kind in ('correct','void','reopen'))
);
alter table public.laundry_data_corrections enable row level security;
create policy laundry_data_corrections_select_in_scope on public.laundry_data_corrections for select to authenticated using (laundry_batch_id is not null and exists(select 1 from public.laundry_batches b where b.id=laundry_batch_id and private.has_site_access(b.operating_site_id)));
revoke all on table public.laundry_data_corrections from anon,authenticated,service_role; grant select on table public.laundry_data_corrections to authenticated;

create table private.laundry_incident_change_requests(id uuid primary key,actor_auth_user_id uuid not null,operation text not null,change_payload jsonb not null,result_id uuid,outcome text not null,reason_code text not null,created_at timestamptz not null default now());
revoke all on table private.laundry_incident_change_requests from public,anon,authenticated,service_role;

create function public.record_laundry_batch_incident(target_laundry_batch_id uuid, target_stage_run_id uuid, incident_type text, responsibility text, incident_reason text, change_request_id uuid)
returns table(incident_id uuid, already_applied boolean, outcome text, reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); batch public.laundry_batches%rowtype; run public.laundry_batch_stage_runs%rowtype; payload jsonb; existing private.laundry_incident_change_requests%rowtype; inserted_count integer; incident_id_value uuid;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  payload:=jsonb_build_object('batch_id',target_laundry_batch_id,'stage_run_id',target_stage_run_id,'incident_type',incident_type,'responsibility',responsibility,'reason',btrim(incident_reason));
  select r.* into existing from private.laundry_incident_change_requests r where r.id=change_request_id;
  if found then if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select null::uuid,false,'denied'::text,'request_replay'::text; return; end if; return query select existing.result_id,true,existing.outcome,existing.reason_code; return; end if;
  select b.* into batch from public.laundry_batches b where b.id=target_laundry_batch_id for update; if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then return query select null::uuid,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  if incident_type not in ('refused','cancelled','missing','damaged','returned','equipment_failed','rewash','redry','correction') or responsibility not in ('送洗機構','洗衣房','設備','未知') or incident_reason is null or char_length(btrim(incident_reason))<1 then return query select null::uuid,false,'denied'::text,'invalid_incident'::text; return; end if;
  if target_stage_run_id is not null then select r.* into run from public.laundry_batch_stage_runs r where r.id=target_stage_run_id for update; end if;
  insert into private.laundry_incident_change_requests(id,actor_auth_user_id,operation,change_payload,outcome,reason_code) values(change_request_id,actor,'record_incident',payload,'applied','recorded') on conflict(id) do nothing; get diagnostics inserted_count=row_count; if inserted_count=0 then raise exception 'incident request replay rejected' using errcode='42501'; end if;
  insert into public.laundry_batch_incidents(laundry_batch_id,stage_run_id,incident_type,responsibility,reason,recorded_by_auth_user_id) values(batch.id,target_stage_run_id,incident_type,responsibility,btrim(incident_reason),actor) returning id into incident_id_value;
  if incident_type='equipment_failed' and target_stage_run_id is not null then update public.laundry_batch_stage_runs set status='failed',completed_at=now(),updated_at=now() where id=target_stage_run_id; update public.laundry_equipment set occupied=false,updated_at=now() where id=run.laundry_equipment_id; update public.laundry_batches set status='failed',active_stage_run_id=null,updated_at=now() where id=batch.id; end if;
  insert into public.authorization_audit_events(actor_type,actor_auth_user_id,operating_site_id,laundry_batch_id,action,outcome,reason,before_state,after_state,request_id) values('authenticated_user',actor,batch.operating_site_id,batch.id,'laundry_batch_incident_recorded','succeeded',btrim(incident_reason),jsonb_build_object('incident_type',incident_type),jsonb_build_object('incident_id',incident_id_value),change_request_id);
  update private.laundry_incident_change_requests set result_id=incident_id_value where id=change_request_id;
  return query select incident_id_value,false,'applied'::text,'recorded'::text;
end
$$;

create function public.create_laundry_batch_rework(target_laundry_batch_id uuid,target_stage_run_id uuid,rework_type text,rework_reason text,change_request_id uuid)
returns table(rework_id uuid,already_applied boolean,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); batch public.laundry_batches%rowtype; run public.laundry_batch_stage_runs%rowtype; rework_id_value uuid; payload jsonb; existing private.laundry_incident_change_requests%rowtype; inserted_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if; payload:=jsonb_build_object('batch_id',target_laundry_batch_id,'stage_run_id',target_stage_run_id,'rework_type',rework_type,'reason',btrim(rework_reason));
  select r.* into existing from private.laundry_incident_change_requests r where r.id=change_request_id;
  if found then if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select null::uuid,false,'denied'::text,'request_replay'::text; return; end if; return query select existing.result_id,true,existing.outcome,existing.reason_code; return; end if;
  select b.* into batch from public.laundry_batches b where b.id=target_laundry_batch_id for update; select r.* into run from public.laundry_batch_stage_runs r where r.id=target_stage_run_id for update;
  if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then return query select null::uuid,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  if rework_type not in ('rewash','redry') or rework_reason is null or char_length(btrim(rework_reason))<1 then return query select null::uuid,false,'denied'::text,'invalid_incident'::text; return; end if;
  insert into private.laundry_incident_change_requests(id,actor_auth_user_id,operation,change_payload,outcome,reason_code) values(change_request_id,actor,'create_rework',payload,'applied','rework_created') on conflict(id) do nothing; get diagnostics inserted_count=row_count; if inserted_count=0 then raise exception 'rework request replay rejected' using errcode='42501'; end if;
  insert into public.laundry_batch_rework_attempts(laundry_batch_id,source_stage_run_id,rework_type,reason,created_by_auth_user_id) values(batch.id,run.id,rework_type,btrim(rework_reason),actor) returning id into rework_id_value;
  update public.laundry_batches set status='not_started',active_stage_run_id=null,updated_at=now() where id=batch.id;
  update private.laundry_incident_change_requests set result_id=rework_id_value where id=change_request_id;
  return query select rework_id_value,false,'applied'::text,'rework_created'::text;
end
$$;

create function public.correct_laundry_batch_data(target_laundry_batch_id uuid, correction_kind text, correction_reason text, before_state jsonb, after_state jsonb, change_request_id uuid)
returns table(correction_id uuid,already_applied boolean,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); batch public.laundry_batches%rowtype; correction_id_value uuid;
begin
  select b.* into batch from public.laundry_batches b where b.id=target_laundry_batch_id for update;
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then return query select null::uuid,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  if correction_kind not in ('correct','void','reopen') or correction_reason is null or before_state is null or after_state is null then return query select null::uuid,false,'denied'::text,'invalid_incident'::text; return; end if;
  insert into public.laundry_data_corrections(laundry_batch_id,correction_kind,reason,before_state,after_state,corrected_by_auth_user_id) values(batch.id,correction_kind,btrim(correction_reason),before_state,after_state,actor) returning id into correction_id_value;
  insert into public.authorization_audit_events(actor_type,actor_auth_user_id,operating_site_id,laundry_batch_id,action,outcome,reason,before_state,after_state,request_id) values('authenticated_user',actor,batch.operating_site_id,batch.id,'laundry_batch_data_corrected','succeeded',btrim(correction_reason),before_state,after_state,change_request_id);
  return query select correction_id_value,false,'applied'::text,'corrected'::text;
end
$$;

revoke all on function public.record_laundry_batch_incident(uuid,uuid,text,text,text,uuid),public.create_laundry_batch_rework(uuid,uuid,text,text,uuid),public.correct_laundry_batch_data(uuid,text,text,jsonb,jsonb,uuid) from public,anon,service_role;
grant execute on function public.record_laundry_batch_incident(uuid,uuid,text,text,text,uuid),public.create_laundry_batch_rework(uuid,uuid,text,text,uuid),public.correct_laundry_batch_data(uuid,text,text,jsonb,jsonb,uuid) to authenticated;

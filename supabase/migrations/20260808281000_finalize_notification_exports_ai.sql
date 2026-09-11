-- Default rules are explicit, editable, and safe to disable without code changes.
insert into public.notification_matrix_rules(event_key,channel,recipient_role,severity,enabled,aggregation_window_minutes,immediate,created_by_auth_user_id)
values
  ('order_overdue','in_app','laundry_supervisor','high',true,0,true,'00000000-0000-0000-0000-000000000000'),
  ('order_overdue','email','laundry_supervisor','high',true,0,true,'00000000-0000-0000-0000-000000000000'),
  ('batch_incident_critical','in_app','laundry_supervisor','critical',true,0,true,'00000000-0000-0000-0000-000000000000'),
  ('batch_incident_critical','email','laundry_supervisor','critical',true,0,true,'00000000-0000-0000-0000-000000000000'),
  ('progress_digest','in_app','laundry_supervisor','normal',true,15,false,'00000000-0000-0000-0000-000000000000')
on conflict do nothing;

create function private.enqueue_order_overdue_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('awaiting_cleaning','in_process','ready_for_pickup')
     and new.updated_at < now() - interval '1 day' then
    perform private.enqueue_laundry_notification_event('order_overdue',new.id,new.operating_site_id,new.institution_id,'high','洗衣單 '||new.order_number||' 已逾期');
  end if;
  return new;
end
$$;
create trigger enqueue_order_overdue_notification_after_update after update of updated_at,status on public.laundry_orders
  for each row execute function private.enqueue_order_overdue_notification();

create function public.finish_laundry_export_job(target_job_id uuid,target_file_name text,target_token_hash text,target_expires_at timestamptz)
returns table(job_id uuid,status text,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); job public.laundry_export_jobs%rowtype;
begin
  select j.* into job from public.laundry_export_jobs j where j.id=target_job_id for update;
  if not found or job.created_by_auth_user_id<>actor or not private.has_laundry_supervisor_site_access(job.operating_site_id) then return query select target_job_id,'failed'::text,'denied'::text,'worker_scope_denied'::text; return; end if;
  update public.laundry_export_jobs set status='ready',file_name=btrim(target_file_name),download_token_hash=decode(target_token_hash,'hex'),expires_at=least(coalesce(target_expires_at,now()+interval '15 minutes'),now()+interval '1 hour'),completed_at=now() where id=job.id;
  return query select job.id,'ready'::text,'applied'::text,'export_ready'::text;
end
$$;
revoke all on function public.finish_laundry_export_job(uuid,text,text,timestamptz) from public,anon,service_role;
grant execute on function public.finish_laundry_export_job(uuid,text,text,timestamptz) to authenticated;

create table public.laundry_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  operating_site_id uuid not null references public.operating_sites(id),
  source_snapshot jsonb not null,
  summary text not null,
  recommendations jsonb not null,
  model text not null default 'rules-v1',
  accepted boolean,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.laundry_ai_suggestions enable row level security;
create policy laundry_ai_suggestions_select_in_scope on public.laundry_ai_suggestions for select to authenticated using(private.has_laundry_supervisor_site_access(operating_site_id));
revoke all on table public.laundry_ai_suggestions from anon,authenticated,service_role; grant select on table public.laundry_ai_suggestions to authenticated;
create function public.save_laundry_ai_suggestion(target_site_id uuid,target_source_snapshot jsonb,target_summary text,target_recommendations jsonb,target_model text,change_request_id uuid)
returns table(suggestion_id uuid,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); suggestion_id_value uuid;
begin
  if actor is null or not private.has_laundry_supervisor_site_access(target_site_id) then return query select null::uuid,'denied'::text,'worker_scope_denied'::text; return; end if;
  if target_summary is null or btrim(target_summary)='' or jsonb_typeof(target_recommendations)<>'array' then return query select null::uuid,'denied'::text,'invalid_suggestion'::text; return; end if;
  insert into public.laundry_ai_suggestions(operating_site_id,source_snapshot,summary,recommendations,model,created_by_auth_user_id) values(target_site_id,coalesce(target_source_snapshot,'{}'::jsonb),btrim(target_summary),target_recommendations,coalesce(nullif(btrim(target_model),''),'rules-v1'),actor) returning id into suggestion_id_value;
  return query select suggestion_id_value,'applied'::text,'suggestion_saved'::text;
end
$$;
revoke all on function public.save_laundry_ai_suggestion(uuid,jsonb,text,jsonb,text,uuid) from public,anon,service_role;
grant execute on function public.save_laundry_ai_suggestion(uuid,jsonb,text,jsonb,text,uuid) to authenticated;

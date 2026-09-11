-- T21: event notifications with stable idempotency and normal-event aggregation.
alter table public.notification_matrix_rules
  add column if not exists aggregation_window_minutes integer not null default 0,
  add column if not exists immediate boolean not null default true;

create table public.notification_event_dispatches (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  source_event_id uuid,
  operating_site_id uuid references public.operating_sites(id),
  institution_id uuid references public.institutions(id),
  severity text not null,
  aggregation_bucket timestamptz,
  created_at timestamptz not null default now(),
  unique (event_key, source_event_id, operating_site_id, aggregation_bucket)
);
alter table public.notification_event_dispatches enable row level security;
create policy notification_event_dispatches_select_in_scope on public.notification_event_dispatches
  for select to authenticated using (operating_site_id is null or private.has_laundry_supervisor_site_access(operating_site_id));
revoke all on table public.notification_event_dispatches from anon, authenticated, service_role;
grant select on table public.notification_event_dispatches to authenticated;

create function private.enqueue_laundry_notification_event(
  target_event_key text,
  target_source_event_id uuid,
  target_site_id uuid,
  target_institution_id uuid,
  target_severity text,
  target_summary text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  rule record;
  member_row record;
  bucket timestamptz;
  dispatch_id uuid;
  inserted_count integer := 0;
  event_window integer;
  key text;
begin
  select coalesce(max(aggregation_window_minutes), 0) into event_window
    from public.notification_matrix_rules where event_key = target_event_key and enabled;
  bucket := case when target_severity = 'normal' and event_window > 0
    then date_trunc('minute', now()) - (extract(minute from now())::integer % event_window) * interval '1 minute'
    else null end;
  insert into public.notification_event_dispatches(event_key,source_event_id,operating_site_id,institution_id,severity,aggregation_bucket)
    values(target_event_key,target_source_event_id,target_site_id,target_institution_id,target_severity,bucket)
    on conflict do nothing returning id into dispatch_id;
  if dispatch_id is null then return 0; end if;
  for member_row in
    select p.auth_user_id, p.email, m.role
    from public.access_memberships m
    join public.user_access_profiles p on p.id = m.user_access_profile_id
    where m.active and p.active and m.valid_from <= now()
      and (m.valid_until is null or m.valid_until > now())
      and ((m.role='laundry_supervisor' and m.operating_site_id=target_site_id)
        or (m.role='institution_supervisor' and m.institution_id=target_institution_id))
  loop
    for rule in
      select * from public.notification_matrix_rules r
      where r.event_key=target_event_key and r.enabled and r.recipient_role=member_row.role
        and (r.operating_site_id is null or r.operating_site_id=target_site_id)
        and (r.institution_id is null or r.institution_id=target_institution_id)
    loop
      key := target_event_key||':'||coalesce(target_source_event_id::text,'none')||':'||coalesce(member_row.auth_user_id::text,'none')||':'||rule.channel||':'||coalesce(bucket::text,'immediate');
      insert into public.notification_outbox(
        idempotency_key,event_key,source_event_id,operating_site_id,institution_id,
        recipient_auth_user_id,recipient_email,channel,destination,severity,content_summary
      ) values(key,target_event_key,target_source_event_id,target_site_id,target_institution_id,
        member_row.auth_user_id,member_row.email,rule.channel,rule.destination,target_severity,target_summary)
      on conflict (idempotency_key) do nothing;
      inserted_count := inserted_count + 1;
    end loop;
  end loop;
  return inserted_count;
end
$$;

create function public.enqueue_laundry_notification_event(
  target_event_key text, target_source_event_id uuid, target_site_id uuid,
  target_institution_id uuid, target_severity text, target_summary text
)
returns table(enqueued_count integer, outcome text, reason_code text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.has_any_laundry_supervisor_access() then
    return query select 0, 'denied'::text, 'worker_scope_denied'::text; return;
  end if;
  if target_event_key is null or target_summary is null or btrim(target_summary) = ''
     or target_severity not in ('normal','high','critical') then
    return query select 0, 'denied'::text, 'invalid_event'::text; return;
  end if;
  return query select private.enqueue_laundry_notification_event(target_event_key,target_source_event_id,target_site_id,target_institution_id,target_severity,btrim(target_summary)), 'applied'::text, 'queued'::text;
end
$$;
revoke all on function public.enqueue_laundry_notification_event(text,uuid,uuid,uuid,text,text) from public, anon, service_role;
grant execute on function public.enqueue_laundry_notification_event(text,uuid,uuid,uuid,text,text) to authenticated;

create function private.enqueue_batch_incident_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare summary text;
begin
  if new.severity = 'critical' then
    summary := '洗滌批次發生嚴重異常：'||new.incident_type;
    perform private.enqueue_laundry_notification_event('batch_incident_critical',new.id,new.operating_site_id,null,'critical',summary);
  end if;
  return new;
end
$$;
create trigger enqueue_batch_incident_notification_after_insert after insert on public.laundry_batch_incidents
  for each row execute function private.enqueue_batch_incident_notification();

-- T22: provenance-first import center. Rows are validated before the commit RPC writes domain data.
create table public.laundry_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source_format text not null check (source_format in ('csv','xlsx')),
  source_sha256 text not null,
  operating_site_id uuid not null references public.operating_sites(id),
  selected_sheet text,
  status text not null default 'preview' check (status in ('preview','committed','partially_committed','rejected')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  committed_rows integer not null default 0,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
alter table public.laundry_import_batches enable row level security;
create policy laundry_import_batches_select_in_scope on public.laundry_import_batches for select to authenticated using (private.has_laundry_supervisor_site_access(operating_site_id));
revoke all on table public.laundry_import_batches from anon, authenticated, service_role;
grant select on table public.laundry_import_batches to authenticated;

create table public.laundry_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.laundry_import_batches(id) on delete cascade,
  row_number integer not null,
  raw_values jsonb not null,
  normalized_values jsonb,
  valid boolean not null default false,
  validation_errors jsonb not null default '[]'::jsonb,
  dedupe_key text,
  committed_laundry_order_id uuid references public.laundry_orders(id),
  unique(import_batch_id,row_number)
);
alter table public.laundry_import_rows enable row level security;
create policy laundry_import_rows_select_in_scope on public.laundry_import_rows for select to authenticated using (exists(select 1 from public.laundry_import_batches b where b.id=import_batch_id and private.has_laundry_supervisor_site_access(b.operating_site_id)));
revoke all on table public.laundry_import_rows from anon, authenticated, service_role;
grant select on table public.laundry_import_rows to authenticated;

create function public.create_laundry_import_preview(
  target_file_name text, target_format text, target_sha256 text, target_site_id uuid,
  target_sheet text, target_rows jsonb, change_request_id uuid
)
returns table(import_batch_id uuid, total_rows integer, valid_rows integer, invalid_rows integer, outcome text, reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); batch_id uuid; row_item jsonb; row_no integer:=0; normalized jsonb; errors jsonb; valid_count integer:=0; invalid_count integer:=0; item_count integer:=0;
begin
  if actor is null or not private.has_laundry_supervisor_site_access(target_site_id) then return query select null::uuid,0,0,0,'denied'::text,'worker_scope_denied'::text; return; end if;
  if target_format not in ('csv','xlsx') or target_sha256 is null or jsonb_typeof(target_rows)<>'array' or jsonb_array_length(target_rows)>5000 then return query select null::uuid,0,0,0,'denied'::text,'invalid_import'::text; return; end if;
  insert into public.laundry_import_batches(file_name,source_format,source_sha256,operating_site_id,selected_sheet,created_by_auth_user_id) values(btrim(target_file_name),target_format,target_sha256,target_site_id,nullif(btrim(target_sheet),''),actor) returning id into batch_id;
  for row_item in select value from jsonb_array_elements(target_rows) loop
    row_no:=row_no+1; item_count:=item_count+1; errors:='[]'::jsonb;
    normalized:=jsonb_build_object('order_number',upper(btrim(coalesce(row_item->>'order_number',''))),'cart_number',upper(btrim(coalesce(row_item->>'cart_number',''))),'category_code',upper(btrim(coalesce(row_item->>'category_code',''))));
    if normalized->>'order_number'='' then errors:=errors||jsonb_build_array('缺少 order_number'); end if;
    if normalized->>'cart_number'='' then errors:=errors||jsonb_build_array('缺少 cart_number'); end if;
    if normalized->>'category_code'='' then errors:=errors||jsonb_build_array('缺少 category_code'); end if;
    if jsonb_array_length(errors)=0 then valid_count:=valid_count+1; else invalid_count:=invalid_count+1; end if;
    insert into public.laundry_import_rows(import_batch_id,row_number,raw_values,normalized_values,valid,validation_errors,dedupe_key) values(batch_id,row_no,row_item,normalized,jsonb_array_length(errors)=0,errors,coalesce(normalized->>'order_number','')||':'||coalesce(normalized->>'cart_number',''));
  end loop;
  update public.laundry_import_batches set total_rows=item_count,valid_rows=valid_count,invalid_rows=invalid_count where id=batch_id;
  return query select batch_id,item_count,valid_count,invalid_count,'applied'::text,'preview_created'::text;
end
$$;

create function public.commit_laundry_import_preview(target_import_batch_id uuid, change_request_id uuid)
returns table(import_batch_id uuid,committed_rows integer,skipped_rows integer,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare batch public.laundry_import_batches%rowtype; row_item record; committed integer:=0; skipped integer:=0; cart_id uuid; existing uuid;
begin
  select b.* into batch from public.laundry_import_batches b where b.id=target_import_batch_id for update;
  if not found or not private.has_laundry_supervisor_site_access(batch.operating_site_id) then return query select target_import_batch_id,0,0,'denied'::text,'worker_scope_denied'::text; return; end if;
  if batch.status <> 'preview' then return query select batch.id,batch.committed_rows,batch.total_rows-batch.valid_rows,'denied'::text,'already_committed'::text; return; end if;
  for row_item in select * from public.laundry_import_rows where import_batch_id=batch.id and valid order by row_number loop
    select c.id into cart_id from public.laundry_carts c where c.cart_number=row_item.normalized_values->>'cart_number' and c.active;
    if cart_id is null then skipped:=skipped+1; continue; end if;
    select o.id into existing from public.laundry_orders o where o.order_number=row_item.normalized_values->>'order_number';
    if existing is not null then update public.laundry_import_rows set committed_laundry_order_id=existing where id=row_item.id; skipped:=skipped+1; continue; end if;
    insert into public.laundry_orders(order_number,laundry_cart_id,institution_id,operating_site_id,status)
      select row_item.normalized_values->>'order_number',c.id,i.id,i.operating_site_id,'awaiting_receipt'
      from public.laundry_carts c join public.institutions i on i.id=c.institution_id
      where c.id=cart_id and i.active and i.operating_site_id=batch.operating_site_id
      on conflict do nothing returning id into existing;
    if existing is null then skipped:=skipped+1;
    else update public.laundry_import_rows set committed_laundry_order_id=existing where id=row_item.id; committed:=committed+1; end if;
  end loop;
  update public.laundry_import_batches set status=case when skipped=0 then 'committed' else 'partially_committed' end,committed_rows=committed,committed_at=now() where id=batch.id;
  return query select batch.id,committed,skipped,'applied'::text,'imported_with_provenance'::text;
end
$$;
revoke all on function public.create_laundry_import_preview(text,text,text,uuid,text,jsonb,uuid),public.commit_laundry_import_preview(uuid,uuid) from public,anon,service_role;
grant execute on function public.create_laundry_import_preview(text,text,text,uuid,text,jsonb,uuid),public.commit_laundry_import_preview(uuid,uuid) to authenticated;

-- T23/T24: role-scoped KPI and a fixed whitelist BI seam; no arbitrary SQL is accepted.
create function public.get_laundry_dashboard(target_site_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare site_id uuid:=target_site_id; result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if site_id is null then select operating_site_id into site_id from public.current_access_context() where operating_site_id is not null limit 1; end if;
  if site_id is null or not (private.has_site_access(site_id) or private.has_laundry_supervisor_site_access(site_id)) then return jsonb_build_object('outcome','denied','reason_code','worker_scope_denied'); end if;
  select jsonb_build_object('site_id',site_id,'orders',jsonb_build_object('awaiting_receipt',count(*) filter(where status='awaiting_receipt'),'in_process',count(*) filter(where status='in_process'),'ready_for_pickup',count(*) filter(where status='ready_for_pickup'),'picked_up',count(*) filter(where status='picked_up')),'batches',jsonb_build_object('not_started',(select count(*) from public.laundry_batches b where b.operating_site_id=site_id and b.status='not_started'),'in_progress',(select count(*) from public.laundry_batches b where b.operating_site_id=site_id and b.status='in_progress'),'paused',(select count(*) from public.laundry_batches b where b.operating_site_id=site_id and b.status='paused'),'completed',(select count(*) from public.laundry_batches b where b.operating_site_id=site_id and b.status='completed')),'generated_at',now()) into result from public.laundry_orders where operating_site_id=site_id;
  return result;
end
$$;
revoke all on function public.get_laundry_dashboard(uuid) from public,anon,service_role;
grant execute on function public.get_laundry_dashboard(uuid) to authenticated;

create table public.saved_bi_views (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  dimensions jsonb not null,
  metrics jsonb not null,
  filters jsonb not null default '{}'::jsonb,
  operating_site_id uuid references public.operating_sites(id),
  owner_auth_user_id uuid not null,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  constraint saved_bi_dimensions_check check (dimensions <@ '["status","category","operating_site"]'::jsonb),
  constraint saved_bi_metrics_check check (metrics <@ '["order_count","batch_count","completed_count"]'::jsonb)
);
alter table public.saved_bi_views enable row level security;
create policy saved_bi_views_select_owner_or_shared on public.saved_bi_views for select to authenticated using (owner_auth_user_id=auth.uid() or (shared and (operating_site_id is null or private.has_laundry_supervisor_site_access(operating_site_id))));
revoke all on table public.saved_bi_views from anon,authenticated,service_role; grant select on table public.saved_bi_views to authenticated;

create function public.save_laundry_bi_view(view_name text,view_dimensions jsonb,view_metrics jsonb,view_filters jsonb,target_site_id uuid,make_shared boolean,change_request_id uuid)
returns table(view_id uuid,outcome text,reason_code text) language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); id_value uuid;
begin
  if actor is null or not private.has_any_laundry_supervisor_access() then return query select null::uuid,'denied'::text,'worker_scope_denied'::text; return; end if;
  if target_site_id is not null and not private.has_laundry_supervisor_site_access(target_site_id) then return query select null::uuid,'denied'::text,'worker_scope_denied'::text; return; end if;
  if not (view_dimensions <@ '["status","category","operating_site"]'::jsonb) or not (view_metrics <@ '["order_count","batch_count","completed_count"]'::jsonb) then return query select null::uuid,'denied'::text,'unsupported_query'::text; return; end if;
  insert into public.saved_bi_views(name,dimensions,metrics,filters,operating_site_id,owner_auth_user_id,shared) values(btrim(view_name),view_dimensions,view_metrics,coalesce(view_filters,'{}'::jsonb),target_site_id,actor,make_shared) returning id into id_value;
  return query select id_value,'applied'::text,'saved'::text;
end
$$;
revoke all on function public.save_laundry_bi_view(text,jsonb,jsonb,jsonb,uuid,boolean,uuid) from public,anon,service_role; grant execute on function public.save_laundry_bi_view(text,jsonb,jsonb,jsonb,uuid,boolean,uuid) to authenticated;

create function public.run_laundry_bi_view(target_view_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare view_row public.saved_bi_views%rowtype; site_id uuid; result jsonb;
begin
  select v.* into view_row from public.saved_bi_views v where v.id=target_view_id and (v.owner_auth_user_id=auth.uid() or (v.shared and (v.operating_site_id is null or private.has_laundry_supervisor_site_access(v.operating_site_id))));
  if not found then return jsonb_build_object('outcome','denied','reason_code','view_not_found'); end if;
  site_id:=view_row.operating_site_id;
  if site_id is null then select operating_site_id into site_id from public.current_access_context() where role='laundry_supervisor' limit 1; end if;
  if site_id is null or not private.has_laundry_supervisor_site_access(site_id) then return jsonb_build_object('outcome','denied','reason_code','worker_scope_denied'); end if;
  select jsonb_build_object('view_id',view_row.id,'site_id',site_id,'rows',jsonb_build_array(jsonb_build_object('order_count',(select count(*) from public.laundry_orders where operating_site_id=site_id),'batch_count',(select count(*) from public.laundry_batches where operating_site_id=site_id),'completed_count',(select count(*) from public.laundry_batches where operating_site_id=site_id and status='completed')))) into result;
  return result;
end
$$;
revoke all on function public.run_laundry_bi_view(uuid) from public,anon,service_role; grant execute on function public.run_laundry_bi_view(uuid) to authenticated;

-- T25: export jobs are tracked and scoped; the server generates the artifact from this row.
create table public.laundry_export_jobs (
  id uuid primary key default gen_random_uuid(),
  format text not null check(format in ('csv','xlsx','pdf')),
  report_key text not null check(report_key in ('orders','batches','dashboard','bi_view')),
  query_spec jsonb not null,
  operating_site_id uuid references public.operating_sites(id),
  status text not null default 'queued' check(status in ('queued','running','ready','failed','expired')),
  file_name text,
  download_token_hash bytea,
  expires_at timestamptz,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);
alter table public.laundry_export_jobs enable row level security;
create policy laundry_export_jobs_select_owner_scope on public.laundry_export_jobs for select to authenticated using (created_by_auth_user_id=auth.uid() or (operating_site_id is not null and private.has_laundry_supervisor_site_access(operating_site_id)));
revoke all on table public.laundry_export_jobs from anon,authenticated,service_role; grant select on table public.laundry_export_jobs to authenticated;
create function public.create_laundry_export_job(target_format text,target_report_key text,target_query_spec jsonb,target_site_id uuid,change_request_id uuid)
returns table(job_id uuid,status text,outcome text,reason_code text) language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); job_id_value uuid;
begin
  if actor is null or not private.has_any_laundry_supervisor_access() then return query select null::uuid,'failed'::text,'denied'::text,'worker_scope_denied'::text; return; end if;
  if target_format not in ('csv','xlsx','pdf') or target_report_key not in ('orders','batches','dashboard','bi_view') or target_site_id is null or not private.has_laundry_supervisor_site_access(target_site_id) then return query select null::uuid,'failed'::text,'denied'::text,'invalid_export'::text; return; end if;
  insert into public.laundry_export_jobs(format,report_key,query_spec,operating_site_id,created_by_auth_user_id) values(target_format,target_report_key,coalesce(target_query_spec,'{}'::jsonb),target_site_id,actor) returning id into job_id_value;
  return query select job_id_value,'queued'::text,'applied'::text,'export_queued'::text;
end
$$;
revoke all on function public.create_laundry_export_job(text,text,jsonb,uuid,uuid) from public,anon,service_role; grant execute on function public.create_laundry_export_job(text,text,jsonb,uuid,uuid) to authenticated;

-- T26: threshold crossings are durable and never delete historical snapshots.
create table public.laundry_capacity_alerts (
  id uuid primary key default gen_random_uuid(),
  operating_site_id uuid not null references public.operating_sites(id),
  snapshot_id uuid not null references public.laundry_capacity_snapshots(id),
  threshold integer not null check(threshold in (60,75,85,95)),
  status text not null default 'open' check(status in ('open','acknowledged','unknown')),
  failure_reason text,
  created_at timestamptz not null default now(),
  unique(operating_site_id,snapshot_id,threshold)
);
alter table public.laundry_capacity_alerts enable row level security;
create policy laundry_capacity_alerts_select_in_scope on public.laundry_capacity_alerts for select to authenticated using(private.has_laundry_supervisor_site_access(operating_site_id));
revoke all on table public.laundry_capacity_alerts from anon,authenticated,service_role; grant select on table public.laundry_capacity_alerts to authenticated;
create function public.evaluate_laundry_capacity(target_snapshot_id uuid)
returns table(alert_count integer,outcome text,reason_code text) language plpgsql security definer set search_path = '' as $$
declare snapshot public.laundry_capacity_snapshots%rowtype; utilization numeric; threshold_value integer; inserted_count integer:=0;
begin
  select s.* into snapshot from public.laundry_capacity_snapshots s where s.id=target_snapshot_id;
  if not found or not private.has_laundry_supervisor_site_access(snapshot.operating_site_id) then return query select 0,'denied'::text,'worker_scope_denied'::text; return; end if;
  if snapshot.available_minutes<=0 then insert into public.laundry_capacity_alerts(operating_site_id,snapshot_id,threshold,status,failure_reason) values(snapshot.operating_site_id,snapshot.id,95,'unknown','capacity denominator unavailable') on conflict do nothing; return query select 1,'applied'::text,'unknown'::text; return; end if;
  utilization:=snapshot.required_minutes::numeric/snapshot.available_minutes::numeric*100;
  foreach threshold_value in array ARRAY[60,75,85,95] loop
    if utilization>=threshold_value then insert into public.laundry_capacity_alerts(operating_site_id,snapshot_id,threshold) values(snapshot.operating_site_id,snapshot.id,threshold_value) on conflict do nothing; if found then inserted_count:=inserted_count+1; end if; end if;
  end loop;
  return query select inserted_count,'applied'::text,'thresholds_evaluated'::text;
end
$$;
revoke all on function public.evaluate_laundry_capacity(uuid) from public,anon,service_role; grant execute on function public.evaluate_laundry_capacity(uuid) to authenticated;

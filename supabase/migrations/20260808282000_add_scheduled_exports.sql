alter table public.laundry_export_jobs
  add column if not exists scheduled_for timestamptz,
  add column if not exists recipient_email text;

create function public.schedule_laundry_export_job(
  target_format text,
  target_report_key text,
  target_query_spec jsonb,
  target_site_id uuid,
  target_recipient_email text,
  target_scheduled_for timestamptz,
  change_request_id uuid
)
returns table(job_id uuid,status text,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); job_id_value uuid;
begin
  if actor is null or not private.has_laundry_supervisor_site_access(target_site_id) then return query select null::uuid,'failed'::text,'denied'::text,'worker_scope_denied'::text; return; end if;
  if target_format not in ('csv','xlsx','pdf') or target_report_key not in ('orders','batches','dashboard','bi_view') or target_recipient_email is null or target_recipient_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or target_scheduled_for is null or target_scheduled_for < now() then return query select null::uuid,'failed'::text,'denied'::text,'invalid_schedule'::text; return; end if;
  insert into public.laundry_export_jobs(format,report_key,query_spec,operating_site_id,recipient_email,scheduled_for,created_by_auth_user_id) values(target_format,target_report_key,coalesce(target_query_spec,'{}'::jsonb),target_site_id,lower(btrim(target_recipient_email)),target_scheduled_for,actor) returning id into job_id_value;
  return query select job_id_value,'queued'::text,'applied'::text,'scheduled'::text;
end
$$;
revoke all on function public.schedule_laundry_export_job(text,text,jsonb,uuid,text,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.schedule_laundry_export_job(text,text,jsonb,uuid,text,timestamptz,uuid) to authenticated;

create or replace function public.pause_laundry_batch_stage(
  target_laundry_batch_id uuid,
  pause_reason text,
  change_request_id uuid
)
returns table(laundry_batch_id uuid, stage_run_id uuid, already_applied boolean, outcome text, status text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  batch public.laundry_batches%rowtype;
  run public.laundry_batch_stage_runs%rowtype;
  payload jsonb;
  existing private.laundry_batch_progress_change_requests%rowtype;
  inserted_count integer;
  reason_text text := btrim(pause_reason);
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  payload := jsonb_build_object('laundry_batch_id', target_laundry_batch_id, 'reason', reason_text);
  select request.* into existing
  from private.laundry_batch_progress_change_requests as request
  where request.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor or existing.change_payload <> payload then
      return query select target_laundry_batch_id, null::uuid, false, 'denied'::text, null::text, 'request_replay'::text;
      return;
    end if;
    return query select existing.laundry_batch_id, existing.stage_run_id, true, existing.outcome, 'paused'::text, existing.reason_code;
    return;
  end if;
  select laundry_batch.* into batch
  from public.laundry_batches as laundry_batch
  where laundry_batch.id = target_laundry_batch_id
  for update;
  select stage_run.* into run
  from public.laundry_batch_stage_runs as stage_run
  where stage_run.id = batch.active_stage_run_id
  for update;
  if not found or not private.has_laundry_worker_site_access(batch.operating_site_id) then
    return query select target_laundry_batch_id, null::uuid, false, 'denied'::text, null::text, 'worker_scope_denied'::text;
    return;
  end if;
  if run.status <> 'in_progress' or reason_text is null or char_length(reason_text) < 1 then
    return query select batch.id, run.id, false, 'denied'::text, run.status, 'batch_not_running'::text;
    return;
  end if;
  payload := payload || jsonb_build_object('stage_run_id', run.id);
  insert into private.laundry_batch_progress_change_requests(
    id, actor_auth_user_id, operation, change_payload, laundry_batch_id, stage_run_id, outcome, reason_code
  ) values (
    change_request_id, actor, 'pause', payload, batch.id, run.id, 'applied', 'paused'
  ) on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    raise exception 'progress request replay rejected' using errcode = '42501';
  end if;
  update public.laundry_batch_stage_runs as stage_run
    set status = 'paused',
      paused_at = now(),
      pause_reason = reason_text,
      updated_at = now()
    where stage_run.id = run.id;
  update public.laundry_batches as laundry_batch
    set status = 'paused', updated_at = now()
    where laundry_batch.id = batch.id;
  insert into public.authorization_audit_events(
    actor_type, actor_auth_user_id, operating_site_id, laundry_batch_id, action, outcome, reason, before_state, after_state, request_id
  ) values (
    'authenticated_user', actor, batch.operating_site_id, batch.id, 'laundry_batch_stage_paused', 'succeeded', reason_text,
    jsonb_build_object('status', 'in_progress'), jsonb_build_object('status', 'paused'), change_request_id
  );
  return query select batch.id, run.id, false, 'applied'::text, 'paused'::text, 'paused'::text;
end;
$$;

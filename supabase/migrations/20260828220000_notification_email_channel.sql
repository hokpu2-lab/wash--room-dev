alter table public.notification_external_destinations
  drop constraint if exists notification_external_type_check;

alter table public.notification_external_destinations
  add constraint notification_external_type_check
  check (destination_type in ('line', 'telegram', 'email'));

alter table public.notification_external_destinations
  drop constraint if exists notification_external_email_format_check;

alter table public.notification_external_destinations
  add constraint notification_external_email_format_check
  check (
    destination_type <> 'email'
    or destination = lower(btrim(destination))
      and destination ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

create or replace function public.upsert_notification_external_destination(
  destination_type text,
  destination_label text,
  destination_value text,
  target_site_id uuid,
  target_institution_id uuid,
  target_active boolean,
  change_request_id uuid
)
returns table(destination_id uuid, already_applied boolean, outcome text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  destination_id_value uuid;
  normalized_type text := lower(btrim(destination_type));
  normalized_label text := btrim(destination_label);
  normalized_value text := btrim(destination_value);
begin
  if actor is null or not private.has_any_laundry_supervisor_access() then
    return query select null::uuid, false, 'denied'::text, 'worker_scope_denied'::text;
    return;
  end if;
  if normalized_type = 'email' then
    normalized_value := lower(normalized_value);
  end if;
  if normalized_type not in ('line', 'telegram', 'email')
    or normalized_label is null or char_length(normalized_label) not between 1 and 80
    or normalized_value is null or char_length(normalized_value) not between 1 and 200 then
    return query select null::uuid, false, 'denied'::text, 'invalid_destination'::text;
    return;
  end if;
  if normalized_type = 'email'
    and normalized_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return query select null::uuid, false, 'denied'::text, 'invalid_destination'::text;
    return;
  end if;
  if target_site_id is not null and not private.has_laundry_supervisor_site_access(target_site_id) then
    return query select null::uuid, false, 'denied'::text, 'worker_scope_denied'::text;
    return;
  end if;
  insert into public.notification_external_destinations(
    destination_type, label, destination, operating_site_id, institution_id, active, created_by_auth_user_id
  ) values (
    normalized_type, normalized_label, normalized_value, target_site_id, target_institution_id, target_active, actor
  ) returning id into destination_id_value;
  return query select destination_id_value, false, 'applied'::text, 'configured'::text;
end
$$;

create or replace function public.test_notification_external_destination(target_destination_id uuid)
returns table(destination_id uuid, destination_type text, enabled boolean, outcome text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  destination public.notification_external_destinations%rowtype;
  configured boolean;
begin
  select d.* into destination
  from public.notification_external_destinations d
  where d.id = target_destination_id and d.active;
  if not found or not private.has_any_laundry_supervisor_access() then
    return query select target_destination_id, null::text, false, 'denied'::text, 'worker_scope_denied'::text;
    return;
  end if;
  configured := case
    when destination.destination_type = 'line'
      then coalesce(current_setting('app.line_channel_access_token', true), '') <> ''
    when destination.destination_type = 'telegram'
      then coalesce(current_setting('app.telegram_bot_token', true), '') <> ''
    when destination.destination_type = 'email'
      then coalesce(current_setting('app.notification_email_from', true), '') <> ''
    else false
  end;
  return query select destination.id, destination.destination_type, configured, 'applied'::text,
    case when configured then 'test_message_queued' else 'not_configured' end;
end
$$;

create or replace function private.enqueue_laundry_notification_event(
  target_event_key text,
  target_source_event_id uuid,
  target_site_id uuid,
  target_institution_id uuid,
  target_severity text,
  target_summary text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule record;
  member_row record;
  dest record;
  bucket timestamptz;
  dispatch_id uuid;
  inserted_count integer := 0;
  event_window integer;
  key text;
  email_address text;
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
    select p.auth_user_id, coalesce(p.notification_email, p.email) as email, m.role
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
      email_address := case when rule.channel = 'email' then member_row.email else member_row.email end;
      key := target_event_key||':'||coalesce(target_source_event_id::text,'none')||':'||coalesce(member_row.auth_user_id::text,'none')||':'||rule.channel||':'||coalesce(bucket::text,'immediate');
      insert into public.notification_outbox(
        idempotency_key,event_key,source_event_id,operating_site_id,institution_id,
        recipient_auth_user_id,recipient_email,channel,destination,severity,content_summary
      ) values(
        key,target_event_key,target_source_event_id,target_site_id,target_institution_id,
        member_row.auth_user_id,email_address,rule.channel,
        case when rule.channel = 'email' then email_address else rule.destination end,
        target_severity,target_summary
      )
      on conflict (idempotency_key) do nothing;
      inserted_count := inserted_count + 1;
    end loop;
  end loop;
  if exists (
    select 1 from public.notification_matrix_rules r
    where r.event_key = target_event_key and r.enabled and r.channel = 'email'
  ) then
    for dest in
      select d.*
      from public.notification_external_destinations d
      where d.active and d.destination_type = 'email'
        and (d.operating_site_id is null or d.operating_site_id = target_site_id)
    loop
      key := target_event_key||':'||coalesce(target_source_event_id::text,'none')||':dest:'||dest.id::text||':email:'||coalesce(bucket::text,'immediate');
      insert into public.notification_outbox(
        idempotency_key,event_key,source_event_id,operating_site_id,institution_id,
        recipient_auth_user_id,recipient_email,channel,destination,severity,content_summary
      ) values(
        key,target_event_key,target_source_event_id,target_site_id,target_institution_id,
        null,dest.destination,'email',dest.destination,target_severity,target_summary
      )
      on conflict (idempotency_key) do nothing;
      inserted_count := inserted_count + 1;
    end loop;
  end if;
  return inserted_count;
end
$$;

create or replace function public.dispatch_notification_with_fallback(target_outbox_id uuid)
returns table(outbox_id uuid, status text, attempt_count integer, fallback_channel text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.notification_outbox%rowtype;
  attempt_no integer;
  fallback_id uuid;
begin
  select o.* into item from public.notification_outbox o where o.id = target_outbox_id for update;
  if not found then
    return query select target_outbox_id, 'failed'::text, 0, null::text, 'not_found'::text;
    return;
  end if;
  attempt_no := item.attempt_count + 1;
  if item.channel = 'in_app' then
    update public.notification_outbox set status = 'sent', attempt_count = attempt_no, sent_at = now() where id = item.id;
    return query select item.id, 'sent'::text, attempt_no, null::text, 'delivered'::text;
    return;
  end if;
  if item.channel = 'email' then
    if item.recipient_email is null or btrim(item.recipient_email) = '' then
      insert into public.notification_outbox(
        idempotency_key,event_key,source_event_id,operating_site_id,institution_id,
        recipient_auth_user_id,recipient_email,channel,severity,content_summary
      ) values(
        item.idempotency_key||':fallback',item.event_key,item.source_event_id,item.operating_site_id,
        item.institution_id,item.recipient_auth_user_id,item.recipient_email,'in_app',item.severity,item.content_summary
      ) returning id into fallback_id;
      insert into public.notification_delivery_fallbacks(outbox_id,fallback_channel,fallback_outbox_id,reason)
        values(item.id,'in_app',fallback_id,'缺少通知 Email');
      update public.notification_outbox set status = 'failed', attempt_count = attempt_no, last_error = '缺少通知 Email' where id = item.id;
      return query select item.id, 'failed'::text, attempt_no, 'in_app'::text, 'fallback_created'::text;
      return;
    end if;
    update public.notification_outbox
    set status = 'sent', attempt_count = attempt_no, sent_at = now(), last_error = null
    where id = item.id;
    return query select item.id, 'sent'::text, attempt_no, null::text, 'email_queued'::text;
    return;
  end if;
  if attempt_no <= 3 then
    update public.notification_outbox
    set status = 'pending', attempt_count = attempt_no, last_error = '外部通道重試中', next_attempt_at = now() + interval '5 minutes'
    where id = item.id;
  end if;
  if attempt_no >= 3 then
    insert into public.notification_outbox(
      idempotency_key,event_key,source_event_id,operating_site_id,institution_id,
      recipient_auth_user_id,recipient_email,channel,severity,content_summary
    ) values(
      item.idempotency_key||':fallback',item.event_key,item.source_event_id,item.operating_site_id,
      item.institution_id,item.recipient_auth_user_id,item.recipient_email,'in_app',item.severity,item.content_summary
    ) returning id into fallback_id;
    insert into public.notification_delivery_fallbacks(outbox_id,fallback_channel,fallback_outbox_id,reason)
      values(item.id,'in_app',fallback_id,'外部通道連續失敗');
    update public.notification_outbox set status = 'failed', last_error = '外部通道連續失敗' where id = item.id;
    return query select item.id, 'failed'::text, attempt_no, 'in_app'::text, 'fallback_created'::text;
    return;
  end if;
  return query select item.id, 'pending'::text, attempt_no, null::text, 'retry_scheduled'::text;
end
$$;

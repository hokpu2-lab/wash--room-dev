create table public.notification_external_destinations (
  id uuid primary key default gen_random_uuid(),
  destination_type text not null,
  label text not null,
  destination text not null,
  operating_site_id uuid references public.operating_sites(id),
  institution_id uuid references public.institutions(id),
  active boolean not null default true,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint notification_external_type_check check (destination_type in ('line','telegram')),
  constraint notification_external_label_check check (char_length(btrim(label)) between 1 and 80),
  constraint notification_external_destination_check check (char_length(btrim(destination)) between 1 and 200)
);
alter table public.notification_external_destinations enable row level security;
create policy notification_external_destinations_select_in_scope on public.notification_external_destinations for select to authenticated using (operating_site_id is null or private.has_laundry_supervisor_site_access(operating_site_id));
revoke all on table public.notification_external_destinations from anon,authenticated,service_role; grant select on table public.notification_external_destinations to authenticated;

create table public.notification_delivery_fallbacks(id uuid primary key default gen_random_uuid(),outbox_id uuid not null references public.notification_outbox(id),fallback_channel text not null,fallback_outbox_id uuid references public.notification_outbox(id),reason text not null,created_at timestamptz not null default now(),constraint notification_fallback_channel_check check(fallback_channel in ('in_app','email')));
revoke all on table public.notification_delivery_fallbacks from anon,authenticated,service_role;

create function public.upsert_notification_external_destination(destination_type text,destination_label text,destination_value text,target_site_id uuid,target_institution_id uuid,target_active boolean,change_request_id uuid)
returns table(destination_id uuid,already_applied boolean,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); destination_id_value uuid;
begin
  if actor is null or not private.has_any_laundry_supervisor_access() then return query select null::uuid,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  if destination_type not in ('line','telegram') or destination_label is null or destination_value is null then return query select null::uuid,false,'denied'::text,'invalid_destination'::text; return; end if;
  if target_site_id is not null and not private.has_laundry_supervisor_site_access(target_site_id) then return query select null::uuid,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  insert into public.notification_external_destinations(destination_type,label,destination,operating_site_id,institution_id,active,created_by_auth_user_id) values(destination_type,btrim(destination_label),btrim(destination_value),target_site_id,target_institution_id,target_active,actor) returning id into destination_id_value;
  return query select destination_id_value,false,'applied'::text,'configured'::text;
end
$$;

create function public.test_notification_external_destination(target_destination_id uuid)
returns table(destination_id uuid,destination_type text,enabled boolean,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare destination public.notification_external_destinations%rowtype; configured boolean;
begin
  select d.* into destination from public.notification_external_destinations d where d.id=target_destination_id and d.active;
  if not found or not private.has_any_laundry_supervisor_access() then return query select target_destination_id,null::text,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  configured:=case when destination.destination_type='line' then coalesce(current_setting('app.line_channel_access_token',true),'')<>'' else coalesce(current_setting('app.telegram_bot_token',true),'')<>'' end;
  return query select destination.id,destination.destination_type,configured,'applied'::text,case when configured then 'test_message_queued' else 'not_configured' end;
end
$$;

create function public.dispatch_notification_with_fallback(target_outbox_id uuid)
returns table(outbox_id uuid,status text,attempt_count integer,fallback_channel text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare item public.notification_outbox%rowtype; attempt_no integer; fallback_id uuid;
begin
  select o.* into item from public.notification_outbox o where o.id=target_outbox_id for update;
  if not found then return query select target_outbox_id,'failed'::text,0,null::text,'not_found'::text; return; end if;
  attempt_no:=item.attempt_count+1;
  if item.channel='in_app' then update public.notification_outbox set status='sent',attempt_count=attempt_no,sent_at=now() where id=item.id; return query select item.id,'sent'::text,attempt_no,null::text,'delivered'::text; return; end if;
  if attempt_no<=3 then update public.notification_outbox set status='pending',attempt_count=attempt_no,last_error='外部通道重試中',next_attempt_at=now()+interval '5 minutes' where id=item.id; end if;
  if attempt_no>=3 then
    insert into public.notification_outbox(idempotency_key,event_key,source_event_id,operating_site_id,institution_id,recipient_auth_user_id,recipient_email,channel,severity,content_summary) values(item.idempotency_key||':fallback',item.event_key,item.source_event_id,item.operating_site_id,item.institution_id,item.recipient_auth_user_id,item.recipient_email,'in_app',item.severity,item.content_summary) returning id into fallback_id;
    insert into public.notification_delivery_fallbacks(outbox_id,fallback_channel,fallback_outbox_id,reason) values(item.id,'in_app',fallback_id,'外部通道連續失敗');
    update public.notification_outbox set status='failed',last_error='外部通道連續失敗' where id=item.id;
    return query select item.id,'failed'::text,attempt_no,'in_app'::text,'fallback_created'::text; return;
  end if;
  return query select item.id,'pending'::text,attempt_no,null::text,'retry_scheduled'::text;
end
$$;
revoke all on function public.upsert_notification_external_destination(text,text,text,uuid,uuid,boolean,uuid),public.test_notification_external_destination(uuid),public.dispatch_notification_with_fallback(uuid) from public,anon,service_role;
grant execute on function public.upsert_notification_external_destination(text,text,text,uuid,uuid,boolean,uuid),public.test_notification_external_destination(uuid),public.dispatch_notification_with_fallback(uuid) to authenticated;

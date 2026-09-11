create table public.laundry_capacity_snapshots (
  id uuid primary key default gen_random_uuid(),
  operating_site_id uuid not null references public.operating_sites(id),
  snapshot_date date not null,
  available_minutes integer not null,
  required_minutes integer not null,
  capacity_gap_minutes integer not null,
  overtime_recommendation_minutes integer not null default 0,
  calculated_at timestamptz not null default now(),
  unique (operating_site_id, snapshot_date)
);
alter table public.laundry_capacity_snapshots enable row level security;
create policy laundry_capacity_snapshots_select_in_scope on public.laundry_capacity_snapshots for select to authenticated using (private.has_laundry_supervisor_site_access(operating_site_id));
revoke all on table public.laundry_capacity_snapshots from anon,authenticated,service_role; grant select on table public.laundry_capacity_snapshots to authenticated;

create table public.laundry_replan_suggestions (
  id uuid primary key default gen_random_uuid(),
  operating_site_id uuid not null references public.operating_sites(id),
  reason text not null,
  affected_batch_ids jsonb not null default '[]'::jsonb,
  suggestion jsonb not null,
  status text not null default 'proposed',
  created_by_auth_user_id uuid not null,
  confirmed_by_auth_user_id uuid,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint laundry_replan_status_check check (status in ('proposed','confirmed','cancelled'))
);
alter table public.laundry_replan_suggestions enable row level security;
create policy laundry_replan_suggestions_select_in_scope on public.laundry_replan_suggestions for select to authenticated using (private.has_laundry_supervisor_site_access(operating_site_id));
revoke all on table public.laundry_replan_suggestions from anon,authenticated,service_role; grant select on table public.laundry_replan_suggestions to authenticated;

create table private.laundry_replan_requests(id uuid primary key,actor_auth_user_id uuid not null,operation text not null,change_payload jsonb not null,result_id uuid,outcome text not null,reason_code text not null,created_at timestamptz not null default now());
revoke all on table private.laundry_replan_requests from public,anon,authenticated,service_role;

create function public.create_laundry_replan_suggestion(target_site_id uuid,replan_reason text,change_request_id uuid)
returns table(suggestion_id uuid,already_applied boolean,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); payload jsonb; existing private.laundry_replan_requests%rowtype; suggestion_id_value uuid; pending_ids jsonb; required_minutes integer; available_minutes integer:=480; gap integer; inserted_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if; payload:=jsonb_build_object('site_id',target_site_id,'reason',btrim(replan_reason)); select r.* into existing from private.laundry_replan_requests r where r.id=change_request_id;
  if found then if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select null::uuid,false,'denied'::text,'request_replay'::text; return; end if; return query select existing.result_id,true,existing.outcome,existing.reason_code; return; end if;
  if not private.has_laundry_supervisor_site_access(target_site_id) or replan_reason is null or char_length(btrim(replan_reason))<1 then return query select null::uuid,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  select coalesce(jsonb_agg(b.id), '[]'::jsonb), coalesce(sum((select sum(stage.standard_minutes) from public.procedure_template_stages stage where stage.procedure_version_id=b.procedure_version_id)),0)::integer into pending_ids,required_minutes from public.laundry_batches b where b.operating_site_id=target_site_id and b.status in ('not_started','awaiting_cart'); gap:=greatest(0,required_minutes-available_minutes);
  insert into public.laundry_capacity_snapshots(operating_site_id,snapshot_date,available_minutes,required_minutes,capacity_gap_minutes,overtime_recommendation_minutes) values(target_site_id,current_date,available_minutes,required_minutes,gap,gap) on conflict(operating_site_id,snapshot_date) do update set available_minutes=excluded.available_minutes,required_minutes=excluded.required_minutes,capacity_gap_minutes=excluded.capacity_gap_minutes,overtime_recommendation_minutes=excluded.overtime_recommendation_minutes,calculated_at=now();
  insert into public.laundry_replan_suggestions(operating_site_id,reason,affected_batch_ids,suggestion,created_by_auth_user_id) values(target_site_id,btrim(replan_reason),pending_ids,jsonb_build_object('sort','priority_then_created_at','available_minutes',available_minutes,'required_minutes',required_minutes,'capacity_gap_minutes',gap,'overtime_recommendation_minutes',gap),actor) returning id into suggestion_id_value;
  insert into private.laundry_replan_requests(id,actor_auth_user_id,operation,change_payload,result_id,outcome,reason_code) values(change_request_id,actor,'create_replan',payload,suggestion_id_value,'applied','proposed');
  return query select suggestion_id_value,false,'applied'::text,'proposed'::text;
end
$$;

create function public.confirm_laundry_replan(target_suggestion_id uuid,change_request_id uuid)
returns table(suggestion_id uuid,already_applied boolean,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); suggestion public.laundry_replan_suggestions%rowtype; payload jsonb; existing private.laundry_replan_requests%rowtype;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if; payload:=jsonb_build_object('suggestion_id',target_suggestion_id); select r.* into existing from private.laundry_replan_requests r where r.id=change_request_id;
  if found then if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select target_suggestion_id,false,'denied'::text,'request_replay'::text; return; end if; return query select existing.result_id,true,existing.outcome,existing.reason_code; return; end if;
  select s.* into suggestion from public.laundry_replan_suggestions s where s.id=target_suggestion_id for update;
  if not found or not private.has_laundry_supervisor_site_access(suggestion.operating_site_id) then return query select target_suggestion_id,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  if suggestion.status<>'proposed' then return query select suggestion.id,false,'denied'::text,'already_confirmed'::text; return; end if;
  update public.laundry_replan_suggestions set status='confirmed',confirmed_by_auth_user_id=actor,confirmed_at=now() where id=suggestion.id;
  insert into private.laundry_replan_requests(id,actor_auth_user_id,operation,change_payload,result_id,outcome,reason_code) values(change_request_id,actor,'confirm_replan',payload,suggestion.id,'applied','confirmed');
  return query select suggestion.id,false,'applied'::text,'confirmed'::text;
end
$$;
revoke all on function public.create_laundry_replan_suggestion(uuid,text,uuid),public.confirm_laundry_replan(uuid,uuid) from public,anon,service_role;
grant execute on function public.create_laundry_replan_suggestion(uuid,text,uuid),public.confirm_laundry_replan(uuid,uuid) to authenticated;

create table public.notification_matrix_rules (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  channel text not null,
  recipient_role text not null,
  operating_site_id uuid references public.operating_sites(id),
  institution_id uuid references public.institutions(id),
  severity text not null default 'normal',
  enabled boolean not null default true,
  destination text,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint notification_matrix_channel_check check (channel in ('in_app','email','line','telegram')),
  constraint notification_matrix_severity_check check (severity in ('normal','high','critical'))
);
alter table public.notification_matrix_rules enable row level security;
create policy notification_matrix_select_in_scope on public.notification_matrix_rules for select to authenticated using (operating_site_id is null or private.has_laundry_supervisor_site_access(operating_site_id));
revoke all on table public.notification_matrix_rules from anon,authenticated,service_role; grant select on table public.notification_matrix_rules to authenticated;
insert into public.notification_matrix_rules(event_key,channel,recipient_role,severity,enabled,created_by_auth_user_id)
values
  ('order_ready_for_pickup','in_app','laundry_supervisor','normal',true,'00000000-0000-0000-0000-000000000000'),
  ('order_ready_for_pickup','email','laundry_supervisor','normal',true,'00000000-0000-0000-0000-000000000000'),
  ('order_ready_for_pickup','in_app','institution_supervisor','normal',true,'00000000-0000-0000-0000-000000000000'),
  ('order_ready_for_pickup','email','institution_supervisor','normal',true,'00000000-0000-0000-0000-000000000000');

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  event_key text not null,
  source_event_id uuid,
  operating_site_id uuid references public.operating_sites(id),
  institution_id uuid references public.institutions(id),
  recipient_auth_user_id uuid references auth.users(id),
  recipient_email text,
  channel text not null,
  destination text,
  severity text not null,
  content_summary text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_outbox_channel_check check (channel in ('in_app','email','line','telegram')),
  constraint notification_outbox_status_check check (status in ('pending','sent','failed','suppressed'))
);
alter table public.notification_outbox enable row level security;
create policy notification_outbox_select_recipient on public.notification_outbox for select to authenticated using (recipient_auth_user_id=(select auth.uid()) or private.has_laundry_supervisor_site_access(operating_site_id));
revoke all on table public.notification_outbox from anon,authenticated,service_role; grant select on table public.notification_outbox to authenticated;

create table public.notification_attempts(id uuid primary key default gen_random_uuid(),outbox_id uuid not null references public.notification_outbox(id),attempt_no integer not null,channel text not null,success boolean not null,error_message text,attempted_at timestamptz not null default now(),unique(outbox_id,attempt_no));
revoke all on table public.notification_attempts from anon,authenticated,service_role;

create function private.enqueue_ready_for_pickup_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare member_row record; rule record; key text; summary text;
begin
  if new.status<>'ready_for_pickup' or old.status='ready_for_pickup' then return new; end if;
  for member_row in select profile.auth_user_id,profile.email,mem.role from public.access_memberships mem join public.user_access_profiles profile on profile.id=mem.user_access_profile_id where mem.active and profile.active and ((mem.role='laundry_supervisor' and mem.operating_site_id=new.operating_site_id) or (mem.role='institution_supervisor' and mem.institution_id=new.institution_id)) loop
    for rule in select * from public.notification_matrix_rules where event_key='order_ready_for_pickup' and enabled and recipient_role=member_row.role and (operating_site_id is null or operating_site_id=new.operating_site_id) and (institution_id is null or institution_id=new.institution_id) loop
      key:='ready:'||new.id::text||':'||member_row.auth_user_id::text||':'||rule.channel||':'||coalesce(rule.destination,''); summary:='洗衣單 '||new.order_number||' 已可取件';
      insert into public.notification_outbox(idempotency_key,event_key,source_event_id,operating_site_id,institution_id,recipient_auth_user_id,recipient_email,channel,destination,severity,content_summary) values(key,'order_ready_for_pickup',new.id,new.operating_site_id,new.institution_id,member_row.auth_user_id,member_row.email,rule.channel,rule.destination,rule.severity,summary) on conflict(idempotency_key) do nothing;
    end loop;
  end loop;
  return new;
end
$$;
create trigger enqueue_ready_for_pickup_notifications_after_update after update of status on public.laundry_orders for each row execute function private.enqueue_ready_for_pickup_notifications();

create function public.upsert_notification_matrix_rule(target_event_key text,target_channel text,target_role text,target_site_id uuid,target_institution_id uuid,target_severity text,target_enabled boolean,target_destination text,change_request_id uuid)
returns table(rule_id uuid,already_applied boolean,outcome text,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); rule_id_value uuid;
begin
  if actor is null or not private.has_any_laundry_supervisor_access() then return query select null::uuid,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  insert into public.notification_matrix_rules(event_key,channel,recipient_role,operating_site_id,institution_id,severity,enabled,destination,created_by_auth_user_id) values(target_event_key,target_channel,target_role,target_site_id,target_institution_id,target_severity,target_enabled,target_destination,actor) returning id into rule_id_value;
  return query select rule_id_value,false,'applied'::text,'configured'::text;
end
$$;
revoke all on function public.upsert_notification_matrix_rule(text,text,text,uuid,uuid,text,boolean,text,uuid) from public,anon,service_role;
grant execute on function public.upsert_notification_matrix_rule(text,text,text,uuid,uuid,text,boolean,text,uuid) to authenticated;

create function public.dispatch_notification_outbox(target_outbox_id uuid)
returns table(outbox_id uuid,status text,attempt_count integer,reason_code text)
language plpgsql security definer set search_path = '' as $$
declare item public.notification_outbox%rowtype; next_attempt integer;
begin
  select o.* into item from public.notification_outbox o where o.id=target_outbox_id for update;
  if not found then return query select target_outbox_id,'failed'::text,0,'not_found'::text; return; end if;
  if item.status='sent' then return query select item.id,item.status,item.attempt_count,'already_sent'::text; return; end if;
  next_attempt:=item.attempt_count+1;
  if next_attempt<=3 and item.channel='in_app' then update public.notification_outbox set status='sent',attempt_count=next_attempt,sent_at=now(),last_error=null where id=item.id; insert into public.notification_attempts(outbox_id,attempt_no,channel,success) values(item.id,next_attempt,item.channel,true); return query select item.id,'sent'::text,next_attempt,'delivered'::text; return; end if;
  update public.notification_outbox set status=case when next_attempt>=3 then 'failed' else 'pending' end,attempt_count=next_attempt,last_error='外部通道尚未配置或傳送失敗',next_attempt_at=now()+interval '5 minutes' where id=item.id; insert into public.notification_attempts(outbox_id,attempt_no,channel,success,error_message) values(item.id,next_attempt,item.channel,false,'外部通道尚未配置或傳送失敗'); return query select item.id,case when next_attempt>=3 then 'failed' else 'pending' end,next_attempt,'delivery_failed'::text;
end
$$;
revoke all on function public.dispatch_notification_outbox(uuid) from public,anon,service_role;
grant execute on function public.dispatch_notification_outbox(uuid) to authenticated;

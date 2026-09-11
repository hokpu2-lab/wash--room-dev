alter table public.laundry_batches add column batch_sequence integer;
update public.laundry_batches batch_row
set batch_sequence = sequence_rows.sequence_value
from (
  select id, row_number() over (partition by laundry_order_id order by created_at, id)::integer as sequence_value
  from public.laundry_batches
) sequence_rows
where batch_row.id = sequence_rows.id;
alter table public.laundry_batches alter column batch_sequence set default 1;
alter table public.laundry_batches alter column batch_sequence set not null;
alter table public.laundry_batches add column required boolean not null default true;
alter table public.laundry_batches add column cancelled_at timestamptz;
alter table public.laundry_batches add column cancelled_by_auth_user_id uuid;
alter table public.laundry_batches add column cancellation_reason text;
alter table public.laundry_batches add constraint laundry_batches_sequence_check check (batch_sequence > 0);
alter table public.laundry_batches add constraint laundry_batches_cancelled_check check (
  (status = 'cancelled' and cancelled_at is not null and cancellation_reason is not null)
  or (status <> 'cancelled' and cancelled_at is null and cancelled_by_auth_user_id is null and cancellation_reason is null)
);
create unique index laundry_batches_order_sequence_idx on public.laundry_batches (laundry_order_id, batch_sequence);

create function private.assign_laundry_batch_sequence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.batch_sequence is null or new.batch_sequence = 1 and exists (
    select 1 from public.laundry_batches existing where existing.laundry_order_id = new.laundry_order_id
  ) then
    select coalesce(max(existing.batch_sequence), 0) + 1 into new.batch_sequence
    from public.laundry_batches existing
    where existing.laundry_order_id = new.laundry_order_id;
  end if;
  return new;
end
$$;
create trigger assign_laundry_batch_sequence_before_insert
before insert on public.laundry_batches
for each row execute function private.assign_laundry_batch_sequence();

create table private.laundry_batch_split_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  change_payload jsonb not null,
  laundry_order_id uuid references public.laundry_orders(id),
  batch_count integer not null default 0,
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_batch_split_outcome_check check (outcome in ('applied','denied')),
  constraint laundry_batch_split_reason_check check (reason_code in ('split','invalid_categories','worker_scope_denied','order_not_splittable','missing_published_procedure','request_replay'))
);
revoke all on table private.laundry_batch_split_requests from public, anon, authenticated, service_role;

create function public.split_laundry_order_into_batches(
  target_laundry_order_id uuid,
  selected_category_codes jsonb,
  change_request_id uuid
)
returns table (laundry_order_id uuid, batch_count integer, already_applied boolean, outcome text, reason_code text)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); profile_id uuid; order_record public.laundry_orders%rowtype;
  normalized_categories jsonb; existing private.laundry_batch_split_requests%rowtype;
  payload jsonb; inserted_count integer; category_code text; category_id uuid; template_id uuid; version_id uuid; created_count integer := 0;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if target_laundry_order_id is null or change_request_id is null or selected_category_codes is null or jsonb_typeof(selected_category_codes)<>'array' or jsonb_array_length(selected_category_codes)=0 then
    return query select target_laundry_order_id, 0, false, 'denied'::text, 'invalid_categories'::text; return;
  end if;
  select jsonb_agg(values_list.code order by values_list.code) into normalized_categories from (select distinct upper(btrim(value)) as code from jsonb_array_elements_text(selected_category_codes)) values_list;
  if normalized_categories is null or exists(select 1 from jsonb_array_elements_text(normalized_categories) item where item.value is null or item.value !~ '^[A-Z][A-Z0-9_-]{0,39}$') then
    return query select target_laundry_order_id,0,false,'denied'::text,'invalid_categories'::text; return;
  end if;
  payload := jsonb_build_object('laundry_order_id',target_laundry_order_id,'category_codes',normalized_categories);
  select r.* into existing from private.laundry_batch_split_requests r where r.id=change_request_id;
  if found then
    if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select target_laundry_order_id,0,false,'denied'::text,'request_replay'::text; return; end if;
    return query select existing.laundry_order_id,existing.batch_count,true,existing.outcome,existing.reason_code; return;
  end if;
  select o.* into order_record from public.laundry_orders o where o.id=target_laundry_order_id for update;
  if not found or not private.has_laundry_worker_site_access(order_record.operating_site_id) then return query select target_laundry_order_id,0,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  if order_record.status not in ('awaiting_cleaning','in_process') then return query select order_record.id,0,false,'denied'::text,'order_not_splittable'::text; return; end if;
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id=actor and p.active;
  for category_code in select value from jsonb_array_elements_text(normalized_categories) loop
    select category.id into category_id from public.laundry_categories category where category.code=category_code and category.active;
    if category_id is null then return query select order_record.id,0,false,'denied'::text,'invalid_categories'::text; return; end if;
    if exists(select 1 from public.laundry_batches b where b.laundry_order_id=order_record.id and b.laundry_category_id=category_id and b.status<>'cancelled') then continue; end if;
    select template.id, version.id into template_id, version_id
    from public.procedure_templates template join public.procedure_template_versions version on version.procedure_template_id=template.id and version.status='published'
    where template.operating_site_id=order_record.operating_site_id and template.laundry_category_id=category_id and template.active order by version.version_no desc limit 1;
    if template_id is null or version_id is null then return query select order_record.id,0,false,'denied'::text,'missing_published_procedure'::text; return; end if;
  end loop;
  insert into private.laundry_batch_split_requests(id,actor_auth_user_id,change_payload,laundry_order_id,outcome,reason_code)
    values(change_request_id,actor,payload,order_record.id,'applied','split') on conflict(id) do nothing;
  get diagnostics inserted_count=row_count; if inserted_count=0 then raise exception 'split request replay rejected' using errcode='42501'; end if;
  for category_code in select value from jsonb_array_elements_text(normalized_categories) loop
    select category.id into category_id from public.laundry_categories category where category.code=category_code and category.active;
    if exists(select 1 from public.laundry_batches b where b.laundry_order_id=order_record.id and b.laundry_category_id=category_id and b.status<>'cancelled') then continue; end if;
    select template.id, version.id into template_id, version_id
    from public.procedure_templates template join public.procedure_template_versions version on version.procedure_template_id=template.id and version.status='published'
    where template.operating_site_id=order_record.operating_site_id and template.laundry_category_id=category_id and template.active order by version.version_no desc limit 1;
    insert into public.laundry_batches(laundry_order_id,source_laundry_cart_id,operating_site_id,laundry_category_id,procedure_template_id,procedure_version_id,status,quantity_scale,current_stage_order,created_by_auth_user_id)
      values(order_record.id,order_record.laundry_cart_id,order_record.operating_site_id,category_id,template_id,version_id,'not_started','one_cart',1,actor);
    created_count:=created_count+1;
  end loop;
  update private.laundry_batch_split_requests set batch_count=created_count where id=change_request_id;
  insert into public.authorization_audit_events(actor_type,actor_auth_user_id,actor_access_profile_id,operating_site_id,institution_id,laundry_order_id,action,outcome,reason,before_state,after_state,request_id)
    values('authenticated_user',actor,profile_id,order_record.operating_site_id,order_record.institution_id,order_record.id,'laundry_order_batches_split','succeeded','同一洗衣單拆分必要批次',jsonb_build_object('category_codes',normalized_categories),jsonb_build_object('batch_count',created_count),change_request_id);
  return query select order_record.id,created_count,false,'applied'::text,'split'::text;
end
$$;
revoke all on function public.split_laundry_order_into_batches(uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.split_laundry_order_into_batches(uuid,jsonb,uuid) to authenticated;

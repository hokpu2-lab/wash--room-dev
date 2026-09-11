create table public.laundry_batch_sources (
  id uuid primary key default gen_random_uuid(),
  shared_batch_id uuid not null references public.laundry_batches(id),
  laundry_order_id uuid not null references public.laundry_orders(id),
  source_laundry_cart_id uuid not null references public.laundry_carts(id),
  operating_site_id uuid not null references public.operating_sites(id),
  laundry_category_id uuid not null references public.laundry_categories(id),
  procedure_version_id uuid not null references public.procedure_template_versions(id),
  load_status text not null default 'pending',
  loaded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint laundry_batch_sources_load_check check (
    (load_status = 'loaded' and loaded_at is not null) or (load_status = 'pending' and loaded_at is null)
  ),
  unique (shared_batch_id, laundry_order_id)
);

insert into public.laundry_batch_sources(
  shared_batch_id, laundry_order_id, source_laundry_cart_id, operating_site_id,
  laundry_category_id, procedure_version_id
)
select id, laundry_order_id, source_laundry_cart_id, operating_site_id,
  laundry_category_id, procedure_version_id
from public.laundry_batches;

alter table public.laundry_batch_sources enable row level security;
create policy laundry_batch_sources_select_in_site_scope
on public.laundry_batch_sources for select to authenticated
using (private.has_site_access(operating_site_id));
revoke all on table public.laundry_batch_sources from anon, authenticated, service_role;
grant select on table public.laundry_batch_sources to authenticated;

create table private.laundry_batch_merge_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  change_payload jsonb not null,
  target_batch_id uuid references public.laundry_batches(id),
  source_batch_id uuid references public.laundry_batches(id),
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_batch_merge_outcome_check check (outcome in ('applied','denied')),
  constraint laundry_batch_merge_reason_check check (reason_code in ('merged','worker_scope_denied','batch_not_compatible','batch_not_ready','request_replay'))
);
revoke all on table private.laundry_batch_merge_requests from public, anon, authenticated, service_role;

create function private.sync_shared_batch_source_loads()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source_row record; order_ready boolean;
begin
  if new.status <> 'loaded' or old.status = 'loaded' then return new; end if;
  update public.laundry_batch_sources
  set load_status = 'loaded', loaded_at = coalesce(new.loaded_at, now())
  where shared_batch_id = new.id;
  for source_row in select distinct laundry_order_id from public.laundry_batch_sources where shared_batch_id = new.id loop
    select not exists(
      select 1 from public.laundry_batch_sources source
      where source.laundry_order_id = source_row.laundry_order_id and source.load_status <> 'loaded'
    ) into order_ready;
    if order_ready then update public.laundry_orders set status = 'ready_for_pickup', updated_at = now() where id = source_row.laundry_order_id and status not in ('picked_up','ready_for_pickup'); end if;
  end loop;
  return new;
end
$$;
create trigger sync_shared_batch_source_loads_after_load
after update of status on public.laundry_batches
for each row execute function private.sync_shared_batch_source_loads();

create function public.merge_compatible_laundry_batches(
  target_batch_id uuid,
  source_batch_id uuid,
  change_request_id uuid
)
returns table (shared_batch_id uuid, merged_source_batch_id uuid, already_applied boolean, outcome text, reason_code text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); target public.laundry_batches%rowtype; source public.laundry_batches%rowtype; payload jsonb; existing private.laundry_batch_merge_requests%rowtype; inserted_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  payload:=jsonb_build_object('target_batch_id',target_batch_id,'source_batch_id',source_batch_id);
  select r.* into existing from private.laundry_batch_merge_requests r where r.id=change_request_id;
  if found then
    if existing.actor_auth_user_id<>actor or existing.change_payload<>payload then return query select target_batch_id,source_batch_id,false,'denied'::text,'request_replay'::text; return; end if;
    return query select existing.target_batch_id,existing.source_batch_id,true,existing.outcome,existing.reason_code; return;
  end if;
  select b.* into target from public.laundry_batches b where b.id=target_batch_id for update;
  select b.* into source from public.laundry_batches b where b.id=source_batch_id for update;
  if not found or target.id is null or source.id is null then return query select target_batch_id,source_batch_id,false,'denied'::text,'batch_not_ready'::text; return; end if;
  if not private.has_laundry_worker_site_access(target.operating_site_id) or source.operating_site_id<>target.operating_site_id then return query select target.id,source.id,false,'denied'::text,'worker_scope_denied'::text; return; end if;
  if target.id=source.id or target.status<>'not_started' or source.status<>'not_started' then return query select target.id,source.id,false,'denied'::text,'batch_not_ready'::text; return; end if;
  if target.operating_site_id<>source.operating_site_id or target.laundry_category_id<>source.laundry_category_id or target.procedure_version_id<>source.procedure_version_id then return query select target.id,source.id,false,'denied'::text,'batch_not_compatible'::text; return; end if;
  insert into private.laundry_batch_merge_requests(id,actor_auth_user_id,change_payload,target_batch_id,source_batch_id,outcome,reason_code)
    values(change_request_id,actor,payload,target.id,source.id,'applied','merged') on conflict(id) do nothing;
  get diagnostics inserted_count=row_count; if inserted_count=0 then raise exception 'merge request replay rejected' using errcode='42501'; end if;
  insert into public.laundry_batch_sources(shared_batch_id,laundry_order_id,source_laundry_cart_id,operating_site_id,laundry_category_id,procedure_version_id)
    select target.id,laundry_order_id,source_laundry_cart_id,operating_site_id,laundry_category_id,procedure_version_id from public.laundry_batch_sources where shared_batch_id=source.id
    on conflict(shared_batch_id,laundry_order_id) do nothing;
  update public.laundry_batches set status='cancelled',cancelled_at=now(),cancelled_by_auth_user_id=actor,cancellation_reason='合併至共享批次' where id=source.id;
  insert into public.authorization_audit_events(actor_type,actor_auth_user_id,operating_site_id,laundry_batch_id,action,outcome,reason,before_state,after_state,request_id)
    values('authenticated_user',actor,target.operating_site_id,target.id,'laundry_batches_merged','succeeded','合併相容批次',jsonb_build_object('source_batch_id',source.id),jsonb_build_object('shared_batch_id',target.id),change_request_id);
  return query select target.id,source.id,false,'applied'::text,'merged'::text;
end
$$;
revoke all on function public.merge_compatible_laundry_batches(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.merge_compatible_laundry_batches(uuid,uuid,uuid) to authenticated;

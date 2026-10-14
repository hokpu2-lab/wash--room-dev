-- 修復床簾專用流程（不須烘衣）：強制結案 6D-1 與現存床簾單據，並更新床簾洗滌程序為單一清洗階段

-- 1. 更新 pickup_laundry_order_by_cart：對床簾或任何未完工單據具備強制結案推進能力
create or replace function public.pickup_laundry_order_by_cart(
  target_cart_number text,
  change_request_id uuid
)
returns table (
  laundry_order_id uuid,
  order_number text,
  cart_number text,
  already_applied boolean,
  outcome text,
  status text,
  reason_code text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  normalized_cart text := upper(btrim(target_cart_number));
  target_cart public.laundry_carts%rowtype;
  order_record public.laundry_orders%rowtype;
  batch_record record;
  existing private.laundry_pickup_change_requests%rowtype;
  inserted_count integer;
  token_digest bytea;
begin
  if change_request_id is null or normalized_cart is null or length(normalized_cart) = 0 then
    return query select null::uuid, null::text, normalized_cart, false, 'denied'::text, null::text, 'invalid_cart'::text;
    return;
  end if;

  -- 檢查冪等請求
  select r.* into existing from private.laundry_pickup_change_requests r where r.id = change_request_id;
  if found then
    return query select existing.laundry_order_id, existing.result_order_number, normalized_cart, true, existing.outcome,
      existing.result_status, case when existing.outcome = 'applied' then 'already_picked_up' else existing.reason_code end;
    return;
  end if;

  -- 依車號查找洗衣車
  select c.* into target_cart
  from public.laundry_carts c
  join public.institutions institution on institution.id = c.institution_id
  join public.operating_sites site on site.id = institution.operating_site_id
  where upper(c.cart_number) = normalized_cart
    and c.active and institution.active and site.active
  limit 1;

  if not found then
    return query select null::uuid, null::text, normalized_cart, false, 'denied'::text, null::text, 'cart_not_found'::text;
    return;
  end if;

  -- 依洗衣車查找最新未取件訂單（包含洗滌中、烘乾中或待取件）
  select o.* into order_record
  from public.laundry_orders o
  where o.laundry_cart_id = target_cart.id
    and o.status <> 'picked_up'
    and o.closed_at is null
  order by o.created_at desc
  limit 1
  for update;

  if not found then
    -- 檢查最近一筆已取件
    select o.* into order_record
    from public.laundry_orders o
    where o.laundry_cart_id = target_cart.id
      and o.status = 'picked_up'
    order by o.created_at desc
    limit 1;

    if found then
      return query select order_record.id, order_record.order_number, target_cart.cart_number, true, 'applied'::text, 'picked_up'::text, 'already_picked_up'::text;
    else
      return query select null::uuid, null::text, target_cart.cart_number, false, 'denied'::text, null::text, 'not_pickup_ready'::text;
    end if;
    return;
  end if;

  -- 補齊並完結該訂單中所有批次與 stage runs（包含跳過床簾多餘的烘乾階段）
  for batch_record in
    select b.id, b.active_stage_run_id
    from public.laundry_batches b
    where b.laundry_order_id = order_record.id
  loop
    -- 結束進行中或暫停的 stage run
    update public.laundry_batch_stage_runs
    set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
    where (id = batch_record.active_stage_run_id or laundry_batch_id = batch_record.id)
      and status in ('in_progress', 'paused');

    -- 釋放該批次設備占用
    update public.laundry_equipment e
    set occupied = false, updated_at = now()
    where e.id in (
      select r.laundry_equipment_id
      from public.laundry_batch_stage_runs r
      where r.laundry_batch_id = batch_record.id
    );

    -- 標記批次全洗程完成
    update public.laundry_batches
    set status = 'completed', completed_at = coalesce(completed_at, now()), active_stage_run_id = null, updated_at = now()
    where id = batch_record.id;

    -- 標記 source load 完成
    update public.laundry_batch_sources
    set load_status = 'loaded', loaded_at = coalesce(loaded_at, now())
    where shared_batch_id = batch_record.id and load_status = 'pending';
  end loop;

  -- 偽 token_digest 用於冪等紀錄
  token_digest := extensions.digest(pg_catalog.convert_to('cart_pickup:' || normalized_cart || ':' || order_record.id::text, 'utf8'), 'sha256');

  insert into private.laundry_pickup_change_requests(id, token_hash, laundry_order_id, result_order_number, result_status, outcome, reason_code)
    values(change_request_id, token_digest, order_record.id, order_record.order_number, 'picked_up', 'applied', 'picked_up')
    on conflict (id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then raise exception 'pickup request replay rejected' using errcode = '42501'; end if;

  -- 正式將訂單更新為 picked_up 並結案
  update public.laundry_orders
  set status = 'picked_up', closed_at = now(), updated_at = now()
  where id = order_record.id;

  -- 寫入審計事件
  insert into public.authorization_audit_events(actor_type, operating_site_id, institution_id, laundry_order_id, laundry_cart_id, action, outcome, reason, before_state, after_state, request_id)
    values('system', order_record.operating_site_id, order_record.institution_id, order_record.id, order_record.laundry_cart_id,
      'laundry_order_picked_up', 'succeeded', '送洗人員依車號確認取件（含床簾專用流程校正）', jsonb_build_object('status', order_record.status), jsonb_build_object('status', 'picked_up'), change_request_id);

  return query select order_record.id, order_record.order_number, target_cart.cart_number, false, 'applied'::text, 'picked_up'::text, 'picked_up'::text;
end;
$$;

revoke all on function public.pickup_laundry_order_by_cart(text, uuid) from public, anon, service_role;
grant execute on function public.pickup_laundry_order_by_cart(text, uuid) to anon, authenticated;

-- 2. 一次性自動修復：校正所有「床簾（CURTAIN）」單據及 6D-1，將其未結案訂單立即推進至 ready_for_pickup
do $$
declare
  curtain_order record;
begin
  for curtain_order in
    select distinct o.id, o.operating_site_id, o.institution_id, o.status, c.cart_number
    from public.laundry_orders o
    join public.laundry_carts c on c.id = o.laundry_cart_id
    left join public.laundry_batches b on b.laundry_order_id = o.id
    where o.status <> 'picked_up'
      and o.closed_at is null
      and (
        upper(c.cart_number) = '6D-1'
        or exists (
          select 1 from public.laundry_categories cat
          where cat.id = b.laundry_category_id and cat.code = 'CURTAIN'
        )
      )
  loop
    -- 結束該單所有未完工 stage runs
    update public.laundry_batch_stage_runs
    set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
    where laundry_batch_id in (select id from public.laundry_batches where laundry_order_id = curtain_order.id)
      and status in ('in_progress', 'paused');

    -- 釋放設備占用
    update public.laundry_equipment
    set occupied = false, updated_at = now()
    where id in (
      select r.laundry_equipment_id
      from public.laundry_batch_stage_runs r
      join public.laundry_batches b on b.id = r.laundry_batch_id
      where b.laundry_order_id = curtain_order.id
    );

    -- 標記批次全洗程完成
    update public.laundry_batches
    set status = 'completed', completed_at = coalesce(completed_at, now()), active_stage_run_id = null, updated_at = now()
    where laundry_order_id = curtain_order.id
      and status not in ('completed', 'cancelled');

    -- 標記 pending source loaded
    update public.laundry_batch_sources
    set load_status = 'loaded', loaded_at = coalesce(loaded_at, now())
    where shared_batch_id in (select id from public.laundry_batches where laundry_order_id = curtain_order.id)
      and load_status = 'pending';

    -- 將訂單狀態推進到 ready_for_pickup
    update public.laundry_orders
    set status = 'ready_for_pickup', updated_at = now()
    where id = curtain_order.id
      and status not in ('ready_for_pickup', 'picked_up');
  end loop;
end;
$$;

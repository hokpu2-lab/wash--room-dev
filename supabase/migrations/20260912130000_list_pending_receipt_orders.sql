-- 新增 list_pending_receipt_orders RPC，供操作者查詢待收件單據與對應車卡憑證
create or replace function public.list_pending_receipt_orders(target_site_id uuid default null)
returns table (
  order_id uuid,
  order_number text,
  created_at timestamptz,
  institution_name text,
  cart_id uuid,
  cart_number text,
  qr_token text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    orders.id as order_id,
    orders.order_number,
    orders.created_at,
    institution.name as institution_name,
    cart.id as cart_id,
    cart.cart_number,
    private.build_laundry_cart_qr_token(
      cart.id,
      credential.version,
      credential.nonce,
      signing_key.signing_secret
    ) as qr_token
  from public.laundry_orders as orders
  join public.institutions as institution
    on institution.id = orders.institution_id
  join public.laundry_carts as cart
    on cart.id = orders.laundry_cart_id
  join private.laundry_cart_qr_credentials as credential
    on credential.laundry_cart_id = cart.id
   and credential.version = cart.current_qr_version
   and credential.revoked_at is null
  join private.fixed_asset_qr_signing_keys as signing_key
    on signing_key.id = credential.signing_key_id
  where (target_site_id is null or orders.operating_site_id = target_site_id)
    and orders.status = 'awaiting_receipt'
    and orders.closed_at is null
    and cart.active
    and institution.active
    and private.has_laundry_worker_site_access(orders.operating_site_id)
  order by orders.created_at asc;
$$;

revoke all on function public.list_pending_receipt_orders(uuid) from public, anon, service_role;
grant execute on function public.list_pending_receipt_orders(uuid) to authenticated;

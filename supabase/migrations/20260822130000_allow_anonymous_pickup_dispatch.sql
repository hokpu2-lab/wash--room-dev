create or replace function public.dispatch_laundry_cart_qr(qr_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  cart_id uuid;
  site_id uuid;
  open_order public.laundry_orders%rowtype;
  pending_source public.laundry_batch_sources%rowtype;
begin
  if qr_token is null or qr_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;
  select laundry_cart.id, institution.operating_site_id
  into cart_id, site_id
  from private.laundry_cart_qr_credentials as credential
  join public.laundry_carts as laundry_cart
    on laundry_cart.id = credential.laundry_cart_id
    and laundry_cart.current_qr_version = credential.version
  join public.institutions as institution
    on institution.id = laundry_cart.institution_id
  where credential.token_hash = extensions.digest(pg_catalog.convert_to(qr_token, 'utf8'), 'sha256')
    and credential.revoked_at is null
    and laundry_cart.active
    and institution.active;
  if cart_id is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;

  -- A ready-for-pickup cart is an anonymous sender flow. Resolve this state
  -- before the worker-only authorization branch so the sender never needs login.
  select laundry_order.*
  into open_order
  from public.laundry_orders as laundry_order
  where laundry_order.laundry_cart_id = cart_id
    and laundry_order.closed_at is null
  order by laundry_order.created_at desc
  limit 1;
  if found and open_order.status = 'ready_for_pickup' then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/scan/pickup', 'mode', 'pickup');
  end if;

  if actor is null then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/scan/cart', 'mode', 'anonymous_dropoff');
  end if;
  if not private.has_laundry_worker_site_access(site_id) then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'worker_scope_denied');
  end if;
  if not found then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/scan/cart', 'mode', 'anonymous_dropoff');
  end if;
  if open_order.status = 'awaiting_receipt' then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/app/operations/receive', 'mode', 'receive');
  end if;
  select source.*
  into pending_source
  from public.laundry_batch_sources as source
  where source.source_laundry_cart_id = cart_id
    and source.load_status = 'pending'
  order by source.created_at
  limit 1;
  if found then
    return jsonb_build_object('outcome', 'ok', 'next_path', '/app/operations/loading', 'mode', 'load');
  end if;
  return jsonb_build_object('outcome', 'ok', 'next_path', '/app/operations', 'mode', 'workspace');
end;
$$;

revoke all on function public.dispatch_laundry_cart_qr(text)
  from public, anon, service_role;
grant execute on function public.dispatch_laundry_cart_qr(text)
  to authenticated, anon;

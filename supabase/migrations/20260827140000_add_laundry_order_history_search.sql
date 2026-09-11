create index if not exists laundry_orders_picked_up_history_idx
  on public.laundry_orders (operating_site_id, closed_at desc)
  where status = 'picked_up';

create function public.search_laundry_order_history(
  target_site_id uuid default null,
  period_start timestamptz default (timezone('utc', now()) - interval '30 days'),
  period_end timestamptz default timezone('utc', now()),
  order_query text default null,
  target_institution_id uuid default null,
  order_limit integer default 20,
  order_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  site_id uuid := target_site_id;
  safe_limit integer := least(greatest(coalesce(order_limit, 20), 1), 40);
  safe_offset integer := least(greatest(coalesce(order_offset, 0), 0), 1000000);
  needle text := nullif(left(btrim(coalesce(order_query, '')), 120), '');
  scoped_institutions uuid[];
  site_wide boolean := false;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if period_start is null
    or period_end is null
    or period_end <= period_start
    or period_end > period_start + interval '366 days' then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_period');
  end if;

  if site_id is null then
    select operating_site_id
    into site_id
    from public.current_access_context()
    where operating_site_id is not null
    limit 1;
  end if;

  if site_id is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'worker_scope_denied');
  end if;

  site_wide := private.has_site_access(site_id)
    or private.has_laundry_supervisor_site_access(site_id);

  if not site_wide then
    select coalesce(array_agg(membership.institution_id), '{}'::uuid[])
    into scoped_institutions
    from public.access_memberships as membership
    join public.user_access_profiles as profile
      on profile.id = membership.user_access_profile_id
    join public.institutions as institution
      on institution.id = membership.institution_id
    where profile.auth_user_id = auth.uid()
      and profile.active
      and membership.active
      and membership.role = 'institution_supervisor'
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and institution.active
      and institution.operating_site_id = site_id;

    if coalesce(cardinality(scoped_institutions), 0) = 0 then
      return jsonb_build_object('outcome', 'denied', 'reason_code', 'worker_scope_denied');
    end if;

    if target_institution_id is not null
      and not (target_institution_id = any (scoped_institutions)) then
      return jsonb_build_object('outcome', 'denied', 'reason_code', 'institution_scope_denied');
    end if;
  end if;

  select jsonb_build_object(
    'outcome', 'ok',
    'site_id', site_id,
    'period', jsonb_build_object('start', period_start, 'end', period_end),
    'queue', jsonb_build_object(
      'total', (
        select count(*)
        from public.laundry_orders as laundry_order
        join public.institutions as institution
          on institution.id = laundry_order.institution_id
        join public.laundry_carts as cart
          on cart.id = laundry_order.laundry_cart_id
        where laundry_order.operating_site_id = site_id
          and laundry_order.status = 'picked_up'
          and laundry_order.closed_at >= period_start
          and laundry_order.closed_at < period_end
          and (site_wide or laundry_order.institution_id = any (scoped_institutions))
          and (target_institution_id is null or laundry_order.institution_id = target_institution_id)
          and (
            needle is null
            or laundry_order.order_number ilike '%' || needle || '%'
            or institution.code ilike '%' || needle || '%'
            or institution.name ilike '%' || needle || '%'
            or cart.cart_number ilike '%' || needle || '%'
          )
      ),
      'limit', safe_limit,
      'offset', safe_offset,
      'items', coalesce((
        select jsonb_agg(item order by item ->> 'closed_at' desc, item ->> 'order_number' desc)
        from (
          select jsonb_build_object(
            'id', laundry_order.id,
            'order_number', laundry_order.order_number,
            'status', laundry_order.status,
            'created_at', laundry_order.created_at,
            'closed_at', laundry_order.closed_at,
            'institution_code', institution.code,
            'institution_name', institution.name,
            'cart_number', cart.cart_number,
            'site_code', operating_site.code,
            'site_name', operating_site.name
          ) as item
          from public.laundry_orders as laundry_order
          join public.institutions as institution
            on institution.id = laundry_order.institution_id
          join public.laundry_carts as cart
            on cart.id = laundry_order.laundry_cart_id
          join public.operating_sites as operating_site
            on operating_site.id = laundry_order.operating_site_id
          where laundry_order.operating_site_id = site_id
            and laundry_order.status = 'picked_up'
            and laundry_order.closed_at >= period_start
            and laundry_order.closed_at < period_end
            and (site_wide or laundry_order.institution_id = any (scoped_institutions))
            and (target_institution_id is null or laundry_order.institution_id = target_institution_id)
            and (
              needle is null
              or laundry_order.order_number ilike '%' || needle || '%'
              or institution.code ilike '%' || needle || '%'
              or institution.name ilike '%' || needle || '%'
              or cart.cart_number ilike '%' || needle || '%'
            )
          order by laundry_order.closed_at desc, laundry_order.order_number desc
          limit safe_limit
          offset safe_offset
        ) as page
      ), '[]'::jsonb)
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.search_laundry_order_history(
  uuid, timestamptz, timestamptz, text, uuid, integer, integer
) from public, anon, service_role;
grant execute on function public.search_laundry_order_history(
  uuid, timestamptz, timestamptz, text, uuid, integer, integer
) to authenticated;

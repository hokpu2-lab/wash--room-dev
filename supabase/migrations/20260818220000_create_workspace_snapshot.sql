create function public.current_workspace_principal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  login_name text;
  must_change boolean;
  memberships jsonb;
begin
  if actor is null then
    return jsonb_build_object('kind', 'anonymous');
  end if;

  select profile.login_name, profile.must_change_password
  into login_name, must_change
  from public.user_access_profiles as profile
  join auth.users as auth_user
    on auth_user.id = profile.auth_user_id
  where profile.auth_user_id = actor
    and (profile.active or profile.must_change_password)
    and auth_user.email_confirmed_at is not null
    and auth_user.raw_app_meta_data ->> 'provider' = 'email';

  if not found then
    return jsonb_build_object('kind', 'denied');
  end if;

  if must_change then
    return jsonb_build_object(
      'kind', 'password_change_required',
      'login_name', login_name
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'membership_id', ctx.membership_id,
        'role', ctx.role,
        'operating_site_id', ctx.operating_site_id,
        'institution_id', ctx.institution_id,
        'scope_code', ctx.scope_code,
        'scope_name', ctx.scope_name
      )
      order by ctx.membership_id
    ),
    '[]'::jsonb
  )
  into memberships
  from public.current_access_context() as ctx;

  if memberships = '[]'::jsonb then
    return jsonb_build_object('kind', 'denied');
  end if;

  return jsonb_build_object(
    'kind', 'authorized',
    'login_name', login_name,
    'memberships', memberships
  );
end;
$$;

revoke all on function public.current_workspace_principal() from public, anon, service_role;
grant execute on function public.current_workspace_principal() to authenticated;

create function public.get_workspace_snapshot(
  target_site_id uuid default null,
  period_start timestamptz default date_trunc('day', timezone('utc', now())),
  period_end timestamptz default timezone('utc', now()),
  order_limit integer default 20,
  order_offset integer default 0,
  order_query text default null
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
  safe_offset integer := greatest(coalesce(order_offset, 0), 0);
  needle text := nullif(btrim(coalesce(order_query, '')), '');
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if site_id is null then
    select operating_site_id
    into site_id
    from public.current_access_context()
    where operating_site_id is not null
    limit 1;
  end if;

  if site_id is null
    or not (
      private.has_site_access(site_id)
      or private.has_laundry_supervisor_site_access(site_id)
    )
  then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'worker_scope_denied');
  end if;

  select jsonb_build_object(
    'outcome', 'ok',
    'site_id', site_id,
    'period', jsonb_build_object('start', period_start, 'end', period_end),
    'orders', jsonb_build_object(
      'awaiting_receipt', count(*) filter (where laundry_order.status = 'awaiting_receipt'),
      'in_process', count(*) filter (where laundry_order.status in ('awaiting_cleaning', 'in_process')),
      'ready_for_pickup', count(*) filter (where laundry_order.status = 'ready_for_pickup'),
      'picked_up', count(*) filter (
        where laundry_order.status = 'picked_up'
          and coalesce(laundry_order.closed_at, laundry_order.updated_at) >= period_start
          and coalesce(laundry_order.closed_at, laundry_order.updated_at) < period_end
      )
    ),
    'batches', jsonb_build_object(
      'not_started', (
        select count(*) from public.laundry_batches as batch
        where batch.operating_site_id = site_id and batch.status = 'not_started'
      ),
      'in_progress', (
        select count(*) from public.laundry_batches as batch
        where batch.operating_site_id = site_id and batch.status = 'in_progress'
      ),
      'paused', (
        select count(*) from public.laundry_batches as batch
        where batch.operating_site_id = site_id and batch.status = 'paused'
      ),
      'completed', (
        select count(*) from public.laundry_batches as batch
        where batch.operating_site_id = site_id
          and batch.status = 'completed'
          and batch.updated_at >= period_start
          and batch.updated_at < period_end
      )
    ),
    'queue', jsonb_build_object(
      'total', (
        select count(*)
        from public.laundry_orders as queued
        where queued.operating_site_id = site_id
          and queued.status <> 'picked_up'
          and (needle is null or queued.order_number ilike '%' || needle || '%')
      ),
      'limit', safe_limit,
      'offset', safe_offset,
      'items', coalesce((
        select jsonb_agg(item order by item ->> 'updated_at' desc)
        from (
          select jsonb_build_object(
            'id', queued.id,
            'order_number', queued.order_number,
            'status', queued.status,
            'updated_at', queued.updated_at,
            'institution_name', coalesce(institution.name, '送洗機構'),
            'cart_number', coalesce(cart.cart_number, '—')
          ) as item
          from public.laundry_orders as queued
          left join public.institutions as institution
            on institution.id = queued.institution_id
          left join public.laundry_carts as cart
            on cart.id = queued.laundry_cart_id
          where queued.operating_site_id = site_id
            and queued.status <> 'picked_up'
            and (needle is null or queued.order_number ilike '%' || needle || '%')
          order by queued.updated_at desc
          limit safe_limit
          offset safe_offset
        ) as page
      ), '[]'::jsonb)
    ),
    'open_batches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', batch.id,
          'status', batch.status,
          'stage_order', batch.current_stage_order,
          'order_number', coalesce(laundry_order.order_number, left(batch.id::text, 8)),
          'category_name', coalesce(category.name, category.code, '洗滌批次')
        )
        order by batch.updated_at
      )
      from public.laundry_batches as batch
      left join public.laundry_orders as laundry_order
        on laundry_order.id = batch.laundry_order_id
      left join public.laundry_categories as category
        on category.id = batch.laundry_category_id
      where batch.operating_site_id = site_id
        and batch.status <> 'completed'
    ), '[]'::jsonb),
    'equipment', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', equipment.id,
          'name', equipment.name,
          'equipment_type', equipment.equipment_type,
          'status', equipment.status,
          'occupied', equipment.occupied
        )
        order by equipment.name
      )
      from public.laundry_equipment as equipment
      where equipment.operating_site_id = site_id
    ), '[]'::jsonb),
    'incidents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', incident.id,
          'incident_type', incident.incident_type,
          'responsibility', incident.responsibility,
          'reason', incident.reason,
          'occurred_at', incident.occurred_at
        )
        order by incident.occurred_at desc
      )
      from (
        select incident.id, incident.incident_type, incident.responsibility, incident.reason, incident.occurred_at
        from public.laundry_batch_incidents as incident
        join public.laundry_batches as batch
          on batch.id = incident.laundry_batch_id
        where batch.operating_site_id = site_id
        order by incident.occurred_at desc
        limit 8
      ) as incident
    ), '[]'::jsonb),
    'generated_at', timezone('utc', now())
  )
  into result
  from public.laundry_orders as laundry_order
  where laundry_order.operating_site_id = site_id;

  if result is null then
    result := jsonb_build_object(
      'outcome', 'ok',
      'site_id', site_id,
      'period', jsonb_build_object('start', period_start, 'end', period_end),
      'orders', jsonb_build_object(
        'awaiting_receipt', 0,
        'in_process', 0,
        'ready_for_pickup', 0,
        'picked_up', 0
      ),
      'batches', jsonb_build_object(
        'not_started', 0,
        'in_progress', 0,
        'paused', 0,
        'completed', 0
      ),
      'queue', jsonb_build_object(
        'total', 0,
        'limit', safe_limit,
        'offset', safe_offset,
        'items', '[]'::jsonb
      ),
      'open_batches', '[]'::jsonb,
      'equipment', '[]'::jsonb,
      'incidents', '[]'::jsonb,
      'generated_at', timezone('utc', now())
    );
  end if;

  return result;
end;
$$;

revoke all on function public.get_workspace_snapshot(uuid, timestamptz, timestamptz, integer, integer, text)
  from public, anon, service_role;
grant execute on function public.get_workspace_snapshot(uuid, timestamptz, timestamptz, integer, integer, text)
  to authenticated;

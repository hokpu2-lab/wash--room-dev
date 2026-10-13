-- Migration: add cleaning_duration_config to laundry_equipment and update snapshots

-- 1. Add cleaning_duration_config column to public.laundry_equipment
alter table public.laundry_equipment
  add column if not exists cleaning_duration_config jsonb not null default '{"default": 60}'::jsonb;

update public.laundry_equipment
set cleaning_duration_config = jsonb_build_object('default', coalesce(cleaning_duration_minutes, 60))
where cleaning_duration_config is null or cleaning_duration_config = '{}'::jsonb;

-- 2. Update get_workspace_snapshot to include cleaning_duration_config
create or replace function public.get_workspace_snapshot(
  target_site_id uuid default null,
  period_start timestamptz default (timezone('utc', now()) - interval '30 days'),
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
        join public.laundry_orders as scoped_order on scoped_order.id = batch.laundry_order_id
        where batch.operating_site_id = site_id
          and batch.status = 'not_started'
          and (site_wide or scoped_order.institution_id = any (scoped_institutions))
      ),
      'in_progress', (
        select count(*) from public.laundry_batches as batch
        join public.laundry_orders as scoped_order on scoped_order.id = batch.laundry_order_id
        where batch.operating_site_id = site_id
          and batch.status = 'in_progress'
          and (site_wide or scoped_order.institution_id = any (scoped_institutions))
      ),
      'paused', (
        select count(*) from public.laundry_batches as batch
        join public.laundry_orders as scoped_order on scoped_order.id = batch.laundry_order_id
        where batch.operating_site_id = site_id
          and batch.status = 'paused'
          and (site_wide or scoped_order.institution_id = any (scoped_institutions))
      ),
      'completed', (
        select count(*) from public.laundry_batches as batch
        join public.laundry_orders as scoped_order on scoped_order.id = batch.laundry_order_id
        where batch.operating_site_id = site_id
          and batch.status = 'completed'
          and (site_wide or scoped_order.institution_id = any (scoped_institutions))
      )
    ),
    'queue', jsonb_build_object(
      'total', (
        select count(*)
        from public.laundry_orders as queued
        where queued.operating_site_id = site_id
          and queued.status <> 'picked_up'
          and (needle is null or queued.order_number ilike '%' || needle || '%')
          and (site_wide or queued.institution_id = any (scoped_institutions))
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
            and (site_wide or queued.institution_id = any (scoped_institutions))
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
        and (site_wide or laundry_order.institution_id = any (scoped_institutions))
    ), '[]'::jsonb),
    'equipment', case
      when site_wide then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', equipment.id,
            'name', equipment.name,
            'equipment_type', equipment.equipment_type,
            'status', equipment.status,
            'occupied', equipment.occupied,
            'cleaning_duration_minutes', coalesce(equipment.cleaning_duration_minutes, 60),
            'cleaning_duration_config', coalesce(equipment.cleaning_duration_config, jsonb_build_object('default', coalesce(equipment.cleaning_duration_minutes, 60)))
          )
          order by equipment.name
        )
        from public.laundry_equipment as equipment
        where equipment.operating_site_id = site_id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
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
        join public.laundry_orders as laundry_order
          on laundry_order.id = batch.laundry_order_id
        where batch.operating_site_id = site_id
          and (site_wide or laundry_order.institution_id = any (scoped_institutions))
        order by incident.occurred_at desc
        limit 8
      ) as incident
    ), '[]'::jsonb),
    'generated_at', timezone('utc', now())
  )
  into result
  from public.laundry_orders as laundry_order
  where laundry_order.operating_site_id = site_id
  and (site_wide or laundry_order.institution_id = any (scoped_institutions));

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

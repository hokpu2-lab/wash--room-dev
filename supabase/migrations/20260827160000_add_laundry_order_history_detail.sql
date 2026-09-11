create function public.get_laundry_order_history_detail(target_laundry_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  order_record public.laundry_orders%rowtype;
  site_wide boolean := false;
  workspace_detail jsonb;
  batch_ids uuid[];
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select laundry_order.*
  into order_record
  from public.laundry_orders as laundry_order
  where laundry_order.id = target_laundry_order_id;

  if not found or order_record.status <> 'picked_up' then
    return jsonb_build_object(
      'outcome', 'not_found',
      'order_id', target_laundry_order_id
    );
  end if;

  site_wide := private.has_site_access(order_record.operating_site_id)
    or private.has_laundry_supervisor_site_access(order_record.operating_site_id);

  if not site_wide
    and not private.has_institution_supervisor_access(order_record.institution_id) then
    return jsonb_build_object(
      'outcome', 'not_found',
      'order_id', target_laundry_order_id
    );
  end if;

  workspace_detail := public.get_workspace_order_detail(order_record.id);

  select coalesce(array_agg((item ->> 'id')::uuid), '{}'::uuid[])
  into batch_ids
  from jsonb_array_elements(coalesce(workspace_detail -> 'batches', '[]'::jsonb)) as item;

  select jsonb_build_object(
    'outcome', 'ok',
    'order', jsonb_build_object(
      'id', order_record.id,
      'order_number', order_record.order_number,
      'status', order_record.status,
      'created_at', order_record.created_at,
      'closed_at', order_record.closed_at,
      'institution_code', institution.code,
      'institution_name', institution.name,
      'cart_number', cart.cart_number,
      'site_code', operating_site.code,
      'site_name', operating_site.name
    ),
    'batches', coalesce(workspace_detail -> 'batches', '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', audit.id,
          'occurred_at', audit.occurred_at,
          'action', audit.action,
          'outcome', audit.outcome,
          'reason', audit.reason,
          'batch_id', audit.laundry_batch_id,
          'equipment_name', equipment.name
        )
        order by audit.occurred_at, audit.id
      )
      from public.authorization_audit_events as audit
      left join public.laundry_equipment as equipment
        on equipment.id = audit.laundry_equipment_id
      where audit.outcome = 'succeeded'
        and (
          audit.laundry_order_id = order_record.id
          or audit.laundry_batch_id = any(batch_ids)
          or audit.after_state ->> 'laundry_order_id' = order_record.id::text
          or exists (
            select 1
            from unnest(batch_ids) as batch_id
            where audit.after_state -> 'batch_ids' ? batch_id::text
          )
        )
    ), '[]'::jsonb)
  )
  into result
  from public.institutions as institution
  join public.laundry_carts as cart
    on cart.id = order_record.laundry_cart_id
  join public.operating_sites as operating_site
    on operating_site.id = order_record.operating_site_id;

  return result;
end;
$$;

revoke all on function public.get_laundry_order_history_detail(uuid)
  from public, anon, service_role;
grant execute on function public.get_laundry_order_history_detail(uuid)
  to authenticated;

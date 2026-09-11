create or replace function public.run_laundry_bi_view(target_view_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  view_row public.saved_bi_views%rowtype;
  site_id uuid;
  result jsonb;
begin
  select saved.*
  into view_row
  from public.saved_bi_views as saved
  where saved.id = target_view_id
    and (
      saved.owner_auth_user_id = auth.uid()
      or (
        saved.shared
        and (
          saved.operating_site_id is null
          or private.has_laundry_supervisor_site_access(saved.operating_site_id)
        )
      )
    );
  if not found then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'view_not_found');
  end if;

  site_id := view_row.operating_site_id;
  if site_id is null then
    select context.operating_site_id
    into site_id
    from public.current_access_context() as context
    where context.role = 'laundry_supervisor'
    limit 1;
  end if;
  if site_id is null or not private.has_laundry_supervisor_site_access(site_id) then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'worker_scope_denied');
  end if;

  with base as (
    select
      order_record.id as order_id,
      order_record.status as order_status,
      order_record.operating_site_id,
      batch.id as batch_id,
      batch.status as batch_status,
      coalesce(category.name, category.code, '未分類') as category_label
    from public.laundry_orders as order_record
    left join public.laundry_batches as batch
      on batch.laundry_order_id = order_record.id
    left join public.laundry_categories as category
      on category.id = batch.laundry_category_id
    where order_record.operating_site_id = site_id
  ), grouped as (
    select
      case view_row.dimensions ->> 0
        when 'status' then base.order_status
        when 'category' then base.category_label
        when 'operating_site' then coalesce(base.operating_site_id::text, '未知據點')
        else '總計'
      end as group_label,
      count(distinct base.order_id) as order_count,
      count(distinct base.batch_id) as batch_count,
      count(distinct base.batch_id) filter (where base.batch_status = 'completed') as completed_count
    from base
    group by 1
  )
  select jsonb_build_object(
    'outcome', 'ok',
    'view_id', view_row.id,
    'site_id', site_id,
    'dimensions', view_row.dimensions,
    'metrics', view_row.metrics,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'label', grouped.group_label,
          'order_count', case when view_row.metrics ? 'order_count' then grouped.order_count else null end,
          'batch_count', case when view_row.metrics ? 'batch_count' then grouped.batch_count else null end,
          'completed_count', case when view_row.metrics ? 'completed_count' then grouped.completed_count else null end
        )
        order by grouped.group_label
      )
      from grouped
    ), '[]'::jsonb)
  )
  into result;
  return result;
end
$$;

revoke all on function public.run_laundry_bi_view(uuid)
  from public, anon, service_role;
grant execute on function public.run_laundry_bi_view(uuid) to authenticated;

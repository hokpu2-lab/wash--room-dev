create or replace function public.get_workspace_order_detail(target_laundry_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  order_record public.laundry_orders%rowtype;
  site_wide boolean;
  received_at timestamptz;
  ready_at timestamptz;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select laundry_order.*
  into order_record
  from public.laundry_orders as laundry_order
  where laundry_order.id = target_laundry_order_id;

  if not found then
    return jsonb_build_object(
      'order_id', target_laundry_order_id,
      'batches', '[]'::jsonb
    );
  end if;

  site_wide := private.has_site_access(order_record.operating_site_id)
    or private.has_laundry_supervisor_site_access(order_record.operating_site_id);

  if not site_wide
    and not private.has_institution_supervisor_access(order_record.institution_id) then
    return jsonb_build_object(
      'order_id', target_laundry_order_id,
      'batches', '[]'::jsonb
    );
  end if;

  select min(audit.occurred_at)
  into received_at
  from public.authorization_audit_events as audit
  where audit.action = 'laundry_order_received'
    and audit.outcome = 'succeeded'
    and audit.operating_site_id = order_record.operating_site_id
    and audit.institution_id = order_record.institution_id
    and audit.laundry_cart_id = order_record.laundry_cart_id
    and audit.occurred_at >= order_record.created_at
    and (
      audit.laundry_order_id = order_record.id
      or audit.after_state ->> 'laundry_order_id' = order_record.id::text
      or exists (
        select 1
        from jsonb_array_elements_text(
          coalesce(audit.after_state -> 'batch_ids', '[]'::jsonb)
        ) as batch_reference(batch_id)
        join public.laundry_batches as batch
          on batch.id = batch_reference.batch_id::uuid
         and batch.laundry_order_id = order_record.id
      )
    );

  select max(coalesce(batch.loaded_at, batch.completed_at))
  into ready_at
  from public.laundry_batches as batch
  where batch.status in ('completed', 'loaded')
    and batch.id in (
      select direct_batch.id
      from public.laundry_batches as direct_batch
      where direct_batch.laundry_order_id = order_record.id
      union
      select source.shared_batch_id
      from public.laundry_batch_sources as source
      where source.laundry_order_id = order_record.id
        and source.operating_site_id = order_record.operating_site_id
    );

  select jsonb_build_object(
    'order_id', order_record.id,
    'order_created_at', order_record.created_at,
    'order_received_at', received_at,
    'order_ready_at', ready_at,
    'order_closed_at', order_record.closed_at,
    'batches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', batch.id,
          'batch_sequence', batch.batch_sequence,
          'category_code', coalesce(category.code, 'OTHER'),
          'category_name', coalesce(category.name, category.code, '洗滌批次'),
          'procedure_name', coalesce(version.template_name, '洗滌程序'),
          'procedure_version', coalesce(version.version_no, 1),
          'status', batch.status,
          'current_stage_order', batch.current_stage_order,
          'active_equipment_name', case
            when site_wide then active_equipment.name
            else null
          end,
          'active_equipment_type', case
            when site_wide then active_equipment.equipment_type
            else null
          end,
          'progress', jsonb_build_object(
            'stage_run_id', active_run.id,
            'stage_status', active_run.status,
            'stage_progress_percent', case
              when batch.status in ('completed', 'loaded') then 100
              when active_run.id is null then 0
              else round(least(100::numeric, greatest(0::numeric,
                (extract(epoch from (now() - active_run.started_at))
                  - coalesce(active_run.total_paused_seconds, 0)
                  - case when active_run.paused_at is not null
                    then extract(epoch from (now() - active_run.paused_at))
                    else 0 end
                ) / greatest(1, coalesce(active_run.standard_minutes, 0) * 60)::numeric * 100
              )), 2)
            end,
            'overall_progress_percent', case
              when batch.status in ('completed', 'loaded') then 100
              when active_run.id is null then 0
              else round(least(100::numeric, greatest(0::numeric,
                (
                  coalesce((
                    select sum(previous_stage.standard_minutes)
                    from public.procedure_template_stages as previous_stage
                    where previous_stage.procedure_version_id = batch.procedure_version_id
                      and previous_stage.stage_order < batch.current_stage_order
                  ), 0) * 60
                  + extract(epoch from (now() - active_run.started_at))
                  - coalesce(active_run.total_paused_seconds, 0)
                  - case when active_run.paused_at is not null
                    then extract(epoch from (now() - active_run.paused_at))
                    else 0 end
                ) / greatest(1, totals.total_minutes * 60)::numeric * 100
              )), 2)
            end,
            'estimated_stage_completed_at', case
              when active_run.id is null then null
              else active_run.started_at + make_interval(
                secs => greatest(1, coalesce(active_run.standard_minutes, 0) * 60)
                  + coalesce(active_run.total_paused_seconds, 0)
              )
            end,
            'overdue_minutes', case
              when active_run.id is null then 0
              else greatest(0, floor((
                extract(epoch from (now() - active_run.started_at))
                - coalesce(active_run.total_paused_seconds, 0)
                - case when active_run.paused_at is not null
                  then extract(epoch from (now() - active_run.paused_at))
                  else 0 end
                - greatest(1, coalesce(active_run.standard_minutes, 0) * 60)
              ) / 60))::integer
            end,
            'total_standard_minutes', totals.total_minutes,
            'is_estimate', true
          ),
          'stages', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'stage_order', procedure_stage.stage_order,
                'name', procedure_stage.name,
                'standard_minutes', procedure_stage.standard_minutes,
                'equipment_type', procedure_stage.equipment_type,
                'state', case
                  when latest_run.status = 'completed'
                    or procedure_stage.stage_order < batch.current_stage_order then 'completed'
                  when latest_run.id = active_run.id
                    and latest_run.status in ('in_progress', 'paused') then 'active'
                  else 'pending'
                end,
                'started_at', latest_run.started_at,
                'completed_at', latest_run.completed_at
              )
              order by procedure_stage.stage_order
            )
            from public.procedure_template_stages as procedure_stage
            left join lateral (
              select stage_run.id, stage_run.status, stage_run.started_at,
                stage_run.completed_at
              from public.laundry_batch_stage_runs as stage_run
              where stage_run.laundry_batch_id = batch.id
                and stage_run.procedure_stage_id = procedure_stage.id
              order by stage_run.attempt_no desc, stage_run.updated_at desc, stage_run.id desc
              limit 1
            ) as latest_run on true
            where procedure_stage.procedure_version_id = batch.procedure_version_id
          ), '[]'::jsonb)
        )
        order by batch.batch_sequence, batch.id
      )
      from public.laundry_batches as batch
      left join public.laundry_categories as category
        on category.id = batch.laundry_category_id
      left join public.procedure_template_versions as version
        on version.id = batch.procedure_version_id
      left join lateral (
        select stage_run.id, stage_run.status, stage_run.started_at,
          stage_run.paused_at, stage_run.total_paused_seconds,
          stage_run.laundry_equipment_id, procedure_stage.standard_minutes
        from public.laundry_batch_stage_runs as stage_run
        left join public.procedure_template_stages as procedure_stage
          on procedure_stage.id = stage_run.procedure_stage_id
        where stage_run.id = batch.active_stage_run_id
        limit 1
      ) as active_run on true
      left join public.laundry_equipment as active_equipment
        on active_equipment.id = active_run.laundry_equipment_id
      left join lateral (
        select coalesce(sum(procedure_stage.standard_minutes), 0)::integer as total_minutes
        from public.procedure_template_stages as procedure_stage
        where procedure_stage.procedure_version_id = batch.procedure_version_id
      ) as totals on true
      where batch.status <> 'cancelled'
        and batch.id in (
          select direct_batch.id
          from public.laundry_batches as direct_batch
          where direct_batch.laundry_order_id = order_record.id
          union
          select source.shared_batch_id
          from public.laundry_batch_sources as source
          where source.laundry_order_id = order_record.id
            and source.operating_site_id = order_record.operating_site_id
        )
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.get_workspace_order_detail(uuid)
  from public, anon, service_role;
grant execute on function public.get_workspace_order_detail(uuid)
  to authenticated;

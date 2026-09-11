create table private.laundry_operation_reversal_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  change_payload jsonb not null,
  laundry_batch_id uuid not null references public.laundry_batches (id),
  correction_id uuid references public.laundry_data_corrections (id),
  reversed_operation text,
  restored_batch_status text,
  restored_order_status text,
  stage_order integer,
  outcome text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  constraint laundry_operation_reversal_requests_operation_check
    check (
      reversed_operation is null
      or reversed_operation in ('stage_started', 'stage_completed', 'source_loaded')
    ),
  constraint laundry_operation_reversal_requests_outcome_check
    check (outcome in ('applied', 'denied')),
  constraint laundry_operation_reversal_requests_reason_check
    check (
      reason_code in (
        'stage_start_reversed',
        'stage_completion_reopened',
        'source_load_reversed',
        'invalid_reason',
        'worker_scope_denied',
        'order_already_picked_up',
        'nothing_to_reverse',
        'request_replay',
        'equipment_state_conflict'
      )
    )
);

revoke all on private.laundry_operation_reversal_requests from public;
revoke all on private.laundry_operation_reversal_requests from anon;
revoke all on private.laundry_operation_reversal_requests from authenticated;
revoke all on private.laundry_operation_reversal_requests from service_role;

create or replace function public.reverse_last_laundry_batch_operation(
  target_laundry_batch_id uuid,
  reversal_reason text,
  change_request_id uuid
)
returns table (
  laundry_batch_id uuid,
  reversed_operation text,
  restored_batch_status text,
  restored_order_status text,
  stage_order integer,
  already_applied boolean,
  outcome text,
  reason_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_reason text := btrim(coalesce(reversal_reason, ''));
  request_payload jsonb;
  existing_request private.laundry_operation_reversal_requests%rowtype;
  batch_record public.laundry_batches%rowtype;
  order_record public.laundry_orders%rowtype;
  stage_run_record public.laundry_batch_stage_runs%rowtype;
  equipment_record public.laundry_equipment%rowtype;
  source_record public.laundry_batch_sources%rowtype;
  correction_record_id uuid;
  restored_order_status_value text;
  restored_completed_at timestamptz;
  before_state jsonb;
  after_state jsonb;
  request_inserted integer;
begin
  if actor_auth_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if target_laundry_batch_id is null or change_request_id is null then
    return query
    select
      target_laundry_batch_id,
      null::text,
      null::text,
      null::text,
      null::integer,
      false,
      'denied'::text,
      'nothing_to_reverse'::text;
    return;
  end if;

  if length(normalized_reason) < 2
     or length(normalized_reason) > 500
     or normalized_reason ~ 'wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}' then
    return query
    select
      target_laundry_batch_id,
      null::text,
      null::text,
      null::text,
      null::integer,
      false,
      'denied'::text,
      'invalid_reason'::text;
    return;
  end if;

  request_payload := jsonb_build_object(
    'laundry_batch_id', target_laundry_batch_id,
    'reversal_reason', normalized_reason
  );

  select request.*
  into existing_request
  from private.laundry_operation_reversal_requests as request
  where request.id = change_request_id;

  if found then
    if existing_request.actor_auth_user_id = actor_auth_user_id
       and existing_request.change_payload = request_payload then
      return query
      select
        existing_request.laundry_batch_id,
        existing_request.reversed_operation,
        existing_request.restored_batch_status,
        existing_request.restored_order_status,
        existing_request.stage_order,
        true,
        existing_request.outcome,
        existing_request.reason_code;
    else
      return query
      select
        target_laundry_batch_id,
        null::text,
        null::text,
        null::text,
        null::integer,
        false,
        'denied'::text,
        'request_replay'::text;
    end if;
    return;
  end if;

  select batch.*
  into batch_record
  from public.laundry_batches as batch
  where batch.id = target_laundry_batch_id
  for update;

  if not found then
    return query
    select
      target_laundry_batch_id,
      null::text,
      null::text,
      null::text,
      null::integer,
      false,
      'denied'::text,
      'nothing_to_reverse'::text;
    return;
  end if;

  -- Recheck after the batch lock so concurrent retries cannot apply twice.
  select request.*
  into existing_request
  from private.laundry_operation_reversal_requests as request
  where request.id = change_request_id;

  if found then
    if existing_request.actor_auth_user_id = actor_auth_user_id
       and existing_request.change_payload = request_payload then
      return query
      select
        existing_request.laundry_batch_id,
        existing_request.reversed_operation,
        existing_request.restored_batch_status,
        existing_request.restored_order_status,
        existing_request.stage_order,
        true,
        existing_request.outcome,
        existing_request.reason_code;
    else
      return query
      select
        target_laundry_batch_id,
        null::text,
        null::text,
        null::text,
        null::integer,
        false,
        'denied'::text,
        'request_replay'::text;
    end if;
    return;
  end if;

  select laundry_order.*
  into order_record
  from public.laundry_orders as laundry_order
  where laundry_order.id = batch_record.laundry_order_id
  for update;

  if not private.has_laundry_worker_site_access(batch_record.operating_site_id) then
    return query
    select
      target_laundry_batch_id,
      null::text,
      null::text,
      null::text,
      null::integer,
      false,
      'denied'::text,
      'worker_scope_denied'::text;
    return;
  end if;

  if order_record.status = 'picked_up' then
    return query
    select
      target_laundry_batch_id,
      null::text,
      null::text,
      order_record.status,
      batch_record.current_stage_order,
      false,
      'denied'::text,
      'order_already_picked_up'::text;
    return;
  end if;

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = actor_auth_user_id
    and profile.active = true;

  if batch_record.status = 'in_progress'
     and batch_record.active_stage_run_id is not null then
    select stage_run.*
    into stage_run_record
    from public.laundry_batch_stage_runs as stage_run
    where stage_run.id = batch_record.active_stage_run_id
      and stage_run.laundry_batch_id = batch_record.id
      and stage_run.status = 'in_progress'
    for update;

    if found then
      select equipment.*
      into equipment_record
      from public.laundry_equipment as equipment
      where equipment.id = stage_run_record.laundry_equipment_id
      for update;

      if not found
         or exists (
           select 1
           from public.laundry_batch_stage_runs as other_run
           where other_run.laundry_equipment_id = stage_run_record.laundry_equipment_id
             and other_run.id <> stage_run_record.id
             and other_run.status in ('in_progress', 'paused')
         ) then
        return query
        select
          target_laundry_batch_id,
          null::text,
          batch_record.status,
          order_record.status,
          batch_record.current_stage_order,
          false,
          'denied'::text,
          'equipment_state_conflict'::text;
        return;
      end if;

      insert into private.laundry_operation_reversal_requests (
        id,
        actor_auth_user_id,
        change_payload,
        laundry_batch_id,
        reversed_operation,
        restored_batch_status,
        restored_order_status,
        stage_order,
        outcome,
        reason_code
      )
      values (
        change_request_id,
        actor_auth_user_id,
        request_payload,
        batch_record.id,
        'stage_started',
        'not_started',
        order_record.status,
        batch_record.current_stage_order,
        'applied',
        'stage_start_reversed'
      )
      on conflict (id) do nothing;

      get diagnostics request_inserted = row_count;

      if request_inserted = 0 then
        return query
        select
          target_laundry_batch_id,
          null::text,
          null::text,
          null::text,
          null::integer,
          false,
          'denied'::text,
          'request_replay'::text;
        return;
      end if;

      before_state := jsonb_build_object(
        'laundry_order_status', order_record.status,
        'laundry_batch_status', batch_record.status,
        'active_stage_run_id', stage_run_record.id,
        'stage_run_status', stage_run_record.status,
        'laundry_equipment_id', equipment_record.id,
        'equipment_occupied', equipment_record.occupied,
        'stage_order', batch_record.current_stage_order
      );

      update public.laundry_batch_stage_runs
      set
        status = 'cancelled',
        updated_at = now()
      where id = stage_run_record.id;

      update public.laundry_equipment
      set
        occupied = false,
        updated_at = now()
      where id = equipment_record.id;

      update public.laundry_batches
      set
        status = 'not_started',
        active_stage_run_id = null,
        completed_at = null,
        loaded_at = null,
        updated_at = now()
      where id = batch_record.id;

      if batch_record.current_stage_order = 1
         and not exists (
           select 1
           from public.laundry_batches as sibling_batch
           where sibling_batch.laundry_order_id = batch_record.laundry_order_id
             and sibling_batch.status not in ('not_started', 'cancelled')
         )
         and not exists (
           select 1
           from public.laundry_batches as sibling_batch
           join public.laundry_batch_stage_runs as sibling_run
             on sibling_run.laundry_batch_id = sibling_batch.id
           where sibling_batch.laundry_order_id = batch_record.laundry_order_id
             and sibling_run.status <> 'cancelled'
         ) then
        restored_order_status_value := 'awaiting_cleaning';
      else
        restored_order_status_value := 'in_process';
      end if;

      update public.laundry_orders
      set
        status = restored_order_status_value,
        closed_at = null,
        updated_at = now()
      where id = order_record.id;

      after_state := jsonb_build_object(
        'laundry_order_status', restored_order_status_value,
        'laundry_batch_status', 'not_started',
        'active_stage_run_id', null,
        'stage_run_status', 'cancelled',
        'laundry_equipment_id', equipment_record.id,
        'equipment_occupied', false,
        'stage_order', batch_record.current_stage_order
      );

      insert into public.laundry_data_corrections (
        laundry_batch_id,
        correction_kind,
        reason,
        before_state,
        after_state,
        corrected_by_auth_user_id
      )
      values (
        batch_record.id,
        'reopen',
        normalized_reason,
        before_state,
        after_state,
        actor_auth_user_id
      )
      returning id into correction_record_id;

      insert into public.authorization_audit_events (
        actor_type,
        actor_auth_user_id,
        actor_access_profile_id,
        operating_site_id,
        laundry_order_id,
        laundry_batch_id,
        laundry_equipment_id,
        action,
        outcome,
        reason,
        before_state,
        after_state,
        request_id
      )
      values (
        'authenticated_user',
        actor_auth_user_id,
        actor_access_profile_id,
        batch_record.operating_site_id,
        order_record.id,
        batch_record.id,
        equipment_record.id,
        'laundry_batch_last_operation_reversed',
        'succeeded',
        'stage_start_reversed: ' || normalized_reason,
        before_state,
        after_state,
        change_request_id
      );

      update private.laundry_operation_reversal_requests
      set
        correction_id = correction_record_id,
        restored_order_status = restored_order_status_value
      where id = change_request_id;

      return query
      select
        batch_record.id,
        'stage_started'::text,
        'not_started'::text,
        restored_order_status_value,
        batch_record.current_stage_order,
        false,
        'applied'::text,
        'stage_start_reversed'::text;
      return;
    end if;
  end if;

  if batch_record.status = 'loaded'
     and batch_record.active_stage_run_id is null then
    select source.*
    into source_record
    from public.laundry_batch_sources as source
    where source.shared_batch_id = batch_record.id
      and source.load_status = 'loaded'
    order by source.loaded_at desc, source.id desc
    limit 1
    for update;

    if found then
      if source_record.laundry_order_id <> order_record.id then
        select laundry_order.*
        into order_record
        from public.laundry_orders as laundry_order
        where laundry_order.id = source_record.laundry_order_id
        for update;
      end if;

      if order_record.status = 'picked_up' then
        return query
        select
          target_laundry_batch_id,
          null::text,
          batch_record.status,
          order_record.status,
          batch_record.current_stage_order,
          false,
          'denied'::text,
          'order_already_picked_up'::text;
        return;
      end if;

      select max(stage_run.completed_at)
      into restored_completed_at
      from public.laundry_batch_stage_runs as stage_run
      where stage_run.laundry_batch_id = batch_record.id
        and stage_run.stage_order = batch_record.current_stage_order
        and stage_run.status = 'completed';

      if restored_completed_at is not null then
        insert into private.laundry_operation_reversal_requests (
          id,
          actor_auth_user_id,
          change_payload,
          laundry_batch_id,
          reversed_operation,
          restored_batch_status,
          restored_order_status,
          stage_order,
          outcome,
          reason_code
        )
        values (
          change_request_id,
          actor_auth_user_id,
          request_payload,
          batch_record.id,
          'source_loaded',
          'completed',
          'in_process',
          batch_record.current_stage_order,
          'applied',
          'source_load_reversed'
        )
        on conflict (id) do nothing;

        get diagnostics request_inserted = row_count;

        if request_inserted = 0 then
          return query
          select
            target_laundry_batch_id,
            null::text,
            null::text,
            null::text,
            null::integer,
            false,
            'denied'::text,
            'request_replay'::text;
          return;
        end if;

        before_state := jsonb_build_object(
          'laundry_order_id', order_record.id,
          'laundry_order_status', order_record.status,
          'laundry_batch_status', batch_record.status,
          'batch_loaded_at', batch_record.loaded_at,
          'source_id', source_record.id,
          'source_laundry_cart_id', source_record.source_laundry_cart_id,
          'source_load_status', source_record.load_status,
          'source_loaded_at', source_record.loaded_at,
          'stage_order', batch_record.current_stage_order
        );

        update public.laundry_batch_sources
        set
          load_status = 'pending',
          loaded_at = null
        where id = source_record.id;

        update public.laundry_batches
        set
          status = 'completed',
          active_stage_run_id = null,
          completed_at = restored_completed_at,
          loaded_at = null,
          updated_at = now()
        where id = batch_record.id;

        update public.laundry_orders
        set
          status = 'in_process',
          closed_at = null,
          updated_at = now()
        where id = order_record.id;

        after_state := jsonb_build_object(
          'laundry_order_id', order_record.id,
          'laundry_order_status', 'in_process',
          'laundry_batch_status', 'completed',
          'batch_completed_at', restored_completed_at,
          'batch_loaded_at', null,
          'source_id', source_record.id,
          'source_laundry_cart_id', source_record.source_laundry_cart_id,
          'source_load_status', 'pending',
          'source_loaded_at', null,
          'stage_order', batch_record.current_stage_order
        );

        insert into public.laundry_data_corrections (
          laundry_batch_id,
          correction_kind,
          reason,
          before_state,
          after_state,
          corrected_by_auth_user_id
        )
        values (
          batch_record.id,
          'reopen',
          normalized_reason,
          before_state,
          after_state,
          actor_auth_user_id
        )
        returning id into correction_record_id;

        insert into public.authorization_audit_events (
          actor_type,
          actor_auth_user_id,
          actor_access_profile_id,
          operating_site_id,
          laundry_order_id,
          laundry_batch_id,
          laundry_cart_id,
          action,
          outcome,
          reason,
          before_state,
          after_state,
          request_id
        )
        values (
          'authenticated_user',
          actor_auth_user_id,
          actor_access_profile_id,
          batch_record.operating_site_id,
          order_record.id,
          batch_record.id,
          source_record.source_laundry_cart_id,
          'laundry_batch_last_operation_reversed',
          'succeeded',
          'source_load_reversed: ' || normalized_reason,
          before_state,
          after_state,
          change_request_id
        );

        update private.laundry_operation_reversal_requests
        set correction_id = correction_record_id
        where id = change_request_id;

        return query
        select
          batch_record.id,
          'source_loaded'::text,
          'completed'::text,
          'in_process'::text,
          batch_record.current_stage_order,
          false,
          'applied'::text,
          'source_load_reversed'::text;
        return;
      end if;
    end if;
  end if;

  if batch_record.active_stage_run_id is null
     and batch_record.status in ('not_started', 'completed') then
    select stage_run.*
    into stage_run_record
    from public.laundry_batch_stage_runs as stage_run
    where stage_run.laundry_batch_id = batch_record.id
      and stage_run.status = 'completed'
      and stage_run.stage_order = case
        when batch_record.status = 'not_started' then batch_record.current_stage_order - 1
        else batch_record.current_stage_order
      end
    order by stage_run.completed_at desc, stage_run.attempt_no desc
    limit 1
    for update;

    if found then
      insert into private.laundry_operation_reversal_requests (
        id,
        actor_auth_user_id,
        change_payload,
        laundry_batch_id,
        reversed_operation,
        restored_batch_status,
        restored_order_status,
        stage_order,
        outcome,
        reason_code
      )
      values (
        change_request_id,
        actor_auth_user_id,
        request_payload,
        batch_record.id,
        'stage_completed',
        'not_started',
        'in_process',
        stage_run_record.stage_order,
        'applied',
        'stage_completion_reopened'
      )
      on conflict (id) do nothing;

      get diagnostics request_inserted = row_count;

      if request_inserted = 0 then
        return query
        select
          target_laundry_batch_id,
          null::text,
          null::text,
          null::text,
          null::integer,
          false,
          'denied'::text,
          'request_replay'::text;
        return;
      end if;

      before_state := jsonb_build_object(
        'laundry_order_status', order_record.status,
        'laundry_batch_status', batch_record.status,
        'active_stage_run_id', null,
        'stage_run_id', stage_run_record.id,
        'stage_run_status', stage_run_record.status,
        'stage_run_completed_at', stage_run_record.completed_at,
        'stage_order', batch_record.current_stage_order
      );

      update public.laundry_batches
      set
        status = 'not_started',
        current_stage_order = stage_run_record.stage_order,
        active_stage_run_id = null,
        completed_at = null,
        loaded_at = null,
        updated_at = now()
      where id = batch_record.id;

      update public.laundry_orders
      set
        status = 'in_process',
        closed_at = null,
        updated_at = now()
      where id = order_record.id;

      after_state := jsonb_build_object(
        'laundry_order_status', 'in_process',
        'laundry_batch_status', 'not_started',
        'active_stage_run_id', null,
        'stage_run_id', stage_run_record.id,
        'stage_run_status', stage_run_record.status,
        'stage_run_completed_at', stage_run_record.completed_at,
        'stage_order', stage_run_record.stage_order
      );

      insert into public.laundry_data_corrections (
        laundry_batch_id,
        correction_kind,
        reason,
        before_state,
        after_state,
        corrected_by_auth_user_id
      )
      values (
        batch_record.id,
        'reopen',
        normalized_reason,
        before_state,
        after_state,
        actor_auth_user_id
      )
      returning id into correction_record_id;

      insert into public.authorization_audit_events (
        actor_type,
        actor_auth_user_id,
        actor_access_profile_id,
        operating_site_id,
        laundry_order_id,
        laundry_batch_id,
        laundry_equipment_id,
        action,
        outcome,
        reason,
        before_state,
        after_state,
        request_id
      )
      values (
        'authenticated_user',
        actor_auth_user_id,
        actor_access_profile_id,
        batch_record.operating_site_id,
        order_record.id,
        batch_record.id,
        stage_run_record.laundry_equipment_id,
        'laundry_batch_last_operation_reversed',
        'succeeded',
        'stage_completion_reopened: ' || normalized_reason,
        before_state,
        after_state,
        change_request_id
      );

      update private.laundry_operation_reversal_requests
      set correction_id = correction_record_id
      where id = change_request_id;

      return query
      select
        batch_record.id,
        'stage_completed'::text,
        'not_started'::text,
        'in_process'::text,
        stage_run_record.stage_order,
        false,
        'applied'::text,
        'stage_completion_reopened'::text;
      return;
    end if;
  end if;

  return query
  select
    target_laundry_batch_id,
    null::text,
    batch_record.status,
    order_record.status,
    batch_record.current_stage_order,
    false,
    'denied'::text,
    'nothing_to_reverse'::text;
end;
$$;

revoke all on function public.reverse_last_laundry_batch_operation(uuid, text, uuid) from public;
revoke all on function public.reverse_last_laundry_batch_operation(uuid, text, uuid) from anon;
revoke all on function public.reverse_last_laundry_batch_operation(uuid, text, uuid) from service_role;
grant execute on function public.reverse_last_laundry_batch_operation(uuid, text, uuid) to authenticated;

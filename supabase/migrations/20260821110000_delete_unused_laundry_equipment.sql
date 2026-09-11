alter table private.laundry_equipment_change_requests
  drop constraint laundry_equipment_change_operation_check;

alter table private.laundry_equipment_change_requests
  add constraint laundry_equipment_change_operation_check
  check (operation in ('register', 'update', 'reissue_qr', 'delete'));

create or replace function private.protect_laundry_equipment_qr_credential_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  permitted_equipment_id text := current_setting(
    'wash_room.delete_unused_laundry_equipment_id',
    true
  );
begin
  if tg_op = 'DELETE' then
    if permitted_equipment_id = old.laundry_equipment_id::text then
      return old;
    end if;
    raise exception 'QR credential history is immutable' using errcode = '55000';
  end if;
  if old.revoked_at is not null
    or new.id <> old.id
    or new.laundry_equipment_id <> old.laundry_equipment_id
    or new.version <> old.version
    or new.nonce <> old.nonce
    or new.signing_key_id <> old.signing_key_id
    or new.token_hash <> old.token_hash
    or new.issued_by_auth_user_id <> old.issued_by_auth_user_id
    or new.issued_at <> old.issued_at
    or new.issuance_reason <> old.issuance_reason
    or new.revoked_at is null
    or new.revoked_by_auth_user_id is null
    or new.revocation_reason is null then
    raise exception 'QR credential history is immutable' using errcode = '55000';
  end if;
  return new;
end
$$;

create or replace function public.prevent_authorization_audit_event_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  permitted_equipment_id text := current_setting(
    'wash_room.delete_unused_laundry_equipment_id',
    true
  );
begin
  if tg_op = 'UPDATE'
    and permitted_equipment_id is not null
    and old.laundry_equipment_id::text = permitted_equipment_id
    and new.laundry_equipment_id is null
    and (to_jsonb(new) - 'laundry_equipment_id') =
      (to_jsonb(old) - 'laundry_equipment_id') then
    return new;
  end if;
  raise exception 'authorization audit events are immutable';
end
$$;

create function public.delete_unused_laundry_equipment(
  target_laundry_equipment_id uuid,
  expected_equipment_name text,
  change_request_id uuid,
  change_reason text
)
returns table (
  laundry_equipment_id uuid,
  already_applied boolean,
  outcome text,
  reason_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  profile_id uuid;
  equipment_record public.laundry_equipment%rowtype;
  normalized_expected_name text := upper(regexp_replace(
    expected_equipment_name,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  ));
  normalized_reason text := regexp_replace(
    change_reason,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  payload jsonb;
  existing private.laundry_equipment_change_requests%rowtype;
  deletion_blocked boolean := false;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if target_laundry_equipment_id is null
    or change_request_id is null
    or normalized_expected_name is null
    or char_length(normalized_expected_name) not between 1 and 80
    or not private.is_safe_laundry_equipment_change_reason(normalized_reason) then
    raise exception 'invalid laundry equipment deletion request' using errcode = '22023';
  end if;

  payload := jsonb_build_object(
    'equipment_id', target_laundry_equipment_id,
    'expected_name', normalized_expected_name,
    'reason', normalized_reason
  );
  select request.*
    into existing
    from private.laundry_equipment_change_requests as request
   where request.id = change_request_id;
  if found then
    if existing.actor_auth_user_id <> actor
      or existing.operation <> 'delete'
      or existing.change_payload <> payload then
      raise exception 'request id already used with different change' using errcode = '22023';
    end if;
    return query
    select target_laundry_equipment_id, true, 'applied'::text, 'deleted'::text;
    return;
  end if;

  select equipment.*
    into equipment_record
    from public.laundry_equipment as equipment
   where equipment.id = target_laundry_equipment_id
   for update;
  select profile.id
    into profile_id
    from public.user_access_profiles as profile
   where profile.auth_user_id = actor
     and profile.active;

  if equipment_record.id is null
    or profile_id is null
    or not private.equipment_site_access(target_laundry_equipment_id) then
    return query
    select null::uuid, false, 'denied'::text, 'scope_denied'::text;
    return;
  end if;

  if equipment_record.name <> normalized_expected_name then
    insert into public.authorization_audit_events (
      actor_type, actor_auth_user_id, actor_access_profile_id, action,
      operating_site_id, laundry_equipment_id, outcome, reason,
      before_state, request_id
    ) values (
      'authenticated_user', actor, profile_id,
      'laundry_equipment_delete_denied', equipment_record.operating_site_id,
      equipment_record.id, 'denied', normalized_reason,
      jsonb_build_object('name', equipment_record.name, 'reason_code', 'name_mismatch'),
      change_request_id
    );
    return query
    select equipment_record.id, false, 'denied'::text, 'name_mismatch'::text;
    return;
  end if;

  deletion_blocked := equipment_record.occupied
    or exists (
      select 1 from public.laundry_batch_stage_runs as run
       where run.laundry_equipment_id = equipment_record.id
    )
    or exists (
      select 1 from public.laundry_batch_equipment_assignments as assignment
       where assignment.laundry_equipment_id = equipment_record.id
    )
    or exists (
      select 1 from private.laundry_batch_stage_change_requests as request
       where request.laundry_equipment_id = equipment_record.id
    )
    or exists (
      select 1 from private.laundry_disinfection_change_requests as request
       where request.laundry_equipment_id = equipment_record.id
    )
    or exists (
      select 1 from private.laundry_drying_change_requests as request
       where request.laundry_equipment_id = equipment_record.id
    )
    or exists (
      select 1 from private.laundry_stage_complete_change_requests as request
       where request.laundry_equipment_id = equipment_record.id
    );

  if deletion_blocked then
    insert into public.authorization_audit_events (
      actor_type, actor_auth_user_id, actor_access_profile_id, action,
      operating_site_id, laundry_equipment_id, outcome, reason,
      before_state, request_id
    ) values (
      'authenticated_user', actor, profile_id,
      'laundry_equipment_delete_denied', equipment_record.operating_site_id,
      equipment_record.id, 'denied', normalized_reason,
      jsonb_build_object('name', equipment_record.name, 'reason_code', 'in_use'),
      change_request_id
    );
    return query
    select equipment_record.id, false, 'denied'::text, 'in_use'::text;
    return;
  end if;

  begin
    perform set_config(
      'wash_room.delete_unused_laundry_equipment_id',
      equipment_record.id::text,
      true
    );

    update public.authorization_audit_events as audit
       set laundry_equipment_id = null
     where audit.laundry_equipment_id = equipment_record.id;
    update private.laundry_equipment_change_requests as request
       set laundry_equipment_id = null
     where request.laundry_equipment_id = equipment_record.id;
    update public.laundry_equipment_denial_audit_aggregates as denial
       set laundry_equipment_id = null
     where denial.laundry_equipment_id = equipment_record.id;
    delete from private.laundry_equipment_qr_credentials as credential
     where credential.laundry_equipment_id = equipment_record.id;
    delete from public.laundry_equipment as equipment
     where equipment.id = equipment_record.id;
  exception
    when foreign_key_violation then
      deletion_blocked := true;
  end;

  if deletion_blocked then
    insert into public.authorization_audit_events (
      actor_type, actor_auth_user_id, actor_access_profile_id, action,
      operating_site_id, laundry_equipment_id, outcome, reason,
      before_state, request_id
    ) values (
      'authenticated_user', actor, profile_id,
      'laundry_equipment_delete_denied', equipment_record.operating_site_id,
      equipment_record.id, 'denied', normalized_reason,
      jsonb_build_object('name', equipment_record.name, 'reason_code', 'in_use'),
      change_request_id
    );
    return query
    select equipment_record.id, false, 'denied'::text, 'in_use'::text;
    return;
  end if;

  insert into private.laundry_equipment_change_requests (
    id, actor_auth_user_id, operation, change_payload
  ) values (
    change_request_id, actor, 'delete', payload
  );
  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id, action,
    operating_site_id, outcome, reason, before_state, request_id
  ) values (
    'authenticated_user', actor, profile_id, 'laundry_equipment_deleted',
    equipment_record.operating_site_id, 'succeeded', normalized_reason,
    jsonb_build_object(
      'id', equipment_record.id,
      'name', equipment_record.name,
      'equipment_type', equipment_record.equipment_type,
      'capacity_kg', equipment_record.capacity_kg,
      'status', equipment_record.status,
      'current_qr_version', equipment_record.current_qr_version
    ),
    change_request_id
  );

  return query
  select equipment_record.id, false, 'applied'::text, 'deleted'::text;
end
$$;

revoke all on function public.delete_unused_laundry_equipment(uuid, text, uuid, text)
  from public;
grant execute on function public.delete_unused_laundry_equipment(uuid, text, uuid, text)
  to authenticated;

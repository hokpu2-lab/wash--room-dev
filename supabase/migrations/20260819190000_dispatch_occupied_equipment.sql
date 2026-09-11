create or replace function public.dispatch_laundry_equipment_qr(qr_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  equipment record;
begin
  if actor is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'authentication_required');
  end if;
  if qr_token is null or qr_token !~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;
  select
    machine.id,
    machine.equipment_type,
    machine.operating_site_id,
    machine.occupied
  into equipment
  from private.laundry_equipment_qr_credentials as credential
  join public.laundry_equipment as machine
    on machine.id = credential.laundry_equipment_id
    and machine.current_qr_version = credential.version
  join public.operating_sites as site
    on site.id = machine.operating_site_id
  where credential.token_hash = extensions.digest(pg_catalog.convert_to(qr_token, 'utf8'), 'sha256')
    and credential.revoked_at is null
    and machine.status = 'normal'
    and site.active;
  if equipment.id is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;
  if not private.has_laundry_worker_site_access(equipment.operating_site_id) then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'worker_scope_denied');
  end if;
  return jsonb_build_object(
    'outcome', 'ok',
    'equipment_type', equipment.equipment_type,
    'laundry_equipment_id', equipment.id,
    'operating_site_id', equipment.operating_site_id,
    'occupied', equipment.occupied,
    'next_path', case equipment.equipment_type
      when 'disinfection_tank' then '/app/operations/disinfection'
      when 'washer' then '/app/operations/washing'
      when 'dryer' then '/app/operations/drying'
      else '/app/operations'
    end
  );
end;
$$;

create or replace function public.dispatch_laundry_equipment_by_id(target_laundry_equipment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  equipment record;
begin
  if actor is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'authentication_required');
  end if;
  if target_laundry_equipment_id is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;
  select
    machine.id,
    machine.equipment_type,
    machine.operating_site_id,
    machine.occupied
  into equipment
  from public.laundry_equipment as machine
  join public.operating_sites as site
    on site.id = machine.operating_site_id
  where machine.id = target_laundry_equipment_id
    and machine.status = 'normal'
    and site.active;
  if equipment.id is null then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'invalid_qr');
  end if;
  if not private.has_laundry_worker_site_access(equipment.operating_site_id) then
    return jsonb_build_object('outcome', 'denied', 'reason_code', 'worker_scope_denied');
  end if;
  return jsonb_build_object(
    'outcome', 'ok',
    'equipment_type', equipment.equipment_type,
    'laundry_equipment_id', equipment.id,
    'operating_site_id', equipment.operating_site_id,
    'occupied', equipment.occupied,
    'next_path', case equipment.equipment_type
      when 'disinfection_tank' then '/app/operations/disinfection'
      when 'washer' then '/app/operations/washing'
      when 'dryer' then '/app/operations/drying'
      else '/app/operations'
    end
  );
end;
$$;

create or replace function public.get_operable_laundry_equipment_qr(target_laundry_equipment_id uuid)
returns table (
  laundry_equipment_id uuid,
  qr_token text,
  operating_site_id uuid,
  occupied boolean,
  equipment_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    machine.id,
    private.build_laundry_equipment_qr_token(
      machine.id,
      credential.version,
      credential.nonce,
      signing.signing_secret
    ),
    machine.operating_site_id,
    machine.occupied,
    machine.equipment_type
  from public.laundry_equipment as machine
  join private.laundry_equipment_qr_credentials as credential
    on credential.laundry_equipment_id = machine.id
    and credential.version = machine.current_qr_version
    and credential.revoked_at is null
  join private.fixed_asset_qr_signing_keys as signing
    on signing.id = credential.signing_key_id
  join public.operating_sites as site
    on site.id = machine.operating_site_id
  where machine.id = target_laundry_equipment_id
    and machine.status = 'normal'
    and site.active
    and private.has_laundry_worker_site_access(machine.operating_site_id);
$$;

revoke all on function public.dispatch_laundry_equipment_qr(text)
  from public, anon, service_role;
revoke all on function public.dispatch_laundry_equipment_by_id(uuid),
  public.get_operable_laundry_equipment_qr(uuid)
  from public, anon, service_role;
grant execute on function public.dispatch_laundry_equipment_qr(text) to authenticated;
grant execute on function public.dispatch_laundry_equipment_by_id(uuid) to authenticated;
grant execute on function public.get_operable_laundry_equipment_qr(uuid) to authenticated;

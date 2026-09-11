create table public.laundry_equipment (
  id uuid primary key default gen_random_uuid(),
  operating_site_id uuid not null references public.operating_sites(id),
  name text not null,
  equipment_type text not null,
  capacity_kg integer,
  status text not null default 'normal',
  occupied boolean not null default false,
  current_qr_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint laundry_equipment_name_check check (
    char_length(btrim(name)) between 1 and 80
  ),
  constraint laundry_equipment_type_check check (
    equipment_type in ('disinfection_tank', 'washer', 'dryer')
  ),
  constraint laundry_equipment_capacity_check check (
    capacity_kg is null or capacity_kg between 1 and 10000
  ),
  constraint laundry_equipment_status_check check (
    status in ('normal', 'inactive', 'abnormal', 'maintenance')
  ),
  constraint laundry_equipment_qr_version_check check (current_qr_version > 0),
  unique (operating_site_id, name)
);

create index laundry_equipment_site_type_idx
  on public.laundry_equipment (operating_site_id, equipment_type, status, name);

create table public.laundry_equipment_categories (
  laundry_equipment_id uuid not null references public.laundry_equipment(id) on delete cascade,
  laundry_category_id uuid not null references public.laundry_categories(id),
  created_at timestamptz not null default now(),
  primary key (laundry_equipment_id, laundry_category_id)
);

create table public.laundry_equipment_procedures (
  laundry_equipment_id uuid not null references public.laundry_equipment(id) on delete cascade,
  procedure_template_id uuid not null references public.procedure_templates(id),
  created_at timestamptz not null default now(),
  primary key (laundry_equipment_id, procedure_template_id)
);

create table private.laundry_equipment_qr_credentials (
  id uuid primary key default gen_random_uuid(),
  laundry_equipment_id uuid not null references public.laundry_equipment(id),
  version integer not null,
  nonce bytea not null,
  signing_key_id smallint not null references private.fixed_asset_qr_signing_keys(id),
  token_hash bytea not null unique,
  issued_by_auth_user_id uuid not null,
  issued_at timestamptz not null default now(),
  issuance_reason text not null,
  revoked_by_auth_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  constraint laundry_equipment_qr_version_check check (version > 0),
  constraint laundry_equipment_qr_nonce_check check (octet_length(nonce) = 32),
  constraint laundry_equipment_qr_hash_check check (octet_length(token_hash) = 32),
  constraint laundry_equipment_qr_reason_check check (char_length(btrim(issuance_reason)) between 1 and 500),
  constraint laundry_equipment_qr_revocation_check check (
    (revoked_at is null and revoked_by_auth_user_id is null and revocation_reason is null)
    or (revoked_at is not null and revoked_by_auth_user_id is not null
      and revocation_reason is not null and char_length(btrim(revocation_reason)) between 1 and 500)
  ),
  unique (laundry_equipment_id, version)
);

create unique index laundry_equipment_qr_one_current_idx
  on private.laundry_equipment_qr_credentials (laundry_equipment_id)
  where revoked_at is null;

create table private.laundry_equipment_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  laundry_equipment_id uuid references public.laundry_equipment(id),
  result_qr_version integer,
  created_at timestamptz not null default now(),
  constraint laundry_equipment_change_operation_check check (
    operation in ('register', 'update', 'reissue_qr')
  )
);

create table public.laundry_equipment_denial_audit_aggregates (
  actor_auth_user_id uuid not null,
  operation text not null,
  scope_key text not null,
  operating_site_id uuid references public.operating_sites(id),
  laundry_equipment_id uuid references public.laundry_equipment(id),
  first_attempted_at timestamptz not null,
  last_attempted_at timestamptz not null,
  total_attempt_count bigint not null default 1,
  primary key (actor_auth_user_id, operation, scope_key),
  constraint laundry_equipment_denial_operation_check check (operation in ('register', 'update', 'reissue_qr'))
);

alter table public.authorization_audit_events
  add column laundry_equipment_id uuid references public.laundry_equipment(id);
create index authorization_audit_events_laundry_equipment_idx
  on public.authorization_audit_events (laundry_equipment_id, occurred_at desc)
  where laundry_equipment_id is not null;

create function private.protect_laundry_equipment_qr_credential_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
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
create trigger protect_laundry_equipment_qr_credential_history
before update or delete on private.laundry_equipment_qr_credentials
for each row execute function private.protect_laundry_equipment_qr_credential_history();

create function private.build_laundry_equipment_qr_token(
  target_laundry_equipment_id uuid,
  target_version integer,
  target_nonce bytea,
  signing_secret bytea
)
returns text language sql immutable strict set search_path = '' as $$
  select 'wrq_v1.' || private.base64url(target_nonce) || '.' || private.base64url(
    extensions.hmac(
      pg_catalog.convert_to('equipment:' || target_laundry_equipment_id::text || ':'
        || target_version::text || ':' || pg_catalog.encode(target_nonce, 'hex'), 'utf8'),
      signing_secret, 'sha256'
    )
  )
$$;

create function private.is_safe_laundry_equipment_change_reason(value text)
returns boolean language sql immutable set search_path = '' as $$
  select value is not null and char_length(value) between 1 and 500
    and value !~* 'wrq_v[0-9]+\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
$$;

create function private.equipment_site_access(target_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.laundry_equipment equipment
    where equipment.id = target_id
      and private.has_laundry_supervisor_site_access(equipment.operating_site_id)
  )
$$;

create function private.should_audit_laundry_equipment_denial(
  target_actor uuid, target_operation text, target_site uuid, target_equipment uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  key text := case when target_equipment is not null then 'equipment:' || target_equipment::text
                   when target_site is not null then 'site:' || target_site::text
                   else 'unscoped' end;
  inserted integer;
begin
  if target_actor is null or target_operation is null
    or target_operation not in ('register','update','reissue_qr') then
    raise exception 'invalid laundry equipment denial input' using errcode = '22023';
  end if;
  insert into public.laundry_equipment_denial_audit_aggregates (
    actor_auth_user_id, operation, scope_key, operating_site_id, laundry_equipment_id,
    first_attempted_at, last_attempted_at, total_attempt_count
  ) values (target_actor, target_operation, key, target_site, target_equipment, now(), now(), 1)
  on conflict (actor_auth_user_id, operation, scope_key) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then return true; end if;
  update public.laundry_equipment_denial_audit_aggregates
  set last_attempted_at = now(), total_attempt_count = total_attempt_count + 1
  where actor_auth_user_id = target_actor and operation = target_operation and scope_key = key;
  return false;
end
$$;

create function private.validate_laundry_equipment_capabilities(
  target_site_id uuid,
  target_equipment_type text,
  target_category_codes jsonb,
  target_procedure_template_ids jsonb
)
returns void language plpgsql set search_path = '' as $$
declare
  template_id uuid;
  published_version_id uuid;
begin
  for template_id in
    select value::uuid from jsonb_array_elements_text(target_procedure_template_ids)
  loop
    select version.id into published_version_id
    from public.procedure_template_versions version
    join public.procedure_templates template on template.id = version.procedure_template_id
    where template.id = template_id
      and template.operating_site_id = target_site_id
      and template.active
      and version.status = 'published'
    order by version.version_no desc
    limit 1;
    if published_version_id is null then
      raise exception 'incompatible procedure capability' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.procedure_template_stages stage
      where stage.procedure_version_id = published_version_id
        and stage.equipment_type not in ('manual', target_equipment_type)
    ) then
      raise exception 'procedure requires a different equipment type' using errcode = '22023';
    end if;
  end loop;
end
$$;

create function private.validate_laundry_equipment_for_stage(
  target_equipment_id uuid,
  expected_equipment_type text,
  expected_site_id uuid,
  expected_category_code text,
  expected_procedure_template_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.laundry_equipment equipment
    join public.operating_sites site on site.id = equipment.operating_site_id
    join public.laundry_equipment_categories category_capability
      on category_capability.laundry_equipment_id = equipment.id
    join public.laundry_categories category
      on category.id = category_capability.laundry_category_id
    join public.laundry_equipment_procedures procedure_capability
      on procedure_capability.laundry_equipment_id = equipment.id
    where equipment.id = target_equipment_id
      and equipment.operating_site_id = expected_site_id
      and equipment.equipment_type = expected_equipment_type
      and equipment.status = 'normal'
      and not equipment.occupied
      and site.active
      and category.active
      and category.code = upper(btrim(expected_category_code))
      and procedure_capability.procedure_template_id = expected_procedure_template_id
  )
$$;

alter table public.laundry_equipment enable row level security;
alter table public.laundry_equipment_categories enable row level security;
alter table public.laundry_equipment_procedures enable row level security;
alter table public.laundry_equipment_denial_audit_aggregates enable row level security;

create policy laundry_equipment_select_in_scope on public.laundry_equipment
for select to authenticated using (private.has_site_access(operating_site_id));
create policy laundry_equipment_categories_select_in_scope on public.laundry_equipment_categories
for select to authenticated using (exists (select 1 from public.laundry_equipment e where e.id = laundry_equipment_id));
create policy laundry_equipment_procedures_select_in_scope on public.laundry_equipment_procedures
for select to authenticated using (exists (select 1 from public.laundry_equipment e where e.id = laundry_equipment_id));
create policy laundry_equipment_denial_select_in_scope on public.laundry_equipment_denial_audit_aggregates
for select to authenticated using (operating_site_id is not null and private.has_laundry_supervisor_site_access(operating_site_id));

revoke all on table public.laundry_equipment, public.laundry_equipment_categories,
  public.laundry_equipment_procedures, public.laundry_equipment_denial_audit_aggregates
  from anon, authenticated, service_role;
revoke all on table private.laundry_equipment_qr_credentials, private.laundry_equipment_change_requests
  from public, anon, authenticated, service_role;
grant select on table public.laundry_equipment, public.laundry_equipment_categories,
  public.laundry_equipment_procedures, public.laundry_equipment_denial_audit_aggregates to authenticated;

create function public.register_laundry_equipment(
  requested_name text, target_site_code text, target_equipment_type text,
  target_capacity_kg integer, target_category_codes jsonb, target_procedure_template_ids jsonb,
  change_request_id uuid, change_reason text
)
returns table (laundry_equipment_id uuid, qr_version integer, already_applied boolean, outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); profile_id uuid; site_id uuid; equipment_id uuid;
  normalized_name text := upper(regexp_replace(requested_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  normalized_site text := upper(btrim(target_site_code));
  normalized_type text := lower(btrim(target_equipment_type));
  normalized_reason text := regexp_replace(change_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  payload jsonb; nonce bytea; token text; key_id smallint; secret bytea;
  existing private.laundry_equipment_change_requests%rowtype; inserted integer;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if change_request_id is null or normalized_name is null or char_length(normalized_name) not between 1 and 80
    or normalized_type not in ('disinfection_tank','washer','dryer')
    or target_category_codes is null or jsonb_typeof(target_category_codes) <> 'array'
    or target_procedure_template_ids is null or jsonb_typeof(target_procedure_template_ids) <> 'array'
    or not private.is_safe_laundry_equipment_change_reason(normalized_reason) then
    raise exception 'invalid laundry equipment request' using errcode='22023';
  end if;
  if target_capacity_kg is not null and target_capacity_kg not between 1 and 10000 then
    raise exception 'invalid equipment capacity' using errcode='22023';
  end if;
  select id into site_id from public.operating_sites where code = normalized_site and active;
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id = actor and p.active;
  if site_id is null or not private.has_laundry_supervisor_site_access(site_id) then
    if private.should_audit_laundry_equipment_denial(actor, 'register', site_id, null) then
      insert into public.authorization_audit_events(actor_type, actor_auth_user_id, actor_access_profile_id, action, operating_site_id, outcome, reason, after_state, request_id)
      values ('authenticated_user', actor, profile_id, 'laundry_equipment_registration_denied', site_id, 'denied', normalized_reason,
        jsonb_build_object('name', normalized_name, 'equipment_type', normalized_type), change_request_id);
    end if;
    return query select null::uuid, null::integer, false, 'denied'::text; return;
  end if;
  if exists (select 1 from jsonb_array_elements_text(target_category_codes) code
    where not exists (select 1 from public.laundry_categories c where c.code = upper(btrim(code)) and c.active)) then
    raise exception 'unknown laundry category capability' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(target_procedure_template_ids) value
    where not exists (select 1 from public.procedure_templates t where t.id = value::uuid and t.operating_site_id = site_id and t.active
      and exists (select 1 from public.procedure_template_versions v where v.procedure_template_id = t.id and v.status = 'published'))) then
    raise exception 'incompatible procedure capability' using errcode='22023';
  end if;
  perform private.validate_laundry_equipment_capabilities(site_id, normalized_type, target_category_codes, target_procedure_template_ids);
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id = actor and p.active;
  payload := jsonb_build_object('name', normalized_name, 'site_code', normalized_site, 'equipment_type', normalized_type,
    'capacity_kg', target_capacity_kg, 'category_codes', target_category_codes, 'procedure_template_ids', target_procedure_template_ids, 'reason', normalized_reason);
  insert into private.laundry_equipment_change_requests(id, actor_auth_user_id, operation, change_payload)
    values(change_request_id, actor, 'register', payload) on conflict(id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    select r.* into existing from private.laundry_equipment_change_requests r where r.id = change_request_id;
    if existing.actor_auth_user_id <> actor or existing.operation <> 'register' or existing.change_payload <> payload then
      raise exception 'request id already used with different change' using errcode='22023';
    end if;
    return query select existing.laundry_equipment_id, existing.result_qr_version, true, 'applied'::text; return;
  end if;
  insert into public.laundry_equipment(operating_site_id, name, equipment_type, capacity_kg)
    values(site_id, normalized_name, normalized_type, target_capacity_kg) returning id into equipment_id;
  insert into public.laundry_equipment_categories(laundry_equipment_id, laundry_category_id)
    select equipment_id, c.id from public.laundry_categories c
    where c.code = any(select upper(btrim(item.value)) from jsonb_array_elements_text(target_category_codes) as item(value));
  insert into public.laundry_equipment_procedures(laundry_equipment_id, procedure_template_id)
    select equipment_id, value::uuid from jsonb_array_elements_text(target_procedure_template_ids);
  select id, signing_secret into key_id, secret from private.fixed_asset_qr_signing_keys where active order by id desc limit 1;
  if key_id is null then raise exception 'QR signing key unavailable'; end if;
  nonce := extensions.gen_random_bytes(32);
  token := private.build_laundry_equipment_qr_token(equipment_id, 1, nonce, secret);
  insert into private.laundry_equipment_qr_credentials(laundry_equipment_id, version, nonce, signing_key_id, token_hash, issued_by_auth_user_id, issuance_reason)
    values(equipment_id, 1, nonce, key_id, extensions.digest(pg_catalog.convert_to(token,'utf8'),'sha256'), actor, normalized_reason);
  insert into public.authorization_audit_events(actor_type, actor_auth_user_id, actor_access_profile_id, action, operating_site_id, laundry_equipment_id, outcome, reason, after_state, request_id)
    values('authenticated_user', actor, profile_id, 'laundry_equipment_registered', site_id, equipment_id, 'succeeded', normalized_reason,
      jsonb_build_object('name', normalized_name, 'equipment_type', normalized_type, 'capacity_kg', target_capacity_kg, 'status', 'normal', 'qr_version', 1), change_request_id);
  update private.laundry_equipment_change_requests set laundry_equipment_id = equipment_id, result_qr_version = 1 where id = change_request_id;
  return query select equipment_id, 1, false, 'applied'::text;
end
$$;

create function public.get_current_laundry_equipment_qr(target_laundry_equipment_id uuid)
returns table (laundry_equipment_id uuid, equipment_name text, equipment_type text, qr_version integer, qr_token text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.name, e.equipment_type, c.version,
    private.build_laundry_equipment_qr_token(e.id, c.version, c.nonce, k.signing_secret)
  from public.laundry_equipment e
  join private.laundry_equipment_qr_credentials c on c.laundry_equipment_id=e.id and c.version=e.current_qr_version and c.revoked_at is null
  join private.fixed_asset_qr_signing_keys k on k.id=c.signing_key_id
  where e.id=target_laundry_equipment_id and private.equipment_site_access(e.id)
$$;

create function public.resolve_laundry_equipment_qr(qr_token text)
returns table (laundry_equipment_id uuid, equipment_name text, equipment_type text, capacity_kg integer, operating_site_id uuid, status text, occupied boolean, qr_version integer)
language sql stable security definer set search_path = '' as $$
  select e.id, e.name, e.equipment_type, e.capacity_kg, e.operating_site_id, e.status, e.occupied, c.version
  from private.laundry_equipment_qr_credentials c
  join public.laundry_equipment e on e.id=c.laundry_equipment_id and e.current_qr_version=c.version
  join public.operating_sites s on s.id=e.operating_site_id
  where qr_token ~ '^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$'
    and c.token_hash=extensions.digest(pg_catalog.convert_to(qr_token,'utf8'),'sha256')
    and c.revoked_at is null and e.status='normal' and not e.occupied and s.active
$$;

create function public.update_laundry_equipment(
  target_laundry_equipment_id uuid, requested_name text, target_capacity_kg integer, target_status text,
  target_category_codes jsonb, target_procedure_template_ids jsonb, change_request_id uuid, change_reason text
)
returns table (laundry_equipment_id uuid, qr_version integer, already_applied boolean, outcome text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); profile_id uuid; equipment public.laundry_equipment%rowtype; payload jsonb; existing private.laundry_equipment_change_requests%rowtype; inserted integer; normalized_name text:=upper(regexp_replace(requested_name,'^[[:space:]]+|[[:space:]]+$','','g')); reason text:=regexp_replace(change_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if change_request_id is null or target_status not in ('normal','inactive','abnormal','maintenance') or not private.is_safe_laundry_equipment_change_reason(reason) then raise exception 'invalid laundry equipment update' using errcode='22023'; end if;
  select e.* into equipment from public.laundry_equipment e where e.id=target_laundry_equipment_id for update;
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id=actor and p.active;
  if not found or not private.equipment_site_access(target_laundry_equipment_id) then
    if private.should_audit_laundry_equipment_denial(actor,'update',equipment.operating_site_id,target_laundry_equipment_id) then
      insert into public.authorization_audit_events(actor_type,actor_auth_user_id,actor_access_profile_id,action,operating_site_id,laundry_equipment_id,outcome,reason,request_id) values('authenticated_user',actor,profile_id,'laundry_equipment_update_denied',equipment.operating_site_id,target_laundry_equipment_id,'denied',reason,change_request_id);
    end if;
    return query select null::uuid,null::integer,false,'denied'::text; return;
  end if;
  if normalized_name is null or char_length(normalized_name) not between 1 and 80 or target_category_codes is null or jsonb_typeof(target_category_codes)<>'array' or target_procedure_template_ids is null or jsonb_typeof(target_procedure_template_ids)<>'array' then raise exception 'invalid equipment capability' using errcode='22023'; end if;
  if target_capacity_kg is not null and target_capacity_kg not between 1 and 10000 then raise exception 'invalid equipment capacity' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(target_category_codes) code where not exists(select 1 from public.laundry_categories c where c.code=upper(btrim(code)) and c.active)) then raise exception 'unknown laundry category capability' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(target_procedure_template_ids) value where not exists(select 1 from public.procedure_templates t where t.id=value::uuid and t.operating_site_id=equipment.operating_site_id and t.active and exists(select 1 from public.procedure_template_versions v where v.procedure_template_id=t.id and v.status='published'))) then raise exception 'incompatible procedure capability' using errcode='22023'; end if;
  perform private.validate_laundry_equipment_capabilities(equipment.operating_site_id, equipment.equipment_type, target_category_codes, target_procedure_template_ids);
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id=actor and p.active;
  payload:=jsonb_build_object('equipment_id',target_laundry_equipment_id,'name',normalized_name,'capacity_kg',target_capacity_kg,'status',target_status,'category_codes',target_category_codes,'procedure_template_ids',target_procedure_template_ids,'reason',reason);
  insert into private.laundry_equipment_change_requests(id,actor_auth_user_id,operation,change_payload) values(change_request_id,actor,'update',payload) on conflict(id) do nothing; get diagnostics inserted=row_count;
  if inserted=0 then select r.* into existing from private.laundry_equipment_change_requests r where r.id=change_request_id; if existing.actor_auth_user_id<>actor or existing.operation<>'update' or existing.change_payload<>payload then raise exception 'request id already used with different change' using errcode='22023'; end if; return query select existing.laundry_equipment_id,existing.result_qr_version,true,'applied'::text; return; end if;
  update public.laundry_equipment set name=normalized_name,capacity_kg=target_capacity_kg,status=target_status,updated_at=now() where id=target_laundry_equipment_id;
  delete from public.laundry_equipment_categories as capability where capability.laundry_equipment_id=target_laundry_equipment_id;
  insert into public.laundry_equipment_categories select target_laundry_equipment_id,c.id from public.laundry_categories c where c.code=any(select upper(btrim(item.value)) from jsonb_array_elements_text(target_category_codes) as item(value));
  delete from public.laundry_equipment_procedures as capability where capability.laundry_equipment_id=target_laundry_equipment_id;
  insert into public.laundry_equipment_procedures select target_laundry_equipment_id,value::uuid from jsonb_array_elements_text(target_procedure_template_ids);
  insert into public.authorization_audit_events(actor_type,actor_auth_user_id,actor_access_profile_id,action,operating_site_id,laundry_equipment_id,outcome,reason,before_state,after_state,request_id) values('authenticated_user',actor,profile_id,'laundry_equipment_updated',equipment.operating_site_id,target_laundry_equipment_id,'succeeded',reason,jsonb_build_object('name',equipment.name,'capacity_kg',equipment.capacity_kg,'status',equipment.status),jsonb_build_object('name',normalized_name,'capacity_kg',target_capacity_kg,'status',target_status,'qr_version',equipment.current_qr_version),change_request_id);
  update private.laundry_equipment_change_requests set laundry_equipment_id=target_laundry_equipment_id,result_qr_version=equipment.current_qr_version where id=change_request_id;
  return query select target_laundry_equipment_id,equipment.current_qr_version,false,'applied'::text;
end
$$;

create function public.reissue_laundry_equipment_qr(target_laundry_equipment_id uuid, change_request_id uuid, change_reason text)
returns table (laundry_equipment_id uuid, qr_version integer, already_applied boolean, outcome text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); profile_id uuid; e public.laundry_equipment%rowtype; reason text:=regexp_replace(change_reason,'^[[:space:]]+|[[:space:]]+$','','g'); payload jsonb; existing private.laundry_equipment_change_requests%rowtype; inserted integer; next_version integer; nonce bytea; token text; key_id smallint; secret bytea;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if target_laundry_equipment_id is null or change_request_id is null or not private.is_safe_laundry_equipment_change_reason(reason) then raise exception 'invalid QR reissue request' using errcode='22023'; end if;
  select x.* into e from public.laundry_equipment x where x.id=target_laundry_equipment_id for update;
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id=actor and p.active;
  if not found or not private.equipment_site_access(target_laundry_equipment_id) then
    if private.should_audit_laundry_equipment_denial(actor,'reissue_qr',e.operating_site_id,target_laundry_equipment_id) then insert into public.authorization_audit_events(actor_type,actor_auth_user_id,actor_access_profile_id,action,operating_site_id,laundry_equipment_id,outcome,reason,request_id) values('authenticated_user',actor,profile_id,'laundry_equipment_qr_reissue_denied',e.operating_site_id,target_laundry_equipment_id,'denied',reason,change_request_id); end if;
    return query select null::uuid,null::integer,false,'denied'::text; return;
  end if;
  select p.id into profile_id from public.user_access_profiles p where p.auth_user_id=actor and p.active;
  payload:=jsonb_build_object('equipment_id',target_laundry_equipment_id,'reason',reason);
  insert into private.laundry_equipment_change_requests(id,actor_auth_user_id,operation,change_payload) values(change_request_id,actor,'reissue_qr',payload) on conflict(id) do nothing; get diagnostics inserted=row_count;
  if inserted=0 then select r.* into existing from private.laundry_equipment_change_requests r where r.id=change_request_id; if existing.actor_auth_user_id<>actor or existing.operation<>'reissue_qr' or existing.change_payload<>payload then raise exception 'request id already used with different change' using errcode='22023'; end if; return query select existing.laundry_equipment_id,existing.result_qr_version,true,'applied'::text; return; end if;
  next_version:=e.current_qr_version+1;
  select id,signing_secret into key_id,secret from private.fixed_asset_qr_signing_keys where active order by id desc limit 1;
  update private.laundry_equipment_qr_credentials as credential set revoked_by_auth_user_id=actor,revoked_at=now(),revocation_reason=reason where credential.laundry_equipment_id=e.id and credential.version=e.current_qr_version and credential.revoked_at is null;
  if not found then raise exception 'current QR credential unavailable'; end if;
  nonce:=extensions.gen_random_bytes(32); token:=private.build_laundry_equipment_qr_token(e.id,next_version,nonce,secret);
  insert into private.laundry_equipment_qr_credentials(laundry_equipment_id,version,nonce,signing_key_id,token_hash,issued_by_auth_user_id,issuance_reason) values(e.id,next_version,nonce,key_id,extensions.digest(pg_catalog.convert_to(token,'utf8'),'sha256'),actor,reason);
  update public.laundry_equipment set current_qr_version=next_version,updated_at=now() where id=e.id;
  insert into public.authorization_audit_events(actor_type,actor_auth_user_id,actor_access_profile_id,action,operating_site_id,laundry_equipment_id,outcome,reason,before_state,after_state,request_id) values('authenticated_user',actor,profile_id,'laundry_equipment_qr_reissued',e.operating_site_id,e.id,'succeeded',reason,jsonb_build_object('qr_version',e.current_qr_version),jsonb_build_object('qr_version',next_version),change_request_id);
  update private.laundry_equipment_change_requests set laundry_equipment_id=e.id,result_qr_version=next_version where id=change_request_id;
  return query select e.id,next_version,false,'applied'::text;
end
$$;

revoke all on function private.build_laundry_equipment_qr_token(uuid,integer,bytea,bytea), private.equipment_site_access(uuid), private.should_audit_laundry_equipment_denial(uuid,text,uuid,uuid), private.validate_laundry_equipment_capabilities(uuid,text,jsonb,jsonb), private.validate_laundry_equipment_for_stage(uuid,text,uuid,text,uuid) from public;
revoke all on function public.register_laundry_equipment(text,text,text,integer,jsonb,jsonb,uuid,text), public.get_current_laundry_equipment_qr(uuid), public.update_laundry_equipment(uuid,text,integer,text,jsonb,jsonb,uuid,text), public.reissue_laundry_equipment_qr(uuid,uuid,text), public.resolve_laundry_equipment_qr(text) from public;
grant execute on function public.register_laundry_equipment(text,text,text,integer,jsonb,jsonb,uuid,text), public.get_current_laundry_equipment_qr(uuid), public.update_laundry_equipment(uuid,text,integer,text,jsonb,jsonb,uuid,text), public.reissue_laundry_equipment_qr(uuid,uuid,text) to authenticated;
grant execute on function public.resolve_laundry_equipment_qr(text) to service_role;

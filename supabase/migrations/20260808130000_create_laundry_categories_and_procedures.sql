create table public.laundry_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  first_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint laundry_categories_code_check check (
    code = upper(btrim(code))
    and code ~ '^[A-Z][A-Z0-9_-]{0,39}$'
  ),
  constraint laundry_categories_name_check check (
    char_length(btrim(name)) between 1 and 80
  ),
  constraint laundry_categories_sort_order_check check (sort_order >= 0)
);

insert into public.laundry_categories (code, name, sort_order)
values
  ('DISINFECT', '消毒品', 10),
  ('BIB', '圍兜', 20),
  ('SOILED', '汙衣', 30),
  ('CURTAIN', '床簾', 40),
  ('OTHER', '其他', 50)
on conflict (code) do nothing;

create function public.prevent_laundry_category_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'laundry categories are retired, not deleted'
    using errcode = '55000';
end
$$;

create trigger laundry_categories_are_not_deleted
before delete on public.laundry_categories
for each row execute function public.prevent_laundry_category_delete();

alter table public.laundry_categories enable row level security;

create policy laundry_categories_select_authenticated
on public.laundry_categories
for select
to authenticated
using (true);

revoke all on table public.laundry_categories
  from anon, authenticated, service_role;
grant select on table public.laundry_categories to authenticated;

revoke all on function public.prevent_laundry_category_delete()
  from public, anon, authenticated, service_role;

create table private.laundry_category_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  laundry_category_id uuid references public.laundry_categories(id),
  created_at timestamptz not null default now(),
  constraint laundry_category_change_requests_operation_check check (
    operation in ('create', 'update')
  )
);

revoke all on table private.laundry_category_change_requests
  from public, anon, authenticated, service_role;

create function private.has_any_laundry_supervisor_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_memberships as membership
    join public.user_access_profiles as profile
      on profile.id = membership.user_access_profile_id
    join public.operating_sites as site
      on site.id = membership.operating_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.role = 'laundry_supervisor'
      and membership.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and site.active
  )
$$;

create function public.create_laundry_category(
  category_code text,
  category_name text,
  category_sort_order integer,
  change_request_id uuid,
  change_reason text
)
returns table (
  laundry_category_id uuid,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  actor_operating_site_id uuid;
  normalized_code text := upper(btrim(category_code));
  normalized_name text := regexp_replace(category_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  normalized_reason text := regexp_replace(change_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  normalized_payload jsonb;
  inserted_request_count integer;
  existing_request private.laundry_category_change_requests%rowtype;
  created_category_id uuid;
begin
  if current_actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not private.has_any_laundry_supervisor_access() then
    raise exception 'laundry supervisor access required' using errcode = '42501';
  end if;
  if change_request_id is null
    or normalized_code is null
    or char_length(normalized_code) > 40
    or normalized_code !~ '^[A-Z][A-Z0-9_-]{0,39}$'
    or normalized_name is null
    or char_length(normalized_name) not between 1 and 80
    or category_sort_order is null
    or category_sort_order < 0
    or normalized_reason is null
    or char_length(normalized_reason) not between 1 and 500 then
    raise exception 'invalid laundry category request' using errcode = '22023';
  end if;

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;

  select membership.operating_site_id
  into actor_operating_site_id
  from public.access_memberships as membership
  join public.user_access_profiles as profile
    on profile.id = membership.user_access_profile_id
  where profile.auth_user_id = current_actor_auth_user_id
    and membership.role = 'laundry_supervisor'
    and membership.active
    and membership.operating_site_id is not null
  order by membership.created_at, membership.id
  limit 1;

  normalized_payload := jsonb_build_object(
    'category_code', normalized_code,
    'category_name', normalized_name,
    'category_sort_order', category_sort_order,
    'change_reason', normalized_reason
  );

  insert into private.laundry_category_change_requests (
    id, actor_auth_user_id, operation, change_payload
  ) values (
    change_request_id, current_actor_auth_user_id, 'create', normalized_payload
  ) on conflict (id) do nothing;
  get diagnostics inserted_request_count = row_count;

  if inserted_request_count = 0 then
    select request.* into existing_request
    from private.laundry_category_change_requests as request
    where request.id = change_request_id;
    if existing_request.actor_auth_user_id <> current_actor_auth_user_id then
      raise exception 'request id belongs to another actor' using errcode = '42501';
    end if;
    if existing_request.operation <> 'create'
      or existing_request.change_payload <> normalized_payload then
      raise exception 'request id already used with different change' using errcode = '22023';
    end if;
    return query select existing_request.laundry_category_id, true;
    return;
  end if;

  insert into public.laundry_categories (code, name, sort_order)
  values (normalized_code, normalized_name, category_sort_order)
  returning id into created_category_id;

  update private.laundry_category_change_requests
  set laundry_category_id = created_category_id
  where id = change_request_id;

  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id, operating_site_id, action,
    outcome, reason, before_state, after_state, request_id
  ) values (
    'authenticated_user', current_actor_auth_user_id, actor_access_profile_id,
    actor_operating_site_id,
    'laundry_category_created', 'succeeded', normalized_reason, null,
    jsonb_build_object(
      'code', normalized_code,
      'name', normalized_name,
      'sort_order', category_sort_order,
      'active', true
    ), change_request_id
  );

  return query select created_category_id, false;
end
$$;

create function public.update_laundry_category(
  target_laundry_category_id uuid,
  category_name text,
  category_sort_order integer,
  category_active boolean,
  change_request_id uuid,
  change_reason text
)
returns table (
  laundry_category_id uuid,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  actor_operating_site_id uuid;
  normalized_name text := regexp_replace(category_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  normalized_reason text := regexp_replace(change_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  normalized_payload jsonb;
  inserted_request_count integer;
  existing_request private.laundry_category_change_requests%rowtype;
  existing_category public.laundry_categories%rowtype;
begin
  if current_actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not private.has_any_laundry_supervisor_access() then
    raise exception 'laundry supervisor access required' using errcode = '42501';
  end if;
  if target_laundry_category_id is null
    or change_request_id is null
    or normalized_name is null
    or char_length(normalized_name) not between 1 and 80
    or category_sort_order is null
    or category_sort_order < 0
    or category_active is null
    or normalized_reason is null
    or char_length(normalized_reason) not between 1 and 500 then
    raise exception 'invalid laundry category request' using errcode = '22023';
  end if;

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;

  select membership.operating_site_id
  into actor_operating_site_id
  from public.access_memberships as membership
  join public.user_access_profiles as profile
    on profile.id = membership.user_access_profile_id
  where profile.auth_user_id = current_actor_auth_user_id
    and membership.role = 'laundry_supervisor'
    and membership.active
    and membership.operating_site_id is not null
  order by membership.created_at, membership.id
  limit 1;

  select category.*
  into existing_category
  from public.laundry_categories as category
  where category.id = target_laundry_category_id
  for update;
  if not found then
    raise exception 'laundry category not found' using errcode = '22023';
  end if;

  normalized_payload := jsonb_build_object(
    'laundry_category_id', target_laundry_category_id,
    'category_name', normalized_name,
    'category_sort_order', category_sort_order,
    'category_active', category_active,
    'change_reason', normalized_reason
  );

  insert into private.laundry_category_change_requests (
    id, actor_auth_user_id, operation, change_payload, laundry_category_id
  ) values (
    change_request_id, current_actor_auth_user_id, 'update', normalized_payload,
    target_laundry_category_id
  ) on conflict (id) do nothing;
  get diagnostics inserted_request_count = row_count;

  if inserted_request_count = 0 then
    select request.* into existing_request
    from private.laundry_category_change_requests as request
    where request.id = change_request_id;
    if existing_request.actor_auth_user_id <> current_actor_auth_user_id then
      raise exception 'request id belongs to another actor' using errcode = '42501';
    end if;
    if existing_request.operation <> 'update'
      or existing_request.change_payload <> normalized_payload then
      raise exception 'request id already used with different change' using errcode = '22023';
    end if;
    return query select existing_request.laundry_category_id, true;
    return;
  end if;

  update public.laundry_categories
  set name = normalized_name,
      sort_order = category_sort_order,
      active = category_active,
      updated_at = now()
  where id = target_laundry_category_id;

  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id, operating_site_id, action,
    outcome, reason, before_state, after_state, request_id
  ) values (
    'authenticated_user', current_actor_auth_user_id, actor_access_profile_id,
    actor_operating_site_id,
    'laundry_category_updated', 'succeeded', normalized_reason,
    jsonb_build_object(
      'code', existing_category.code,
      'name', existing_category.name,
      'sort_order', existing_category.sort_order,
      'active', existing_category.active
    ),
    jsonb_build_object(
      'code', existing_category.code,
      'name', normalized_name,
      'sort_order', category_sort_order,
      'active', category_active
    ), change_request_id
  );

  return query select target_laundry_category_id, false;
end
$$;

revoke all on function private.has_any_laundry_supervisor_access()
  from public, anon, authenticated, service_role;
revoke all on function public.create_laundry_category(text, text, integer, uuid, text)
  from public;
revoke all on function public.update_laundry_category(uuid, text, integer, boolean, uuid, text)
  from public;
grant execute on function public.create_laundry_category(text, text, integer, uuid, text)
  to authenticated;
grant execute on function public.update_laundry_category(uuid, text, integer, boolean, uuid, text)
  to authenticated;

create table public.procedure_templates (
  id uuid primary key default gen_random_uuid(),
  operating_site_id uuid not null references public.operating_sites(id),
  laundry_category_id uuid not null references public.laundry_categories(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procedure_templates_site_category_unique
    unique (operating_site_id, laundry_category_id)
);

create table public.procedure_template_versions (
  id uuid primary key default gen_random_uuid(),
  procedure_template_id uuid not null references public.procedure_templates(id),
  version_no integer not null,
  template_name text not null,
  status text not null default 'draft',
  created_by_profile_id uuid references public.user_access_profiles(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint procedure_template_versions_unique
    unique (procedure_template_id, version_no),
  constraint procedure_template_versions_status_check
    check (status in ('draft', 'published', 'retired')),
  constraint procedure_template_versions_name_check
    check (char_length(btrim(template_name)) between 1 and 120),
  constraint procedure_template_versions_published_at_check
    check ((status = 'draft' and published_at is null) or status <> 'draft')
);

create table public.procedure_template_stages (
  id uuid primary key default gen_random_uuid(),
  procedure_version_id uuid not null
    references public.procedure_template_versions(id) on delete cascade,
  stage_order integer not null,
  name text not null,
  standard_minutes integer not null,
  equipment_type text not null default 'manual',
  compatibility_conditions jsonb not null default '{}'::jsonb,
  transition_mode text not null default 'manual',
  requires_operator_confirmation boolean not null default true,
  constraint procedure_template_stages_order_check check (stage_order > 0),
  constraint procedure_template_stages_name_check
    check (char_length(btrim(name)) between 1 and 80),
  constraint procedure_template_stages_minutes_check
    check (standard_minutes between 1 and 1440),
  constraint procedure_template_stages_equipment_check check (
    equipment_type in ('manual', 'disinfection_tank', 'washer', 'dryer', 'cart')
  ),
  constraint procedure_template_stages_transition_check check (
    transition_mode in ('manual', 'timer')
  ),
  constraint procedure_template_stages_conditions_check check (
    jsonb_typeof(compatibility_conditions) = 'object'
  ),
  constraint procedure_template_stages_unique_order
    unique (procedure_version_id, stage_order)
);

create table private.procedure_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  operation text not null,
  change_payload jsonb not null,
  procedure_template_id uuid references public.procedure_templates(id),
  procedure_version_id uuid references public.procedure_template_versions(id),
  created_at timestamptz not null default now(),
  constraint procedure_change_requests_operation_check check (
    operation in ('create_draft', 'update_draft', 'publish', 'set_active')
  )
);

revoke all on table private.procedure_change_requests
  from public, anon, authenticated, service_role;

create function public.prevent_published_procedure_version_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'retired' then
    raise exception 'retired procedure versions are immutable' using errcode = '55000';
  end if;
  if old.status = 'published'
    and (new.status <> 'retired'
      or new.procedure_template_id <> old.procedure_template_id
      or new.version_no <> old.version_no
      or new.template_name <> old.template_name
      or new.created_by_profile_id <> old.created_by_profile_id
      or new.created_at <> old.created_at) then
    raise exception 'published procedure versions are immutable' using errcode = '55000';
  end if;
  if old.status = 'draft' and new.status not in ('draft', 'published') then
    raise exception 'invalid procedure version transition' using errcode = '22023';
  end if;
  return new;
end
$$;

create trigger procedure_template_versions_are_immutable
before update or delete on public.procedure_template_versions
for each row execute function public.prevent_published_procedure_version_change();

create function public.prevent_published_procedure_stage_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  version_status text;
begin
  select version.status
  into version_status
  from public.procedure_template_versions as version
  where version.id = coalesce(new.procedure_version_id, old.procedure_version_id);
  if version_status <> 'draft' then
    raise exception 'published procedure stages are immutable' using errcode = '55000';
  end if;
  return coalesce(new, old);
end
$$;

create trigger procedure_template_stages_are_immutable_after_publish
before insert or update or delete on public.procedure_template_stages
for each row execute function public.prevent_published_procedure_stage_change();

create function private.validate_procedure_stage_payload(target_stages jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  stage jsonb;
  expected_order integer := 1;
  stage_order integer;
  stage_name text;
  standard_minutes integer;
  equipment_type text;
  transition_mode text;
  requires_confirmation boolean;
begin
  if target_stages is null
    or jsonb_typeof(target_stages) <> 'array'
    or jsonb_array_length(target_stages) not between 1 and 20 then
    raise exception 'procedure must contain one to twenty stages' using errcode = '22023';
  end if;

  for stage in select value from jsonb_array_elements(target_stages) loop
    stage_order := (stage ->> 'stage_order')::integer;
    stage_name := regexp_replace(
      stage ->> 'name', '^[[:space:]]+|[[:space:]]+$', '', 'g'
    );
    standard_minutes := (stage ->> 'standard_minutes')::integer;
    equipment_type := coalesce(stage ->> 'equipment_type', 'manual');
    transition_mode := coalesce(stage ->> 'transition_mode', 'manual');
    requires_confirmation := coalesce(
      (stage ->> 'requires_operator_confirmation')::boolean,
      true
    );

    if stage_order <> expected_order
      or stage_name is null
      or char_length(stage_name) not between 1 and 80
      or stage_name ~* '(病患|住民|姓名|房號|病歷|patient|resident)'
      or standard_minutes not between 1 and 1440
      or equipment_type not in ('manual', 'disinfection_tank', 'washer', 'dryer', 'cart')
      or transition_mode not in ('manual', 'timer')
      or (equipment_type <> 'manual' and transition_mode <> 'manual')
      or (equipment_type <> 'manual' and not requires_confirmation)
      or jsonb_typeof(coalesce(stage -> 'compatibility_conditions', '{}'::jsonb)) <> 'object'
      or stage::text ~* '(病患|住民|姓名|房號|病歷|patient|resident)' then
      raise exception 'invalid procedure stage' using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_object_keys(
        coalesce(stage -> 'compatibility_conditions', '{}'::jsonb)
      ) as condition_key
      where condition_key not in (
        'category_codes', 'min_capacity_kg', 'max_capacity_kg',
        'requires_active_equipment'
      )
    ) then
      raise exception 'unsupported procedure compatibility condition' using errcode = '22023';
    end if;

    expected_order := expected_order + 1;
  end loop;
end
$$;

create function private.procedure_site_access(target_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.procedure_templates as template
    where template.id = target_template_id
      and private.has_site_access(template.operating_site_id)
  )
$$;

alter table public.procedure_templates enable row level security;
alter table public.procedure_template_versions enable row level security;
alter table public.procedure_template_stages enable row level security;

create policy procedure_templates_select_in_scope
on public.procedure_templates
for select
to authenticated
using (private.procedure_site_access(id));

create policy procedure_template_versions_select_in_scope
on public.procedure_template_versions
for select
to authenticated
using (
  private.procedure_site_access(procedure_template_id)
  and (
    status = 'published'
    or exists (
      select 1
      from public.procedure_templates as template
      where template.id = procedure_template_id
        and private.has_laundry_supervisor_site_access(template.operating_site_id)
    )
  )
);

create policy procedure_template_stages_select_in_scope
on public.procedure_template_stages
for select
to authenticated
using (
  exists (
    select 1
    from public.procedure_template_versions as version
    where version.id = procedure_version_id
  )
);

revoke all on table public.procedure_templates,
  public.procedure_template_versions,
  public.procedure_template_stages
  from anon, authenticated, service_role;
grant select on table public.procedure_templates,
  public.procedure_template_versions,
  public.procedure_template_stages
  to authenticated;

create function public.create_procedure_template_draft(
  target_template_id uuid,
  target_site_code text,
  target_category_code text,
  template_name text,
  stages jsonb,
  change_request_id uuid,
  change_reason text
)
returns table (
  procedure_template_id uuid,
  procedure_version_id uuid,
  version_no integer,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  actor_operating_site_id uuid;
  normalized_site_code text := upper(btrim(target_site_code));
  normalized_category_code text := upper(btrim(target_category_code));
  normalized_name text := regexp_replace(template_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  normalized_reason text := regexp_replace(change_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  normalized_payload jsonb;
  inserted_request_count integer;
  existing_request private.procedure_change_requests%rowtype;
  existing_template public.procedure_templates%rowtype;
  category_id uuid;
  site_id uuid;
  new_version_no integer;
  new_version_id uuid;
  stage jsonb;
begin
  if current_actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if change_request_id is null
    or normalized_name is null
    or char_length(normalized_name) not between 1 and 120
    or normalized_name ~* '(病患|住民|姓名|房號|病歷|patient|resident)'
    or normalized_reason is null
    or char_length(normalized_reason) not between 1 and 500 then
    raise exception 'invalid procedure draft request' using errcode = '22023';
  end if;
  perform private.validate_procedure_stage_payload(stages);

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;
  select membership.operating_site_id
  into actor_operating_site_id
  from public.access_memberships as membership
  join public.user_access_profiles as profile
    on profile.id = membership.user_access_profile_id
  where profile.auth_user_id = current_actor_auth_user_id
    and membership.role = 'laundry_supervisor'
    and membership.active
    and membership.operating_site_id is not null
  order by membership.created_at, membership.id
  limit 1;

  normalized_payload := jsonb_build_object(
    'target_template_id', target_template_id,
    'target_site_code', normalized_site_code,
    'target_category_code', normalized_category_code,
    'template_name', normalized_name,
    'stages', stages,
    'change_reason', normalized_reason
  );
  insert into private.procedure_change_requests (
    id, actor_auth_user_id, operation, change_payload
  ) values (
    change_request_id, current_actor_auth_user_id, 'create_draft', normalized_payload
  ) on conflict (id) do nothing;
  get diagnostics inserted_request_count = row_count;
  if inserted_request_count = 0 then
    select request.* into existing_request
    from private.procedure_change_requests as request
    where request.id = change_request_id;
    if existing_request.actor_auth_user_id <> current_actor_auth_user_id then
      raise exception 'request id belongs to another actor' using errcode = '42501';
    end if;
    if existing_request.operation <> 'create_draft'
      or existing_request.change_payload <> normalized_payload then
      raise exception 'request id already used with different change' using errcode = '22023';
    end if;
    return query select
      existing_request.procedure_template_id,
      existing_request.procedure_version_id,
      (select version.version_no from public.procedure_template_versions as version
       where version.id = existing_request.procedure_version_id),
      true;
    return;
  end if;

  if target_template_id is null then
    select site.id
    into site_id
    from public.operating_sites as site
    where site.code = normalized_site_code
      and site.active;
    if site_id is null or not private.has_laundry_supervisor_site_access(site_id) then
      raise exception 'active supervisor site required' using errcode = '42501';
    end if;
    select category.id
    into category_id
    from public.laundry_categories as category
    where category.code = normalized_category_code
      and category.active;
    if category_id is null then
      raise exception 'active laundry category required' using errcode = '22023';
    end if;
    insert into public.procedure_templates (operating_site_id, laundry_category_id)
    values (site_id, category_id)
    returning * into existing_template;
    new_version_no := 1;
  else
    select template.*
    into existing_template
    from public.procedure_templates as template
    where template.id = target_template_id
    for update;
    if not found or not private.has_laundry_supervisor_site_access(existing_template.operating_site_id) then
      raise exception 'procedure supervisor access required' using errcode = '42501';
    end if;
    if not existing_template.active then
      raise exception 'inactive procedure template' using errcode = '22023';
    end if;
    if exists (
      select 1
      from public.procedure_template_versions as version
      where version.procedure_template_id = existing_template.id
        and version.status = 'draft'
    ) then
      raise exception 'procedure draft already exists' using errcode = '55000';
    end if;
    new_version_no := coalesce(
      (select max(version.version_no)
       from public.procedure_template_versions as version
       where version.procedure_template_id = existing_template.id),
      0
    ) + 1;
  end if;

  insert into public.procedure_template_versions (
    procedure_template_id, version_no, template_name, created_by_profile_id
  ) values (
    existing_template.id, new_version_no, normalized_name, actor_access_profile_id
  ) returning id into new_version_id;

  for stage in select value from jsonb_array_elements(stages) loop
    insert into public.procedure_template_stages (
      procedure_version_id, stage_order, name, standard_minutes,
      equipment_type, compatibility_conditions, transition_mode,
      requires_operator_confirmation
    ) values (
      new_version_id,
      (stage ->> 'stage_order')::integer,
      regexp_replace(stage ->> 'name', '^[[:space:]]+|[[:space:]]+$', '', 'g'),
      (stage ->> 'standard_minutes')::integer,
      coalesce(stage ->> 'equipment_type', 'manual'),
      coalesce(stage -> 'compatibility_conditions', '{}'::jsonb),
      coalesce(stage ->> 'transition_mode', 'manual'),
      coalesce((stage ->> 'requires_operator_confirmation')::boolean, true)
    );
  end loop;

  update private.procedure_change_requests
  set procedure_template_id = existing_template.id,
      procedure_version_id = new_version_id
  where id = change_request_id;
  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id,
    operating_site_id, action, outcome, reason, before_state, after_state,
    request_id
  ) values (
    'authenticated_user', current_actor_auth_user_id, actor_access_profile_id,
    existing_template.operating_site_id, 'procedure_draft_created', 'succeeded',
    normalized_reason, null,
    jsonb_build_object(
      'procedure_template_id', existing_template.id,
      'procedure_version_id', new_version_id,
      'version_no', new_version_no,
      'template_name', normalized_name
    ), change_request_id
  );
  return query select existing_template.id, new_version_id, new_version_no, false;
end
$$;

create function public.update_procedure_template_draft(
  target_procedure_version_id uuid,
  template_name text,
  stages jsonb,
  change_request_id uuid,
  change_reason text
)
returns table (
  procedure_template_id uuid,
  procedure_version_id uuid,
  version_no integer,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_name text := regexp_replace(template_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  normalized_reason text := regexp_replace(change_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  normalized_payload jsonb;
  inserted_request_count integer;
  existing_request private.procedure_change_requests%rowtype;
  existing_version public.procedure_template_versions%rowtype;
  existing_template public.procedure_templates%rowtype;
  stage jsonb;
begin
  if current_actor_auth_user_id is null
    or target_procedure_version_id is null
    or change_request_id is null
    or normalized_name is null
    or char_length(normalized_name) not between 1 and 120
    or normalized_name ~* '(病患|住民|姓名|房號|病歷|patient|resident)'
    or normalized_reason is null
    or char_length(normalized_reason) not between 1 and 500 then
    raise exception 'invalid procedure draft request' using errcode = '22023';
  end if;
  perform private.validate_procedure_stage_payload(stages);
  select version.* into existing_version
  from public.procedure_template_versions as version
  where version.id = target_procedure_version_id
  for update;
  if not found then
    raise exception 'procedure version not found' using errcode = '22023';
  end if;
  select template.* into existing_template
  from public.procedure_templates as template
  where template.id = existing_version.procedure_template_id
  for update;
  if not private.has_laundry_supervisor_site_access(existing_template.operating_site_id) then
    raise exception 'procedure supervisor access required' using errcode = '42501';
  end if;
  if existing_version.status <> 'draft' then
    raise exception 'published procedure versions are immutable' using errcode = '55000';
  end if;
  select profile.id into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;
  normalized_payload := jsonb_build_object(
    'procedure_version_id', target_procedure_version_id,
    'template_name', normalized_name,
    'stages', stages,
    'change_reason', normalized_reason
  );
  insert into private.procedure_change_requests (
    id, actor_auth_user_id, operation, change_payload,
    procedure_template_id, procedure_version_id
  ) values (
    change_request_id, current_actor_auth_user_id, 'update_draft', normalized_payload,
    existing_template.id, existing_version.id
  ) on conflict (id) do nothing;
  get diagnostics inserted_request_count = row_count;
  if inserted_request_count = 0 then
    select request.* into existing_request
    from private.procedure_change_requests as request
    where request.id = change_request_id;
    if existing_request.actor_auth_user_id <> current_actor_auth_user_id
      or existing_request.operation <> 'update_draft'
      or existing_request.change_payload <> normalized_payload then
      raise exception 'procedure request replay rejected' using errcode = '42501';
    end if;
    return query select existing_template.id, existing_version.id,
      existing_version.version_no, true;
    return;
  end if;
  update public.procedure_template_versions
  set template_name = normalized_name
  where id = existing_version.id;
  delete from public.procedure_template_stages as stage
  where stage.procedure_version_id = existing_version.id;
  for stage in select value from jsonb_array_elements(stages) loop
    insert into public.procedure_template_stages (
      procedure_version_id, stage_order, name, standard_minutes,
      equipment_type, compatibility_conditions, transition_mode,
      requires_operator_confirmation
    ) values (
      existing_version.id,
      (stage ->> 'stage_order')::integer,
      regexp_replace(stage ->> 'name', '^[[:space:]]+|[[:space:]]+$', '', 'g'),
      (stage ->> 'standard_minutes')::integer,
      coalesce(stage ->> 'equipment_type', 'manual'),
      coalesce(stage -> 'compatibility_conditions', '{}'::jsonb),
      coalesce(stage ->> 'transition_mode', 'manual'),
      coalesce((stage ->> 'requires_operator_confirmation')::boolean, true)
    );
  end loop;
  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id,
    operating_site_id, action, outcome, reason, before_state, after_state,
    request_id
  ) values (
    'authenticated_user', current_actor_auth_user_id, actor_access_profile_id,
    existing_template.operating_site_id, 'procedure_draft_updated', 'succeeded',
    normalized_reason,
    jsonb_build_object('procedure_version_id', existing_version.id,
      'template_name', existing_version.template_name),
    jsonb_build_object('procedure_version_id', existing_version.id,
      'template_name', normalized_name, 'stage_count', jsonb_array_length(stages)),
    change_request_id
  );
  return query select existing_template.id, existing_version.id,
    existing_version.version_no, false;
end
$$;

create function public.publish_procedure_template_version(
  target_procedure_version_id uuid,
  change_request_id uuid,
  change_reason text
)
returns table (
  procedure_template_id uuid,
  procedure_version_id uuid,
  version_no integer,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_reason text := regexp_replace(change_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  existing_request private.procedure_change_requests%rowtype;
  inserted_request_count integer;
  target_version public.procedure_template_versions%rowtype;
  target_template public.procedure_templates%rowtype;
  old_published_version_id uuid;
  normalized_payload jsonb;
begin
  if current_actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if target_procedure_version_id is null
    or change_request_id is null
    or normalized_reason is null
    or char_length(normalized_reason) not between 1 and 500 then
    raise exception 'invalid procedure publish request' using errcode = '22023';
  end if;
  select profile.id into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;
  select version.* into target_version
  from public.procedure_template_versions as version
  where version.id = target_procedure_version_id
  for update;
  if not found then
    raise exception 'procedure version not found' using errcode = '22023';
  end if;
  select template.* into target_template
  from public.procedure_templates as template
  where template.id = target_version.procedure_template_id
  for update;
  if not private.has_laundry_supervisor_site_access(target_template.operating_site_id) then
    raise exception 'procedure supervisor access required' using errcode = '42501';
  end if;
  normalized_payload := jsonb_build_object(
    'procedure_version_id', target_procedure_version_id,
    'change_reason', normalized_reason
  );
  insert into private.procedure_change_requests (
    id, actor_auth_user_id, operation, change_payload,
    procedure_template_id, procedure_version_id
  ) values (
    change_request_id, current_actor_auth_user_id, 'publish', normalized_payload,
    target_template.id, target_version.id
  ) on conflict (id) do nothing;
  get diagnostics inserted_request_count = row_count;
  if inserted_request_count = 0 then
    select request.* into existing_request
    from private.procedure_change_requests as request
    where request.id = change_request_id;
    if existing_request.actor_auth_user_id <> current_actor_auth_user_id then
      raise exception 'request id belongs to another actor' using errcode = '42501';
    end if;
    if existing_request.operation <> 'publish'
      or existing_request.change_payload <> normalized_payload then
      raise exception 'request id already used with different change' using errcode = '22023';
    end if;
    return query select
      existing_request.procedure_template_id,
      existing_request.procedure_version_id,
      target_version.version_no,
      true;
    return;
  end if;
  if target_version.status <> 'draft' or not target_template.active then
    raise exception 'only an active draft can be published' using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.laundry_categories as category
    where category.id = target_template.laundry_category_id
      and category.active
  ) then
    raise exception 'procedure category is inactive' using errcode = '22023';
  end if;
  perform private.validate_procedure_stage_payload(
    (select jsonb_agg(jsonb_build_object(
      'stage_order', stage.stage_order,
      'name', stage.name,
      'standard_minutes', stage.standard_minutes,
      'equipment_type', stage.equipment_type,
      'compatibility_conditions', stage.compatibility_conditions,
      'transition_mode', stage.transition_mode,
      'requires_operator_confirmation', stage.requires_operator_confirmation
    ) order by stage.stage_order)
     from public.procedure_template_stages as stage
     where stage.procedure_version_id = target_version.id)
  );
  select version.id into old_published_version_id
  from public.procedure_template_versions as version
  where version.procedure_template_id = target_template.id
    and version.status = 'published'
  for update;
  if old_published_version_id is not null then
    update public.procedure_template_versions
    set status = 'retired'
    where id = old_published_version_id;
  end if;
  update public.procedure_template_versions
  set status = 'published', published_at = now()
  where id = target_version.id;
  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id,
    operating_site_id, action, outcome, reason, before_state, after_state,
    request_id
  ) values (
    'authenticated_user', current_actor_auth_user_id, actor_access_profile_id,
    target_template.operating_site_id, 'procedure_published', 'succeeded',
    normalized_reason,
    jsonb_build_object('previous_published_version_id', old_published_version_id),
    jsonb_build_object(
      'procedure_template_id', target_template.id,
      'procedure_version_id', target_version.id,
      'version_no', target_version.version_no
    ), change_request_id
  );
  return query select target_template.id, target_version.id, target_version.version_no, false;
end
$$;

create function public.set_procedure_template_active(
  target_procedure_template_id uuid,
  template_active boolean,
  change_request_id uuid,
  change_reason text
)
returns table (
  procedure_template_id uuid,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_reason text := regexp_replace(change_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  existing_template public.procedure_templates%rowtype;
  existing_request private.procedure_change_requests%rowtype;
  normalized_payload jsonb;
  inserted_request_count integer;
begin
  if current_actor_auth_user_id is null
    or target_procedure_template_id is null
    or template_active is null
    or change_request_id is null
    or normalized_reason is null
    or char_length(normalized_reason) not between 1 and 500 then
    raise exception 'invalid procedure template state request' using errcode = '22023';
  end if;
  select profile.id into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;
  select template.* into existing_template
  from public.procedure_templates as template
  where template.id = target_procedure_template_id
  for update;
  if not found or not private.has_laundry_supervisor_site_access(existing_template.operating_site_id) then
    raise exception 'procedure supervisor access required' using errcode = '42501';
  end if;
  normalized_payload := jsonb_build_object(
    'procedure_template_id', target_procedure_template_id,
    'template_active', template_active,
    'change_reason', normalized_reason
  );
  insert into private.procedure_change_requests (
    id, actor_auth_user_id, operation, change_payload, procedure_template_id
  ) values (
    change_request_id, current_actor_auth_user_id, 'set_active', normalized_payload,
    target_procedure_template_id
  ) on conflict (id) do nothing;
  get diagnostics inserted_request_count = row_count;
  if inserted_request_count = 0 then
    select request.* into existing_request
    from private.procedure_change_requests as request
    where request.id = change_request_id;
    if existing_request.actor_auth_user_id <> current_actor_auth_user_id
      or existing_request.operation <> 'set_active'
      or existing_request.change_payload <> normalized_payload then
      raise exception 'procedure request replay rejected' using errcode = '42501';
    end if;
    return query select target_procedure_template_id, true;
    return;
  end if;
  update public.procedure_templates
  set active = template_active, updated_at = now()
  where id = target_procedure_template_id;
  insert into public.authorization_audit_events (
    actor_type, actor_auth_user_id, actor_access_profile_id,
    operating_site_id, action, outcome, reason, before_state, after_state,
    request_id
  ) values (
    'authenticated_user', current_actor_auth_user_id, actor_access_profile_id,
    existing_template.operating_site_id, 'procedure_template_active_changed',
    'succeeded', normalized_reason,
    jsonb_build_object('active', existing_template.active),
    jsonb_build_object('active', template_active), change_request_id
  );
  return query select target_procedure_template_id, false;
end
$$;

revoke all on function public.create_procedure_template_draft(uuid, text, text, text, jsonb, uuid, text)
  from public;
revoke all on function public.publish_procedure_template_version(uuid, uuid, text)
  from public;
revoke all on function public.update_procedure_template_draft(uuid, text, jsonb, uuid, text)
  from public;
revoke all on function public.set_procedure_template_active(uuid, boolean, uuid, text)
  from public;
grant execute on function public.create_procedure_template_draft(uuid, text, text, text, jsonb, uuid, text)
  to authenticated;
grant execute on function public.publish_procedure_template_version(uuid, uuid, text)
  to authenticated;
grant execute on function public.update_procedure_template_draft(uuid, text, jsonb, uuid, text)
  to authenticated;
grant execute on function public.set_procedure_template_active(uuid, boolean, uuid, text)
  to authenticated;

revoke all on function private.validate_procedure_stage_payload(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.procedure_site_access(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.procedure_site_access(uuid)
  to authenticated;

insert into public.operating_sites (code, name)
values
  ('MAIN', '本館'),
  ('CORP', '法人')
on conflict (code) do nothing;

comment on column public.institutions.operating_site_id is
  'Current institution-site pairing. Future laundry orders must snapshot this site; pairing changes never rewrite existing orders.';

alter table public.authorization_audit_events
  add column source_operating_site_id uuid
    references public.operating_sites(id);

create index authorization_audit_events_source_operating_site_id_idx
  on public.authorization_audit_events (source_operating_site_id, occurred_at desc)
  where source_operating_site_id is not null;

drop policy authorization_audit_events_select_in_scope
  on public.authorization_audit_events;
create policy authorization_audit_events_select_in_scope
on public.authorization_audit_events
for select
to authenticated
using (
  private.can_view_authorization_audit_event(
    operating_site_id,
    institution_id
  )
  or (
    source_operating_site_id is not null
    and private.has_laundry_supervisor_site_access(source_operating_site_id)
  )
);

drop policy institutions_select_in_scope on public.institutions;
create policy institutions_select_in_scope
on public.institutions
for select
to authenticated
using (
  private.has_institution_access(id)
  or private.has_laundry_supervisor_site_access(operating_site_id)
);

create table private.organization_change_requests (
  id uuid primary key,
  actor_auth_user_id uuid not null,
  change_payload jsonb not null,
  institution_id uuid references public.institutions(id),
  created_at timestamptz not null default now()
);

revoke all on table private.organization_change_requests
  from public, anon, authenticated;

create function public.apply_institution_change(
  institution_code text,
  institution_name text,
  target_site_code text,
  institution_active boolean,
  change_request_id uuid,
  change_reason text
)
returns table (
  institution_id uuid,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_auth_user_id uuid := auth.uid();
  actor_access_profile_id uuid;
  normalized_institution_code text := upper(btrim(institution_code));
  normalized_institution_name text := regexp_replace(
    institution_name,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  normalized_site_code text := upper(btrim(target_site_code));
  normalized_change_reason text := regexp_replace(
    change_reason,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  target_site_id uuid;
  source_site_id uuid;
  changed_institution_id uuid;
  existing_institution public.institutions%rowtype;
  existing_request private.organization_change_requests%rowtype;
  previous_site_code text;
  previous_state jsonb;
  audit_action text;
  normalized_change_payload jsonb;
  inserted_request_count integer;
begin
  if current_actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if change_request_id is null then
    raise exception 'change request id is required' using errcode = '22023';
  end if;

  if normalized_institution_code is null
    or char_length(normalized_institution_code) > 40
    or normalized_institution_code !~ '^[A-Z0-9][A-Z0-9_-]*$' then
    raise exception 'invalid institution code' using errcode = '22023';
  end if;

  if normalized_institution_name is null
    or normalized_institution_name = ''
    or char_length(normalized_institution_name) > 120 then
    raise exception 'invalid institution name' using errcode = '22023';
  end if;

  if institution_active is null then
    raise exception 'institution active state is required' using errcode = '22023';
  end if;

  if normalized_change_reason is null
    or normalized_change_reason = ''
    or char_length(normalized_change_reason) > 500 then
    raise exception 'invalid change reason' using errcode = '22023';
  end if;

  select site.id
  into target_site_id
  from public.operating_sites as site
  where site.code = normalized_site_code
    and site.active;

  if target_site_id is null then
    raise exception 'active operating site not found' using errcode = '22023';
  end if;

  if not private.has_laundry_supervisor_site_access(target_site_id) then
    raise exception 'site supervisor access required' using errcode = '42501';
  end if;

  select profile.id
  into actor_access_profile_id
  from public.user_access_profiles as profile
  where profile.auth_user_id = current_actor_auth_user_id
    and profile.active;

  select institution.*
  into existing_institution
  from public.institutions as institution
  where institution.code = normalized_institution_code
  for update;

  if found then
    source_site_id := existing_institution.operating_site_id;

    if not private.has_laundry_supervisor_site_access(
      existing_institution.operating_site_id
    ) then
      raise exception 'source site supervisor access required'
        using errcode = '42501';
    end if;

  end if;

  normalized_change_payload := jsonb_build_object(
    'institution_code', normalized_institution_code,
    'institution_name', normalized_institution_name,
    'target_site_code', normalized_site_code,
    'institution_active', institution_active,
    'change_reason', normalized_change_reason
  );

  insert into private.organization_change_requests (
    id,
    actor_auth_user_id,
    change_payload
  ) values (
    change_request_id,
    current_actor_auth_user_id,
    normalized_change_payload
  )
  on conflict (id) do nothing;

  get diagnostics inserted_request_count = row_count;

  if inserted_request_count = 0 then
    select request.*
    into existing_request
    from private.organization_change_requests as request
    where request.id = change_request_id;

    if existing_request.actor_auth_user_id <> current_actor_auth_user_id then
      raise exception 'request id belongs to another actor'
        using errcode = '42501';
    end if;

    if existing_request.change_payload <> normalized_change_payload then
      raise exception 'request id already used with different change'
        using errcode = '22023';
    end if;

    return query select existing_request.institution_id, true;
    return;
  end if;

  if existing_institution.id is not null then

    select site.code
    into previous_site_code
    from public.operating_sites as site
    where site.id = existing_institution.operating_site_id;

    previous_state := jsonb_build_object(
      'code', existing_institution.code,
      'name', existing_institution.name,
      'site_code', previous_site_code,
      'active', existing_institution.active
    );
    audit_action := 'institution_updated';

    update public.institutions
    set name = normalized_institution_name,
        operating_site_id = target_site_id,
        active = institution_active,
        updated_at = now()
    where id = existing_institution.id
    returning id into changed_institution_id;
  else
    audit_action := 'institution_created';

    insert into public.institutions (
      code,
      name,
      operating_site_id,
      active
    ) values (
      normalized_institution_code,
      normalized_institution_name,
      target_site_id,
      institution_active
    )
    returning id into changed_institution_id;
  end if;

  insert into public.authorization_audit_events (
    actor_type,
    actor_auth_user_id,
    actor_access_profile_id,
    action,
    source_operating_site_id,
    operating_site_id,
    institution_id,
    outcome,
    reason,
    before_state,
    after_state,
    request_id
  ) values (
    'authenticated_user',
    current_actor_auth_user_id,
    actor_access_profile_id,
    audit_action,
    source_site_id,
    target_site_id,
    changed_institution_id,
    'succeeded',
    normalized_change_reason,
    previous_state,
    jsonb_build_object(
      'code', normalized_institution_code,
      'name', normalized_institution_name,
      'site_code', normalized_site_code,
      'active', institution_active
    ),
    change_request_id
  );

  update private.organization_change_requests
  set institution_id = changed_institution_id
  where id = change_request_id;

  return query select changed_institution_id, false;
end
$$;

revoke all on function public.apply_institution_change(
  text,
  text,
  text,
  boolean,
  uuid,
  text
) from public;
grant execute on function public.apply_institution_change(
  text,
  text,
  text,
  boolean,
  uuid,
  text
) to authenticated;

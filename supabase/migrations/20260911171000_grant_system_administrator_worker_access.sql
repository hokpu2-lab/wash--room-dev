-- 補齊系統管理員 (system_administrator) 之洗衣員現場作業據點權限與全活躍據點存取

-- 1. 更新 private.has_laundry_worker_site_access 納入 system_administrator
create or replace function private.has_laundry_worker_site_access(target_site_id uuid)
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
    join public.operating_sites as target_site
      on target_site.id = target_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and target_site.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and (
        membership.role = 'system_administrator'
        or (
          membership.role in ('laundry_worker', 'laundry_supervisor')
          and membership.operating_site_id = target_site_id
        )
      )
  )
$$;

-- 2. 更新 private.has_laundry_supervisor_site_access 確保 system_administrator 可管理所有活躍據點
create or replace function private.has_laundry_supervisor_site_access(target_site_id uuid)
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
    join public.operating_sites as target_site
      on target_site.id = target_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and target_site.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and (
        membership.role = 'system_administrator'
        or (
          membership.role = 'laundry_supervisor'
          and membership.operating_site_id = target_site_id
        )
      )
  )
$$;

-- 3. 更新 private.has_site_access 確保 system_administrator 可存取所有活躍據點
create or replace function private.has_site_access(target_site_id uuid)
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
    join public.operating_sites as target_site
      on target_site.id = target_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and target_site.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and (
        membership.role = 'system_administrator'
        or (
          membership.role in ('laundry_worker', 'laundry_supervisor')
          and membership.operating_site_id = target_site_id
        )
      )
  )
$$;

-- 4. 更新 private.has_institution_supervisor_access 確保 system_administrator 可管理所有活躍送洗機構
create or replace function private.has_institution_supervisor_access(target_institution_id uuid)
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
    join public.institutions as target_institution
      on target_institution.id = target_institution_id
    join public.operating_sites as institution_site
      on institution_site.id = target_institution.operating_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and target_institution.active
      and institution_site.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and (
        membership.role = 'system_administrator'
        or (
          membership.role = 'institution_supervisor'
          and membership.institution_id = target_institution_id
        )
      )
  )
$$;

-- 5. 確保執行權限
revoke all on function private.has_laundry_worker_site_access(uuid) from public;
grant execute on function private.has_laundry_worker_site_access(uuid) to authenticated;

revoke all on function private.has_laundry_supervisor_site_access(uuid) from public;
grant execute on function private.has_laundry_supervisor_site_access(uuid) to authenticated;

revoke all on function private.has_site_access(uuid) from public;
grant execute on function private.has_site_access(uuid) to authenticated;

revoke all on function private.has_institution_supervisor_access(uuid) from public;
grant execute on function private.has_institution_supervisor_access(uuid) to authenticated;

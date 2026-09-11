-- 新增「系統管理員 (system_administrator)」角色與更新預設 admin 帳號 (ad@hok.com.tw)

alter table public.access_memberships
  drop constraint if exists access_memberships_role_check,
  drop constraint if exists access_memberships_role_scope_check;

alter table public.access_memberships
  add constraint access_memberships_role_check
    check (role in (
      'laundry_worker',
      'laundry_supervisor',
      'institution_supervisor',
      'system_administrator'
    )),
  add constraint access_memberships_role_scope_check check (
    (
      role in ('laundry_worker', 'laundry_supervisor', 'system_administrator')
      and operating_site_id is not null
      and institution_id is null
    )
    or
    (
      role = 'institution_supervisor'
      and operating_site_id is null
      and institution_id is not null
    )
  );

-- 更新 private.has_laundry_supervisor_site_access 納入 system_administrator
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
    join public.operating_sites as site
      on site.id = membership.operating_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and membership.role in ('laundry_supervisor', 'system_administrator')
      and membership.operating_site_id = target_site_id
      and site.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
  )
$$;

-- 更新 private.has_any_laundry_supervisor_access 納入 system_administrator
create or replace function private.has_any_laundry_supervisor_access()
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
      and membership.role in ('laundry_supervisor', 'system_administrator')
      and membership.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and site.active
  )
$$;

-- 更新 private.has_site_access 納入 system_administrator
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
    join public.operating_sites as membership_site
      on membership_site.id = membership.operating_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.active
      and membership.role in ('laundry_worker', 'laundry_supervisor', 'system_administrator')
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
      and target_site.active
      and membership_site.active
      and membership.operating_site_id = target_site_id
  )
$$;

-- 更新 private.can_fully_manage_access_profile
create or replace function private.can_fully_manage_access_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_memberships as membership
    where membership.user_access_profile_id = target_profile_id
  )
  and not exists (
    select 1
    from public.access_memberships as membership
    left join public.institutions as institution
      on institution.id = membership.institution_id
    where membership.user_access_profile_id = target_profile_id
      and not private.has_laundry_supervisor_site_access(
        coalesce(membership.operating_site_id, institution.operating_site_id)
      )
  )
$$;

-- 1. 若存在 admin 帳號，預設設定其 notification_email 為 ad@hok.com.tw
update public.user_access_profiles
set notification_email = 'ad@hok.com.tw',
    updated_at = now()
where lower(login_name) = 'admin';

-- 2. 將 admin 帳號既有的據點 membership 角色升級/更新為 system_administrator
update public.access_memberships
set role = 'system_administrator',
    updated_at = now()
where user_access_profile_id in (
  select id from public.user_access_profiles where lower(login_name) = 'admin'
)
and role in ('laundry_supervisor', 'laundry_worker');

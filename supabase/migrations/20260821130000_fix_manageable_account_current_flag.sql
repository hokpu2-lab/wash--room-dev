create or replace function public.list_manageable_user_accounts()
returns table (
  profile_id uuid,
  login_name text,
  display_name text,
  notification_email text,
  account_active boolean,
  must_change_password boolean,
  deleted_at timestamptz,
  auth_identity_configured boolean,
  is_current_account boolean,
  memberships jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.login_name,
    profile.display_name,
    profile.notification_email,
    profile.active,
    profile.must_change_password,
    profile.deleted_at,
    profile.auth_user_id is not null,
    coalesce(profile.auth_user_id = (select auth.uid()), false),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'membership_id', membership.id,
          'role', membership.role,
          'site_code', site.code,
          'site_name', site.name,
          'institution_code', institution.code,
          'institution_name', institution.name,
          'active', membership.active
        ) order by membership.created_at, membership.id
      ) filter (where membership.id is not null),
      '[]'::jsonb
    )
  from public.user_access_profiles as profile
  left join public.access_memberships as membership
    on membership.user_access_profile_id = profile.id
  left join public.operating_sites as site
    on site.id = membership.operating_site_id
  left join public.institutions as institution
    on institution.id = membership.institution_id
  where private.can_fully_manage_access_profile(profile.id)
  group by profile.id
  order by profile.deleted_at nulls first, lower(profile.login_name), profile.id
$$;

revoke all on function public.list_manageable_user_accounts()
  from public, anon, service_role;
grant execute on function public.list_manageable_user_accounts()
  to authenticated;

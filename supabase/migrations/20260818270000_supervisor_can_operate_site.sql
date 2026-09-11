create or replace function private.has_laundry_worker_site_access(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_memberships membership
    join public.user_access_profiles profile
      on profile.id = membership.user_access_profile_id
    join public.operating_sites site
      on site.id = membership.operating_site_id
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and membership.role in ('laundry_worker', 'laundry_supervisor')
      and membership.active
      and membership.operating_site_id = target_site_id
      and site.active
      and membership.valid_from <= now()
      and (membership.valid_until is null or membership.valid_until > now())
  )
$$;

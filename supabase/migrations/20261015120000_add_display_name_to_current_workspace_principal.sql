-- Add display_name to current_workspace_principal RPC
create or replace function public.current_workspace_principal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  login_name text;
  display_name text;
  must_change boolean;
  memberships jsonb;
begin
  if actor is null then
    return jsonb_build_object('kind', 'anonymous');
  end if;

  select profile.login_name, profile.display_name, profile.must_change_password
  into login_name, display_name, must_change
  from public.user_access_profiles as profile
  join auth.users as auth_user
    on auth_user.id = profile.auth_user_id
  where profile.auth_user_id = actor
    and (profile.active or profile.must_change_password)
    and auth_user.email_confirmed_at is not null
    and auth_user.raw_app_meta_data ->> 'provider' = 'email';

  if not found then
    return jsonb_build_object('kind', 'denied');
  end if;

  if must_change then
    return jsonb_build_object(
      'kind', 'password_change_required',
      'login_name', login_name,
      'display_name', display_name
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'membership_id', ctx.membership_id,
        'role', ctx.role,
        'operating_site_id', ctx.operating_site_id,
        'institution_id', ctx.institution_id,
        'scope_code', ctx.scope_code,
        'scope_name', ctx.scope_name
      )
      order by ctx.membership_id
    ),
    '[]'::jsonb
  )
  into memberships
  from public.current_access_context() as ctx;

  if memberships = '[]'::jsonb then
    return jsonb_build_object('kind', 'denied');
  end if;

  return jsonb_build_object(
    'kind', 'authorized',
    'login_name', login_name,
    'display_name', display_name,
    'memberships', memberships
  );
end;
$$;

revoke all on function public.current_workspace_principal() from public, anon, service_role;
grant execute on function public.current_workspace_principal() to authenticated;

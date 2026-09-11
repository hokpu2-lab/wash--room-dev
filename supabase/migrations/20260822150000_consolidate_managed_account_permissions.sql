-- Keep batch permission maintenance inside the managed-account lifecycle.
-- The legacy access RPC can create an unbound profile, which would require a
-- later manual Supabase Auth user. The managed entry point only updates an
-- account that already has an Auth identity created by the application flow.
create or replace function public.apply_managed_account_permission_changes(
  change_rows jsonb,
  change_request_id uuid,
  change_reason text
)
returns table (applied_count integer, already_applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_auth_user_id uuid := auth.uid();
  change_row jsonb;
  requested_login_name text;
  target_profile public.user_access_profiles%rowtype;
begin
  if actor_auth_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if change_request_id is null then
    raise exception 'change request id is required' using errcode = '22023';
  end if;

  if jsonb_typeof(change_rows) <> 'array'
    or jsonb_array_length(change_rows) = 0
    or jsonb_array_length(change_rows) > 500 then
    raise exception 'change rows must contain between 1 and 500 entries'
      using errcode = '22023';
  end if;

  for change_row in
    select value from jsonb_array_elements(change_rows)
  loop
    requested_login_name := btrim(change_row ->> 'login_name');

    if requested_login_name is null
      or requested_login_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$' then
      raise exception 'invalid login name' using errcode = '22023';
    end if;

    select profile.*
    into target_profile
    from public.user_access_profiles as profile
    where profile.login_name = requested_login_name
    for update;

    if not found
      or target_profile.deleted_at is not null
      or target_profile.auth_user_id is null then
      raise exception 'account must be created by managed account lifecycle'
        using errcode = '42501';
    end if;

    if target_profile.auth_user_id = actor_auth_user_id then
      raise exception 'current account must be managed through self service'
        using errcode = '42501';
    end if;

    if not private.can_fully_manage_access_profile(target_profile.id) then
      raise exception 'account is outside supervisor authority'
        using errcode = '42501';
    end if;

    if lower(btrim(change_row ->> 'email')) <> lower(target_profile.email) then
      raise exception 'account identity does not match login name'
        using errcode = '22023';
    end if;
  end loop;

  return query
    select result.applied_count, result.already_applied
    from public.apply_access_changes(
      change_rows,
      change_request_id,
      change_reason
    ) as result;
end
$$;

revoke all on function public.apply_managed_account_permission_changes(jsonb, uuid, text)
  from public, anon, service_role;
grant execute on function public.apply_managed_account_permission_changes(jsonb, uuid, text)
  to authenticated;

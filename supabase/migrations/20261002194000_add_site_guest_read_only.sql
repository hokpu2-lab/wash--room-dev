-- 訪客只擁有授權作業據點的讀取範圍；作業／管理權限仍由原本的角色專用 helper 控制。
alter table public.access_memberships
  drop constraint if exists access_memberships_role_check,
  drop constraint if exists access_memberships_role_scope_check;

alter table public.access_memberships
  add constraint access_memberships_role_check check (
    role in ('guest', 'laundry_worker', 'laundry_supervisor', 'institution_supervisor', 'system_administrator')
  ),
  add constraint access_memberships_role_scope_check check (
    (role in ('guest', 'laundry_worker', 'laundry_supervisor', 'system_administrator')
      and operating_site_id is not null and institution_id is null)
    or (role = 'institution_supervisor' and operating_site_id is null and institution_id is not null)
  );

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
          membership.role in ('guest', 'laundry_worker', 'laundry_supervisor')
          and membership.operating_site_id = target_site_id
        )
      )
  )
$$;

revoke all on function private.has_site_access(uuid) from public;
grant execute on function private.has_site_access(uuid) to authenticated;

-- 兩個既有帳號管理 RPC 內的角色白名單由已部署函式定義精確補上 guest。
-- 若函式形狀改變，直接中止 migration，避免覆蓋未知版本的安全邏輯。
do $$
declare
  signature regprocedure;
  definition text;
  old_fragment text := 'requested_role in (''laundry_worker'', ''laundry_supervisor'')';
  new_fragment text := 'requested_role in (''guest'', ''laundry_worker'', ''laundry_supervisor'')';
begin
  foreach signature in array array[
    'public.manage_user_account(uuid,text,text,text,boolean,jsonb,uuid,text)'::regprocedure,
    'public.apply_access_changes_legacy(jsonb,uuid,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    if definition is null or position(old_fragment in definition) = 0
      or position(new_fragment in definition) > 0 then
      raise exception 'guest role migration: unexpected function definition %', signature;
    end if;
    execute replace(definition, old_fragment, new_fragment);
  end loop;
end
$$;

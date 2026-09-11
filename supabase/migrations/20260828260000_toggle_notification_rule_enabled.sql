create or replace function public.set_notification_matrix_rule_enabled(
  target_rule_id uuid,
  target_enabled boolean
)
returns table(rule_id uuid, already_applied boolean, outcome text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  previous public.notification_matrix_rules%rowtype;
begin
  if actor is null or not private.has_any_laundry_supervisor_access() then
    return query select null::uuid, false, 'denied'::text, 'worker_scope_denied'::text;
    return;
  end if;
  select rule.* into previous
  from public.notification_matrix_rules as rule
  where rule.id = target_rule_id;
  if not found then
    return query select target_rule_id, false, 'denied'::text, 'not_found'::text;
    return;
  end if;
  if previous.operating_site_id is not null
    and not private.has_laundry_supervisor_site_access(previous.operating_site_id) then
    return query select target_rule_id, false, 'denied'::text, 'worker_scope_denied'::text;
    return;
  end if;
  if previous.enabled is not distinct from target_enabled then
    return query select previous.id, true, 'applied'::text, 'configured'::text;
    return;
  end if;
  update public.notification_matrix_rules
  set enabled = target_enabled
  where id = previous.id;
  return query select previous.id, false, 'applied'::text, 'configured'::text;
end
$$;

revoke all on function public.set_notification_matrix_rule_enabled(uuid, boolean)
  from public, anon, service_role;
grant execute on function public.set_notification_matrix_rule_enabled(uuid, boolean)
  to authenticated;

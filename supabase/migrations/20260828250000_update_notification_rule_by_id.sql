create or replace function public.update_notification_matrix_rule(
  target_rule_id uuid,
  target_event_key text,
  target_channel text,
  target_role text,
  target_severity text,
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
  if target_event_key not in (
      'order_ready_for_pickup', 'order_overdue', 'batch_incident_critical', 'progress_digest'
    )
    or target_channel not in ('in_app', 'email', 'line', 'telegram')
    or target_role not in ('laundry_supervisor', 'institution_supervisor')
    or target_severity not in ('normal', 'high', 'critical') then
    return query select target_rule_id, false, 'denied'::text, 'invalid_rule'::text;
    return;
  end if;
  if previous.event_key is not distinct from target_event_key
    and previous.channel is not distinct from target_channel
    and previous.recipient_role is not distinct from target_role
    and previous.severity is not distinct from target_severity
    and previous.enabled is not distinct from target_enabled then
    return query select previous.id, true, 'applied'::text, 'configured'::text;
    return;
  end if;
  update public.notification_matrix_rules
  set event_key = target_event_key,
      channel = target_channel,
      recipient_role = target_role,
      severity = target_severity,
      enabled = target_enabled
  where id = previous.id;
  return query select previous.id, false, 'applied'::text, 'configured'::text;
end
$$;

revoke all on function public.update_notification_matrix_rule(uuid, text, text, text, text, boolean)
  from public, anon, service_role;
grant execute on function public.update_notification_matrix_rule(uuid, text, text, text, text, boolean)
  to authenticated;

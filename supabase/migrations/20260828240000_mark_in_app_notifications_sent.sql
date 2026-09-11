create or replace function private.mark_in_app_notification_sent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'in_app' and new.status = 'pending' then
    new.status := 'sent';
    new.sent_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists notification_outbox_mark_in_app_sent on public.notification_outbox;

create trigger notification_outbox_mark_in_app_sent
before insert on public.notification_outbox
for each row execute function private.mark_in_app_notification_sent();

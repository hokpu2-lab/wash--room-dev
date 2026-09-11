-- 清空洗衣單與相關作業資料。不動據點、機構、洗衣車、設備、分類、程序、帳號。
-- 在 Supabase SQL Editor 以 postgres / 專案擁有者整段執行。

begin;

update public.laundry_equipment
set occupied = false, updated_at = now()
where occupied;

update public.laundry_batches
set active_stage_run_id = null;

update public.laundry_import_rows
set committed_laundry_order_id = null
where committed_laundry_order_id is not null;

delete from private.laundry_stage_complete_change_requests;
delete from private.laundry_batch_stage_change_requests;
delete from private.laundry_disinfection_change_requests;
delete from private.laundry_drying_change_requests;
delete from private.laundry_loading_change_requests;
delete from private.laundry_pickup_change_requests;
delete from private.laundry_receipt_change_requests;
delete from private.laundry_order_change_requests;
delete from private.laundry_batch_split_requests;
delete from private.laundry_batch_merge_requests;
delete from private.laundry_batch_progress_change_requests;
delete from private.laundry_incident_change_requests;
delete from private.laundry_scheduling_requests;
truncate private.laundry_order_sequences;
truncate private.laundry_order_anonymous_rate_limit;

delete from public.laundry_batch_equipment_assignments;
delete from public.laundry_batch_priorities;
delete from public.laundry_batch_sources;
delete from public.laundry_batch_incidents;
delete from public.laundry_batch_rework_attempts;
delete from public.laundry_data_corrections;
delete from public.laundry_batch_stage_runs;

alter table public.authorization_audit_events
  disable trigger authorization_audit_events_are_immutable;
update public.authorization_audit_events
set laundry_order_id = null, laundry_batch_id = null
where laundry_order_id is not null
   or laundry_batch_id is not null;
alter table public.authorization_audit_events
  enable trigger authorization_audit_events_are_immutable;

delete from public.laundry_batches;
delete from public.laundry_orders;

select
  (select count(*) from public.laundry_orders) as remaining_orders,
  (select count(*) from public.laundry_batches) as remaining_batches,
  (select count(*) from public.laundry_equipment where occupied) as occupied_equipment;

commit;

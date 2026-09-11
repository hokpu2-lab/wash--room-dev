import { afterEach, expect, test } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;
afterEach(async () => { await database?.close(); database = undefined; });

test("T13-T28 的資料庫合約表與 RPC 會隨全新環境建立", async () => {
  database = await createTestDatabase();
  const tables = await database.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1::text[])`, [["laundry_batch_sources", "laundry_capacity_snapshots", "notification_outbox", "notification_external_destinations", "laundry_import_batches", "saved_bi_views", "laundry_export_jobs", "laundry_capacity_alerts", "laundry_ai_suggestions"]]);
  const functions = await database.query<{ routine_name: string }>(`select routine_name from information_schema.routines where routine_schema='public' and routine_name = any($1::text[])`, [["merge_compatible_laundry_batches", "pause_laundry_batch_stage", "record_laundry_batch_incident", "suggest_laundry_batch_schedule", "create_laundry_replan_suggestion", "enqueue_laundry_notification_event", "create_laundry_import_preview", "get_laundry_dashboard", "run_laundry_bi_view", "create_laundry_export_job", "evaluate_laundry_capacity", "save_laundry_ai_suggestion"]]);
  expect(new Set(tables.rows.map((row) => row.table_name))).toEqual(new Set(["laundry_batch_sources", "laundry_capacity_snapshots", "notification_outbox", "notification_external_destinations", "laundry_import_batches", "saved_bi_views", "laundry_export_jobs", "laundry_capacity_alerts", "laundry_ai_suggestions"]));
  expect(new Set(functions.rows.map((row) => row.routine_name))).toEqual(new Set(["merge_compatible_laundry_batches", "pause_laundry_batch_stage", "record_laundry_batch_incident", "suggest_laundry_batch_schedule", "create_laundry_replan_suggestion", "enqueue_laundry_notification_event", "create_laundry_import_preview", "get_laundry_dashboard", "run_laundry_bi_view", "create_laundry_export_job", "evaluate_laundry_capacity", "save_laundry_ai_suggestion"]));
});

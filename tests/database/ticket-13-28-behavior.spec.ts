import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

async function seedSite() {
  database = await createTestDatabase();
  const supervisor = "10000000-0000-4000-8000-000000000951";
  const supervisorProfile = "40000000-0000-4000-8000-000000000951";
  const worker = "10000000-0000-4000-8000-000000000952";
  const workerProfile = "40000000-0000-4000-8000-000000000952";
  const ids = Array.from({ length: 14 }, (_, index) => `60000000-0000-4000-8000-0000000013${10 + index}`);
  await database.exec(`
    insert into auth.users (id,email) values ('${supervisor}','adv.supervisor@example.com'),('${worker}','adv.worker@example.com');
    insert into public.user_access_profiles (id,email,auth_user_id) values
      ('${supervisorProfile}','adv.supervisor@example.com','${supervisor}'),
      ('${workerProfile}','adv.worker@example.com','${worker}');
    insert into public.access_memberships (user_access_profile_id,role,operating_site_id)
      select '${supervisorProfile}','laundry_supervisor',id from public.operating_sites where code='MAIN';
    insert into public.access_memberships (user_access_profile_id,role,operating_site_id)
      select '${workerProfile}','laundry_worker',id from public.operating_sites where code='MAIN';
    insert into public.institutions (code,name,operating_site_id)
      select 'ADV-CARE','進階測試機構',id from public.operating_sites where code='MAIN';
  `);
  const site = await database.query<{ id: string }>("select id from public.operating_sites where code='MAIN'");
  return { supervisor, worker, ids, siteId: site.rows[0].id };
}

test("T19 BI 樣本版型只能在授權範圍內保存並回傳受控分組結果", async () => {
  const { supervisor, ids, siteId } = await seedSite();
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  await database!.exec("set role authenticated");

  const saved = await database!.query<{ view_id: string; outcome: string; reason_code: string }>(
    `select view_id, outcome, reason_code from public.save_laundry_bi_view($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7)`,
    [
      "流程健康度",
      JSON.stringify(["status"]),
      JSON.stringify(["order_count", "completed_count"]),
      "{}",
      siteId,
      false,
      ids[0],
    ],
  );
  expect(saved.rows[0]).toMatchObject({ outcome: "applied", reason_code: "saved" });

  const result = await database!.query<{ run: { outcome: string; dimensions: string[]; metrics: string[]; rows: unknown[] } }>(
    `select public.run_laundry_bi_view($1) as run`,
    [saved.rows[0].view_id],
  );
  expect(result.rows[0]?.run).toMatchObject({
    outcome: "ok",
    dimensions: ["status"],
    metrics: ["order_count", "completed_count"],
    rows: [],
  });
});

test("T15 暫停與恢復只改實際狀態，預估進度仍標示為估計", async () => {
  const { supervisor, worker, ids } = await seedSite();
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  await database!.exec("set role authenticated");
  const stages = [{
    stage_order: 1, name: "清洗", standard_minutes: 30, equipment_type: "washer",
    compatibility_conditions: { category_codes: ["SOILED"] }, transition_mode: "manual", requires_operator_confirmation: true,
  }];
  const draft = await database!.query<{ procedure_template_id: string; procedure_version_id: string }>(
    `select * from public.create_procedure_template_draft(null,$1,$2,$3,$4::jsonb,$5,$6)`,
    ["MAIN", "SOILED", "進階程序", JSON.stringify(stages), ids[0], "建立程序"],
  );
  await database!.query(`select * from public.publish_procedure_template_version($1,$2,$3)`, [draft.rows[0].procedure_version_id, ids[1], "發布"]);
  const cart = await database!.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id from public.register_laundry_cart($1,$2,$3,$4)`,
    ["ADV-CART", "ADV-CARE", ids[2], "建立車"],
  );
  const cartQr = await database!.query<{ qr_token: string }>(`select qr_token from public.get_current_laundry_cart_qr($1)`, [cart.rows[0].laundry_cart_id]);
  await database!.exec("set role anon");
  await database!.query(`select laundry_order_id from public.create_laundry_order_from_cart_qr($1,$2)`, [cartQr.rows[0].qr_token, ids[3]]);
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [worker]);
  await database!.exec("set role authenticated");
  const received = await database!.query<{ laundry_order_id: string }>(
    `select laundry_order_id from public.receive_laundry_order_from_cart_qr($1,$2::jsonb,$3)`,
    [cartQr.rows[0].qr_token, JSON.stringify(["SOILED"]), ids[4]],
  );
  const batch = await database!.query<{ id: string }>(`select id from public.laundry_batches where laundry_order_id=$1::uuid`, [received.rows[0].laundry_order_id]);
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  const equipment = await database!.query<{ laundry_equipment_id: string }>(
    `select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    ["Washer ADV 01", "MAIN", "washer", 18, JSON.stringify(["SOILED"]), JSON.stringify([draft.rows[0].procedure_template_id]), ids[5], "建立洗衣機"],
  );
  const equipmentQr = await database!.query<{ qr_token: string }>(`select qr_token from public.get_current_laundry_equipment_qr($1)`, [equipment.rows[0].laundry_equipment_id]);
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [worker]);
  await database!.query(`select * from public.start_laundry_batch_washing_from_equipment_qr($1,$2,$3)`, [equipmentQr.rows[0].qr_token, batch.rows[0].id, ids[6]]);

  const paused = await database!.query<{ status: string; reason_code: string }>(
    `select status, reason_code from public.pause_laundry_batch_stage($1,$2,$3)`,
    [batch.rows[0].id, "設備檢查", ids[7]],
  );
  expect(paused.rows[0]).toMatchObject({ status: "paused", reason_code: "paused" });
  const batchStatus = await database!.query<{ status: string }>(`select status from public.laundry_batches where id=$1::uuid`, [batch.rows[0].id]);
  expect(batchStatus.rows[0]?.status).toBe("paused");

  const progress = await database!.query<{ is_estimate: boolean; batch_status: string }>(
    `select is_estimate, batch_status from public.get_laundry_batch_progress($1)`,
    [batch.rows[0].id],
  );
  expect(progress.rows[0]).toMatchObject({ is_estimate: true, batch_status: "paused" });

  const resumed = await database!.query<{ status: string; reason_code: string }>(
    `select status, reason_code from public.resume_laundry_batch_stage($1,$2)`,
    [batch.rows[0].id, ids[8]],
  );
  expect(resumed.rows[0]).toMatchObject({ status: "in_progress", reason_code: "resumed" });
});

test("T17–T18 排程建議對洗衣員可見，重排建議只給主管且冪等", async () => {
  const { supervisor, worker, ids, siteId } = await seedSite();
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  await database!.exec("set role authenticated");
  const stages = [{
    stage_order: 1, name: "清洗", standard_minutes: 30, equipment_type: "washer",
    compatibility_conditions: { category_codes: ["SOILED"] }, transition_mode: "manual", requires_operator_confirmation: true,
  }];
  const draft = await database!.query<{ procedure_version_id: string }>(
    `select procedure_version_id from public.create_procedure_template_draft(null,$1,$2,$3,$4::jsonb,$5,$6)`,
    ["MAIN", "SOILED", "排程程序", JSON.stringify(stages), ids[0], "建立程序"],
  );
  await database!.query(`select * from public.publish_procedure_template_version($1,$2,$3)`, [draft.rows[0].procedure_version_id, ids[1], "發布"]);
  const cart = await database!.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id from public.register_laundry_cart($1,$2,$3,$4)`,
    ["SCH-CART", "ADV-CARE", ids[2], "建立車"],
  );
  const cartQr = await database!.query<{ qr_token: string }>(`select qr_token from public.get_current_laundry_cart_qr($1)`, [cart.rows[0].laundry_cart_id]);
  await database!.exec("set role anon");
  await database!.query(`select laundry_order_id from public.create_laundry_order_from_cart_qr($1,$2)`, [cartQr.rows[0].qr_token, ids[3]]);
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [worker]);
  await database!.exec("set role authenticated");
  await database!.query(
    `select laundry_order_id from public.receive_laundry_order_from_cart_qr($1,$2::jsonb,$3)`,
    [cartQr.rows[0].qr_token, JSON.stringify(["SOILED"]), ids[4]],
  );

  const schedule = await database!.query<{ laundry_batch_id: string; reason: string }>(
    `select laundry_batch_id, reason from public.suggest_laundry_batch_schedule($1)`,
    [siteId],
  );
  expect(schedule.rows.length).toBeGreaterThan(0);
  expect(schedule.rows[0]?.reason).toContain("確定性排序");

  const workerReplan = await database!.query<{ outcome: string }>(
    `select outcome from public.create_laundry_replan_suggestion($1,$2,$3)`,
    [siteId, "設備停機", ids[5]],
  );
  expect(workerReplan.rows[0]?.outcome).toBe("denied");

  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  const first = await database!.query<{ outcome: string; reason_code: string; already_applied: boolean }>(
    `select outcome, reason_code, already_applied from public.create_laundry_replan_suggestion($1,$2,$3)`,
    [siteId, "設備停機", ids[5]],
  );
  const replay = await database!.query<{ outcome: string; already_applied: boolean }>(
    `select outcome, already_applied from public.create_laundry_replan_suggestion($1,$2,$3)`,
    [siteId, "設備停機", ids[5]],
  );
  expect(first.rows[0]).toMatchObject({ outcome: "applied", reason_code: "proposed", already_applied: false });
  expect(replay.rows[0]).toMatchObject({ outcome: "applied", already_applied: true });
});

test("T21–T27 通知、匯入、匯出、容量與 AI 會驗主管範圍並拒絕洗衣員", async () => {
  const { supervisor, worker, ids, siteId } = await seedSite();
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [worker]);
  await database!.exec("set role authenticated");

  const workerNotify = await database!.query<{ outcome: string }>(
    `select outcome from public.enqueue_laundry_notification_event($1,$2,$3,$4,$5,$6)`,
    ["order_ready", ids[0], siteId, null, "normal", "可取件"],
  );
  const workerImport = await database!.query<{ outcome: string }>(
    `select outcome from public.create_laundry_import_preview($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    ["old.csv", "csv", "abc", siteId, null, JSON.stringify([{ order_number: "X", cart_number: "Y", category_code: "SOILED" }]), ids[1]],
  );
  const workerExport = await database!.query<{ outcome: string }>(
    `select outcome from public.create_laundry_export_job($1,$2,$3::jsonb,$4,$5)`,
    ["csv", "orders", "{}", siteId, ids[2]],
  );
  const workerAi = await database!.query<{ outcome: string }>(
    `select outcome from public.save_laundry_ai_suggestion($1,$2::jsonb,$3,$4::jsonb,$5,$6)`,
    [siteId, "{}", "摘要", JSON.stringify(["建議"]), "rules-v1", ids[3]],
  );
  expect(workerNotify.rows[0]?.outcome).toBe("denied");
  expect(workerImport.rows[0]?.outcome).toBe("denied");
  expect(workerExport.rows[0]?.outcome).toBe("denied");
  expect(workerAi.rows[0]?.outcome).toBe("denied");

  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  const notify = await database!.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.enqueue_laundry_notification_event($1,$2,$3,$4,$5,$6)`,
    ["order_ready", ids[0], siteId, null, "high", "可取件通知"],
  );
  expect(notify.rows[0]).toMatchObject({ outcome: "applied", reason_code: "queued" });

  const preview = await database!.query<{ valid_rows: number; invalid_rows: number; outcome: string }>(
    `select valid_rows, invalid_rows, outcome from public.create_laundry_import_preview($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      "old.csv",
      "csv",
      "deadbeef",
      siteId,
      null,
      JSON.stringify([
        { order_number: "MAIN-1", cart_number: "CART-1", category_code: "SOILED" },
        { order_number: "", cart_number: "", category_code: "" },
      ]),
      ids[4],
    ],
  );
  expect(preview.rows[0]).toMatchObject({ outcome: "applied", valid_rows: 1, invalid_rows: 1 });

  const exported = await database!.query<{ outcome: string; reason_code: string; status: string }>(
    `select outcome, reason_code, status from public.create_laundry_export_job($1,$2,$3::jsonb,$4,$5)`,
    ["csv", "dashboard", "{}", siteId, ids[5]],
  );
  expect(exported.rows[0]).toMatchObject({ outcome: "applied", reason_code: "export_queued", status: "queued" });

  const replan = await database!.query<{ suggestion_id: string }>(
    `select suggestion_id from public.create_laundry_replan_suggestion($1,$2,$3)`,
    [siteId, "評估產能", ids[6]],
  );
  const snapshot = await database!.query<{ id: string }>(
    `select id from public.laundry_capacity_snapshots where operating_site_id=$1::uuid`,
    [siteId],
  );
  expect(snapshot.rows.length).toBe(1);
  const capacity = await database!.query<{ outcome: string }>(
    `select outcome from public.evaluate_laundry_capacity($1)`,
    [snapshot.rows[0].id],
  );
  expect(capacity.rows[0]?.outcome).toBe("applied");
  expect(replan.rows[0]?.suggestion_id).toBeTruthy();

  const ai = await database!.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.save_laundry_ai_suggestion($1,$2::jsonb,$3,$4::jsonb,$5,$6)`,
    [siteId, JSON.stringify({ orders: 0 }), "規則摘要", JSON.stringify(["維持現況"]), "rules-v1", ids[7]],
  );
  expect(ai.rows[0]).toMatchObject({ outcome: "applied", reason_code: "suggestion_saved" });
});

test("主管可登錄 Email 目的地，缺少信箱的 Email 通知會回退站內", async () => {
  const { supervisor, worker, ids, siteId } = await seedSite();
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [worker]);
  await database!.exec("set role authenticated");
  const workerDest = await database!.query<{ outcome: string }>(
    `select outcome from public.upsert_notification_external_destination($1,$2,$3,$4,$5,$6,$7)`,
    ["email", "夜班信箱", "night@example.com", siteId, null, true, ids[8]],
  );
  expect(workerDest.rows[0]?.outcome).toBe("denied");

  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  const invalid = await database!.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.upsert_notification_external_destination($1,$2,$3,$4,$5,$6,$7)`,
    ["email", "壞信箱", "not-an-email", siteId, null, true, ids[9]],
  );
  expect(invalid.rows[0]).toMatchObject({ outcome: "denied", reason_code: "invalid_destination" });

  const saved = await database!.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.upsert_notification_external_destination($1,$2,$3,$4,$5,$6,$7)`,
    ["email", "夜班信箱", "Night@Example.com", siteId, null, true, ids[10]],
  );
  expect(saved.rows[0]).toMatchObject({ outcome: "applied", reason_code: "configured" });
  const stored = await database!.query<{ destination: string }>(
    `select destination from public.notification_external_destinations where label='夜班信箱'`,
  );
  expect(stored.rows[0]?.destination).toBe("night@example.com");

  await database!.exec("reset role");
  const outbox = await database!.query<{ id: string }>(
    `insert into public.notification_outbox(
       idempotency_key,event_key,operating_site_id,channel,severity,content_summary
     ) values ('email-missing','order_overdue',$1,'email','high','測試缺少信箱')
     returning id`,
    [siteId],
  );
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  await database!.exec("set role authenticated");
  const dispatched = await database!.query<{ status: string; reason_code: string; fallback_channel: string }>(
    `select status, reason_code, fallback_channel from public.dispatch_notification_with_fallback($1)`,
    [outbox.rows[0].id],
  );
  expect(dispatched.rows[0]).toMatchObject({
    status: "failed",
    reason_code: "fallback_created",
    fallback_channel: "in_app",
  });
});

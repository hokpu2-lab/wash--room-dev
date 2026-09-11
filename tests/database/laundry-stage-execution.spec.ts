import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("洗衣員掃相容洗衣機 QR 後開始清洗並原子占用設備", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000901";
  const supervisorProfileId = "40000000-0000-4000-8000-000000000901";
  const workerAuthUserId = "10000000-0000-4000-8000-000000000902";
  const workerProfileId = "40000000-0000-4000-8000-000000000902";
  const procedureDraftRequestId = "60000000-0000-4000-8000-000000000901";
  const procedurePublishRequestId = "60000000-0000-4000-8000-000000000902";
  const cartRequestId = "60000000-0000-4000-8000-000000000903";
  const orderRequestId = "60000000-0000-4000-8000-000000000904";
  const receiveRequestId = "60000000-0000-4000-8000-000000000905";
  const equipmentRequestId = "60000000-0000-4000-8000-000000000906";
  const startRequestId = "60000000-0000-4000-8000-000000000907";

  await database.exec(`
    insert into auth.users (id, email) values
      ('${supervisorAuthUserId}', 'stage.supervisor@example.com'),
      ('${workerAuthUserId}', 'stage.worker@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id) values
      ('${supervisorProfileId}', 'stage.supervisor@example.com', '${supervisorAuthUserId}'),
      ('${workerProfileId}', 'stage.worker@example.com', '${workerAuthUserId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${supervisorProfileId}', 'laundry_supervisor', id from public.operating_sites where code = 'MAIN';
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${workerProfileId}', 'laundry_worker', id from public.operating_sites where code = 'MAIN';
    insert into public.institutions (code, name, operating_site_id)
      select 'STAGE-CARE', '階段測試機構', id from public.operating_sites where code = 'MAIN';
  `);

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisorAuthUserId]);
  await database.exec("set role authenticated");
  const stages = [{
    stage_order: 1,
    name: "清洗",
    standard_minutes: 45,
    equipment_type: "washer",
    compatibility_conditions: { category_codes: ["SOILED"] },
    transition_mode: "manual",
    requires_operator_confirmation: true,
  }];
  const draft = await database.query<{ procedure_template_id: string; procedure_version_id: string }>(
    `select * from public.create_procedure_template_draft(null, $1, $2, $3, $4::jsonb, $5, $6)`,
    ["MAIN", "SOILED", "階段測試清洗", JSON.stringify(stages), procedureDraftRequestId, "建立階段測試程序"],
  );
  await database.query(
    `select * from public.publish_procedure_template_version($1, $2, $3)`,
    [draft.rows[0].procedure_version_id, procedurePublishRequestId, "發布階段測試程序"],
  );
  const cart = await database.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id from public.register_laundry_cart($1, $2, $3, $4)`,
    ["STAGE-CART-01", "STAGE-CARE", cartRequestId, "建立階段測試車"],
  );
  const cartQr = await database.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_cart_qr($1)`,
    [cart.rows[0].laundry_cart_id],
  );
  await database.exec("set role anon");
  await database.query(`select * from public.create_laundry_order_from_cart_qr($1, $2)`, [cartQr.rows[0].qr_token, orderRequestId]);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [workerAuthUserId]);
  await database.exec("set role authenticated");
  const received = await database.query<{ laundry_order_id: string }>(
    `select laundry_order_id from public.receive_laundry_order_from_cart_qr($1, $2::jsonb, $3)`,
    [cartQr.rows[0].qr_token, JSON.stringify(["SOILED"]), receiveRequestId],
  );
  const batch = await database.query<{ id: string }>(
    `select id from public.laundry_batches where laundry_order_id = $1::uuid`,
    [received.rows[0].laundry_order_id],
  );
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisorAuthUserId]);
  await database.exec("set role authenticated");
  const equipment = await database.query<{ laundry_equipment_id: string }>(
    `select laundry_equipment_id from public.register_laundry_equipment(
      $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8
    )`,
    ["Washer STAGE 01", "MAIN", "washer", 18, JSON.stringify(["SOILED"]), JSON.stringify([draft.rows[0].procedure_template_id]), equipmentRequestId, "建立階段測試洗衣機"],
  );
  const equipmentQr = await database.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_equipment_qr($1)`,
    [equipment.rows[0].laundry_equipment_id],
  );
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [workerAuthUserId]);

  const started = await database.query<{
    laundry_batch_id: string;
    stage_run_id: string;
    laundry_equipment_id: string;
    stage_order: number;
    already_applied: boolean;
    outcome: string;
    status: string;
    reason_code: string;
  }>(
    `select * from public.start_laundry_batch_washing_from_equipment_qr($1, $2, $3)`,
    [equipmentQr.rows[0].qr_token, batch.rows[0].id, startRequestId],
  );
  const state = await database.query<{ batch_status: string; equipment_occupied: boolean; stage_status: string; stage_equipment_id: string }>(
    `select batch.status as batch_status, equipment.occupied as equipment_occupied,
       run.status as stage_status, run.laundry_equipment_id as stage_equipment_id
     from public.laundry_batches batch
     join public.laundry_batch_stage_runs run on run.id = batch.active_stage_run_id
     join public.laundry_equipment equipment on equipment.id = run.laundry_equipment_id
     where batch.id = $1::uuid`,
    [batch.rows[0].id],
  );

  expect(started.rows).toEqual([{
    laundry_batch_id: batch.rows[0].id,
    stage_run_id: expect.any(String),
    laundry_equipment_id: equipment.rows[0].laundry_equipment_id,
    stage_order: 1,
    already_applied: false,
    outcome: "applied",
    status: "in_progress",
    reason_code: "washing_started",
  }]);
  expect(state.rows).toEqual([{
    batch_status: "in_progress",
    equipment_occupied: true,
    stage_status: "in_progress",
    stage_equipment_id: equipment.rows[0].laundry_equipment_id,
  }]);

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisorAuthUserId]);
  const deletion = await database.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.delete_unused_laundry_equipment($1,$2,$3,$4)`,
    [
      equipment.rows[0].laundry_equipment_id,
      "WASHER STAGE 01",
      "60000000-0000-4000-8000-000000000908",
      "嘗試刪除已有送洗紀錄的設備",
    ],
  );
  expect(deletion.rows).toEqual([{ outcome: "denied", reason_code: "in_use" }]);
  expect((await database.query(`select occupied from public.laundry_equipment where id=$1`, [equipment.rows[0].laundry_equipment_id])).rows)
    .toEqual([{ occupied: true }]);
});

test("未指定能力的洗衣機可完成同據點洗烘程序批次", async () => {
  database = await createTestDatabase();
  const supervisor = "10000000-0000-4000-8000-000000000911";
  const supervisorProfile = "40000000-0000-4000-8000-000000000911";
  const worker = "10000000-0000-4000-8000-000000000912";
  const workerProfile = "40000000-0000-4000-8000-000000000912";
  const ids = [
    "60000000-0000-4000-8000-000000000911",
    "60000000-0000-4000-8000-000000000912",
    "60000000-0000-4000-8000-000000000913",
    "60000000-0000-4000-8000-000000000914",
    "60000000-0000-4000-8000-000000000915",
    "60000000-0000-4000-8000-000000000916",
    "60000000-0000-4000-8000-000000000917",
  ];

  await database.exec(`
    insert into auth.users (id, email) values
      ('${supervisor}', 'open.washer.supervisor@example.com'),
      ('${worker}', 'open.washer.worker@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id) values
      ('${supervisorProfile}', 'open.washer.supervisor@example.com', '${supervisor}'),
      ('${workerProfile}', 'open.washer.worker@example.com', '${worker}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${supervisorProfile}', 'laundry_supervisor', id from public.operating_sites where code = 'MAIN';
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${workerProfile}', 'laundry_worker', id from public.operating_sites where code = 'MAIN';
    insert into public.institutions (code, name, operating_site_id)
      select 'OPEN-CARE', '開放能力測試機構', id from public.operating_sites where code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisor]);
  await database.exec("set role authenticated");

  const stages = [
    {
      stage_order: 1,
      name: "清洗",
      standard_minutes: 45,
      equipment_type: "washer",
      compatibility_conditions: {},
      transition_mode: "manual",
      requires_operator_confirmation: true,
    },
    {
      stage_order: 2,
      name: "烘乾",
      standard_minutes: 30,
      equipment_type: "dryer",
      compatibility_conditions: {},
      transition_mode: "manual",
      requires_operator_confirmation: true,
    },
  ];
  const draft = await database.query<{ procedure_template_id: string; procedure_version_id: string }>(
    `select * from public.create_procedure_template_draft(null,$1,$2,$3,$4::jsonb,$5,$6)`,
    ["MAIN", "SOILED", "標準洗烘", JSON.stringify(stages), ids[0], "建立洗烘程序"],
  );
  await database.query(`select * from public.publish_procedure_template_version($1,$2,$3)`, [
    draft.rows[0].procedure_version_id,
    ids[1],
    "發布洗烘程序",
  ]);
  const cart = await database.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id from public.register_laundry_cart($1,$2,$3,$4)`,
    ["OPEN-CART-01", "OPEN-CARE", ids[2], "建立測試車"],
  );
  const cartQr = await database.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_cart_qr($1)`,
    [cart.rows[0].laundry_cart_id],
  );
  await database.exec("set role anon");
  await database.query(`select * from public.create_laundry_order_from_cart_qr($1,$2)`, [
    cartQr.rows[0].qr_token,
    ids[3],
  ]);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [worker]);
  await database.exec("set role authenticated");
  const received = await database.query<{ laundry_order_id: string }>(
    `select laundry_order_id from public.receive_laundry_order_from_cart_qr($1,$2::jsonb,$3)`,
    [cartQr.rows[0].qr_token, JSON.stringify(["SOILED"]), ids[4]],
  );
  const batch = await database.query<{ id: string }>(
    `select id from public.laundry_batches where laundry_order_id = $1::uuid`,
    [received.rows[0].laundry_order_id],
  );
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisor]);
  const equipment = await database.query<{ laundry_equipment_id: string }>(
    `select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    ["Washer OPEN 01", "MAIN", "washer", 18, "[]", "[]", ids[5], "登錄未限制洗衣機"],
  );
  const equipmentQr = await database.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_equipment_qr($1)`,
    [equipment.rows[0].laundry_equipment_id],
  );
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [worker]);

  const started = await database.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.start_laundry_batch_washing_from_equipment_qr($1,$2,$3)`,
    [equipmentQr.rows[0].qr_token, batch.rows[0].id, ids[6]],
  );

  expect(started.rows).toEqual([{ outcome: "applied", reason_code: "washing_started" }]);

  const finished = await database.query<{ outcome: string; reason_code: string; status: string }>(
    `select outcome, reason_code, status from public.complete_laundry_batch_stage_from_equipment_qr($1,$2,$3)`,
    [equipmentQr.rows[0].qr_token, batch.rows[0].id, "60000000-0000-4000-8000-000000000918"],
  );
  expect(finished.rows).toEqual([
    { outcome: "applied", reason_code: "stage_completed", status: "not_started" },
  ]);

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisor]);
  const dryer = await database.query<{ laundry_equipment_id: string }>(
    `select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    ["Dryer OPEN 01", "MAIN", "dryer", 18, "[]", "[]", "60000000-0000-4000-8000-000000000919", "登錄未限制烘衣機"],
  );
  const dryerQr = await database.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_equipment_qr($1)`,
    [dryer.rows[0].laundry_equipment_id],
  );
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [worker]);

  const dryingStarted = await database.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.start_laundry_batch_drying_from_equipment_qr($1,$2,$3)`,
    [dryerQr.rows[0].qr_token, batch.rows[0].id, "60000000-0000-4000-8000-000000000920"],
  );
  expect(dryingStarted.rows).toEqual([{ outcome: "applied", reason_code: "drying_started" }]);

  const dryingFinished = await database.query<{ outcome: string; reason_code: string; status: string }>(
    `select outcome, reason_code, status from public.complete_laundry_batch_stage_from_equipment_qr($1,$2,$3)`,
    [dryerQr.rows[0].qr_token, batch.rows[0].id, "60000000-0000-4000-8000-000000000921"],
  );
  expect(dryingFinished.rows).toEqual([
    { outcome: "applied", reason_code: "procedure_completed", status: "completed" },
  ]);

  const completedState = await database.query<{
    batch_status: string;
    completed_at: Date | null;
    loaded_at: Date | null;
    active_stage_run_id: string | null;
    equipment_occupied: boolean;
    order_status: string;
  }>(
    `select batch.status as batch_status, batch.completed_at, batch.loaded_at, batch.active_stage_run_id,
       equipment.occupied as equipment_occupied, laundry_order.status as order_status
     from public.laundry_batches batch
     join public.laundry_orders laundry_order on laundry_order.id = batch.laundry_order_id
     join public.laundry_equipment equipment on equipment.id = '${dryer.rows[0].laundry_equipment_id}'::uuid
     where batch.id = $1::uuid`,
    [batch.rows[0].id],
  );
  expect(completedState.rows).toEqual([{
    batch_status: "completed",
    completed_at: expect.any(Date),
    loaded_at: null,
    active_stage_run_id: null,
    equipment_occupied: false,
    order_status: "ready_for_pickup",
  }]);

  await database.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await database.exec("set role anon");
  const dispatched = await database.query<{ dispatch: { outcome: string; next_path: string; mode: string } }>(
    `select public.dispatch_laundry_cart_qr($1) as dispatch`,
    [cartQr.rows[0].qr_token],
  );
  expect(dispatched.rows).toEqual([{
    dispatch: { outcome: "ok", next_path: "/scan/pickup", mode: "pickup" },
  }]);

  const picked = await database.query<{ status: string; reason_code: string }>(
    `select status, reason_code from public.pickup_laundry_order_from_cart_qr($1,$2)`,
    [cartQr.rows[0].qr_token, "60000000-0000-4000-8000-000000000922"],
  );
  expect(picked.rows).toEqual([{ status: "picked_up", reason_code: "picked_up" }]);
});

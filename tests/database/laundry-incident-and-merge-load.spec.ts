import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

async function seedWorkerFlow(label: string) {
  database = await createTestDatabase();
  const supervisor = "10000000-0000-4000-8000-000000000941";
  const supervisorProfile = "40000000-0000-4000-8000-000000000941";
  const worker = "10000000-0000-4000-8000-000000000942";
  const workerProfile = "40000000-0000-4000-8000-000000000942";
  const ids = Array.from({ length: 16 }, (_, index) => `60000000-0000-4000-8000-0000000012${10 + index}`);
  await database.exec(`
    insert into auth.users (id,email) values ('${supervisor}','${label}.supervisor@example.com'),('${worker}','${label}.worker@example.com');
    insert into public.user_access_profiles (id,email,auth_user_id) values ('${supervisorProfile}','${label}.supervisor@example.com','${supervisor}'),('${workerProfile}','${label}.worker@example.com','${worker}');
    insert into public.access_memberships (user_access_profile_id,role,operating_site_id) select '${supervisorProfile}','laundry_supervisor',id from public.operating_sites where code='MAIN';
    insert into public.access_memberships (user_access_profile_id,role,operating_site_id) select '${workerProfile}','laundry_worker',id from public.operating_sites where code='MAIN';
    insert into public.institutions (code,name,operating_site_id) select '${label.toUpperCase()}-CARE','${label}機構',id from public.operating_sites where code='MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  await database.exec("set role authenticated");
  const stages = [
    {
      stage_order: 1,
      name: "清洗",
      standard_minutes: 30,
      equipment_type: "washer",
      compatibility_conditions: { category_codes: ["SOILED"] },
      transition_mode: "manual",
      requires_operator_confirmation: true,
    },
  ];
  const draft = await database.query<{ procedure_template_id: string; procedure_version_id: string }>(
    `select * from public.create_procedure_template_draft(null,$1,$2,$3,$4::jsonb,$5,$6)`,
    ["MAIN", "SOILED", `${label}程序`, JSON.stringify(stages), ids[0], "建立程序"],
  );
  await database.query(`select * from public.publish_procedure_template_version($1,$2,$3)`, [
    draft.rows[0].procedure_version_id,
    ids[1],
    "發布程序",
  ]);
  return { supervisor, worker, ids, draft };
}

test("應用程式 named arguments 可記錄異常，critical 不會因缺欄位炸掉", async () => {
  const { worker, supervisor, ids, draft } = await seedWorkerFlow("inc");
  const cart = await database!.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id from public.register_laundry_cart($1,$2,$3,$4)`,
    ["INC-CART", "INC-CARE", ids[2], "建立異常車"],
  );
  const cartQr = await database!.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_cart_qr($1)`,
    [cart.rows[0].laundry_cart_id],
  );
  await database!.exec("set role anon");
  await database!.query(`select laundry_order_id from public.create_laundry_order_from_cart_qr($1,$2)`, [
    cartQr.rows[0].qr_token,
    ids[3],
  ]);
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [worker]);
  await database!.exec("set role authenticated");
  const received = await database!.query<{ laundry_order_id: string }>(
    `select laundry_order_id from public.receive_laundry_order_from_cart_qr($1,$2::jsonb,$3)`,
    [cartQr.rows[0].qr_token, JSON.stringify(["SOILED"]), ids[4]],
  );
  const batch = await database!.query<{ id: string }>(
    `select id from public.laundry_batches where laundry_order_id=$1::uuid`,
    [received.rows[0].laundry_order_id],
  );
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  const equipment = await database!.query<{ laundry_equipment_id: string }>(
    `select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    ["Washer INC 01", "MAIN", "washer", 18, JSON.stringify(["SOILED"]), JSON.stringify([draft.rows[0].procedure_template_id]), ids[5], "建立異常洗衣機"],
  );
  const equipmentQr = await database!.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_equipment_qr($1)`,
    [equipment.rows[0].laundry_equipment_id],
  );
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [worker]);
  await database!.query(`select * from public.start_laundry_batch_washing_from_equipment_qr($1,$2,$3)`, [
    equipmentQr.rows[0].qr_token,
    batch.rows[0].id,
    ids[6],
  ]);

  const recorded = await database!.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.record_laundry_batch_incident(
      target_laundry_batch_id := $1::uuid,
      target_incident_type := 'equipment_failed',
      target_responsibility := '設備',
      incident_description := '馬達過熱停機',
      change_request_id := $2::uuid
    )`,
    [batch.rows[0].id, ids[7]],
  );
  expect(recorded.rows).toEqual([{ outcome: "applied", reason_code: "recorded" }]);
  const incident = await database!.query<{ severity: string }>(
    `select severity from public.laundry_batch_incidents where laundry_batch_id=$1::uuid`,
    [batch.rows[0].id],
  );
  expect(incident.rows[0]?.severity).toBe("critical");
});

test("合批後必須各自掃描來源車才能裝車，不能讓另一台車提前完成", async () => {
  const { worker, supervisor, ids, draft } = await seedWorkerFlow("merge");
  const cartA = await database!.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id from public.register_laundry_cart($1,$2,$3,$4)`,
    ["MERGE-CART-A", "MERGE-CARE", ids[2], "建立合批車A"],
  );
  const cartB = await database!.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id from public.register_laundry_cart($1,$2,$3,$4)`,
    ["MERGE-CART-B", "MERGE-CARE", ids[3], "建立合批車B"],
  );
  const qrA = await database!.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_cart_qr($1)`,
    [cartA.rows[0].laundry_cart_id],
  );
  const qrB = await database!.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_cart_qr($1)`,
    [cartB.rows[0].laundry_cart_id],
  );
  await database!.exec("set role anon");
  await database!.query(`select laundry_order_id from public.create_laundry_order_from_cart_qr($1,$2)`, [qrA.rows[0].qr_token, ids[4]]);
  await database!.query(`select laundry_order_id from public.create_laundry_order_from_cart_qr($1,$2)`, [qrB.rows[0].qr_token, ids[5]]);
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [worker]);
  await database!.exec("set role authenticated");
  const orderA = await database!.query<{ laundry_order_id: string }>(
    `select laundry_order_id from public.receive_laundry_order_from_cart_qr($1,$2::jsonb,$3)`,
    [qrA.rows[0].qr_token, JSON.stringify(["SOILED"]), ids[6]],
  );
  const orderB = await database!.query<{ laundry_order_id: string }>(
    `select laundry_order_id from public.receive_laundry_order_from_cart_qr($1,$2::jsonb,$3)`,
    [qrB.rows[0].qr_token, JSON.stringify(["SOILED"]), ids[7]],
  );
  const batchA = await database!.query<{ id: string }>(`select id from public.laundry_batches where laundry_order_id=$1::uuid`, [orderA.rows[0].laundry_order_id]);
  const batchB = await database!.query<{ id: string }>(`select id from public.laundry_batches where laundry_order_id=$1::uuid`, [orderB.rows[0].laundry_order_id]);
  await database!.query(`select * from public.merge_compatible_laundry_batches($1,$2,$3)`, [batchA.rows[0].id, batchB.rows[0].id, ids[8]]);
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [supervisor]);
  const equipment = await database!.query<{ laundry_equipment_id: string }>(
    `select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    ["Washer MERGE 01", "MAIN", "washer", 18, JSON.stringify(["SOILED"]), JSON.stringify([draft.rows[0].procedure_template_id]), ids[9], "建立合批洗衣機"],
  );
  const equipmentQr = await database!.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_equipment_qr($1)`,
    [equipment.rows[0].laundry_equipment_id],
  );
  await database!.query(`select set_config('request.jwt.claim.sub',$1,false)`, [worker]);
  await database!.query(`select * from public.start_laundry_batch_washing_from_equipment_qr($1,$2,$3)`, [
    equipmentQr.rows[0].qr_token,
    batchA.rows[0].id,
    ids[10],
  ]);
  const firstLoad = await database!.query<{ batch_status: string; order_status: string; reason_code: string }>(
    `select batch_status, order_status, reason_code from public.load_laundry_batch_to_source_cart($1,$2,$3)`,
    [batchA.rows[0].id, qrA.rows[0].qr_token, ids[11]],
  );
  expect(firstLoad.rows[0]?.reason_code).toBe("loaded");
  expect(firstLoad.rows[0]?.batch_status).not.toBe("loaded");
  const statusesAfterA = await database!.query<{ id: string; status: string }>(
    `select id, status from public.laundry_orders where id in ($1::uuid,$2::uuid) order by created_at`,
    [orderA.rows[0].laundry_order_id, orderB.rows[0].laundry_order_id],
  );
  expect(statusesAfterA.rows.find((row) => row.id === orderA.rows[0].laundry_order_id)?.status).toBe("ready_for_pickup");
  expect(statusesAfterA.rows.find((row) => row.id === orderB.rows[0].laundry_order_id)?.status).not.toBe("ready_for_pickup");

  const secondLoad = await database!.query<{ batch_status: string; order_status: string }>(
    `select batch_status, order_status from public.load_laundry_batch_to_source_cart($1,$2,$3)`,
    [batchA.rows[0].id, qrB.rows[0].qr_token, ids[12]],
  );
  expect(secondLoad.rows[0]).toMatchObject({ batch_status: "loaded" });
  const orderBAfter = await database!.query<{ status: string }>(
    `select status from public.laundry_orders where id=$1::uuid`,
    [orderB.rows[0].laundry_order_id],
  );
  expect(orderBAfter.rows[0]?.status).toBe("ready_for_pickup");
});

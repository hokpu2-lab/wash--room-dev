import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("消毒程序先占用消毒鍋，浸泡完成後原子切換洗衣機", async () => {
  database = await createTestDatabase();
  const supervisor = "10000000-0000-4000-8000-000000000911";
  const supervisorProfile = "40000000-0000-4000-8000-000000000911";
  const worker = "10000000-0000-4000-8000-000000000912";
  const workerProfile = "40000000-0000-4000-8000-000000000912";
  const ids = Array.from({ length: 9 }, (_, index) => `60000000-0000-4000-8000-0000000009${20 + index}`);
  await database.exec(`
    insert into auth.users (id, email) values ('${supervisor}', 'disinfection.supervisor@example.com'), ('${worker}', 'disinfection.worker@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id) values
      ('${supervisorProfile}', 'disinfection.supervisor@example.com', '${supervisor}'),
      ('${workerProfile}', 'disinfection.worker@example.com', '${worker}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${supervisorProfile}', 'laundry_supervisor', id from public.operating_sites where code = 'MAIN';
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${workerProfile}', 'laundry_worker', id from public.operating_sites where code = 'MAIN';
    insert into public.institutions (code, name, operating_site_id)
      select 'DISINFECT-CARE', '消毒測試機構', id from public.operating_sites where code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisor]);
  await database.exec("set role authenticated");
  const stages = [
    { stage_order: 1, name: "浸泡", standard_minutes: 20, equipment_type: "disinfection_tank", compatibility_conditions: { category_codes: ["DISINFECT"] }, transition_mode: "manual", requires_operator_confirmation: true },
    { stage_order: 2, name: "清洗", standard_minutes: 45, equipment_type: "washer", compatibility_conditions: { category_codes: ["DISINFECT"] }, transition_mode: "manual", requires_operator_confirmation: true },
  ];
  const draft = await database.query<{ procedure_template_id: string; procedure_version_id: string }>(
    `select * from public.create_procedure_template_draft(null, $1, $2, $3, $4::jsonb, $5, $6)`,
    ["MAIN", "DISINFECT", "消毒測試程序", JSON.stringify(stages), ids[0], "建立消毒程序"],
  );
  await database.query(`select * from public.publish_procedure_template_version($1, $2, $3)`, [draft.rows[0].procedure_version_id, ids[1], "發布消毒程序"]);
  const cart = await database.query<{ laundry_cart_id: string }>(`select laundry_cart_id from public.register_laundry_cart($1,$2,$3,$4)`, ["DISINFECT-CART", "DISINFECT-CARE", ids[2], "建立消毒測試車"]);
  const cartQr = await database.query<{ qr_token: string }>(`select qr_token from public.get_current_laundry_cart_qr($1)`, [cart.rows[0].laundry_cart_id]);
  await database.exec("set role anon");
  await database.query(`select * from public.create_laundry_order_from_cart_qr($1,$2)`, [cartQr.rows[0].qr_token, ids[3]]);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [worker]);
  await database.exec("set role authenticated");
  const received = await database.query<{ laundry_order_id: string }>(`select laundry_order_id from public.receive_laundry_order_from_cart_qr($1,$2::jsonb,$3)`, [cartQr.rows[0].qr_token, JSON.stringify(["DISINFECT"]), ids[4]]);
  const batch = await database.query<{ id: string }>(`select id from public.laundry_batches where laundry_order_id=$1::uuid`, [received.rows[0].laundry_order_id]);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisor]);
  const tank = await database.query<{ laundry_equipment_id: string }>(`select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`, ["Tank DISINFECT 01", "MAIN", "disinfection_tank", 80, JSON.stringify(["DISINFECT"]), JSON.stringify([draft.rows[0].procedure_template_id]), ids[5], "建立消毒鍋"]);
  const washer = await database.query<{ laundry_equipment_id: string }>(`select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`, ["Washer DISINFECT 01", "MAIN", "washer", 18, JSON.stringify(["DISINFECT"]), JSON.stringify([draft.rows[0].procedure_template_id]), ids[6], "建立消毒洗衣機"]);
  const tankQr = await database.query<{ qr_token: string }>(`select qr_token from public.get_current_laundry_equipment_qr($1)`, [tank.rows[0].laundry_equipment_id]);
  const washerQr = await database.query<{ qr_token: string }>(`select qr_token from public.get_current_laundry_equipment_qr($1)`, [washer.rows[0].laundry_equipment_id]);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [worker]);
  const soaking = await database.query<{ status: string; reason_code: string }>(`select status, reason_code from public.start_laundry_batch_disinfection_from_equipment_qr($1,$2,$3)`, [tankQr.rows[0].qr_token, batch.rows[0].id, ids[7]]);
  expect(soaking.rows).toEqual([{ status: "in_progress", reason_code: "soak_started" }]);
  const washing = await database.query<{ stage_order: number; reason_code: string; status: string }>(`select stage_order, reason_code, status from public.complete_laundry_disinfection_and_start_washing($1,$2,$3)`, [batch.rows[0].id, washerQr.rows[0].qr_token, ids[8]]);
  const equipmentState = await database.query<{ equipment_type: string; occupied: boolean }>(`select equipment_type, occupied from public.laundry_equipment where id in ($1::uuid,$2::uuid) order by equipment_type`, [tank.rows[0].laundry_equipment_id, washer.rows[0].laundry_equipment_id]);
  expect(washing.rows).toEqual([{ stage_order: 2, reason_code: "washing_started", status: "in_progress" }]);
  expect(equipmentState.rows).toEqual([{ equipment_type: "disinfection_tank", occupied: false }, { equipment_type: "washer", occupied: true }]);
});

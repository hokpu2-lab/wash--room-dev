import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("授權洗衣員掃待收件車卡並選分類後建立鎖定程序版本的初始批次", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000801";
  const supervisorProfileId = "40000000-0000-4000-8000-000000000801";
  const workerAuthUserId = "10000000-0000-4000-8000-000000000802";
  const workerProfileId = "40000000-0000-4000-8000-000000000802";
  const procedureDraftRequestId = "60000000-0000-4000-8000-000000000801";
  const procedurePublishRequestId = "60000000-0000-4000-8000-000000000802";
  const cartRequestId = "60000000-0000-4000-8000-000000000803";
  const orderRequestId = "60000000-0000-4000-8000-000000000804";
  const receiveRequestId = "60000000-0000-4000-8000-000000000805";

  await database.exec(`
    insert into auth.users (id, email) values
      ('${supervisorAuthUserId}', 'receipt.supervisor@example.com'),
      ('${workerAuthUserId}', 'receipt.worker@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id) values
      ('${supervisorProfileId}', 'receipt.supervisor@example.com', '${supervisorAuthUserId}'),
      ('${workerProfileId}', 'receipt.worker@example.com', '${workerAuthUserId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${supervisorProfileId}', 'laundry_supervisor', id from public.operating_sites where code = 'MAIN';
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${workerProfileId}', 'laundry_worker', id from public.operating_sites where code = 'MAIN';
    insert into public.institutions (code, name, operating_site_id)
      select 'RECEIPT-CARE', '收單測試機構', id from public.operating_sites where code = 'MAIN';
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
    ["MAIN", "SOILED", "汙衣標準清洗", JSON.stringify(stages), procedureDraftRequestId, "建立收單測試程序"],
  );
  await database.query(
    `select * from public.publish_procedure_template_version($1, $2, $3)`,
    [draft.rows[0].procedure_version_id, procedurePublishRequestId, "發布收單測試程序"],
  );
  const cart = await database.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id from public.register_laundry_cart($1, $2, $3, $4)`,
    ["RECEIPT-CART-01", "RECEIPT-CARE", cartRequestId, "建立收單測試車"],
  );
  const qr = await database.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_cart_qr($1)`,
    [cart.rows[0].laundry_cart_id],
  );
  await database.exec("set role anon");
  await database.query(
    `select * from public.create_laundry_order_from_cart_qr($1, $2)`,
    [qr.rows[0].qr_token, orderRequestId],
  );

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [workerAuthUserId]);
  await database.exec("set role authenticated");
  const received = await database.query<{
    laundry_order_id: string;
    batch_count: number;
    already_applied: boolean;
    outcome: string;
    status: string;
  }>(
    `select * from public.receive_laundry_order_from_cart_qr($1, $2::jsonb, $3)`,
    [qr.rows[0].qr_token, JSON.stringify(["soiled"]), receiveRequestId],
  );
  const batches = await database.query<{
    status: string;
    quantity_scale: string;
    laundry_category_code: string;
    procedure_version_id: string;
    source_laundry_cart_id: string;
  }>(
    `select batch.status, batch.quantity_scale, category.code as laundry_category_code,
       batch.procedure_version_id, batch.source_laundry_cart_id
     from public.laundry_batches batch
     join public.laundry_categories category on category.id = batch.laundry_category_id
     where batch.laundry_order_id = $1::uuid`,
    [received.rows[0]?.laundry_order_id],
  );
  const order = await database.query<{ status: string }>(
    `select status from public.laundry_orders where id = $1::uuid`,
    [received.rows[0]?.laundry_order_id],
  );

  expect(received.rows).toEqual([
    {
      laundry_order_id: expect.any(String),
      batch_count: 1,
      already_applied: false,
      outcome: "applied",
      status: "awaiting_cleaning",
      reason_code: "received",
    },
  ]);
  expect(batches.rows).toEqual([
    {
      status: "not_started",
      quantity_scale: "one_cart",
      laundry_category_code: "SOILED",
      procedure_version_id: draft.rows[0].procedure_version_id,
      source_laundry_cart_id: cart.rows[0].laundry_cart_id,
    },
  ]);
  expect(order.rows).toEqual([{ status: "awaiting_cleaning" }]);
});

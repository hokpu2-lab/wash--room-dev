import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("有效固定車卡 QR 可匿名建立待收件洗衣單並快照機構與作業據點", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000701";
  const profileId = "40000000-0000-4000-8000-000000000701";
  const cartRequestId = "60000000-0000-4000-8000-000000000701";
  const orderRequestId = "60000000-0000-4000-8000-000000000702";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${authUserId}', 'order.admin@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id)
    values ('${profileId}', 'order.admin@example.com', '${authUserId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
    select '${profileId}', 'laundry_supervisor', id
    from public.operating_sites
    where code = 'MAIN';
    insert into public.institutions (code, name, operating_site_id)
    select 'CARE-A', '照護機構 A', id
    from public.operating_sites
    where code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUserId]);
  await database.exec("set role authenticated");
  const cart = await database.query<{ laundry_cart_id: string | null; outcome: string }>(
    `select * from public.register_laundry_cart($1, $2, $3, $4)`,
    ["ORDER-CART-01", "CARE-A", cartRequestId, "建立送單測試車"],
  );
  const cartId = cart.rows[0].laundry_cart_id;
  expect(cartId).toEqual(expect.any(String));
  const pairing = await database.query<{ institution_id: string; operating_site_id: string }>(
    `select institution.id as institution_id, institution.operating_site_id
     from public.institutions institution where institution.code = 'CARE-A'`,
  );
  const credential = await database.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_cart_qr($1)`,
    [cartId],
  );
  expect(credential.rows).toHaveLength(1);

  await database.exec("set role anon");
  const created = await database.query<{
    laundry_order_id: string | null;
    order_number: string | null;
    status: string;
    already_applied: boolean;
    outcome: string;
    reason_code: string;
  }>(
    `select * from public.create_laundry_order_from_cart_qr($1, $2)`,
    [credential.rows[0].qr_token, orderRequestId],
  );

  await database.exec("set role authenticated");
  const order = await database.query<{
    order_number: string;
    status: string;
    laundry_cart_id: string;
    institution_id: string;
    operating_site_id: string;
    category_codes: string[];
  }>(
    `select order_number, status, laundry_cart_id, institution_id, operating_site_id,
       '{}'::text[] as category_codes
     from public.laundry_orders
     where id = $1::uuid`,
    [created.rows[0]?.laundry_order_id],
  );

  expect(created.rows).toEqual([
    {
      laundry_order_id: expect.any(String),
      order_number: expect.stringMatching(/^MAIN-\d{8}-\d{4}$/),
      status: "awaiting_receipt",
      already_applied: false,
      outcome: "applied",
      reason_code: "created",
    },
  ]);
  expect(order.rows).toEqual([
    {
      order_number: created.rows[0].order_number,
      status: "awaiting_receipt",
      laundry_cart_id: cartId,
      institution_id: pairing.rows[0].institution_id,
      operating_site_id: pairing.rows[0].operating_site_id,
      category_codes: [],
    },
  ]);
});

test("相同匿名冪等鍵只建立一張單，同車新請求會被未結案唯一性阻擋", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000703";
  const profileId = "40000000-0000-4000-8000-000000000703";
  const cartRequestId = "60000000-0000-4000-8000-000000000703";
  const orderRequestId = "60000000-0000-4000-8000-000000000704";
  const secondOrderRequestId = "60000000-0000-4000-8000-000000000705";

  await database.exec(`
    insert into auth.users (id, email) values ('${authUserId}', 'order.replay@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id)
      values ('${profileId}', 'order.replay@example.com', '${authUserId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${profileId}', 'laundry_supervisor', id from public.operating_sites where code = 'MAIN';
    insert into public.institutions (code, name, operating_site_id)
      select 'ORDER-CARE-2', '送單測試機構 2', id from public.operating_sites where code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUserId]);
  await database.exec("set role authenticated");
  const cart = await database.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id from public.register_laundry_cart($1, $2, $3, $4)`,
    ["ORDER-CART-02", "ORDER-CARE-2", cartRequestId, "建立冪等送單測試車"],
  );
  const credential = await database.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_cart_qr($1)`,
    [cart.rows[0].laundry_cart_id],
  );
  await database.exec("set role anon");

  const first = await database.query<{ laundry_order_id: string; already_applied: boolean; reason_code: string }>(
    `select * from public.create_laundry_order_from_cart_qr($1, $2)`,
    [credential.rows[0].qr_token, orderRequestId],
  );
  const replay = await database.query<{ laundry_order_id: string; already_applied: boolean; reason_code: string }>(
    `select * from public.create_laundry_order_from_cart_qr($1, $2)`,
    [credential.rows[0].qr_token, orderRequestId],
  );
  const duplicate = await database.query<{ laundry_order_id: string | null; outcome: string; reason_code: string }>(
    `select * from public.create_laundry_order_from_cart_qr($1, $2)`,
    [credential.rows[0].qr_token, secondOrderRequestId],
  );

  expect(first.rows[0]).toMatchObject({ already_applied: false, reason_code: "created" });
  expect(replay.rows[0]).toMatchObject({ laundry_order_id: first.rows[0].laundry_order_id, already_applied: true, reason_code: "already_applied" });
  expect(duplicate.rows[0]).toMatchObject({ laundry_order_id: null, outcome: "denied", reason_code: "existing_open_order" });
});

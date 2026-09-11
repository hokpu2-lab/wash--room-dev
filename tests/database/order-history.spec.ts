import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

const periodStart = "2026-08-01T00:00:00.000Z";
const periodEnd = "2026-09-01T00:00:00.000Z";

test("已取件歷史查詢依據點與送洗機構範圍回傳日期、關鍵字與分頁結果", async () => {
  database = await createTestDatabase();
  const site = await database.query<{ id: string }>(
    "select id from public.operating_sites where code = 'MAIN'",
  );
  const siteId = site.rows[0].id;
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000951";
  const institutionSupervisorAuthUserId = "10000000-0000-4000-8000-000000000952";
  const supervisorProfileId = "40000000-0000-4000-8000-000000000951";
  const institutionSupervisorProfileId = "40000000-0000-4000-8000-000000000952";
  const institutionA = "30000000-0000-4000-8000-000000000951";
  const institutionB = "30000000-0000-4000-8000-000000000952";
  const cartA = "41000000-0000-4000-8000-000000000951";
  const cartB = "41000000-0000-4000-8000-000000000952";
  const orderA = "51000000-0000-4000-8000-000000000951";
  const orderB = "51000000-0000-4000-8000-000000000952";
  const orderOutsidePeriod = "51000000-0000-4000-8000-000000000953";

  await database.exec(`
    insert into auth.users (id, email, raw_app_meta_data) values
      ('${supervisorAuthUserId}', 'history.supervisor@example.com', '{"provider":"email","providers":["email"]}'),
      ('${institutionSupervisorAuthUserId}', 'history.institution@example.com', '{"provider":"email","providers":["email"]}');
    insert into public.user_access_profiles (id, email, auth_user_id) values
      ('${supervisorProfileId}', 'history.supervisor@example.com', '${supervisorAuthUserId}'),
      ('${institutionSupervisorProfileId}', 'history.institution@example.com', '${institutionSupervisorAuthUserId}');
    insert into public.institutions (id, code, name, operating_site_id) values
      ('${institutionA}', 'HIST-A', '歷史機構 A', '${siteId}'),
      ('${institutionB}', 'HIST-B', '歷史機構 B', '${siteId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      values ('${supervisorProfileId}', 'laundry_supervisor', '${siteId}');
    insert into public.access_memberships (user_access_profile_id, role, institution_id)
      values ('${institutionSupervisorProfileId}', 'institution_supervisor', '${institutionA}');
    insert into public.laundry_carts (id, cart_number, institution_id) values
      ('${cartA}', 'HIST-CART-A', '${institutionA}'),
      ('${cartB}', 'HIST-CART-B', '${institutionB}');
    insert into public.laundry_orders (
      id, order_number, laundry_cart_id, institution_id, operating_site_id, status, created_at, updated_at, closed_at
    ) values
      ('${orderA}', 'MAIN-20260818-0091', '${cartA}', '${institutionA}', '${siteId}', 'picked_up', '2026-08-18T05:00:00Z', '2026-08-18T08:00:00Z', '2026-08-18T08:00:00Z'),
      ('${orderB}', 'MAIN-20260819-0092', '${cartB}', '${institutionB}', '${siteId}', 'picked_up', '2026-08-19T05:00:00Z', '2026-08-19T09:00:00Z', '2026-08-19T09:00:00Z'),
      ('${orderOutsidePeriod}', 'MAIN-20260731-0093', '${cartA}', '${institutionA}', '${siteId}', 'picked_up', '2026-07-31T05:00:00Z', '2026-07-31T08:00:00Z', '2026-07-31T08:00:00Z');
    insert into public.authorization_audit_events (
      occurred_at, actor_type, operating_site_id, institution_id, laundry_order_id, action, outcome, reason, after_state
    ) values
      ('2026-08-18T05:00:00Z', 'system', '${siteId}', '${institutionA}', '${orderA}', 'laundry_order_created_from_cart_qr', 'succeeded', '匿名固定 QR 送單', '{"laundry_order_id":"${orderA}"}'),
      ('2026-08-18T08:00:00Z', 'system', '${siteId}', '${institutionA}', '${orderA}', 'laundry_order_picked_up', 'succeeded', '送洗人員掃車取件', '{"status":"picked_up"}');
  `);

  await expect(
    database.query("select public.search_laundry_order_history($1::uuid, $2::timestamptz, $3::timestamptz)", [siteId, periodStart, periodEnd]),
  ).rejects.toThrow(/authentication required/);

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisorAuthUserId]);
  await database.exec("set role authenticated");

  const supervisorResult = await database.query<{
    search_laundry_order_history: {
      outcome: string;
      queue: { total: number; items: Array<{ id: string; institution_code: string; cart_number: string; closed_at: string }> };
    };
  }>(
    "select public.search_laundry_order_history($1::uuid, $2::timestamptz, $3::timestamptz, $4::text, null, 1, 1)",
    [siteId, periodStart, periodEnd, "MAIN-202608"],
  );
  expect(supervisorResult.rows[0]?.search_laundry_order_history).toMatchObject({
    outcome: "ok",
    queue: {
      total: 2,
      items: [{ id: orderA, institution_code: "HIST-A", cart_number: "HIST-CART-A" }],
    },
  });

  const supervisorDetail = await database.query<{
    get_laundry_order_history_detail: {
      outcome: string;
      order: { id: string; order_number: string; status: string };
      batches: unknown[];
      events: Array<{ action: string; reason: string | null }>;
    };
  }>(
    "select public.get_laundry_order_history_detail($1::uuid)",
    [orderA],
  );
  expect(supervisorDetail.rows[0]?.get_laundry_order_history_detail).toMatchObject({
    outcome: "ok",
    order: { id: orderA, order_number: "MAIN-20260818-0091", status: "picked_up" },
    events: [
      { action: "laundry_order_created_from_cart_qr" },
      { action: "laundry_order_picked_up" },
    ],
  });

  await database.exec("reset role");
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [institutionSupervisorAuthUserId]);
  await database.exec("set role authenticated");

  const institutionResult = await database.query<{
    search_laundry_order_history: {
      outcome: string;
      queue: { total: number; items: Array<{ id: string; institution_code: string }> };
    };
  }>(
    "select public.search_laundry_order_history($1::uuid, $2::timestamptz, $3::timestamptz)",
    [siteId, periodStart, periodEnd],
  );
  expect(institutionResult.rows[0]?.search_laundry_order_history).toMatchObject({
    outcome: "ok",
    queue: { total: 1, items: [{ id: orderA, institution_code: "HIST-A" }] },
  });

  const denied = await database.query<{
    search_laundry_order_history: { outcome: string; reason_code: string };
  }>(
    "select public.search_laundry_order_history($1::uuid, $2::timestamptz, $3::timestamptz, null, $4::uuid)",
    [siteId, periodStart, periodEnd, institutionB],
  );
  expect(denied.rows[0]?.search_laundry_order_history).toEqual({
    outcome: "denied",
    reason_code: "institution_scope_denied",
  });

  const institutionDetailDenied = await database.query<{
    get_laundry_order_history_detail: { outcome: string; order_id: string };
  }>(
    "select public.get_laundry_order_history_detail($1::uuid)",
    [orderB],
  );
  expect(institutionDetailDenied.rows[0]?.get_laundry_order_history_detail).toEqual({
    outcome: "not_found",
    order_id: orderB,
  });
});

import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("workspace snapshot 與 mutation RPC 會自行驗證 auth.uid() 與範圍", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000901";
  const supervisorProfileId = "40000000-0000-4000-8000-000000000901";

  await database.exec(`
    insert into auth.users (id, email, raw_app_meta_data) values
      ('${supervisorAuthUserId}', 'snapshot.supervisor@example.com', '{"provider":"email","providers":["email"]}');
    insert into public.user_access_profiles (id, email, auth_user_id) values
      ('${supervisorProfileId}', 'snapshot.supervisor@example.com', '${supervisorAuthUserId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${supervisorProfileId}', 'laundry_supervisor', id from public.operating_sites where code = 'MAIN';
  `);

  await expect(database.query("select public.get_workspace_snapshot()")).rejects.toThrow(/authentication required/);
  await expect(
    database.query(
      `select * from public.receive_laundry_order_from_cart_qr(
        'wrq_v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '["SOILED"]'::jsonb,
        '60000000-0000-4000-8000-000000000901'
      )`,
    ),
  ).rejects.toThrow(/authentication required/);

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisorAuthUserId]);
  await database.exec("set role authenticated");

  const principal = await database.query<{ current_workspace_principal: { kind: string } }>(
    "select public.current_workspace_principal()",
  );
  expect(principal.rows[0]?.current_workspace_principal.kind).toBe("authorized");

  const snapshot = await database.query<{
    get_workspace_snapshot: { outcome: string; orders: { picked_up: number } };
  }>("select public.get_workspace_snapshot()");
  expect(snapshot.rows[0]?.get_workspace_snapshot.outcome).toBe("ok");
  expect(snapshot.rows[0]?.get_workspace_snapshot.orders.picked_up).toBe(0);
});

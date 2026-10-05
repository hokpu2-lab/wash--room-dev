import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;
afterEach(async () => { await database?.close(); database = undefined; });

test("訪客僅可讀取授權據點，沒有洗衣員或主管作業權限", async () => {
  database = await createTestDatabase();
  const userId = "70000000-0000-4000-8000-000000000001";
  const sites = await database.query<{ id: string; code: string }>(
    `select id, code from public.operating_sites where code in ('MAIN', 'CORP') order by code`,
  );
  const corp = sites.rows.find((site) => site.code === "CORP")!;
  const main = sites.rows.find((site) => site.code === "MAIN")!;
  await database.query(`insert into auth.users (id, email) values ($1, 'guest@auth.wash-room.invalid')`, [userId]);
  const profile = await database.query<{ id: string }>(
    `insert into public.user_access_profiles (email, auth_user_id, login_name)
     values ('guest@auth.wash-room.invalid', $1, 'guest') returning id`, [userId],
  );
  await database.query(
    `insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
     values ($1, 'guest', $2)`, [profile.rows[0].id, corp.id],
  );
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  const access = await database.query<{ own_read: boolean; other_read: boolean; worker: boolean; supervisor: boolean }>(
    `select private.has_site_access($1) as own_read,
            private.has_site_access($2) as other_read,
            private.has_laundry_worker_site_access($1) as worker,
            private.has_laundry_supervisor_site_access($1) as supervisor`, [corp.id, main.id],
  );
  expect(access.rows[0]).toEqual({ own_read: true, other_read: false, worker: false, supervisor: false });
  await database.exec("set role authenticated");
  await expect(database.query(
    `select * from public.manage_user_account(
      null, 'GuestCannotManage', null, null, true,
      '[{"role":"guest","site_code":"CORP","institution_code":null}]'::jsonb,
      '70000000-0000-4000-8000-000000000099'::uuid, '訪客不得管理帳號'
    )`,
  )).rejects.toThrow(/access scope is outside supervisor authority/);
  const unauthorizedAccount = await database.query<{ count: number }>(
    `select count(*)::integer as count from public.user_access_profiles where login_name = 'GuestCannotManage'`,
  );
  expect(unauthorizedAccount.rows[0].count).toBe(0);
});

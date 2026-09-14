import { afterEach, expect, test } from "vitest";

import {
  createTestDatabase as createBaseTestDatabase,
  type TestDatabase,
} from "../support/test-database";

let database: TestDatabase | undefined;

async function createTestDatabase() {
  const isolatedDatabase = await createBaseTestDatabase();
  return isolatedDatabase;
}

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("系統管理員 (system_administrator) 角色可建立 membership 且享有主管權限", async () => {
  database = await createTestDatabase();

  const authUserId = "10000000-0000-4000-8000-000000000099";
  const siteId = "20000000-0000-4000-8000-000000000099";

  await database.query(
    `insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at)
     values ($1, 'admin@auth.wash-room.invalid', '{"provider":"email"}'::jsonb, now())`,
    [authUserId],
  );

  await database.query(
    `insert into public.operating_sites (id, code, name, active)
     values ($1, 'MAIN_ADMIN', '總館', true)`,
    [siteId],
  );

  const profile = await database.query<{ id: string }>(
    `insert into public.user_access_profiles (email, login_name, notification_email, auth_user_id, active)
     values ('admin@auth.wash-room.invalid', 'admin', 'ad@hok.com.tw', $1, true)
     returning id`,
    [authUserId],
  );

  const membership = await database.query<{ id: string; role: string }>(
    `insert into public.access_memberships (user_access_profile_id, role, operating_site_id, active)
     values ($1, 'system_administrator', $2, true)
     returning id, role`,
    [profile.rows[0].id, siteId],
  );

  expect(membership.rows[0].role).toBe("system_administrator");

  // 設定當前操作者 auth.uid()
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    authUserId,
  ]);

  // 驗證主管權限判斷
  const hasSupervisorAccess = await database.query<{ has_access: boolean }>(
    `select private.has_laundry_supervisor_site_access($1) as has_access`,
    [siteId],
  );
  expect(hasSupervisorAccess.rows[0].has_access).toBe(true);

  // 驗證現場作業員權限判斷（收單、洗滌等作業）
  const hasWorkerAccess = await database.query<{ has_access: boolean }>(
    `select private.has_laundry_worker_site_access($1) as has_access`,
    [siteId],
  );
  expect(hasWorkerAccess.rows[0].has_access).toBe(true);

  // 驗證跨據點存取權限（即使未在該據點指派 membership，身為系統管理員依然享有所有活躍據點權限）
  const otherSiteId = "20000000-0000-4000-8000-000000000088";
  await database.query(
    `insert into public.operating_sites (id, code, name, active)
     values ($1, 'OTHER_SITE', '分館', true)`,
    [otherSiteId],
  );

  const hasOtherWorkerAccess = await database.query<{ has_access: boolean }>(
    `select private.has_laundry_worker_site_access($1) as has_access`,
    [otherSiteId],
  );
  expect(hasOtherWorkerAccess.rows[0].has_access).toBe(true);

  const hasOtherSupervisorAccess = await database.query<{ has_access: boolean }>(
    `select private.has_laundry_supervisor_site_access($1) as has_access`,
    [otherSiteId],
  );
  expect(hasOtherSupervisorAccess.rows[0].has_access).toBe(true);

  // 驗證送洗機構管理權限
  const instId = "30000000-0000-4000-8000-000000000077";
  await database.query(
    `insert into public.institutions (id, operating_site_id, code, name, active)
     values ($1, $2, 'INST_TEST', '機構測試', true)`,
    [instId, siteId],
  );
  const hasInstAccess = await database.query<{ has_access: boolean }>(
    `select private.has_institution_supervisor_access($1) as has_access`,
    [instId],
  );
  expect(hasInstAccess.rows[0].has_access).toBe(true);

  // 驗證 site access 判斷
  const hasSiteAccess = await database.query<{ has_access: boolean }>(
    `select private.has_site_access($1) as has_access`,
    [siteId],
  );
  expect(hasSiteAccess.rows[0].has_access).toBe(true);

  // 驗證 current_access_context
  const accessContext = await database.query<{ role: string; scope_code: string }>(
    `select role, scope_code from public.current_access_context()`,
  );
  expect(accessContext.rows).toEqual([
    { role: "system_administrator", scope_code: "MAIN_ADMIN" },
  ]);

  // 驗證 current_workspace_principal
  const principalResult = await database.query<{ current_workspace_principal: { kind: string; memberships: Array<{ role: string }> } }>(
    `select public.current_workspace_principal()`,
  );
  expect(principalResult.rows[0].current_workspace_principal.kind).toBe("authorized");
  expect(principalResult.rows[0].current_workspace_principal.memberships[0].role).toBe("system_administrator");

  // 驗證 notification_email 為 ad@hok.com.tw
  const profileRecord = await database.query<{ notification_email: string }>(
    `select notification_email from public.user_access_profiles where login_name = 'admin'`,
  );
  expect(profileRecord.rows[0].notification_email).toBe("ad@hok.com.tw");
});

test("既有 admin 帳號之 membership 角色自動升級為 system_administrator", async () => {
  database = await createTestDatabase();

  const authUserId = "10000000-0000-4000-8000-000000000088";

  const sites = await database.query<{ id: string; code: string }>(
    `select id, code from public.operating_sites where code in ('MAIN', 'CORP') order by code`,
  );
  const mainSiteId = sites.rows.find((s) => s.code === "MAIN")!.id;
  const corpSiteId = sites.rows.find((s) => s.code === "CORP")!.id;

  await database.query(
    `insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at)
     values ($1, 'admin@auth.wash-room.invalid', '{"provider":"email"}'::jsonb, now())`,
    [authUserId],
  );

  const profile = await database.query<{ id: string }>(
    `insert into public.user_access_profiles (email, login_name, notification_email, auth_user_id, active)
     values ('admin@auth.wash-room.invalid', 'admin', 'old@hok.com.tw', $1, true)
     returning id`,
    [authUserId],
  );

  await database.query(
    `insert into public.access_memberships (user_access_profile_id, role, operating_site_id, active) values
     ($1, 'laundry_supervisor', $2, true),
     ($1, 'laundry_supervisor', $3, true)`,
    [profile.rows[0].id, mainSiteId, corpSiteId],
  );

  // 模擬重新執行 20260831150000_add_system_administrator_role.sql 中的 update 指令
  await database.exec(`
    update public.user_access_profiles
    set notification_email = 'ad@hok.com.tw',
        updated_at = now()
    where lower(login_name) = 'admin';

    update public.access_memberships
    set role = 'system_administrator',
        updated_at = now()
    where user_access_profile_id in (
      select id from public.user_access_profiles where lower(login_name) = 'admin'
    )
    and role in ('laundry_supervisor', 'laundry_worker');
  `);

  // 設定當前操作者
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    authUserId,
  ]);

  // 驗證 list_manageable_user_accounts 回傳的 membership 角色已為 system_administrator
  const accounts = await database.query<{ login_name: string; notification_email: string; memberships: Array<{ role: string; site_code: string }> }>(
    `select login_name, notification_email, memberships from public.list_manageable_user_accounts() where login_name = 'admin'`,
  );

  expect(accounts.rows[0].notification_email).toBe("ad@hok.com.tw");
  expect(accounts.rows[0].memberships.map((m) => m.role)).toEqual([
    "system_administrator",
    "system_administrator",
  ]);
});

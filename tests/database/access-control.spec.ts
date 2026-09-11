import { afterEach, expect, test } from "vitest";

import {
  createTestDatabase as createBaseTestDatabase,
  type TestDatabase,
} from "../support/test-database";

let database: TestDatabase | undefined;

async function createTestDatabase() {
  const isolatedDatabase = await createBaseTestDatabase();
  await isolatedDatabase.exec(`
    delete from public.operating_sites
    where code in ('MAIN', 'CORP');
  `);
  return isolatedDatabase;
}

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("洗衣員 membership 必須綁作業據點而不能綁送洗機構", async () => {
  database = await createTestDatabase();

  const site = await database.query<{ id: string }>(
    `insert into public.operating_sites (code, name)
     values ('MAIN', '本館')
     returning id`,
  );
  const institution = await database.query<{ id: string }>(
    `insert into public.institutions (code, name, operating_site_id)
     values ('WARD-A', 'A 機構', $1)
     returning id`,
    [site.rows[0].id],
  );
  const profile = await database.query<{ id: string }>(
    `insert into public.user_access_profiles (email)
     values ('worker@example.com')
     returning id`,
  );

  await expect(
    database.query(
      `insert into public.access_memberships
         (user_access_profile_id, role, institution_id)
       values ($1, 'laundry_worker', $2)`,
      [profile.rows[0].id, institution.rows[0].id],
    ),
  ).rejects.toThrow(/access_memberships_role_scope_check/);
});

test("已過期的 membership 不會形成有效存取", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000001";

  await database.query(
    `insert into auth.users (id, email)
     values ($1, 'expired@example.com')`,
    [authUserId],
  );
  const site = await database.query<{ id: string }>(
    `insert into public.operating_sites (code, name)
     values ('MAIN', '本館')
     returning id`,
  );
  const profile = await database.query<{ id: string }>(
    `insert into public.user_access_profiles (email, auth_user_id)
     values ('expired@example.com', $1)
     returning id`,
    [authUserId],
  );
  await database.query(
    `insert into public.access_memberships
       (user_access_profile_id, role, operating_site_id, valid_from, valid_until)
     values ($1, 'laundry_worker', $2, now() - interval '2 days', now() - interval '1 day')`,
    [profile.rows[0].id, site.rows[0].id],
  );
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    authUserId,
  ]);

  const access = await database.query(
    "select * from public.current_access_context()",
  );

  expect(access.rows).toEqual([]);
});

test("未列入允許名單的密碼帳號會被拒絕且稽核不保存內部 Email", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000002";
  const rejectedEmail = "unknown.person@example.com";

  await database.query(
    `insert into auth.users (id, email, raw_app_meta_data)
     values ($1, $2, '{"provider":"email","providers":["email"]}'::jsonb)`,
    [authUserId, rejectedEmail],
  );
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    authUserId,
  ]);

  const decision = await database.query<{
    authorized: boolean;
    denial_code: string | null;
  }>("select * from public.authorize_current_user()");
  const audit = await database.query<{
    actor_auth_user_id: string;
    reason: string;
    recorded_data: string;
  }>(
    `select
       actor_auth_user_id,
       reason,
       concat_ws(' ', before_state::text, after_state::text) as recorded_data
     from public.authorization_audit_events`,
  );

  expect(decision.rows).toEqual([
    { authorized: false, denial_code: "not_authorized" },
  ]);
  expect(audit.rows).toEqual([
    {
      actor_auth_user_id: authUserId,
      reason: "allowlist_miss",
      recorded_data: "",
    },
  ]);
  expect(audit.rows[0].recorded_data).not.toContain(rejectedEmail);
});

test("同一帳號反覆被拒絕不會無限新增授權稽核", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000020";

  await database.query(
    `insert into auth.users (id, email, raw_app_meta_data)
     values (
       $1,
       'repeated.unknown@example.com',
       '{"provider":"email","providers":["email"]}'::jsonb
     )`,
    [authUserId],
  );
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    authUserId,
  ]);

  await database.query("select * from public.authorize_current_user()");
  await database.query("select * from public.authorize_current_user()");
  await database.query("select * from public.authorize_current_user()");

  const audit = await database.query<{ audit_count: number }>(
    `select count(*)::integer as audit_count
     from public.authorization_audit_events
     where actor_auth_user_id = $1
       and action = 'login_denied'
       and reason = 'allowlist_miss'`,
    [authUserId],
  );

  expect(audit.rows).toEqual([{ audit_count: 1 }]);
});

test("只有 Email 已確認且 provider 為 email 的密碼帳號可取得授權", async () => {
  database = await createTestDatabase();
  const unconfirmedUserId = "10000000-0000-4000-8000-000000000011";
  const verifiedPasswordUserId = "10000000-0000-4000-8000-000000000012";
  const googleUserId = "10000000-0000-4000-8000-000000000013";

  await database.exec(`
    insert into auth.users
      (id, email, email_confirmed_at, raw_app_meta_data) values
      (
        '${unconfirmedUserId}',
        'unconfirmed@example.com',
        null,
        '{"provider":"google","providers":["google"]}'::jsonb
      ),
      (
        '${verifiedPasswordUserId}',
        'password@example.com',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb
      ),
      (
        '${googleUserId}',
        'verified.google@example.com',
        now(),
        '{"provider":"google","providers":["google"]}'::jsonb
      );

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000009', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email) values
      (
        '40000000-0000-4000-8000-000000000010',
        'unconfirmed@example.com'
      ),
      (
        '40000000-0000-4000-8000-000000000011',
        'password@example.com'
      ),
      (
        '40000000-0000-4000-8000-000000000012',
        'verified.google@example.com'
      );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id) values
      (
        '40000000-0000-4000-8000-000000000010',
        'laundry_worker',
        '20000000-0000-4000-8000-000000000009'
      ),
      (
        '40000000-0000-4000-8000-000000000011',
        'laundry_worker',
        '20000000-0000-4000-8000-000000000009'
      ),
      (
        '40000000-0000-4000-8000-000000000012',
        'laundry_worker',
        '20000000-0000-4000-8000-000000000009'
      );
  `);

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    unconfirmedUserId,
  ]);
  const unconfirmedDecision = await database.query<{
    authorized: boolean;
    denial_code: string | null;
  }>("select * from public.authorize_current_user()");

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    verifiedPasswordUserId,
  ]);
  const verifiedPasswordDecision = await database.query<{
    authorized: boolean;
    denial_code: string | null;
  }>("select * from public.authorize_current_user()");

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    googleUserId,
  ]);
  const googleDecision = await database.query<{
    authorized: boolean;
    denial_code: string | null;
  }>("select * from public.authorize_current_user()");

  const bindings = await database.query<{
    email: string;
    auth_user_id: string | null;
  }>(
    `select email, auth_user_id
     from public.user_access_profiles
     order by email`,
  );

  expect({
    unconfirmed: unconfirmedDecision.rows,
    verifiedPassword: verifiedPasswordDecision.rows,
    google: googleDecision.rows,
    bindings: bindings.rows,
  }).toEqual({
    unconfirmed: [{ authorized: false, denial_code: "not_authorized" }],
    verifiedPassword: [{ authorized: true, denial_code: null }],
    google: [{ authorized: false, denial_code: "not_authorized" }],
    bindings: [
      {
        email: "password@example.com",
        auth_user_id: verifiedPasswordUserId,
      },
      { email: "unconfirmed@example.com", auth_user_id: null },
      {
        email: "verified.google@example.com",
        auth_user_id: null,
      },
    ],
  });
});

test("首次登入帳號在 Auth 密碼真正更新前無法解除工作區鎖定", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000014";
  const profileId = "40000000-0000-4000-8000-000000000014";

  await database.exec(`
    insert into auth.users
      (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data)
    values (
      '${authUserId}',
      'admin@auth.wash-room.invalid',
      'temporary-password-hash',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb
    );

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000014', 'PASSWORD', '密碼測試據點');

    insert into public.user_access_profiles
      (id, email, active, must_change_password)
    values (
      '${profileId}',
      'admin@auth.wash-room.invalid',
      false,
      true
    );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id)
    values (
      '${profileId}',
      'laundry_supervisor',
      '20000000-0000-4000-8000-000000000014'
    );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    authUserId,
  ]);

  const authorization = await database.query<{
    authorized: boolean;
    denial_code: string | null;
  }>("select * from public.authorize_current_user()");
  const securityStateBefore = await database.query<{
    login_name: string;
    password_change_required: boolean;
  }>("select * from public.current_account_security_state()");
  const contextBefore = await database.query(
    "select * from public.current_access_context()",
  );

  await expect(
    database.query("select public.complete_required_password_change()"),
  ).rejects.toThrow(/password has not changed/i);

  await database.query(
    "update auth.users set encrypted_password = 'replacement-password-hash' where id = $1",
    [authUserId],
  );
  const completion = await database.query<{ completed: boolean }>(
    "select public.complete_required_password_change() as completed",
  );
  const securityStateAfter = await database.query<{
    login_name: string;
    password_change_required: boolean;
  }>("select * from public.current_account_security_state()");
  const contextAfter = await database.query<{ role: string }>(
    "select role from public.current_access_context()",
  );
  const audit = await database.query<{ action: string; outcome: string }>(
    `select action, outcome
     from public.authorization_audit_events
     where actor_auth_user_id = $1
       and action = 'required_password_change_completed'`,
    [authUserId],
  );

  expect({
    authorization: authorization.rows,
    securityStateBefore: securityStateBefore.rows,
    contextBefore: contextBefore.rows,
    completion: completion.rows,
    securityStateAfter: securityStateAfter.rows,
    contextAfter: contextAfter.rows,
    audit: audit.rows,
  }).toEqual({
    authorization: [{ authorized: true, denial_code: null }],
    securityStateBefore: [
      { login_name: "admin", password_change_required: true },
    ],
    contextBefore: [],
    completion: [{ completed: true }],
    securityStateAfter: [
      { login_name: "admin", password_change_required: false },
    ],
    contextAfter: [{ role: "laundry_supervisor" }],
    audit: [
      { action: "required_password_change_completed", outcome: "succeeded" },
    ],
  });
});

test("舊 Auth user 刪除後相同核准密碼帳號可安全重新綁定", async () => {
  database = await createTestDatabase();
  const oldAuthUserId = "10000000-0000-4000-8000-000000000023";
  const newAuthUserId = "10000000-0000-4000-8000-000000000024";

  await database.exec(`
    insert into auth.users (id, email, raw_app_meta_data)
    values (
      '${oldAuthUserId}',
      'recreated.google@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb
    );

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000016', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000017',
      'recreated.google@example.com',
      '${oldAuthUserId}'
    );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id)
    values (
      '40000000-0000-4000-8000-000000000017',
      'laundry_worker',
      '20000000-0000-4000-8000-000000000016'
    );

    delete from auth.users where id = '${oldAuthUserId}';

    insert into auth.users (id, email, raw_app_meta_data)
    values (
      '${newAuthUserId}',
      'recreated.google@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb
    );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    newAuthUserId,
  ]);

  const decision = await database.query<{
    authorized: boolean;
    denial_code: string | null;
  }>("select * from public.authorize_current_user()");
  const binding = await database.query<{ auth_user_id: string | null }>(
    `select auth_user_id
     from public.user_access_profiles
     where email = 'recreated.google@example.com'`,
  );

  expect(decision.rows).toEqual([{ authorized: true, denial_code: null }]);
  expect(binding.rows).toEqual([{ auth_user_id: newAuthUserId }]);
});

test("洗衣主管的資料查詢只會回傳授權據點範圍", async () => {
  database = await createTestDatabase();
  const supervisorAId = "10000000-0000-4000-8000-000000000003";
  const supervisorBId = "10000000-0000-4000-8000-000000000004";

  await database.exec(`
    insert into auth.users (id, email) values
      ('${supervisorAId}', 'supervisor.a@example.com'),
      ('${supervisorBId}', 'supervisor.b@example.com');

    insert into public.operating_sites (id, code, name) values
      ('20000000-0000-4000-8000-000000000001', 'SITE_A', 'A 據點'),
      ('20000000-0000-4000-8000-000000000002', 'SITE_B', 'B 據點');

    insert into public.institutions (id, code, name, operating_site_id) values
      ('30000000-0000-4000-8000-000000000001', 'INST_A', 'A 機構',
       '20000000-0000-4000-8000-000000000001'),
      ('30000000-0000-4000-8000-000000000002', 'INST_B', 'B 機構',
       '20000000-0000-4000-8000-000000000002');

    insert into public.user_access_profiles (id, email, auth_user_id) values
      ('40000000-0000-4000-8000-000000000001', 'supervisor.a@example.com',
       '${supervisorAId}'),
      ('40000000-0000-4000-8000-000000000002', 'supervisor.b@example.com',
       '${supervisorBId}');

    insert into public.access_memberships
      (id, user_access_profile_id, role, operating_site_id) values
      ('50000000-0000-4000-8000-000000000001',
       '40000000-0000-4000-8000-000000000001', 'laundry_supervisor',
       '20000000-0000-4000-8000-000000000001'),
      ('50000000-0000-4000-8000-000000000002',
       '40000000-0000-4000-8000-000000000002', 'laundry_supervisor',
       '20000000-0000-4000-8000-000000000002');

    insert into public.authorization_audit_events
      (actor_type, action, outcome, operating_site_id) values
      ('system', 'seed_a', 'succeeded',
       '20000000-0000-4000-8000-000000000001'),
      ('system', 'seed_b', 'succeeded',
       '20000000-0000-4000-8000-000000000002');
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorAId,
  ]);
  await database.exec("set role authenticated");

  const sites = await database.query<{ code: string }>(
    "select code from public.operating_sites order by code",
  );
  const institutions = await database.query<{ code: string }>(
    "select code from public.institutions order by code",
  );
  const profiles = await database.query<{ email: string }>(
    "select email from public.user_access_profiles order by email",
  );
  const memberships = await database.query<{ role: string }>(
    "select role from public.access_memberships order by id",
  );
  const auditEvents = await database.query<{ action: string }>(
    "select action from public.authorization_audit_events order by action",
  );

  expect({
    sites: sites.rows.map((row) => row.code),
    institutions: institutions.rows.map((row) => row.code),
    profiles: profiles.rows.map((row) => row.email),
    memberships: memberships.rows.map((row) => row.role),
    auditEvents: auditEvents.rows.map((row) => row.action),
  }).toEqual({
    sites: ["SITE_A"],
    institutions: ["INST_A"],
    profiles: ["supervisor.a@example.com"],
    memberships: ["laundry_supervisor"],
    auditEvents: ["seed_a"],
  });
});

test("停用的作業據點與送洗機構不會形成 effective context 或 RLS 範圍", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000014";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${authUserId}', 'inactive.scope@example.com');

    insert into public.operating_sites (id, code, name, active) values
      (
        '20000000-0000-4000-8000-000000000010',
        'INACTIVE_SITE',
        '停用據點',
        false
      ),
      (
        '20000000-0000-4000-8000-000000000011',
        'ACTIVE_SITE',
        '啟用據點',
        true
      );

    insert into public.institutions
      (id, code, name, operating_site_id, active)
    values (
      '30000000-0000-4000-8000-000000000003',
      'INACTIVE_INST',
      '停用機構',
      '20000000-0000-4000-8000-000000000011',
      false
    );

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000013',
      'inactive.scope@example.com',
      '${authUserId}'
    );

    insert into public.access_memberships
      (
        user_access_profile_id,
        role,
        operating_site_id,
        institution_id
      ) values
      (
        '40000000-0000-4000-8000-000000000013',
        'laundry_supervisor',
        '20000000-0000-4000-8000-000000000010',
        null
      ),
      (
        '40000000-0000-4000-8000-000000000013',
        'institution_supervisor',
        null,
        '30000000-0000-4000-8000-000000000003'
      );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    authUserId,
  ]);
  await database.exec("set role authenticated");

  const context = await database.query(
    "select * from public.current_access_context()",
  );
  const sites = await database.query<{ code: string }>(
    "select code from public.operating_sites order by code",
  );
  const institutions = await database.query<{ code: string }>(
    "select code from public.institutions order by code",
  );

  expect({
    context: context.rows,
    sites: sites.rows,
    institutions: institutions.rows,
  }).toEqual({ context: [], sites: [], institutions: [] });
});

test("停用帳號或過期 membership 的舊 JWT 不能直讀自己的權限列", async () => {
  database = await createTestDatabase();
  const disabledUserId = "10000000-0000-4000-8000-000000000018";
  const expiredUserId = "10000000-0000-4000-8000-000000000019";
  const activeUserId = "10000000-0000-4000-8000-000000000020";

  await database.exec(`
    insert into auth.users (id, email) values
      ('${disabledUserId}', 'disabled.jwt@example.com'),
      ('${expiredUserId}', 'expired.jwt@example.com'),
      ('${activeUserId}', 'active.jwt@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000017', 'MAIN', '本館');

    insert into public.user_access_profiles
      (id, email, auth_user_id, active) values
      (
        '40000000-0000-4000-8000-000000000017',
        'disabled.jwt@example.com',
        '${disabledUserId}',
        false
      ),
      (
        '40000000-0000-4000-8000-000000000018',
        'expired.jwt@example.com',
        '${expiredUserId}',
        true
      ),
      (
        '40000000-0000-4000-8000-000000000019',
        'active.jwt@example.com',
        '${activeUserId}',
        true
      );

    insert into public.access_memberships
      (
        id,
        user_access_profile_id,
        role,
        operating_site_id,
        valid_from,
        valid_until
      ) values
      (
        '50000000-0000-4000-8000-000000000004',
        '40000000-0000-4000-8000-000000000017',
        'laundry_worker',
        '20000000-0000-4000-8000-000000000017',
        now() - interval '1 day',
        null
      ),
      (
        '50000000-0000-4000-8000-000000000005',
        '40000000-0000-4000-8000-000000000018',
        'laundry_worker',
        '20000000-0000-4000-8000-000000000017',
        now() - interval '2 days',
        now() - interval '1 day'
      ),
      (
        '50000000-0000-4000-8000-000000000006',
        '40000000-0000-4000-8000-000000000019',
        'laundry_worker',
        '20000000-0000-4000-8000-000000000017',
        now() - interval '1 day',
        null
      );
  `);
  await database.exec("set role authenticated");

  async function readOwnAccess(authUserId: string, profileId: string) {
    await database!.query(
      `select set_config('request.jwt.claim.sub', $1, false)`,
      [authUserId],
    );
    const profiles = await database!.query<{ email: string }>(
      `select email
       from public.user_access_profiles
       where id = $1`,
      [profileId],
    );
    const memberships = await database!.query<{ role: string }>(
      `select role
       from public.access_memberships
       where user_access_profile_id = $1`,
      [profileId],
    );
    return { profiles: profiles.rows, memberships: memberships.rows };
  }

  const disabledView = await readOwnAccess(
    disabledUserId,
    "40000000-0000-4000-8000-000000000017",
  );
  const expiredView = await readOwnAccess(
    expiredUserId,
    "40000000-0000-4000-8000-000000000018",
  );
  const activeView = await readOwnAccess(
    activeUserId,
    "40000000-0000-4000-8000-000000000019",
  );

  expect({ disabledView, expiredView, activeView }).toEqual({
    disabledView: { profiles: [], memberships: [] },
    expiredView: { profiles: [], memberships: [] },
    activeView: {
      profiles: [{ email: "active.jwt@example.com" }],
      memberships: [{ role: "laundry_worker" }],
    },
  });
});

test("authenticated 主管不能 SELECT 無據點或機構 scope 的授權稽核", async () => {
  database = await createTestDatabase();
  const supervisorId = "10000000-0000-4000-8000-000000000016";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorId}', 'audit.admin@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000015', 'SITE_A', 'A 據點');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000015',
      'audit.admin@example.com',
      '${supervisorId}'
    );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id)
    values (
      '40000000-0000-4000-8000-000000000015',
      'laundry_supervisor',
      '20000000-0000-4000-8000-000000000015'
    );

    insert into public.authorization_audit_events
      (actor_type, action, outcome, operating_site_id) values
      (
        'system',
        'site_scoped_event',
        'succeeded',
        '20000000-0000-4000-8000-000000000015'
      ),
      ('system', 'unscoped_login_event', 'denied', null);
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorId,
  ]);
  await database.exec("set role authenticated");

  const authenticatedView = await database.query<{ action: string }>(
    "select action from public.authorization_audit_events order by action",
  );

  expect(authenticatedView.rows).toEqual([{ action: "site_scoped_event" }]);

  await database.exec("reset role");
  const ownerView = await database.query<{ action: string }>(
    `select action
     from public.authorization_audit_events
     where action = 'unscoped_login_event'`,
  );

  await database.exec("set role service_role");
  const serviceRoleView = await database.query<{ action: string }>(
    `select action
     from public.authorization_audit_events
     where action = 'unscoped_login_event'`,
  );

  expect(ownerView.rows).toEqual([{ action: "unscoped_login_event" }]);
  expect(serviceRoleView.rows).toEqual([{ action: "unscoped_login_event" }]);
});

test("洗衣主管可在授權據點新增正規化 Email membership 並留下稽核", async () => {
  database = await createTestDatabase();
  const supervisorId = "10000000-0000-4000-8000-000000000005";
  const requestId = "60000000-0000-4000-8000-000000000001";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorId}', 'admin@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000003', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000003',
      'admin@example.com',
      '${supervisorId}'
    );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id)
    values (
      '40000000-0000-4000-8000-000000000003',
      'laundry_supervisor',
      '20000000-0000-4000-8000-000000000003'
    );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorId,
  ]);
  await database.exec("set role authenticated");

  const result = await database.query<{
    applied_count: number;
    already_applied: boolean;
  }>(
    `select * from public.apply_access_changes(
      $1::jsonb,
      $2::uuid,
      $3::text
    )`,
    [
      JSON.stringify([
        {
          email: "  Worker.One@Example.COM  ",
          role: "laundry_worker",
          site_code: "MAIN",
          institution_code: null,
          account_active: true,
          membership_active: true,
        },
      ]),
      requestId,
      "  新進洗衣員到職  ",
    ],
  );
  const created = await database.query<{
    email: string;
    role: string;
    site_code: string;
  }>(
    `select profile.email, membership.role, site.code as site_code
     from public.user_access_profiles as profile
     join public.access_memberships as membership
       on membership.user_access_profile_id = profile.id
     join public.operating_sites as site
       on site.id = membership.operating_site_id
     where profile.email = 'worker.one@example.com'`,
  );
  const audit = await database.query<{
    action: string;
    reason: string;
    request_id: string;
  }>(
    `select action, reason, request_id
     from public.authorization_audit_events
     where request_id = $1`,
    [requestId],
  );

  expect(result.rows).toEqual([{ applied_count: 1, already_applied: false }]);
  expect(created.rows).toEqual([
    {
      email: "worker.one@example.com",
      role: "laundry_worker",
      site_code: "MAIN",
    },
  ]);
  expect(audit.rows).toEqual([
    {
      action: "access_membership_upserted",
      reason: "新進洗衣員到職",
      request_id: requestId,
    },
  ]);
});

test("權限異動理由只有空白時整批拒絕且不留下資料、請求或稽核", async () => {
  database = await createTestDatabase();
  const supervisorId = "10000000-0000-4000-8000-000000000025";
  const requestId = "60000000-0000-4000-8000-000000000012";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorId}', 'reason.admin@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000017', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000018',
      'reason.admin@example.com',
      '${supervisorId}'
    );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id)
    values (
      '40000000-0000-4000-8000-000000000018',
      'laundry_supervisor',
      '20000000-0000-4000-8000-000000000017'
    );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorId,
  ]);
  await database.exec("set role authenticated");

  await expect(
    database.query(
      `select * from public.apply_access_changes(
        $1::jsonb,
        $2::uuid,
        $3::text
      )`,
      [
        JSON.stringify([
          {
            email: "reason.worker@example.com",
            role: "laundry_worker",
            site_code: "MAIN",
            institution_code: null,
            account_active: true,
            membership_active: true,
          },
        ]),
        requestId,
        "  \n\t  ",
      ],
    ),
  ).rejects.toThrow(/change reason is required/i);

  await database.exec("reset role");
  const effects = await database.query<{
    profiles: number;
    requests: number;
    audit_events: number;
  }>(
    `select
       (
         select count(*)::integer
         from public.user_access_profiles
         where email = 'reason.worker@example.com'
       ) as profiles,
       (
         select count(*)::integer
         from private.authorization_change_requests
         where id = $1
       ) as requests,
       (
         select count(*)::integer
         from public.authorization_audit_events
         where request_id = $1
       ) as audit_events`,
    [requestId],
  );

  expect(effects.rows).toEqual([
    { profiles: 0, requests: 0, audit_events: 0 },
  ]);
});

test("主管重新啟用已過期 membership 後會恢復有效權限", async () => {
  database = await createTestDatabase();
  const supervisorId = "10000000-0000-4000-8000-000000000021";
  const workerId = "10000000-0000-4000-8000-000000000022";
  const requestId = "60000000-0000-4000-8000-000000000011";

  await database.exec(`
    insert into auth.users (id, email) values
      ('${supervisorId}', 'renew.admin@example.com'),
      ('${workerId}', 'renew.worker@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000015', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email, auth_user_id) values
      (
        '40000000-0000-4000-8000-000000000015',
        'renew.admin@example.com',
        '${supervisorId}'
      ),
      (
        '40000000-0000-4000-8000-000000000016',
        'renew.worker@example.com',
        '${workerId}'
      );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id) values (
        '40000000-0000-4000-8000-000000000015',
        'laundry_supervisor',
        '20000000-0000-4000-8000-000000000015'
      );

    insert into public.access_memberships (
      user_access_profile_id,
      role,
      operating_site_id,
      active,
      valid_from,
      valid_until
    ) values (
      '40000000-0000-4000-8000-000000000016',
      'laundry_worker',
      '20000000-0000-4000-8000-000000000015',
      false,
      now() - interval '2 days',
      now() - interval '1 day'
    );
  `);

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorId,
  ]);
  await database.exec("set role authenticated");
  await database.query(
    "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
    [
      JSON.stringify([
        {
          email: "renew.worker@example.com",
          role: "laundry_worker",
          site_code: "MAIN",
          institution_code: null,
          account_active: true,
          membership_active: true,
        },
      ]),
      requestId,
      "恢復洗衣員權限",
    ],
  );

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    workerId,
  ]);
  const access = await database.query<{
    role: string;
    scope_code: string;
  }>("select role, scope_code from public.current_access_context()");

  expect(access.rows).toEqual([
    { role: "laundry_worker", scope_code: "MAIN" },
  ]);
});

test("CSV 同批重複 membership 會整批拒絕且不留下部分資料", async () => {
  database = await createTestDatabase();
  const supervisorId = "10000000-0000-4000-8000-000000000006";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorId}', 'csv.admin@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000004', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000004',
      'csv.admin@example.com',
      '${supervisorId}'
    );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id)
    values (
      '40000000-0000-4000-8000-000000000004',
      'laundry_supervisor',
      '20000000-0000-4000-8000-000000000004'
    );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorId,
  ]);
  await database.exec("set role authenticated");

  const duplicateRows = [
    {
      email: "duplicate@example.com",
      role: "laundry_worker",
      site_code: "MAIN",
      institution_code: null,
      account_active: true,
      membership_active: true,
    },
    {
      email: "Duplicate@Example.com",
      role: "laundry_worker",
      site_code: "main",
      institution_code: null,
      account_active: true,
      membership_active: true,
    },
  ];

  await expect(
    database.query(
      "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
      [
        JSON.stringify(duplicateRows),
        "60000000-0000-4000-8000-000000000002",
        "CSV 權限匯入",
      ],
    ),
  ).rejects.toThrow(/duplicate membership/i);

  const partialData = await database.query<{ count: number }>(
    `select count(*)::integer as count
     from public.user_access_profiles
     where email = 'duplicate@example.com'`,
  );
  expect(partialData.rows).toEqual([{ count: 0 }]);
});

test("CSV 同一 Email 多列的 account_active 不一致時會整批拒絕", async () => {
  database = await createTestDatabase();
  const supervisorId = "10000000-0000-4000-8000-000000000015";
  const requestId = "60000000-0000-4000-8000-000000000006";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorId}', 'consistent.admin@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000012', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000014',
      'consistent.admin@example.com',
      '${supervisorId}'
    );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id)
    values (
      '40000000-0000-4000-8000-000000000014',
      'laundry_supervisor',
      '20000000-0000-4000-8000-000000000012'
    );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorId,
  ]);
  await database.exec("set role authenticated");

  const inconsistentRows = [
    {
      email: "multi.role@example.com",
      role: "laundry_worker",
      site_code: "MAIN",
      institution_code: null,
      account_active: true,
      membership_active: true,
    },
    {
      email: "Multi.Role@Example.com",
      role: "laundry_supervisor",
      site_code: "MAIN",
      institution_code: null,
      account_active: false,
      membership_active: true,
    },
  ];

  await expect(
    database.query(
      "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
      [JSON.stringify(inconsistentRows), requestId, "CSV 權限匯入"],
    ),
  ).rejects.toThrow(/account_active must be consistent for each email/i);

  const effects = await database.query<{
    profiles: number;
    audit_events: number;
  }>(
    `select
       (
         select count(*)::integer
         from public.user_access_profiles
         where email = 'multi.role@example.com'
       ) as profiles,
       (
         select count(*)::integer
         from public.authorization_audit_events
         where request_id = $1
       ) as audit_events`,
    [requestId],
  );

  expect(effects.rows).toEqual([{ profiles: 0, audit_events: 0 }]);
});

test("同一洗衣主管以相同 request_id 重送相同變更與理由只會套用一次", async () => {
  database = await createTestDatabase();
  const supervisorId = "10000000-0000-4000-8000-000000000007";
  const requestId = "60000000-0000-4000-8000-000000000003";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorId}', 'retry.admin@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000005', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000005',
      'retry.admin@example.com',
      '${supervisorId}'
    );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id)
    values (
      '40000000-0000-4000-8000-000000000005',
      'laundry_supervisor',
      '20000000-0000-4000-8000-000000000005'
    );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorId,
  ]);
  await database.exec("set role authenticated");

  const originalChanges = [
    {
      email: "retry.worker@example.com",
      role: "laundry_worker",
      site_code: "MAIN",
      institution_code: null,
      account_active: true,
      membership_active: true,
    },
  ];
  const first = await database.query<{
    applied_count: number;
    already_applied: boolean;
  }>(
    "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
    [JSON.stringify(originalChanges), requestId, "人員輪調"],
  );
  const retry = await database.query<{
    applied_count: number;
    already_applied: boolean;
  }>(
    "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
    [JSON.stringify(originalChanges), requestId, "  人員輪調  "],
  );

  await expect(
    database.query(
      "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
      [JSON.stringify(originalChanges), requestId, "臨時替補"],
    ),
  ).rejects.toThrow(/request id cannot be reused/i);

  await expect(
    database.query(
      "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
      [
        JSON.stringify([
          {
            ...originalChanges[0],
            email: "different.worker@example.com",
          },
        ]),
        requestId,
        "人員輪調",
      ],
    ),
  ).rejects.toThrow(/request id cannot be reused/i);

  const effects = await database.query<{
    memberships: number;
    audit_events: number;
  }>(
    `select
       count(distinct membership.id)::integer as memberships,
       count(distinct audit.id)::integer as audit_events
     from public.access_memberships as membership
     join public.user_access_profiles as profile
       on profile.id = membership.user_access_profile_id
     left join public.authorization_audit_events as audit
       on audit.target_membership_id = membership.id
      and audit.request_id = $1
     where profile.email = 'retry.worker@example.com'`,
    [requestId],
  );

  expect(first.rows).toEqual([{ applied_count: 1, already_applied: false }]);
  expect(retry.rows).toEqual([{ applied_count: 1, already_applied: true }]);
  expect(effects.rows).toEqual([{ memberships: 1, audit_events: 1 }]);
});

test("不同洗衣主管不能重放相同 request_id 或取得原請求結果", async () => {
  database = await createTestDatabase();
  const firstSupervisorId = "10000000-0000-4000-8000-000000000008";
  const secondSupervisorId = "10000000-0000-4000-8000-000000000009";
  const requestId = "60000000-0000-4000-8000-000000000004";

  await database.exec(`
    insert into auth.users (id, email) values
      ('${firstSupervisorId}', 'first.admin@example.com'),
      ('${secondSupervisorId}', 'second.admin@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000006', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email, auth_user_id) values
      (
        '40000000-0000-4000-8000-000000000006',
        'first.admin@example.com',
        '${firstSupervisorId}'
      ),
      (
        '40000000-0000-4000-8000-000000000007',
        'second.admin@example.com',
        '${secondSupervisorId}'
      );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id) values
      (
        '40000000-0000-4000-8000-000000000006',
        'laundry_supervisor',
        '20000000-0000-4000-8000-000000000006'
      ),
      (
        '40000000-0000-4000-8000-000000000007',
        'laundry_supervisor',
        '20000000-0000-4000-8000-000000000006'
      );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    firstSupervisorId,
  ]);
  await database.exec("set role authenticated");

  const changes = [
    {
      email: "shared.worker@example.com",
      role: "laundry_worker",
      site_code: "MAIN",
      institution_code: null,
      account_active: true,
      membership_active: true,
    },
  ];
  const first = await database.query<{
    applied_count: number;
    already_applied: boolean;
  }>(
    "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
    [JSON.stringify(changes), requestId, "新增共用洗衣員"],
  );

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    secondSupervisorId,
  ]);

  await expect(
    database.query(
      "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
      [JSON.stringify(changes), requestId, "新增共用洗衣員"],
    ),
  ).rejects.toThrow(/request id cannot be reused/i);

  expect(first.rows).toEqual([{ applied_count: 1, already_applied: false }]);
});

test("批次包含會影響未授權據點的帳號狀態變更時會全數回滾", async () => {
  database = await createTestDatabase();
  const supervisorId = "10000000-0000-4000-8000-000000000010";
  const requestId = "60000000-0000-4000-8000-000000000005";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorId}', 'site.a.admin@example.com');

    insert into public.operating_sites (id, code, name) values
      ('20000000-0000-4000-8000-000000000007', 'SITE_A', 'A 據點'),
      ('20000000-0000-4000-8000-000000000008', 'SITE_B', 'B 據點');

    insert into public.user_access_profiles (id, email, auth_user_id) values
      (
        '40000000-0000-4000-8000-000000000008',
        'site.a.admin@example.com',
        '${supervisorId}'
      ),
      (
        '40000000-0000-4000-8000-000000000009',
        'multi.scope@example.com',
        null
      );

    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id) values
      (
        '40000000-0000-4000-8000-000000000008',
        'laundry_supervisor',
        '20000000-0000-4000-8000-000000000007'
      ),
      (
        '40000000-0000-4000-8000-000000000009',
        'laundry_worker',
        '20000000-0000-4000-8000-000000000008'
      );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorId,
  ]);
  await database.exec("set role authenticated");

  const changes = [
    {
      email: "new.in.scope@example.com",
      role: "laundry_worker",
      site_code: "SITE_A",
      institution_code: null,
      account_active: true,
      membership_active: true,
    },
    {
      email: "multi.scope@example.com",
      role: "laundry_worker",
      site_code: "SITE_A",
      institution_code: null,
      account_active: false,
      membership_active: true,
    },
  ];

  await expect(
    database.query(
      "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
      [JSON.stringify(changes), requestId, "跨據點帳號停用"],
    ),
  ).rejects.toThrow(/account status is outside supervisor authority/i);

  await database.exec("reset role");
  const effects = await database.query<{
    new_profiles: number;
    target_active: boolean;
    target_site_a_memberships: number;
    audit_events: number;
  }>(
    `select
       (
         select count(*)::integer
         from public.user_access_profiles
         where email = 'new.in.scope@example.com'
       ) as new_profiles,
       (
         select active
         from public.user_access_profiles
         where email = 'multi.scope@example.com'
       ) as target_active,
       (
         select count(*)::integer
         from public.access_memberships as membership
         join public.operating_sites as site
           on site.id = membership.operating_site_id
         where membership.user_access_profile_id =
           '40000000-0000-4000-8000-000000000009'
           and site.code = 'SITE_A'
       ) as target_site_a_memberships,
       (
         select count(*)::integer
         from public.authorization_audit_events
         where request_id = $1
       ) as audit_events`,
    [requestId],
  );

  expect(effects.rows).toEqual([
    {
      new_profiles: 0,
      target_active: true,
      target_site_a_memberships: 0,
      audit_events: 0,
    },
  ]);
});

test("最後一位有效洗衣主管不可停用，但同批建立替代主管後可以", async () => {
  database = await createTestDatabase();
  const supervisorId = "10000000-0000-4000-8000-000000000017";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorId}', 'last.admin@example.com');

    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000016', 'MAIN', '本館');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000016',
      'last.admin@example.com',
      '${supervisorId}'
    );

    insert into public.access_memberships
      (id, user_access_profile_id, role, operating_site_id)
    values (
      '50000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000016',
      'laundry_supervisor',
      '20000000-0000-4000-8000-000000000016'
    );
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorId,
  ]);
  await database.exec("set role authenticated");

  await expect(
    database.query(
      "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
      [
        JSON.stringify([
          {
            email: "last.admin@example.com",
            role: "laundry_supervisor",
            site_code: "MAIN",
            institution_code: null,
            account_active: true,
            membership_active: false,
          },
        ]),
        "60000000-0000-4000-8000-000000000009",
        "停用主管權限",
      ],
    ),
  ).rejects.toThrow(/last active laundry supervisor/i);

  await expect(
    database.query(
      "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
      [
        JSON.stringify([
          {
            email: "last.admin@example.com",
            role: "laundry_supervisor",
            site_code: "MAIN",
            institution_code: null,
            account_active: false,
            membership_active: true,
          },
        ]),
        "60000000-0000-4000-8000-000000000010",
        "停用主管帳號",
      ],
    ),
  ).rejects.toThrow(/last active laundry supervisor/i);

  const replacement = await database.query<{
    applied_count: number;
    already_applied: boolean;
  }>(
    "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3::text)",
    [
      JSON.stringify([
        {
          email: "replacement.admin@example.com",
          role: "laundry_supervisor",
          site_code: "MAIN",
          institution_code: null,
          account_active: true,
          membership_active: true,
        },
        {
          email: "last.admin@example.com",
          role: "laundry_supervisor",
          site_code: "MAIN",
          institution_code: null,
          account_active: false,
          membership_active: false,
        },
      ]),
      "60000000-0000-4000-8000-000000000011",
      "主管交接",
    ],
  );

  await database.exec("reset role");
  const supervisors = await database.query<{
    email: string;
    account_active: boolean;
    membership_active: boolean;
  }>(
    `select
       profile.email,
       profile.active as account_active,
       membership.active as membership_active
     from public.user_access_profiles as profile
     join public.access_memberships as membership
       on membership.user_access_profile_id = profile.id
     where membership.role = 'laundry_supervisor'
     order by profile.email`,
  );
  const deniedEffects = await database.query<{
    audit_events: number;
  }>(
    `select count(*)::integer as audit_events
     from public.authorization_audit_events
     where request_id in (
       '60000000-0000-4000-8000-000000000009',
       '60000000-0000-4000-8000-000000000010'
     )`,
  );

  expect(replacement.rows).toEqual([
    { applied_count: 2, already_applied: false },
  ]);
  expect(supervisors.rows).toEqual([
    {
      email: "last.admin@example.com",
      account_active: false,
      membership_active: false,
    },
    {
      email: "replacement.admin@example.com",
      account_active: true,
      membership_active: true,
    },
  ]);
  expect(deniedEffects.rows).toEqual([{ audit_events: 0 }]);
});

test("service_role 與 DB owner 可為不同作業據點各 bootstrap 首位洗衣主管", async () => {
  database = await createTestDatabase();
  const requestId = "60000000-0000-4000-8000-000000000007";

  await database.exec(`
    insert into public.operating_sites (id, code, name, active) values
      (
        '20000000-0000-4000-8000-000000000013',
        'MAIN',
        '本館',
        true
      ),
      (
        '20000000-0000-4000-8000-000000000014',
        'CLOSED',
        '停用據點',
        false
      ),
      (
        '20000000-0000-4000-8000-000000000018',
        'SECOND',
        '第二據點',
        true
      );
  `);

  await database.exec("set role authenticated");
  await expect(
    database.query(
      `select * from public.bootstrap_first_laundry_supervisor(
        $1::text,
        $2::text,
        $3::uuid
      )`,
      ["first.admin@example.com", "MAIN", requestId],
    ),
  ).rejects.toThrow(/permission denied for function/i);

  await database.exec("reset role");
  await database.exec("set role service_role");
  await expect(
    database.query(
      `select * from public.bootstrap_first_laundry_supervisor(
        $1::text,
        $2::text,
        $3::uuid
      )`,
      ["first.admin@example.com", "CLOSED", requestId],
    ),
  ).rejects.toThrow(/active operating site not found/i);

  const created = await database.query<{
    user_access_profile_id: string;
    access_membership_id: string;
  }>(
    `select * from public.bootstrap_first_laundry_supervisor(
      $1::text,
      $2::text,
      $3::uuid
    )`,
    ["  First.Admin@Example.COM  ", " main ", requestId],
  );

  await database.exec("reset role");
  const secondCreated = await database.query<{
    user_access_profile_id: string;
    access_membership_id: string;
  }>(
    `select * from public.bootstrap_first_laundry_supervisor(
      $1::text,
      $2::text,
      $3::uuid
    )`,
    [
      "second.admin@example.com",
      "SECOND",
      "60000000-0000-4000-8000-000000000008",
    ],
  );

  await expect(
    database.query(
      `select * from public.bootstrap_first_laundry_supervisor(
        $1::text,
        $2::text,
        $3::uuid
      )`,
      [
        "second.admin@example.com",
        "MAIN",
        "60000000-0000-4000-8000-000000000009",
      ],
    ),
  ).rejects.toThrow(/active laundry supervisor already exists/i);

  const state = await database.query<{
    email: string;
    role: string;
    site_code: string;
    action: string;
    actor_type: string;
    outcome: string;
    request_id: string;
  }>(
    `select
       profile.email,
       membership.role,
       site.code as site_code,
       audit.action,
       audit.actor_type,
       audit.outcome,
       audit.request_id
     from public.user_access_profiles as profile
     join public.access_memberships as membership
       on membership.user_access_profile_id = profile.id
     join public.operating_sites as site
       on site.id = membership.operating_site_id
     join public.authorization_audit_events as audit
       on audit.target_membership_id = membership.id
     where profile.email in (
       'first.admin@example.com',
       'second.admin@example.com'
     )
     order by profile.email`,
  );

  expect(created.rows).toHaveLength(1);
  expect(created.rows[0].user_access_profile_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(created.rows[0].access_membership_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(secondCreated.rows).toHaveLength(1);
  expect(state.rows).toEqual([
    {
      email: "first.admin@example.com",
      role: "laundry_supervisor",
      site_code: "MAIN",
      action: "first_laundry_supervisor_bootstrapped",
      actor_type: "system",
      outcome: "succeeded",
      request_id: requestId,
    },
    {
      email: "second.admin@example.com",
      role: "laundry_supervisor",
      site_code: "SECOND",
      action: "first_laundry_supervisor_bootstrapped",
      actor_type: "system",
      outcome: "succeeded",
      request_id: "60000000-0000-4000-8000-000000000008",
    },
  ]);
});

test("首位密碼主管 bootstrap 會建立 admin 登入名並保持工作區鎖定", async () => {
  database = await createTestDatabase();
  const requestId = "90000000-0000-4000-8000-000000000031";

  await database.exec(`
    insert into public.operating_sites (id, code, name)
    values ('20000000-0000-4000-8000-000000000031', 'BOOT', '正式啟用據點');
  `);

  const first = await database.query<{
    user_access_profile_id: string;
    access_membership_id: string;
    already_applied: boolean;
  }>(
    `select * from public.bootstrap_first_password_laundry_supervisor(
      ' Admin ',
      ' Notice@example.com ',
      ' boot ',
      $1
    )`,
    [requestId],
  );
  const replay = await database.query<{
    user_access_profile_id: string;
    access_membership_id: string;
    already_applied: boolean;
  }>(
    `select * from public.bootstrap_first_password_laundry_supervisor(
      'admin',
      'notice@example.com',
      'BOOT',
      $1
    )`,
    [requestId],
  );
  const profile = await database.query<{
    email: string;
    login_name: string;
    notification_email: string | null;
    active: boolean;
    must_change_password: boolean;
  }>(
    `select email, login_name, notification_email, active, must_change_password
     from public.user_access_profiles
     where login_name = 'admin'`,
  );
  const memberships = await database.query<{ role: string; active: boolean }>(
    `select membership.role, membership.active
     from public.access_memberships as membership
     join public.user_access_profiles as profile
       on profile.id = membership.user_access_profile_id
     where profile.login_name = 'admin'`,
  );
  const audit = await database.query<{ audit_count: number }>(
    `select count(*)::integer as audit_count
     from public.authorization_audit_events
     where request_id = $1
       and action = 'first_password_laundry_supervisor_bootstrapped'`,
    [requestId],
  );

  expect(first.rows[0]).toMatchObject({ already_applied: false });
  expect(replay.rows).toEqual([
    {
      ...first.rows[0],
      already_applied: true,
    },
  ]);
  expect(profile.rows).toEqual([
    {
      email: "admin@auth.wash-room.invalid",
      login_name: "admin",
      notification_email: "notice@example.com",
      active: false,
      must_change_password: true,
    },
  ]);
  expect(memberships.rows).toEqual([
    { role: "laundry_supervisor", active: true },
  ]);
  expect(audit.rows).toEqual([{ audit_count: 1 }]);
});

import { afterEach, expect, test } from "vitest";

import {
  createTestDatabase,
  type TestDatabase,
} from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

async function seedSupervisor() {
  database = await createTestDatabase();
  await database.exec(`
    insert into auth.users (id, email) values
      ('10000000-0000-4000-8000-000000000201', 'admin@auth.wash-room.invalid');
    insert into public.operating_sites (id, code, name) values
      ('20000000-0000-4000-8000-000000000201', 'ACCT_MAIN', '帳號測試本館'),
      ('20000000-0000-4000-8000-000000000202', 'ACCT_CORP', '帳號測試法人');
    insert into public.institutions (id, code, name, operating_site_id) values
      ('30000000-0000-4000-8000-000000000201', 'ACCT_CARE', '帳號測試機構', '20000000-0000-4000-8000-000000000201'),
      ('30000000-0000-4000-8000-000000000202', 'ACCT_CARE_CORP', '帳號測試法人機構', '20000000-0000-4000-8000-000000000202');
    insert into public.user_access_profiles (id, email, login_name, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000201',
      'admin@auth.wash-room.invalid',
      'admin',
      '10000000-0000-4000-8000-000000000201'
    );
    insert into public.access_memberships
      (user_access_profile_id, role, operating_site_id)
    values (
      '40000000-0000-4000-8000-000000000201',
      'laundry_supervisor',
      '20000000-0000-4000-8000-000000000201'
    );
  `);
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [
    "10000000-0000-4000-8000-000000000201",
  ]);
  await database.exec("set role authenticated");
  return database;
}

test("新增帳號保留大小寫、多個權限與通知資料，且唯一性不分大小寫", async () => {
  const db = await seedSupervisor();
  const memberships = [
    { role: "laundry_worker", site_code: "ACCT_MAIN", institution_code: null },
    {
      role: "institution_supervisor",
      site_code: null,
      institution_code: "ACCT_CARE",
    },
  ];

  const created = await db.query<{
    user_access_profile_id: string;
    internal_auth_email: string;
    created_account: boolean;
    already_applied: boolean;
  }>(
    `select * from public.manage_user_account(
      null, $1, $2, $3, true, $4::jsonb, $5::uuid, $6
    )`,
    [
      "WorkerABC",
      "王小明",
      "Notify@Example.COM",
      JSON.stringify(memberships),
      "60000000-0000-4000-8000-000000000201",
      "新增跨角色帳號",
    ],
  );
  const retry = await db.query(
    `select * from public.manage_user_account(
      null, $1, $2, $3, true, $4::jsonb, $5::uuid, $6
    )`,
    [
      "WorkerABC",
      "王小明",
      "Notify@Example.COM",
      JSON.stringify(memberships),
      "60000000-0000-4000-8000-000000000201",
      "新增跨角色帳號",
    ],
  );

  expect(created.rows[0]).toMatchObject({
    internal_auth_email: "workerabc@auth.wash-room.invalid",
    created_account: true,
    already_applied: false,
  });
  expect(retry.rows[0]).toMatchObject({ already_applied: true });

  const visible = await db.query<{
    login_name: string;
    display_name: string;
    notification_email: string;
    is_current_account: boolean;
    memberships: Array<{ role: string; site_code: string | null; institution_code: string | null }>;
  }>("select login_name, display_name, notification_email, is_current_account, memberships from public.list_manageable_user_accounts() where login_name = 'WorkerABC'");
  expect(visible.rows[0]).toMatchObject({
    login_name: "WorkerABC",
    display_name: "王小明",
    notification_email: "notify@example.com",
    is_current_account: false,
  });
  expect(visible.rows[0].memberships).toHaveLength(2);

  await expect(
    db.query(
      `select * from public.manage_user_account(
        null, 'workerabc', null, null, true,
        '[{"role":"laundry_worker","site_code":"ACCT_MAIN","institution_code":null}]'::jsonb,
        '60000000-0000-4000-8000-000000000202', '重複帳號'
      )`,
    ),
  ).rejects.toThrow(/login name already exists|unique/i);
});

test("編輯帳號可更換大小寫、基本資料與權限集合，跨據點帳號則整筆拒絕", async () => {
  const db = await seedSupervisor();
  const created = await db.query<{ user_access_profile_id: string }>(
    `select * from public.manage_user_account(
      null, 'EditMe', '原名稱', null, true,
      '[{"role":"laundry_worker","site_code":"ACCT_MAIN","institution_code":null}]'::jsonb,
      '60000000-0000-4000-8000-000000000203', '建立待編輯帳號'
    )`,
  );
  const profileId = created.rows[0].user_access_profile_id;
  await db.query(
    `select * from public.manage_user_account(
      $1, 'EDITme', '新名稱', 'NEW@EXAMPLE.COM', true,
      '[{"role":"laundry_supervisor","site_code":"ACCT_MAIN","institution_code":null}]'::jsonb,
      '60000000-0000-4000-8000-000000000204', '調整角色與聯絡方式'
    )`,
    [profileId],
  );
  const state = await db.query<{
    login_name: string;
    display_name: string;
    notification_email: string;
    role: string;
    active: boolean;
  }>(
    `select profile.login_name, profile.display_name, profile.notification_email,
       membership.role, membership.active
     from public.user_access_profiles as profile
     join public.access_memberships as membership
       on membership.user_access_profile_id = profile.id
     where profile.id = $1 order by membership.active desc, membership.role`,
    [profileId],
  );
  expect(state.rows[0]).toMatchObject({
    login_name: "EDITme",
    display_name: "新名稱",
    notification_email: "new@example.com",
    role: "laundry_supervisor",
    active: true,
  });
  expect(state.rows.some((row) => row.role === "laundry_worker" && !row.active)).toBe(true);

  await db.exec("reset role");
  await db.exec(`
    insert into public.user_access_profiles (id, email, login_name)
    values ('40000000-0000-4000-8000-000000000209', 'mixed@auth.wash-room.invalid', 'Mixed');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id) values
      ('40000000-0000-4000-8000-000000000209', 'laundry_worker', '20000000-0000-4000-8000-000000000201'),
      ('40000000-0000-4000-8000-000000000209', 'laundry_worker', '20000000-0000-4000-8000-000000000202');
  `);
  await db.exec("set role authenticated");
  await expect(
    db.query(
      `select * from public.manage_user_account(
        '40000000-0000-4000-8000-000000000209', 'Mixed', null, null, false,
        '[{"role":"laundry_worker","site_code":"ACCT_MAIN","institution_code":null}]'::jsonb,
        '60000000-0000-4000-8000-000000000205', '跨據點停用'
      )`,
    ),
  ).rejects.toThrow(/outside supervisor authority/i);
});

test("密碼重設與刪除帳號保留稽核，並拒絕管理目前登入帳號", async () => {
  const db = await seedSupervisor();
  const created = await db.query<{ user_access_profile_id: string }>(
    `select * from public.manage_user_account(
      null, 'DeleteMe', null, null, true,
      '[{"role":"laundry_worker","site_code":"ACCT_MAIN","institution_code":null}]'::jsonb,
      '60000000-0000-4000-8000-000000000206', '建立測試帳號'
    )`,
  );
  const profileId = created.rows[0].user_access_profile_id;

  await db.exec("reset role");
  await db.exec(`
    insert into auth.users (id, email, raw_app_meta_data)
    values (
      '10000000-0000-4000-8000-000000000206',
      'deleteme@auth.wash-room.invalid',
      '{"provider":"email","providers":["email"]}'::jsonb
    );
    set role service_role;
  `);
  await expect(
    db.query("select public.internal_bind_managed_auth_identity($1, $2)", [
      profileId,
      "10000000-0000-4000-8000-000000000206",
    ]),
  ).resolves.toBeDefined();
  const identity = await db.query<{ auth_user_id: string; auth_email: string }>(
    "select * from public.internal_get_managed_auth_identity($1)",
    [profileId],
  );
  expect(identity.rows[0]).toEqual({
    auth_user_id: "10000000-0000-4000-8000-000000000206",
    auth_email: "deleteme@auth.wash-room.invalid",
  });

  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    "10000000-0000-4000-8000-000000000201",
  ]);
  await db.exec("set role authenticated");
  await db.query(
    "select * from public.mark_managed_account_password_reset($1, $2, $3)",
    [profileId, "60000000-0000-4000-8000-000000000207", "重設忘記的密碼"],
  );
  await db.query(
    "select * from public.retire_managed_user_account($1, $2, $3)",
    [profileId, "60000000-0000-4000-8000-000000000208", "人員離職刪除帳號"],
  );

  const retired = await db.query<{
    active: boolean;
    must_change_password: boolean;
    deleted: boolean;
    active_memberships: number;
    audit_actions: string[];
  }>(
    `select profile.active, profile.must_change_password,
       profile.deleted_at is not null as deleted,
       count(membership.id) filter (where membership.active)::integer as active_memberships,
       array_agg(distinct audit.action) as audit_actions
     from public.user_access_profiles as profile
     left join public.access_memberships as membership
       on membership.user_access_profile_id = profile.id
     left join public.authorization_audit_events as audit
       on audit.request_id in (
         '60000000-0000-4000-8000-000000000207',
         '60000000-0000-4000-8000-000000000208'
       )
     where profile.id = $1 group by profile.id`,
    [profileId],
  );
  expect(retired.rows[0]).toMatchObject({
    active: false,
    must_change_password: false,
    deleted: true,
    active_memberships: 0,
  });
  expect(retired.rows[0].audit_actions).toEqual(
    expect.arrayContaining(["user_password_reset_required", "user_account_deleted"]),
  );

  await expect(
    db.query(
      `select * from public.retire_managed_user_account(
        '40000000-0000-4000-8000-000000000201',
        '60000000-0000-4000-8000-000000000209', '誤刪自己'
      )`,
    ),
  ).rejects.toThrow(/current account cannot be deleted/i);
});

test("帳號模組的批次權限只維護已綁定帳號，並支援冪等重送", async () => {
  const db = await seedSupervisor();
  const created = await db.query<{ user_access_profile_id: string }>(
    `select * from public.manage_user_account(
      null, 'BatchMe', null, null, true,
      '[{"role":"laundry_worker","site_code":"ACCT_MAIN","institution_code":null}]'::jsonb,
      '60000000-0000-0000-0000-000000000211', '建立批次權限帳號'
    )`,
  );
  const profileId = created.rows[0].user_access_profile_id;

  await db.exec("reset role");
  await db.exec(`
    insert into auth.users (id, email, raw_app_meta_data)
    values (
      '10000000-0000-4000-8000-000000000211',
      'batchme@auth.wash-room.invalid',
      '{"provider":"email","providers":["email"]}'::jsonb
    );
    set role service_role;
  `);
  await db.query("select public.internal_bind_managed_auth_identity($1, $2)", [
    profileId,
    "10000000-0000-4000-8000-000000000211",
  ]);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    "10000000-0000-4000-8000-000000000201",
  ]);
  await db.exec("set role authenticated");

  const rows = [
    {
      email: "batchme@auth.wash-room.invalid",
      login_name: "BatchMe",
      role: "laundry_supervisor",
      site_code: "ACCT_MAIN",
      institution_code: null,
      account_active: true,
      membership_active: true,
    },
  ];
  const first = await db.query<{ applied_count: number; already_applied: boolean }>(
    "select * from public.apply_managed_account_permission_changes($1::jsonb, $2::uuid, $3)",
    [JSON.stringify(rows), "60000000-0000-0000-0000-000000000212", "批次調整主管權限"],
  );
  const retry = await db.query<{ applied_count: number; already_applied: boolean }>(
    "select * from public.apply_managed_account_permission_changes($1::jsonb, $2::uuid, $3)",
    [JSON.stringify(rows), "60000000-0000-0000-0000-000000000212", "批次調整主管權限"],
  );

  expect(first.rows[0]).toEqual({ applied_count: 1, already_applied: false });
  expect(retry.rows[0]).toEqual({ applied_count: 1, already_applied: true });
  const membership = await db.query<{ role: string; active: boolean }>(
    `select role, active from public.access_memberships
     where user_access_profile_id = $1 and operating_site_id = '20000000-0000-4000-8000-000000000201'`,
    [profileId],
  );
  expect(membership.rows).toEqual(
    expect.arrayContaining([{ role: "laundry_supervisor", active: true }]),
  );

  await db.exec("reset role");
  await db.exec(`
    insert into public.user_access_profiles (id, email, login_name)
    values ('40000000-0000-0000-0000-000000000212', 'unmanaged@auth.wash-room.invalid', 'Unmanaged');
    set role authenticated;
  `);
  await expect(
    db.query(
      `select * from public.apply_managed_account_permission_changes(
        '[{"email":"unmanaged@auth.wash-room.invalid","login_name":"Unmanaged","role":"laundry_worker","site_code":"ACCT_MAIN","institution_code":null,"account_active":true,"membership_active":true}]'::jsonb,
        '60000000-0000-0000-0000-000000000213', '拒絕未綁定帳號'
      )`,
    ),
  ).rejects.toThrow(/managed account lifecycle/i);
});

test("既有 CSV 權限工具同樣保留帳號大小寫", async () => {
  const db = await seedSupervisor();
  await db.query(
    "select * from public.apply_access_changes($1::jsonb, $2::uuid, $3)",
    [
      JSON.stringify([
        {
          email: "csvuser@auth.wash-room.invalid",
          login_name: "CsvUSER",
          role: "laundry_worker",
          site_code: "ACCT_MAIN",
          institution_code: null,
          account_active: true,
          membership_active: true,
        },
      ]),
      "60000000-0000-4000-8000-000000000210",
      "CSV 新增帳號",
    ],
  );
  const profile = await db.query<{ login_name: string }>(
    "select login_name from public.user_access_profiles where email = 'csvuser@auth.wash-room.invalid'",
  );
  expect(profile.rows).toEqual([{ login_name: "CsvUSER" }]);
});

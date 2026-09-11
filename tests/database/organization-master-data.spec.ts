import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("全新系統預設本館與法人兩個獨立作業據點", async () => {
  database = await createTestDatabase();

  const sites = await database.query<{
    id: string;
    code: string;
    name: string;
    active: boolean;
  }>(
    `select id, code, name, active
     from public.operating_sites
     order by code`,
  );

  expect(sites.rows).toEqual([
    { id: expect.any(String), code: "CORP", name: "法人", active: true },
    { id: expect.any(String), code: "MAIN", name: "本館", active: true },
  ]);
  expect(sites.rows[0].id).not.toBe(sites.rows[1].id);
});

test("洗衣主管可新增配對至授權作業據點的送洗機構並留下理由與前後值", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000101";
  const requestId = "60000000-0000-4000-8000-000000000101";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorAuthUserId}', 'organization.admin@example.com');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000101',
      'organization.admin@example.com',
      '${supervisorAuthUserId}'
    );

    insert into public.access_memberships (
      user_access_profile_id,
      role,
      operating_site_id
    )
    select
      '40000000-0000-4000-8000-000000000101',
      'laundry_supervisor',
      site.id
    from public.operating_sites as site
    where site.code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorAuthUserId,
  ]);
  await database.exec("set role authenticated");

  const result = await database.query<{
    institution_id: string;
    already_applied: boolean;
  }>(
    `select * from public.apply_institution_change(
       $1::text,
       $2::text,
       $3::text,
       $4::boolean,
       $5::uuid,
       $6::text
     )`,
    [
      " care-a ",
      " 照護機構 A ",
      " main ",
      true,
      requestId,
      "新增送洗機構",
    ],
  );
  const institution = await database.query<{
    code: string;
    name: string;
    site_code: string;
    active: boolean;
  }>(
    `select
       institution.code,
       institution.name,
       site.code as site_code,
       institution.active
     from public.institutions as institution
     join public.operating_sites as site
       on site.id = institution.operating_site_id`,
  );
  const audit = await database.query<{
    actor_auth_user_id: string;
    action: string;
    occurred_at: Date;
    reason: string;
    before_state: unknown;
    after_state: unknown;
    request_id: string;
  }>(
    `select
       actor_auth_user_id,
       action,
       occurred_at,
       reason,
       before_state,
       after_state,
       request_id
     from public.authorization_audit_events
     where action = 'institution_created'`,
  );

  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].already_applied).toBe(false);
  expect(institution.rows).toEqual([
    {
      code: "CARE-A",
      name: "照護機構 A",
      site_code: "MAIN",
      active: true,
    },
  ]);
  expect(audit.rows).toEqual([
    {
      actor_auth_user_id: supervisorAuthUserId,
      action: "institution_created",
      occurred_at: expect.any(Date),
      reason: "新增送洗機構",
      before_state: null,
      after_state: {
        active: true,
        code: "CARE-A",
        name: "照護機構 A",
        site_code: "MAIN",
      },
      request_id: requestId,
    },
  ]);
});

test("洗衣主管可修改及停用送洗機構並在管理範圍內繼續查閱", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000102";
  const requestId = "60000000-0000-4000-8000-000000000102";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorAuthUserId}', 'institution.editor@example.com');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000102',
      'institution.editor@example.com',
      '${supervisorAuthUserId}'
    );

    insert into public.access_memberships (
      user_access_profile_id,
      role,
      operating_site_id
    )
    select
      '40000000-0000-4000-8000-000000000102',
      'laundry_supervisor',
      site.id
    from public.operating_sites as site
    where site.code = 'MAIN';

    insert into public.institutions (code, name, operating_site_id)
    select 'CARE-B', '照護機構 B', site.id
    from public.operating_sites as site
    where site.code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorAuthUserId,
  ]);
  await database.exec("set role authenticated");

  await database.query(
    `select * from public.apply_institution_change(
       $1::text,
       $2::text,
       $3::text,
       $4::boolean,
       $5::uuid,
       $6::text
     )`,
    [
      "CARE-B",
      "照護機構 B（停用）",
      "MAIN",
      false,
      requestId,
      "機構已停止送洗",
    ],
  );

  const institution = await database.query<{
    code: string;
    name: string;
    active: boolean;
  }>(
    `select code, name, active
     from public.institutions
     where code = 'CARE-B'`,
  );
  const audit = await database.query<{
    action: string;
    occurred_at: Date;
    reason: string;
    before_state: unknown;
    after_state: unknown;
  }>(
    `select action, occurred_at, reason, before_state, after_state
     from public.authorization_audit_events
     where request_id = $1`,
    [requestId],
  );

  expect(institution.rows).toEqual([
    { code: "CARE-B", name: "照護機構 B（停用）", active: false },
  ]);
  expect(audit.rows).toEqual([
    {
      action: "institution_updated",
      occurred_at: expect.any(Date),
      reason: "機構已停止送洗",
      before_state: {
        active: true,
        code: "CARE-B",
        name: "照護機構 B",
        site_code: "MAIN",
      },
      after_state: {
        active: false,
        code: "CARE-B",
        name: "照護機構 B（停用）",
        site_code: "MAIN",
      },
    },
  ]);
});

test("機構據點配對變更要求主管同時具有原與目標作業據點權限", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000103";
  const deniedRequestId = "60000000-0000-4000-8000-000000000103";
  const allowedRequestId = "60000000-0000-4000-8000-000000000104";
  const changeArguments = [
    "CARE-C",
    "照護機構 C",
    "CORP",
    true,
    deniedRequestId,
    "調整至法人作業據點",
  ];

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorAuthUserId}', 'pairing.admin@example.com');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000103',
      'pairing.admin@example.com',
      '${supervisorAuthUserId}'
    );

    insert into public.access_memberships (
      user_access_profile_id,
      role,
      operating_site_id
    )
    select
      '40000000-0000-4000-8000-000000000103',
      'laundry_supervisor',
      site.id
    from public.operating_sites as site
    where site.code = 'CORP';

    insert into public.institutions (code, name, operating_site_id)
    select 'CARE-C', '照護機構 C', site.id
    from public.operating_sites as site
    where site.code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorAuthUserId,
  ]);
  await database.exec("set role authenticated");

  await expect(
    database.query(
      `select * from public.apply_institution_change(
         $1::text,
         $2::text,
         $3::text,
         $4::boolean,
         $5::uuid,
         $6::text
       )`,
      changeArguments,
    ),
  ).rejects.toThrow(/source site supervisor access required/);

  await database.exec("reset role");
  await database.exec(`
    insert into public.access_memberships (
      user_access_profile_id,
      role,
      operating_site_id
    )
    select
      '40000000-0000-4000-8000-000000000103',
      'laundry_supervisor',
      site.id
    from public.operating_sites as site
    where site.code = 'MAIN';
  `);
  await database.exec("set role authenticated");
  changeArguments[4] = allowedRequestId;

  await database.query(
    `select * from public.apply_institution_change(
       $1::text,
       $2::text,
       $3::text,
       $4::boolean,
       $5::uuid,
       $6::text
     )`,
    changeArguments,
  );

  const institution = await database.query<{
    code: string;
    site_code: string;
  }>(
    `select institution.code, site.code as site_code
     from public.institutions as institution
     join public.operating_sites as site
       on site.id = institution.operating_site_id
     where institution.code = 'CARE-C'`,
  );
  await database.exec("reset role");
  await database.exec(`
    update public.access_memberships as membership
    set active = false
    from public.operating_sites as site
    where membership.user_access_profile_id =
        '40000000-0000-4000-8000-000000000103'
      and membership.operating_site_id = site.id
      and site.code = 'CORP';
  `);
  await database.exec("set role authenticated");
  const audits = await database.query<{
    request_id: string;
    source_site_code: string;
    occurred_at: Date;
    before_state: unknown;
    after_state: unknown;
  }>(
    `select
       audit.request_id,
       source_site.code as source_site_code,
       audit.occurred_at,
       audit.before_state,
       audit.after_state
     from public.authorization_audit_events as audit
     join public.operating_sites as source_site
       on source_site.id = audit.source_operating_site_id
     where audit.request_id = $1`,
    [allowedRequestId],
  );

  expect(institution.rows).toEqual([{ code: "CARE-C", site_code: "CORP" }]);
  expect(audits.rows).toEqual([
    {
      request_id: allowedRequestId,
      source_site_code: "MAIN",
      occurred_at: expect.any(Date),
      before_state: {
        active: true,
        code: "CARE-C",
        name: "照護機構 C",
        site_code: "MAIN",
      },
      after_state: {
        active: true,
        code: "CARE-C",
        name: "照護機構 C",
        site_code: "CORP",
      },
    },
  ]);
});

test("相同機構異動請求只套用一次且不得以不同內容重放", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000104";
  const requestId = "60000000-0000-4000-8000-000000000105";
  const rpcSql = `select * from public.apply_institution_change(
    $1::text,
    $2::text,
    $3::text,
    $4::boolean,
    $5::uuid,
    $6::text
  )`;
  const changeArguments = [
    "CARE-D",
    "照護機構 D",
    "MAIN",
    true,
    requestId,
    "新增機構 D",
  ];

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorAuthUserId}', 'idempotent.admin@example.com');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000104',
      'idempotent.admin@example.com',
      '${supervisorAuthUserId}'
    );

    insert into public.access_memberships (
      user_access_profile_id,
      role,
      operating_site_id
    )
    select
      '40000000-0000-4000-8000-000000000104',
      'laundry_supervisor',
      site.id
    from public.operating_sites as site
    where site.code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorAuthUserId,
  ]);
  await database.exec("set role authenticated");

  const first = await database.query<{ already_applied: boolean }>(
    rpcSql,
    changeArguments,
  );
  const replay = await database.query<{ already_applied: boolean }>(
    rpcSql,
    changeArguments,
  );

  await expect(
    database.query(rpcSql, [
      "CARE-D",
      "被竄改的機構名稱",
      "MAIN",
      true,
      requestId,
      "新增機構 D",
    ]),
  ).rejects.toThrow(/request id already used with different change/);
  await expect(
    database.query(rpcSql, [
      "CARE-D",
      "照護機構 D",
      "MAIN",
      true,
      requestId,
      "被竄改的異動理由",
    ]),
  ).rejects.toThrow(/request id already used with different change/);

  const persisted = await database.query<{
    name: string;
    audit_count: number;
  }>(
    `select
       institution.name,
       count(audit.id)::integer as audit_count
     from public.institutions as institution
     left join public.authorization_audit_events as audit
       on audit.institution_id = institution.id
     where institution.code = 'CARE-D'
     group by institution.name`,
  );

  expect(first.rows).toEqual([{ institution_id: expect.any(String), already_applied: false }]);
  expect(replay.rows).toEqual([{ institution_id: expect.any(String), already_applied: true }]);
  expect(persisted.rows).toEqual([{ name: "照護機構 D", audit_count: 1 }]);
});

test("非洗衣主管不能透過 RPC 或直接 DML 修改送洗機構", async () => {
  database = await createTestDatabase();
  const workerAuthUserId = "10000000-0000-4000-8000-000000000105";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${workerAuthUserId}', 'organization.worker@example.com');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000105',
      'organization.worker@example.com',
      '${workerAuthUserId}'
    );

    insert into public.access_memberships (
      user_access_profile_id,
      role,
      operating_site_id
    )
    select
      '40000000-0000-4000-8000-000000000105',
      'laundry_worker',
      site.id
    from public.operating_sites as site
    where site.code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    workerAuthUserId,
  ]);
  await database.exec("set role authenticated");

  await expect(
    database.query(
      `select * from public.apply_institution_change(
         'CARE-E',
         '照護機構 E',
         'MAIN',
         true,
         '60000000-0000-4000-8000-000000000106',
         '未授權建立'
       )`,
    ),
  ).rejects.toThrow(/site supervisor access required/);

  await expect(
    database.exec(`
      insert into public.institutions (code, name, operating_site_id)
      select 'CARE-E', '照護機構 E', site.id
      from public.operating_sites as site
      where site.code = 'MAIN';
    `),
  ).rejects.toThrow(/permission denied/);
});

test("空白理由或停用目標據點會整筆拒絕且不留下部分資料", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000106";
  const blankReasonRequestId = "60000000-0000-4000-8000-000000000107";
  const inactiveSiteRequestId = "60000000-0000-4000-8000-000000000108";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${supervisorAuthUserId}', 'validation.admin@example.com');

    insert into public.user_access_profiles (id, email, auth_user_id)
    values (
      '40000000-0000-4000-8000-000000000106',
      'validation.admin@example.com',
      '${supervisorAuthUserId}'
    );

    insert into public.access_memberships (
      user_access_profile_id,
      role,
      operating_site_id
    )
    select
      '40000000-0000-4000-8000-000000000106',
      'laundry_supervisor',
      site.id
    from public.operating_sites as site;

    update public.operating_sites
    set active = false
    where code = 'CORP';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    supervisorAuthUserId,
  ]);
  await database.exec("set role authenticated");

  await expect(
    database.query(
      `select * from public.apply_institution_change(
         'CARE-F', '照護機構 F', 'MAIN', true, $1::uuid, '   '
       )`,
      [blankReasonRequestId],
    ),
  ).rejects.toThrow(/invalid change reason/);
  await expect(
    database.query(
      `select * from public.apply_institution_change(
         'CARE-G', '照護機構 G', 'CORP', true, $1::uuid, '新增機構 G'
       )`,
      [inactiveSiteRequestId],
    ),
  ).rejects.toThrow(/active operating site not found/);

  await database.exec("reset role");
  const persisted = await database.query<{
    institution_count: number;
    request_count: number;
    audit_count: number;
  }>(
    `select
       (select count(*)::integer from public.institutions)
         as institution_count,
       (select count(*)::integer from private.organization_change_requests)
         as request_count,
       (
         select count(*)::integer
         from public.authorization_audit_events
         where request_id in ($1::uuid, $2::uuid)
       ) as audit_count`,
    [blankReasonRequestId, inactiveSiteRequestId],
  );

  expect(persisted.rows).toEqual([
    { institution_count: 0, request_count: 0, audit_count: 0 },
  ]);
});

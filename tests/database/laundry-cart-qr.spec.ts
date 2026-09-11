import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

async function seedSupervisor(
  targetDatabase: TestDatabase,
  authUserId: string,
  profileId: string,
  siteCodes: string[],
) {
  await targetDatabase.query(
    `insert into auth.users (id, email)
     values ($1, $2)`,
    [authUserId, `${profileId}@example.com`],
  );
  await targetDatabase.query(
    `insert into public.user_access_profiles (id, email, auth_user_id)
     values ($1, $2, $3)`,
    [profileId, `${profileId}@example.com`, authUserId],
  );
  await targetDatabase.query(
    `insert into public.access_memberships (
       user_access_profile_id,
       role,
       operating_site_id
     )
     select $1, 'laundry_supervisor', site.id
     from public.operating_sites as site
     where site.code = any($2::text[])`,
    [profileId, siteCodes],
  );
}

async function seedWorker(
  targetDatabase: TestDatabase,
  authUserId: string,
  profileId: string,
  siteCode: string,
) {
  await targetDatabase.query(
    `insert into auth.users (id, email)
     values ($1, $2)`,
    [authUserId, `${profileId}@example.com`],
  );
  await targetDatabase.query(
    `insert into public.user_access_profiles (id, email, auth_user_id)
     values ($1, $2, $3)`,
    [profileId, `${profileId}@example.com`, authUserId],
  );
  await targetDatabase.query(
    `insert into public.access_memberships (
       user_access_profile_id,
       role,
       operating_site_id
     )
     select $1, 'laundry_worker', site.id
     from public.operating_sites as site
     where site.code = $2`,
    [profileId, siteCode],
  );
}

async function seedInstitution(
  targetDatabase: TestDatabase,
  code: string,
  name: string,
  siteCode: string,
) {
  await targetDatabase.query(
    `insert into public.institutions (code, name, operating_site_id)
     select $1, $2, site.id
     from public.operating_sites as site
     where site.code = $3`,
    [code, name, siteCode],
  );
}

async function authenticate(targetDatabase: TestDatabase, authUserId: string) {
  await targetDatabase.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [authUserId],
  );
  await targetDatabase.exec("set role authenticated");
}

test("洗衣主管登錄洗衣車後取得不暴露主鍵的固定 QR 並留下完整稽核", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000201";
  const supervisorProfileId = "40000000-0000-4000-8000-000000000201";
  const requestId = "60000000-0000-4000-8000-000000000201";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    supervisorProfileId,
    ["MAIN"],
  );
  await seedInstitution(database, "CARE-A", "照護機構 A", "MAIN");
  await authenticate(database, supervisorAuthUserId);

  const registration = await database.query<{
    laundry_cart_id: string;
    qr_version: number;
    already_applied: boolean;
    outcome: string;
  }>(
    `select * from public.register_laundry_cart(
       $1::text,
       $2::text,
       $3::uuid,
       $4::text
     )`,
    [" cart-a ", " care-a ", requestId, " 首次建檔 "],
  );
  const cartId = registration.rows[0].laundry_cart_id;
  const carts = await database.query<{
    id: string;
    cart_number: string;
    institution_code: string;
    site_code: string;
    active: boolean;
    current_qr_version: number;
  }>(
    `select
       cart.id,
       cart.cart_number,
       institution.code as institution_code,
       site.code as site_code,
       cart.active,
       cart.current_qr_version
     from public.laundry_carts as cart
     join public.institutions as institution
       on institution.id = cart.institution_id
     join public.operating_sites as site
       on site.id = institution.operating_site_id`,
  );
  const qr = await database.query<{
    laundry_cart_id: string;
    cart_number: string;
    qr_version: number;
    qr_token: string;
  }>(
    `select * from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  const audit = await database.query<{
    actor_auth_user_id: string;
    occurred_at: Date;
    action: string;
    outcome: string;
    reason: string;
    before_state: unknown;
    after_state: unknown;
    request_id: string;
  }>(
    `select
       actor_auth_user_id,
       occurred_at,
       action,
       outcome,
       reason,
       before_state,
       after_state,
       request_id
     from public.authorization_audit_events
     where request_id = $1`,
    [requestId],
  );

  const qrToken = qr.rows[0].qr_token;
  const [tokenVersion, nonce, signature] = qrToken.split(".");
  expect(Buffer.from(nonce, "base64url")).toHaveLength(32);
  expect(Buffer.from(signature, "base64url")).toHaveLength(32);
  expect(tokenVersion).toBe("wrq_v1");
  expect(qrToken).not.toContain(cartId);
  expect(qrToken).not.toContain("CART-A");
  expect(registration.rows).toEqual([
    {
      laundry_cart_id: expect.any(String),
      qr_version: 1,
      already_applied: false,
      outcome: "applied",
    },
  ]);
  expect(carts.rows).toEqual([
    {
      id: cartId,
      cart_number: "CART-A",
      institution_code: "CARE-A",
      site_code: "MAIN",
      active: true,
      current_qr_version: 1,
    },
  ]);
  expect(qr.rows).toEqual([
    {
      laundry_cart_id: cartId,
      cart_number: "CART-A",
      qr_version: 1,
      qr_token: qrToken,
    },
  ]);
  expect(audit.rows).toEqual([
    {
      actor_auth_user_id: supervisorAuthUserId,
      occurred_at: expect.any(Date),
      action: "laundry_cart_registered",
      outcome: "succeeded",
      reason: "首次建檔",
      before_state: null,
      after_state: {
        active: true,
        cart_number: "CART-A",
        institution_code: "CARE-A",
        qr_version: 1,
        site_code: "MAIN",
      },
      request_id: requestId,
    },
  ]);
  expect(JSON.stringify(audit.rows)).not.toContain(qrToken);

  await database.exec("reset role");
  await database.exec("set role service_role");
  const resolved = await database.query<{
    laundry_cart_id: string;
    cart_number: string;
    institution_id: string;
    operating_site_id: string;
    qr_version: number;
  }>(
    `select * from public.resolve_laundry_cart_qr($1::text)`,
    [qrToken],
  );
  expect(resolved.rows).toEqual([
    {
      laundry_cart_id: cartId,
      cart_number: "CART-A",
      institution_id: expect.any(String),
      operating_site_id: expect.any(String),
      qr_version: 1,
    },
  ]);
});

test("相同登錄請求只建立一台洗衣車且不得以不同理由重放", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000202";
  const supervisorProfileId = "40000000-0000-4000-8000-000000000202";
  const requestId = "60000000-0000-4000-8000-000000000202";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    supervisorProfileId,
    ["MAIN"],
  );
  await seedInstitution(database, "CARE-B", "照護機構 B", "MAIN");
  await authenticate(database, supervisorAuthUserId);
  const registrationSql = `select * from public.register_laundry_cart(
    $1::text,
    $2::text,
    $3::uuid,
    $4::text
  )`;
  const registrationArguments = [
    "CART-B",
    "CARE-B",
    requestId,
    "建立固定車卡",
  ];

  const first = await database.query<{
    laundry_cart_id: string;
    qr_version: number;
    already_applied: boolean;
    outcome: string;
  }>(registrationSql, registrationArguments);
  const replay = await database.query<{
    laundry_cart_id: string;
    qr_version: number;
    already_applied: boolean;
    outcome: string;
  }>(registrationSql, registrationArguments);
  await expect(
    database.query(registrationSql, [
      "CART-B",
      "CARE-B",
      requestId,
      "竄改重放理由",
    ]),
  ).rejects.toThrow(/request id already used with different change/);

  const persisted = await database.query<{
    cart_count: number;
    audit_count: number;
  }>(
    `select
       (select count(*)::integer from public.laundry_carts) as cart_count,
       (
         select count(*)::integer
         from public.authorization_audit_events
         where request_id = $1
       ) as audit_count`,
    [requestId],
  );
  const firstCartId = first.rows[0].laundry_cart_id;
  expect(first.rows).toEqual([
    {
      laundry_cart_id: firstCartId,
      qr_version: 1,
      already_applied: false,
      outcome: "applied",
    },
  ]);
  expect(replay.rows).toEqual([
    {
      laundry_cart_id: firstCartId,
      qr_version: 1,
      already_applied: true,
      outcome: "applied",
    },
  ]);
  expect(persisted.rows).toEqual([{ cart_count: 1, audit_count: 1 }]);
});

test("洗衣員與其他據點主管無法登錄洗衣車且被拒絕的 RPC 會留下稽核", async () => {
  database = await createTestDatabase();
  const mainSupervisorAuthUserId = "10000000-0000-4000-8000-000000000203";
  const workerAuthUserId = "10000000-0000-4000-8000-000000000204";
  const corpSupervisorAuthUserId = "10000000-0000-4000-8000-000000000205";
  const workerRequestId = "60000000-0000-4000-8000-000000000203";
  const corpRequestId = "60000000-0000-4000-8000-000000000204";
  await seedSupervisor(
    database,
    mainSupervisorAuthUserId,
    "40000000-0000-4000-8000-000000000203",
    ["MAIN"],
  );
  await seedWorker(
    database,
    workerAuthUserId,
    "40000000-0000-4000-8000-000000000204",
    "MAIN",
  );
  await seedSupervisor(
    database,
    corpSupervisorAuthUserId,
    "40000000-0000-4000-8000-000000000205",
    ["CORP"],
  );
  await seedInstitution(database, "CARE-C", "照護機構 C", "MAIN");
  const registrationSql = `select * from public.register_laundry_cart(
    $1::text, $2::text, $3::uuid, $4::text
  )`;

  await authenticate(database, workerAuthUserId);
  const workerDenied = await database.query<{
    laundry_cart_id: string | null;
    qr_version: number | null;
    already_applied: boolean;
    outcome: string;
  }>(registrationSql, [
    "CART-C",
    "CARE-C",
    workerRequestId,
    "洗衣員越權建檔",
  ]);
  await expect(
    database.query(
      `insert into public.laundry_carts (cart_number, institution_id)
       select 'CART-DIRECT', institution.id
       from public.institutions as institution
       where institution.code = 'CARE-C'`,
    ),
  ).rejects.toThrow(/permission denied/);

  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [corpSupervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  const corpDenied = await database.query<{
    laundry_cart_id: string | null;
    qr_version: number | null;
    already_applied: boolean;
    outcome: string;
  }>(registrationSql, [
    "CART-CORP",
    "CARE-C",
    corpRequestId,
    "其他據點越權建檔",
  ]);

  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [mainSupervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  const audits = await database.query<{
    actor_auth_user_id: string;
    action: string;
    outcome: string;
    reason: string;
    before_state: unknown;
    after_state: unknown;
    request_id: string;
  }>(
    `select
       actor_auth_user_id,
       action,
       outcome,
       reason,
       before_state,
       after_state,
       request_id
     from public.authorization_audit_events
     where request_id in ($1::uuid, $2::uuid)
     order by request_id`,
    [workerRequestId, corpRequestId],
  );
  const carts = await database.query<{ cart_count: number }>(
    `select count(*)::integer as cart_count from public.laundry_carts`,
  );

  expect(workerDenied.rows).toEqual([
    {
      laundry_cart_id: null,
      qr_version: null,
      already_applied: false,
      outcome: "denied",
    },
  ]);
  expect(corpDenied.rows).toEqual(workerDenied.rows);
  expect(carts.rows).toEqual([{ cart_count: 0 }]);
  expect(audits.rows).toEqual([
    {
      actor_auth_user_id: workerAuthUserId,
      action: "laundry_cart_registration_denied",
      outcome: "denied",
      reason: "洗衣員越權建檔",
      before_state: null,
      after_state: {
        active: true,
        cart_number: "CART-C",
        institution_code: "CARE-C",
      },
      request_id: workerRequestId,
    },
    {
      actor_auth_user_id: corpSupervisorAuthUserId,
      action: "laundry_cart_registration_denied",
      outcome: "denied",
      reason: "其他據點越權建檔",
      before_state: null,
      after_state: {
        active: true,
        cart_number: "CART-CORP",
        institution_code: "CARE-C",
      },
      request_id: corpRequestId,
    },
  ]);
});

test("洗衣車停用時固定 QR 立即無效且未重發前啟用仍使用原權杖", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000206";
  const supervisorProfileId = "40000000-0000-4000-8000-000000000206";
  const registerRequestId = "60000000-0000-4000-8000-000000000205";
  const deactivateRequestId = "60000000-0000-4000-8000-000000000206";
  const activateRequestId = "60000000-0000-4000-8000-000000000207";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    supervisorProfileId,
    ["MAIN"],
  );
  await seedInstitution(database, "CARE-D", "照護機構 D", "MAIN");
  await authenticate(database, supervisorAuthUserId);
  const registration = await database.query<{ laundry_cart_id: string }>(
    `select * from public.register_laundry_cart(
       'CART-D', 'CARE-D', $1::uuid, '建立車卡 D'
     )`,
    [registerRequestId],
  );
  const cartId = registration.rows[0].laundry_cart_id;
  const initialQr = await database.query<{ qr_token: string }>(
    `select qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  const token = initialQr.rows[0].qr_token;
  const deactivateSql = `select * from public.set_laundry_cart_active(
    $1::uuid, false, $2::uuid, $3::text
  )`;
  const deactivated = await database.query<{
    laundry_cart_id: string;
    qr_version: number;
    already_applied: boolean;
    outcome: string;
  }>(deactivateSql, [cartId, deactivateRequestId, "洗衣車暫停使用"]);
  const deactivatedReplay = await database.query<{
    laundry_cart_id: string;
    qr_version: number;
    already_applied: boolean;
    outcome: string;
  }>(deactivateSql, [cartId, deactivateRequestId, "洗衣車暫停使用"]);

  await database.exec("reset role");
  await database.exec("set role service_role");
  const inactiveResolution = await database.query(
    `select * from public.resolve_laundry_cart_qr($1::text)`,
    [token],
  );

  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [supervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  const activated = await database.query<{
    laundry_cart_id: string;
    qr_version: number;
    already_applied: boolean;
    outcome: string;
  }>(
    `select * from public.set_laundry_cart_active(
       $1::uuid, true, $2::uuid, $3::text
     )`,
    [cartId, activateRequestId, "恢復洗衣車使用"],
  );
  const qrAfterActivation = await database.query<{ qr_token: string }>(
    `select qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  const audits = await database.query<{
    action: string;
    reason: string;
    before_state: unknown;
    after_state: unknown;
    request_id: string;
  }>(
    `select action, reason, before_state, after_state, request_id
     from public.authorization_audit_events
     where request_id in ($1::uuid, $2::uuid)
     order by request_id`,
    [deactivateRequestId, activateRequestId],
  );

  await database.exec("reset role");
  await database.exec("set role service_role");
  const activeResolution = await database.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id
     from public.resolve_laundry_cart_qr($1::text)`,
    [token],
  );

  expect(deactivated.rows).toEqual([
    {
      laundry_cart_id: cartId,
      qr_version: 1,
      already_applied: false,
      outcome: "applied",
    },
  ]);
  expect(deactivatedReplay.rows).toEqual([
    {
      laundry_cart_id: cartId,
      qr_version: 1,
      already_applied: true,
      outcome: "applied",
    },
  ]);
  expect(inactiveResolution.rows).toEqual([]);
  expect(activated.rows).toEqual([
    {
      laundry_cart_id: cartId,
      qr_version: 1,
      already_applied: false,
      outcome: "applied",
    },
  ]);
  expect(qrAfterActivation.rows).toEqual([{ qr_token: token }]);
  expect(activeResolution.rows).toEqual([{ laundry_cart_id: cartId }]);
  expect(audits.rows).toEqual([
    {
      action: "laundry_cart_deactivated",
      reason: "洗衣車暫停使用",
      before_state: { active: true, qr_version: 1 },
      after_state: { active: false, qr_version: 1 },
      request_id: deactivateRequestId,
    },
    {
      action: "laundry_cart_activated",
      reason: "恢復洗衣車使用",
      before_state: { active: false, qr_version: 1 },
      after_state: { active: true, qr_version: 1 },
      request_id: activateRequestId,
    },
  ]);
});

test("例外重發會原子撤銷舊 QR 且相同請求只產生一個新版本", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000207";
  const supervisorProfileId = "40000000-0000-4000-8000-000000000207";
  const registerRequestId = "60000000-0000-4000-8000-000000000208";
  const reissueRequestId = "60000000-0000-4000-8000-000000000209";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    supervisorProfileId,
    ["MAIN"],
  );
  await seedInstitution(database, "CARE-E", "照護機構 E", "MAIN");
  await authenticate(database, supervisorAuthUserId);
  const registration = await database.query<{ laundry_cart_id: string }>(
    `select * from public.register_laundry_cart(
       'CART-E', 'CARE-E', $1::uuid, '建立車卡 E'
     )`,
    [registerRequestId],
  );
  const cartId = registration.rows[0].laundry_cart_id;
  const initialQr = await database.query<{ qr_token: string }>(
    `select qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  const initialToken = initialQr.rows[0].qr_token;
  const reissueSql = `select * from public.reissue_laundry_cart_qr(
    $1::uuid, $2::uuid, $3::text
  )`;
  const reissueArguments = [
    cartId,
    reissueRequestId,
    "疑似外洩，例外重發",
  ];

  const reissued = await database.query<{
    laundry_cart_id: string;
    qr_version: number;
    already_applied: boolean;
    outcome: string;
  }>(reissueSql, reissueArguments);
  const replay = await database.query<{
    laundry_cart_id: string;
    qr_version: number;
    already_applied: boolean;
    outcome: string;
  }>(reissueSql, reissueArguments);
  await expect(
    database.query(reissueSql, [
      cartId,
      reissueRequestId,
      "竄改重發理由",
    ]),
  ).rejects.toThrow(/request id already used with different change/);
  const currentQr = await database.query<{
    qr_version: number;
    qr_token: string;
  }>(
    `select qr_version, qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  const currentToken = currentQr.rows[0].qr_token;
  const audit = await database.query<{
    actor_auth_user_id: string;
    occurred_at: Date;
    action: string;
    outcome: string;
    reason: string;
    before_state: unknown;
    after_state: unknown;
    request_id: string;
  }>(
    `select
       actor_auth_user_id,
       occurred_at,
       action,
       outcome,
       reason,
       before_state,
       after_state,
       request_id
     from public.authorization_audit_events
     where request_id = $1`,
    [reissueRequestId],
  );

  await database.exec("reset role");
  const credentialHistory = await database.query<{
    version: number;
    revoked: boolean;
    issuance_reason: string;
    revocation_reason: string | null;
  }>(
    `select
       version,
       revoked_at is not null as revoked,
       issuance_reason,
       revocation_reason
     from private.laundry_cart_qr_credentials
     where laundry_cart_id = $1
     order by version`,
    [cartId],
  );
  await expect(
    database.query(
      `update private.laundry_cart_qr_credentials
       set revoked_at = null,
           revoked_by_auth_user_id = null,
           revocation_reason = null
       where laundry_cart_id = $1 and version = 1`,
      [cartId],
    ),
  ).rejects.toThrow(/QR credential history is immutable/);
  await expect(
    database.query(
      `delete from private.laundry_cart_qr_credentials
       where laundry_cart_id = $1 and version = 1`,
      [cartId],
    ),
  ).rejects.toThrow(/QR credential history is immutable/);

  await database.exec("set role service_role");
  const oldResolution = await database.query(
    `select * from public.resolve_laundry_cart_qr($1::text)`,
    [initialToken],
  );
  const newResolution = await database.query<{
    laundry_cart_id: string;
    qr_version: number;
  }>(
    `select laundry_cart_id, qr_version
     from public.resolve_laundry_cart_qr($1::text)`,
    [currentToken],
  );

  expect(reissued.rows).toEqual([
    {
      laundry_cart_id: cartId,
      qr_version: 2,
      already_applied: false,
      outcome: "applied",
    },
  ]);
  expect(replay.rows).toEqual([
    {
      laundry_cart_id: cartId,
      qr_version: 2,
      already_applied: true,
      outcome: "applied",
    },
  ]);
  expect(currentQr.rows).toEqual([
    { qr_version: 2, qr_token: currentToken },
  ]);
  expect(currentToken).not.toBe(initialToken);
  expect(oldResolution.rows).toEqual([]);
  expect(newResolution.rows).toEqual([
    { laundry_cart_id: cartId, qr_version: 2 },
  ]);
  expect(credentialHistory.rows).toEqual([
    {
      version: 1,
      revoked: true,
      issuance_reason: "建立車卡 E",
      revocation_reason: "疑似外洩，例外重發",
    },
    {
      version: 2,
      revoked: false,
      issuance_reason: "疑似外洩，例外重發",
      revocation_reason: null,
    },
  ]);
  expect(audit.rows).toEqual([
    {
      actor_auth_user_id: supervisorAuthUserId,
      occurred_at: expect.any(Date),
      action: "laundry_cart_qr_reissued",
      outcome: "succeeded",
      reason: "疑似外洩，例外重發",
      before_state: { active: true, qr_version: 1 },
      after_state: { active: true, qr_version: 2 },
      request_id: reissueRequestId,
    },
  ]);
  expect(JSON.stringify(audit.rows)).not.toContain(initialToken);
  expect(JSON.stringify(audit.rows)).not.toContain(currentToken);
});

test("跨據點主管不可讀寫洗衣車且管理權會隨機構目前配對移轉", async () => {
  database = await createTestDatabase();
  const mainSupervisorAuthUserId = "10000000-0000-4000-8000-000000000208";
  const corpSupervisorAuthUserId = "10000000-0000-4000-8000-000000000209";
  const dualSupervisorAuthUserId = "10000000-0000-4000-8000-000000000210";
  const registerRequestId = "60000000-0000-4000-8000-000000000210";
  const deniedActiveRequestId = "60000000-0000-4000-8000-000000000211";
  const deniedReissueRequestId = "60000000-0000-4000-8000-000000000212";
  const pairingRequestId = "60000000-0000-4000-8000-000000000213";
  await seedSupervisor(
    database,
    mainSupervisorAuthUserId,
    "40000000-0000-4000-8000-000000000208",
    ["MAIN"],
  );
  await seedSupervisor(
    database,
    corpSupervisorAuthUserId,
    "40000000-0000-4000-8000-000000000209",
    ["CORP"],
  );
  await seedSupervisor(
    database,
    dualSupervisorAuthUserId,
    "40000000-0000-4000-8000-000000000210",
    ["MAIN", "CORP"],
  );
  await seedInstitution(database, "CARE-F", "照護機構 F", "MAIN");
  await authenticate(database, mainSupervisorAuthUserId);
  const registration = await database.query<{ laundry_cart_id: string }>(
    `select * from public.register_laundry_cart(
       'CART-F', 'CARE-F', $1::uuid, '建立車卡 F'
     )`,
    [registerRequestId],
  );
  const cartId = registration.rows[0].laundry_cart_id;
  const initialQr = await database.query<{ qr_token: string }>(
    `select qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  const token = initialQr.rows[0].qr_token;

  await database.exec("reset role");
  await database.exec("set role service_role");
  const resolutionBeforePairing = await database.query<{
    operating_site_id: string;
    qr_version: number;
  }>(
    `select operating_site_id, qr_version
     from public.resolve_laundry_cart_qr($1::text)`,
    [token],
  );
  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [corpSupervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  const corpVisibleBeforePairing = await database.query(
    `select id from public.laundry_carts`,
  );
  const corpQrBeforePairing = await database.query(
    `select * from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  const deniedActive = await database.query<{
    laundry_cart_id: string | null;
    qr_version: number | null;
    already_applied: boolean;
    outcome: string;
  }>(
    `select * from public.set_laundry_cart_active(
       $1::uuid, false, $2::uuid, '跨據點停用'
     )`,
    [cartId, deniedActiveRequestId],
  );
  const deniedReissue = await database.query<{
    laundry_cart_id: string | null;
    qr_version: number | null;
    already_applied: boolean;
    outcome: string;
  }>(
    `select * from public.reissue_laundry_cart_qr(
       $1::uuid, $2::uuid, '跨據點重發'
     )`,
    [cartId, deniedReissueRequestId],
  );

  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [mainSupervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  const deniedAudits = await database.query<{
    action: string;
    outcome: string;
    reason: string;
    request_id: string;
  }>(
    `select action, outcome, reason, request_id
     from public.authorization_audit_events
     where request_id in ($1::uuid, $2::uuid)
     order by request_id`,
    [deniedActiveRequestId, deniedReissueRequestId],
  );

  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [dualSupervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  await database.query(
    `select * from public.apply_institution_change(
       'CARE-F',
       '照護機構 F',
       'CORP',
       true,
       $1::uuid,
       '改配至第二作業據點'
     )`,
    [pairingRequestId],
  );

  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [mainSupervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  const mainVisibleAfterPairing = await database.query(
    `select id from public.laundry_carts`,
  );
  const mainQrAfterPairing = await database.query(
    `select * from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );

  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [corpSupervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  const corpVisibleAfterPairing = await database.query<{
    id: string;
    cart_number: string;
  }>(`select id, cart_number from public.laundry_carts`);
  const corpQrAfterPairing = await database.query<{
    qr_version: number;
    qr_token: string;
  }>(
    `select qr_version, qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  await database.exec("reset role");
  await database.exec("set role service_role");
  const resolutionAfterPairing = await database.query<{
    operating_site_id: string;
    qr_version: number;
  }>(
    `select operating_site_id, qr_version
     from public.resolve_laundry_cart_qr($1::text)`,
    [token],
  );

  expect(corpVisibleBeforePairing.rows).toEqual([]);
  expect(corpQrBeforePairing.rows).toEqual([]);
  expect(deniedActive.rows).toEqual([
    {
      laundry_cart_id: null,
      qr_version: null,
      already_applied: false,
      outcome: "denied",
    },
  ]);
  expect(deniedReissue.rows).toEqual(deniedActive.rows);
  expect(deniedAudits.rows).toEqual([
    {
      action: "laundry_cart_active_change_denied",
      outcome: "denied",
      reason: "跨據點停用",
      request_id: deniedActiveRequestId,
    },
    {
      action: "laundry_cart_qr_reissue_denied",
      outcome: "denied",
      reason: "跨據點重發",
      request_id: deniedReissueRequestId,
    },
  ]);
  expect(mainVisibleAfterPairing.rows).toEqual([]);
  expect(mainQrAfterPairing.rows).toEqual([]);
  expect(corpVisibleAfterPairing.rows).toEqual([
    { id: cartId, cart_number: "CART-F" },
  ]);
  expect(corpQrAfterPairing.rows).toEqual([
    { qr_version: 1, qr_token: token },
  ]);
  expect(resolutionBeforePairing.rows).toEqual([
    { operating_site_id: expect.any(String), qr_version: 1 },
  ]);
  expect(resolutionAfterPairing.rows).toEqual([
    { operating_site_id: expect.any(String), qr_version: 1 },
  ]);
  expect(resolutionAfterPairing.rows[0].operating_site_id).not.toBe(
    resolutionBeforePairing.rows[0].operating_site_id,
  );
});

test("洗衣車號正規化後在所有機構與據點仍保持全系統唯一", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000211";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    "40000000-0000-4000-8000-000000000211",
    ["MAIN", "CORP"],
  );
  await seedInstitution(database, "CARE-G", "照護機構 G", "MAIN");
  await seedInstitution(database, "CARE-H", "照護機構 H", "CORP");
  await authenticate(database, supervisorAuthUserId);
  await database.query(
    `select * from public.register_laundry_cart(
       'CART-GLOBAL',
       'CARE-G',
       '60000000-0000-4000-8000-000000000214'::uuid,
       '第一據點建檔'
     )`,
  );

  await expect(
    database.query(
      `select * from public.register_laundry_cart(
         ' cart-global ',
         'CARE-H',
         '60000000-0000-4000-8000-000000000215'::uuid,
         '第二據點重複車號'
       )`,
    ),
  ).rejects.toThrow(/duplicate key value violates unique constraint/);

  await database.exec("reset role");
  const persisted = await database.query<{
    carts: number;
    second_request: number;
    second_audit: number;
  }>(
    `select
       (select count(*)::integer from public.laundry_carts) as carts,
       (
         select count(*)::integer
         from private.laundry_cart_change_requests
         where id = '60000000-0000-4000-8000-000000000215'::uuid
       ) as second_request,
       (
         select count(*)::integer
         from public.authorization_audit_events
         where request_id = '60000000-0000-4000-8000-000000000215'::uuid
       ) as second_audit`,
  );
  expect(persisted.rows).toEqual([
    { carts: 1, second_request: 0, second_audit: 0 },
  ]);
});

test("異動理由若誤貼固定 QR 權杖會整筆拒絕且不留下敏感資料", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000212";
  const registerRequestId = "60000000-0000-4000-8000-000000000216";
  const unsafeActiveRequestId = "60000000-0000-4000-8000-000000000217";
  const unsafeReissueRequestId = "60000000-0000-4000-8000-000000000218";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    "40000000-0000-4000-8000-000000000212",
    ["MAIN"],
  );
  await seedInstitution(database, "CARE-I", "照護機構 I", "MAIN");
  await authenticate(database, supervisorAuthUserId);
  const registration = await database.query<{ laundry_cart_id: string }>(
    `select * from public.register_laundry_cart(
       'CART-I', 'CARE-I', $1::uuid, '建立車卡 I'
     )`,
    [registerRequestId],
  );
  const cartId = registration.rows[0].laundry_cart_id;
  const qr = await database.query<{ qr_token: string }>(
    `select qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  const token = qr.rows[0].qr_token;

  await expect(
    database.query(
      `select * from public.set_laundry_cart_active(
         $1::uuid, false, $2::uuid, $3::text
       )`,
      [cartId, unsafeActiveRequestId, `誤貼掃碼網址 #v1.cart.${token}`],
    ),
  ).rejects.toThrow(/invalid change reason/);
  await expect(
    database.query(
      `select * from public.reissue_laundry_cart_qr(
         $1::uuid, $2::uuid, $3::text
       )`,
      [cartId, unsafeReissueRequestId, `外洩憑證 ${token}`],
    ),
  ).rejects.toThrow(/invalid change reason/);

  await database.exec("reset role");
  const state = await database.query<{
    active: boolean;
    current_qr_version: number;
    unsafe_requests: number;
    unsafe_audits: number;
    unsafe_credential_reasons: number;
  }>(
    `select
       cart.active,
       cart.current_qr_version,
       (
         select count(*)::integer
         from private.laundry_cart_change_requests
         where id in ($2::uuid, $3::uuid)
       ) as unsafe_requests,
       (
         select count(*)::integer
         from public.authorization_audit_events
         where request_id in ($2::uuid, $3::uuid)
       ) as unsafe_audits,
       (
         select count(*)::integer
         from private.laundry_cart_qr_credentials as credential
         where credential.laundry_cart_id = cart.id
           and (
             credential.issuance_reason like '%' || $4 || '%'
             or credential.revocation_reason like '%' || $4 || '%'
           )
       ) as unsafe_credential_reasons
     from public.laundry_carts as cart
     where cart.id = $1`,
    [cartId, unsafeActiveRequestId, unsafeReissueRequestId, token],
  );
  expect(state.rows).toEqual([
    {
      active: true,
      current_qr_version: 1,
      unsafe_requests: 0,
      unsafe_audits: 0,
      unsafe_credential_reasons: 0,
    },
  ]);
});

test("未授權異動按目標範圍彙總且真實據點攻擊不會被無效目標掩蓋", async () => {
  database = await createTestDatabase();
  const workerAuthUserId = "10000000-0000-4000-8000-000000000213";
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000217";
  const deniedRequestId = "60000000-0000-4000-8000-000000000219";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    "40000000-0000-4000-8000-000000000217",
    ["MAIN"],
  );
  await seedWorker(
    database,
    workerAuthUserId,
    "40000000-0000-4000-8000-000000000213",
    "MAIN",
  );
  await seedInstitution(database, "CARE-J", "照護機構 J", "MAIN");
  await authenticate(database, workerAuthUserId);
  const deniedSql = `select * from public.register_laundry_cart(
    $1::text, 'CARE-J', $2::uuid, $3::text
  )`;
  const expectedDenied = [
    {
      laundry_cart_id: null,
      qr_version: null,
      already_applied: false,
      outcome: "denied",
    },
  ];

  const unknownTarget = await database.query(
    `select * from public.register_laundry_cart(
       'UNKNOWN-CART',
       'UNKNOWN-INSTITUTION',
       '60000000-0000-4000-8000-000000000225'::uuid,
       '嘗試不存在目標'
     )`,
  );
  const first = await database.query(deniedSql, [
    "CART-J",
    deniedRequestId,
    "洗衣員越權建檔",
  ]);
  const exactReplay = await database.query(deniedSql, [
    "CART-J",
    deniedRequestId,
    "洗衣員越權建檔",
  ]);
  const distinctRequest = await database.query(deniedSql, [
    "CART-J-OTHER",
    "60000000-0000-4000-8000-000000000220",
    "持續越權建檔",
  ]);

  await database.exec("reset role");
  const persisted = await database.query<{
    cart_count: number;
    change_request_count: number;
    denial_audit_count: number;
    aggregate_rows: number;
    scoped_total_attempt_count: number;
    scoped_window_attempt_count: number;
    unscoped_total_attempt_count: number;
  }>(
    `select
       (select count(*)::integer from public.laundry_carts) as cart_count,
       (
         select count(*)::integer
         from private.laundry_cart_change_requests
       ) as change_request_count,
       (
         select count(*)::integer
         from public.authorization_audit_events
         where actor_auth_user_id = $1
           and action = 'laundry_cart_registration_denied'
       ) as denial_audit_count,
       (
         select count(*)::integer
         from public.laundry_cart_denial_audit_aggregates
         where actor_auth_user_id = $1
           and operation = 'register'
       ) as aggregate_rows,
       (
         select total_attempt_count::integer
         from public.laundry_cart_denial_audit_aggregates
         where actor_auth_user_id = $1
           and operation = 'register'
           and operating_site_id is not null
       ) as scoped_total_attempt_count,
       (
         select window_attempt_count::integer
         from public.laundry_cart_denial_audit_aggregates
         where actor_auth_user_id = $1
           and operation = 'register'
           and operating_site_id is not null
       ) as scoped_window_attempt_count,
       (
         select total_attempt_count::integer
         from public.laundry_cart_denial_audit_aggregates
         where actor_auth_user_id = $1
           and operation = 'register'
           and operating_site_id is null
       ) as unscoped_total_attempt_count`,
    [workerAuthUserId],
  );

  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [supervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  const visibleToSiteSupervisor = await database.query<{
    audit_count: number;
    aggregate_count: number;
    total_attempt_count: number;
  }>(
    `select
       (
         select count(*)::integer
         from public.authorization_audit_events
         where actor_auth_user_id = $1
           and action = 'laundry_cart_registration_denied'
       ) as audit_count,
       (
         select count(*)::integer
         from public.laundry_cart_denial_audit_aggregates
         where actor_auth_user_id = $1
           and operation = 'register'
       ) as aggregate_count,
       (
         select total_attempt_count::integer
         from public.laundry_cart_denial_audit_aggregates
         where actor_auth_user_id = $1
           and operation = 'register'
       ) as total_attempt_count`,
    [workerAuthUserId],
  );

  expect(unknownTarget.rows).toEqual(expectedDenied);
  expect(first.rows).toEqual(expectedDenied);
  expect(exactReplay.rows).toEqual(expectedDenied);
  expect(distinctRequest.rows).toEqual(expectedDenied);
  expect(persisted.rows).toEqual([
    {
      cart_count: 0,
      change_request_count: 0,
      denial_audit_count: 2,
      aggregate_rows: 2,
      scoped_total_attempt_count: 3,
      scoped_window_attempt_count: 3,
      unscoped_total_attempt_count: 1,
    },
  ]);
  expect(visibleToSiteSupervisor.rows).toEqual([
    { audit_count: 1, aggregate_count: 1, total_attempt_count: 3 },
  ]);
});

test("未授權車卡異動按洗衣車與操作獨立彙總且不改變資產", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000230";
  const workerAuthUserId = "10000000-0000-4000-8000-000000000231";
  const noProfileAuthUserId = "10000000-0000-4000-8000-000000000232";
  const firstCartRegisterRequestId =
    "60000000-0000-4000-8000-000000000230";
  const secondCartRegisterRequestId =
    "60000000-0000-4000-8000-000000000231";
  const requestIds = {
    firstSetActive: "60000000-0000-4000-8000-000000000232",
    firstSetActiveAgain: "60000000-0000-4000-8000-000000000233",
    secondSetActive: "60000000-0000-4000-8000-000000000234",
    firstReissue: "60000000-0000-4000-8000-000000000235",
    secondReissue: "60000000-0000-4000-8000-000000000236",
    firstUnknown: "60000000-0000-4000-8000-000000000237",
    secondUnknown: "60000000-0000-4000-8000-000000000238",
    firstSetActiveAfterWindow: "60000000-0000-4000-8000-000000000239",
    noProfileUnknown: "60000000-0000-4000-8000-000000000240",
    noProfileUnknownAfterWindow:
      "60000000-0000-4000-8000-000000000241",
    anonymous: "60000000-0000-4000-8000-000000000242",
  };
  const unknownCartId = "70000000-0000-4000-8000-000000000230";

  await seedSupervisor(
    database,
    supervisorAuthUserId,
    "40000000-0000-4000-8000-000000000230",
    ["MAIN"],
  );
  await seedWorker(
    database,
    workerAuthUserId,
    "40000000-0000-4000-8000-000000000231",
    "MAIN",
  );
  await database.query(
    `insert into auth.users (id, email)
     values ($1, 'no-profile-cart-audit@example.com')`,
    [noProfileAuthUserId],
  );
  await seedInstitution(database, "CARE-SCOPE", "車卡範圍測試機構", "MAIN");
  await authenticate(database, supervisorAuthUserId);

  const firstRegistration = await database.query<{
    laundry_cart_id: string;
  }>(
    `select * from public.register_laundry_cart(
       'CART-SCOPE-A', 'CARE-SCOPE', $1::uuid, '建立範圍測試車 A'
     )`,
    [firstCartRegisterRequestId],
  );
  const secondRegistration = await database.query<{
    laundry_cart_id: string;
  }>(
    `select * from public.register_laundry_cart(
       'CART-SCOPE-B', 'CARE-SCOPE', $1::uuid, '建立範圍測試車 B'
     )`,
    [secondCartRegisterRequestId],
  );
  const firstCartId = firstRegistration.rows[0].laundry_cart_id;
  const secondCartId = secondRegistration.rows[0].laundry_cart_id;

  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [workerAuthUserId],
  );
  await database.exec("set role authenticated");

  const setActiveSql = `select * from public.set_laundry_cart_active(
    $1::uuid, false, $2::uuid, $3::text
  )`;
  const reissueSql = `select * from public.reissue_laundry_cart_qr(
    $1::uuid, $2::uuid, $3::text
  )`;
  const expectedDenied = [
    {
      laundry_cart_id: null,
      qr_version: null,
      already_applied: false,
      outcome: "denied",
    },
  ];

  const firstSetActive = await database.query(setActiveSql, [
    firstCartId,
    requestIds.firstSetActive,
    "越權停用 A 首次",
  ]);
  const firstSetActiveAgain = await database.query(setActiveSql, [
    firstCartId,
    requestIds.firstSetActiveAgain,
    "越權停用 A 再次",
  ]);
  const secondSetActive = await database.query(setActiveSql, [
    secondCartId,
    requestIds.secondSetActive,
    "越權停用 B 首次",
  ]);
  const firstReissue = await database.query(reissueSql, [
    firstCartId,
    requestIds.firstReissue,
    "越權重發 A 首次",
  ]);
  const secondReissue = await database.query(reissueSql, [
    secondCartId,
    requestIds.secondReissue,
    "越權重發 B 首次",
  ]);
  const firstUnknown = await database.query(setActiveSql, [
    unknownCartId,
    requestIds.firstUnknown,
    "越權停用不存在車輛首次",
  ]);
  const secondUnknown = await database.query(setActiveSql, [
    unknownCartId,
    requestIds.secondUnknown,
    "越權停用不存在車輛再次",
  ]);

  await database.exec("reset role");
  await database.query(
    `update public.laundry_cart_denial_audit_aggregates
     set first_attempted_at = now() - interval '2 hours',
         window_started_at = now() - interval '2 hours'
     where actor_auth_user_id = $1
       and operation = 'set_active'
       and laundry_cart_id = $2`,
    [workerAuthUserId, firstCartId],
  );
  await authenticate(database, workerAuthUserId);
  const firstSetActiveAfterWindow = await database.query(setActiveSql, [
    firstCartId,
    requestIds.firstSetActiveAfterWindow,
    "越權停用 A 跨窗口再次",
  ]);

  await database.exec("reset role");
  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [noProfileAuthUserId],
  );
  await database.exec("set role authenticated");
  const noProfileUnknown = await database.query(setActiveSql, [
    unknownCartId,
    requestIds.noProfileUnknown,
    "無權限資料者停用假 UUID",
  ]);

  await database.exec("reset role");
  await database.query(
    `update public.laundry_cart_denial_audit_aggregates
     set first_attempted_at = now() - interval '2 hours',
         window_started_at = now() - interval '2 hours'
     where actor_auth_user_id = $1
       and operation = 'set_active'
       and laundry_cart_id is null`,
    [noProfileAuthUserId],
  );
  await authenticate(database, noProfileAuthUserId);
  const noProfileUnknownAfterWindow = await database.query(setActiveSql, [
    unknownCartId,
    requestIds.noProfileUnknownAfterWindow,
    "無權限資料者跨窗口再試",
  ]);

  await database.exec("reset role");
  await database.exec("set role anon");
  await expect(
    database.query(setActiveSql, [
      firstCartId,
      requestIds.anonymous,
      "匿名越權停用",
    ]),
  ).rejects.toThrow(/permission denied/);

  await database.exec("reset role");
  const aggregates = await database.query<{
    operation: string;
    laundry_cart_id: string | null;
    operating_site_id: string | null;
    institution_id: string | null;
    total_attempt_count: number;
    window_attempt_count: number;
  }>(
    `select
       aggregate.operation,
       aggregate.laundry_cart_id,
       aggregate.operating_site_id,
       aggregate.institution_id,
       aggregate.total_attempt_count::integer,
       aggregate.window_attempt_count::integer
     from public.laundry_cart_denial_audit_aggregates as aggregate
     left join public.laundry_carts as cart
       on cart.id = aggregate.laundry_cart_id
     where aggregate.actor_auth_user_id = $1
     order by aggregate.operation, cart.cart_number nulls last`,
    [workerAuthUserId],
  );
  const detailedAudits = await database.query<{
    actor_auth_user_id: string;
    actor_access_profile_id: string;
    action: string;
    laundry_cart_id: string;
    operating_site_id: string;
    institution_id: string;
    outcome: string;
    reason: string;
    before_state: unknown;
    after_state: unknown;
    request_id: string;
  }>(
    `select
       audit.actor_auth_user_id,
       audit.actor_access_profile_id,
       audit.action,
       audit.laundry_cart_id,
       audit.operating_site_id,
       audit.institution_id,
       audit.outcome,
       audit.reason,
       audit.before_state,
       audit.after_state,
       audit.request_id
     from public.authorization_audit_events as audit
     join public.laundry_carts as cart
       on cart.id = audit.laundry_cart_id
     where audit.actor_auth_user_id = $1
       and audit.action in (
         'laundry_cart_active_change_denied',
         'laundry_cart_qr_reissue_denied'
       )
     order by audit.action, cart.cart_number`,
    [workerAuthUserId],
  );
  const noProfileUnscoped = await database.query<{
    total_attempt_count: number;
    window_attempt_count: number;
    detail_count: number;
    actor_access_profile_id: string | null;
    laundry_cart_id: string | null;
    operating_site_id: string | null;
    institution_id: string | null;
    reason: string;
  }>(
    `select
       aggregate.total_attempt_count::integer,
       aggregate.window_attempt_count::integer,
       (
         select count(*)::integer
         from public.authorization_audit_events as audit
         where audit.actor_auth_user_id = aggregate.actor_auth_user_id
           and audit.action = 'laundry_cart_active_change_denied'
       ) as detail_count,
       audit.actor_access_profile_id,
       audit.laundry_cart_id,
       audit.operating_site_id,
       audit.institution_id,
       audit.reason
     from public.laundry_cart_denial_audit_aggregates as aggregate
     join public.authorization_audit_events as audit
       on audit.actor_auth_user_id = aggregate.actor_auth_user_id
      and audit.action = 'laundry_cart_active_change_denied'
     where aggregate.actor_auth_user_id = $1
       and aggregate.operation = 'set_active'
       and aggregate.laundry_cart_id is null`,
    [noProfileAuthUserId],
  );
  const assets = await database.query<{
    id: string;
    active: boolean;
    current_qr_version: number;
    credential_count: number;
    revoked_credential_count: number;
  }>(
    `select
       cart.id,
       cart.active,
       cart.current_qr_version,
       count(credential.*)::integer as credential_count,
       count(credential.*) filter (
         where credential.revoked_at is not null
       )::integer as revoked_credential_count
     from public.laundry_carts as cart
     left join private.laundry_cart_qr_credentials as credential
       on credential.laundry_cart_id = cart.id
     where cart.id in ($1::uuid, $2::uuid)
     group by cart.id
     order by cart.cart_number`,
    [firstCartId, secondCartId],
  );
  const anonymousArtifacts = await database.query<{
    audit_count: number;
    aggregate_attempt_count: number;
  }>(
    `select
       (
         select count(*)::integer
         from public.authorization_audit_events
         where request_id = $1
       ) as audit_count,
       (
         select coalesce(sum(total_attempt_count), 0)::integer
         from public.laundry_cart_denial_audit_aggregates
         where actor_auth_user_id = $2
       ) as aggregate_attempt_count`,
    [requestIds.anonymous, workerAuthUserId],
  );

  await expect(
    database.query(
      `update public.authorization_audit_events
       set reason = '不可覆寫'
       where actor_auth_user_id = $1
         and laundry_cart_id is not null
         and outcome = 'denied'`,
      [workerAuthUserId],
    ),
  ).rejects.toThrow(/authorization audit events are immutable/);

  expect(firstSetActive.rows).toEqual(expectedDenied);
  expect(firstSetActiveAgain.rows).toEqual(expectedDenied);
  expect(secondSetActive.rows).toEqual(expectedDenied);
  expect(firstReissue.rows).toEqual(expectedDenied);
  expect(secondReissue.rows).toEqual(expectedDenied);
  expect(firstUnknown.rows).toEqual(expectedDenied);
  expect(secondUnknown.rows).toEqual(expectedDenied);
  expect(firstSetActiveAfterWindow.rows).toEqual(expectedDenied);
  expect(noProfileUnknown.rows).toEqual(expectedDenied);
  expect(noProfileUnknownAfterWindow.rows).toEqual(expectedDenied);
  expect(aggregates.rows).toEqual([
    {
      operation: "reissue_qr",
      laundry_cart_id: firstCartId,
      operating_site_id: expect.any(String),
      institution_id: expect.any(String),
      total_attempt_count: 1,
      window_attempt_count: 1,
    },
    {
      operation: "reissue_qr",
      laundry_cart_id: secondCartId,
      operating_site_id: expect.any(String),
      institution_id: expect.any(String),
      total_attempt_count: 1,
      window_attempt_count: 1,
    },
    {
      operation: "set_active",
      laundry_cart_id: firstCartId,
      operating_site_id: expect.any(String),
      institution_id: expect.any(String),
      total_attempt_count: 3,
      window_attempt_count: 1,
    },
    {
      operation: "set_active",
      laundry_cart_id: secondCartId,
      operating_site_id: expect.any(String),
      institution_id: expect.any(String),
      total_attempt_count: 1,
      window_attempt_count: 1,
    },
    {
      operation: "set_active",
      laundry_cart_id: null,
      operating_site_id: null,
      institution_id: null,
      total_attempt_count: 2,
      window_attempt_count: 2,
    },
  ]);
  expect(detailedAudits.rows).toEqual([
    {
      actor_auth_user_id: workerAuthUserId,
      actor_access_profile_id: "40000000-0000-4000-8000-000000000231",
      action: "laundry_cart_active_change_denied",
      laundry_cart_id: firstCartId,
      operating_site_id: expect.any(String),
      institution_id: expect.any(String),
      outcome: "denied",
      reason: "越權停用 A 首次",
      before_state: { active: true, qr_version: 1 },
      after_state: { active: false },
      request_id: requestIds.firstSetActive,
    },
    {
      actor_auth_user_id: workerAuthUserId,
      actor_access_profile_id: "40000000-0000-4000-8000-000000000231",
      action: "laundry_cart_active_change_denied",
      laundry_cart_id: secondCartId,
      operating_site_id: expect.any(String),
      institution_id: expect.any(String),
      outcome: "denied",
      reason: "越權停用 B 首次",
      before_state: { active: true, qr_version: 1 },
      after_state: { active: false },
      request_id: requestIds.secondSetActive,
    },
    {
      actor_auth_user_id: workerAuthUserId,
      actor_access_profile_id: "40000000-0000-4000-8000-000000000231",
      action: "laundry_cart_qr_reissue_denied",
      laundry_cart_id: firstCartId,
      operating_site_id: expect.any(String),
      institution_id: expect.any(String),
      outcome: "denied",
      reason: "越權重發 A 首次",
      before_state: { active: true, qr_version: 1 },
      after_state: null,
      request_id: requestIds.firstReissue,
    },
    {
      actor_auth_user_id: workerAuthUserId,
      actor_access_profile_id: "40000000-0000-4000-8000-000000000231",
      action: "laundry_cart_qr_reissue_denied",
      laundry_cart_id: secondCartId,
      operating_site_id: expect.any(String),
      institution_id: expect.any(String),
      outcome: "denied",
      reason: "越權重發 B 首次",
      before_state: { active: true, qr_version: 1 },
      after_state: null,
      request_id: requestIds.secondReissue,
    },
  ]);
  expect(noProfileUnscoped.rows).toEqual([
    {
      total_attempt_count: 2,
      window_attempt_count: 1,
      detail_count: 1,
      actor_access_profile_id: null,
      laundry_cart_id: null,
      operating_site_id: null,
      institution_id: null,
      reason: "無權限資料者停用假 UUID",
    },
  ]);
  expect(assets.rows).toEqual([
    {
      id: firstCartId,
      active: true,
      current_qr_version: 1,
      credential_count: 1,
      revoked_credential_count: 0,
    },
    {
      id: secondCartId,
      active: true,
      current_qr_version: 1,
      credential_count: 1,
      revoked_credential_count: 0,
    },
  ]);
  expect(anonymousArtifacts.rows).toEqual([
    { audit_count: 0, aggregate_attempt_count: 8 },
  ]);
});

test("固定 QR 簽章金鑰不可被覆寫而使既有標籤悄悄改變", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000214";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    "40000000-0000-4000-8000-000000000214",
    ["MAIN"],
  );
  await seedInstitution(database, "CARE-K", "照護機構 K", "MAIN");
  await authenticate(database, supervisorAuthUserId);
  const registration = await database.query<{ laundry_cart_id: string }>(
    `select * from public.register_laundry_cart(
       'CART-K',
       'CARE-K',
       '60000000-0000-4000-8000-000000000221'::uuid,
       '建立車卡 K'
     )`,
  );
  const cartId = registration.rows[0].laundry_cart_id;
  const before = await database.query<{ qr_token: string }>(
    `select qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );

  await database.exec("reset role");
  await expect(
    database.query(
      `update private.fixed_asset_qr_signing_keys
       set signing_secret = extensions.gen_random_bytes(32)
       where id = 1`,
    ),
  ).rejects.toThrow(/fixed asset QR signing key is immutable/);
  await expect(
    database.query(
      `delete from private.fixed_asset_qr_signing_keys
       where id = 1`,
    ),
  ).rejects.toThrow(/fixed asset QR signing key is immutable/);

  await database.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [supervisorAuthUserId],
  );
  await database.exec("set role authenticated");
  const after = await database.query<{ qr_token: string }>(
    `select qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  expect(after.rows).toEqual(before.rows);
});

test("洗衣車所屬機構或作業據點停用時固定 QR 都無法解析", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000215";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    "40000000-0000-4000-8000-000000000215",
    ["MAIN"],
  );
  await seedInstitution(database, "CARE-L", "照護機構 L", "MAIN");
  await authenticate(database, supervisorAuthUserId);
  const registration = await database.query<{ laundry_cart_id: string }>(
    `select * from public.register_laundry_cart(
       'CART-L',
       'CARE-L',
       '60000000-0000-4000-8000-000000000222'::uuid,
       '建立車卡 L'
     )`,
  );
  const qr = await database.query<{ qr_token: string }>(
    `select qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [registration.rows[0].laundry_cart_id],
  );
  const token = qr.rows[0].qr_token;

  await database.exec("reset role");
  await database.exec("set role service_role");
  const initiallyValid = await database.query(
    `select * from public.resolve_laundry_cart_qr($1::text)`,
    [token],
  );
  await database.exec("reset role");
  await database.query(
    `update public.institutions
     set active = false
     where code = 'CARE-L'`,
  );
  await database.exec("set role service_role");
  const inactiveInstitution = await database.query(
    `select * from public.resolve_laundry_cart_qr($1::text)`,
    [token],
  );
  await database.exec("reset role");
  await database.query(
    `update public.institutions
     set active = true
     where code = 'CARE-L'`,
  );
  await database.query(
    `update public.operating_sites
     set active = false
     where code = 'MAIN'`,
  );
  await database.exec("set role service_role");
  const inactiveSite = await database.query(
    `select * from public.resolve_laundry_cart_qr($1::text)`,
    [token],
  );

  expect(initiallyValid.rows).toHaveLength(1);
  expect(inactiveInstitution.rows).toEqual([]);
  expect(inactiveSite.rows).toEqual([]);
});

test("只有授權主管可取回固定 QR 且只有 service role 可執行內部解析", async () => {
  database = await createTestDatabase();
  const supervisorAuthUserId = "10000000-0000-4000-8000-000000000216";
  await seedSupervisor(
    database,
    supervisorAuthUserId,
    "40000000-0000-4000-8000-000000000216",
    ["MAIN"],
  );
  await seedInstitution(database, "CARE-M", "照護機構 M", "MAIN");
  await authenticate(database, supervisorAuthUserId);
  const registration = await database.query<{ laundry_cart_id: string }>(
    `select * from public.register_laundry_cart(
       'CART-M',
       'CARE-M',
       '60000000-0000-4000-8000-000000000223'::uuid,
       '建立車卡 M'
     )`,
  );
  const cartId = registration.rows[0].laundry_cart_id;
  const qr = await database.query<{ qr_token: string }>(
    `select qr_token
     from public.get_current_laundry_cart_qr($1::uuid)`,
    [cartId],
  );
  const token = qr.rows[0].qr_token;
  await expect(
    database.query(
      `select * from public.resolve_laundry_cart_qr($1::text)`,
      [token],
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    database.query(
      `update public.laundry_carts
       set active = false
       where id = $1`,
      [cartId],
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    database.query(
      `select * from private.laundry_cart_qr_credentials`,
    ),
  ).rejects.toThrow(/permission denied/);

  await database.exec("reset role");
  await database.exec("set role anon");
  await expect(
    database.query(
      `select * from public.get_current_laundry_cart_qr($1::uuid)`,
      [cartId],
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    database.query(
      `select * from public.register_laundry_cart(
         'ANON-CART',
         'CARE-M',
         '60000000-0000-4000-8000-000000000224'::uuid,
         '匿名越權'
       )`,
    ),
  ).rejects.toThrow(/permission denied/);

  await database.exec("reset role");
  await database.exec("set role service_role");
  const resolved = await database.query<{ laundry_cart_id: string }>(
    `select laundry_cart_id
     from public.resolve_laundry_cart_qr($1::text)`,
    [token],
  );
  await expect(
    database.query(`select * from public.laundry_carts`),
  ).rejects.toThrow(/permission denied/);
  await expect(
    database.query(
      `select * from private.laundry_cart_qr_credentials`,
    ),
  ).rejects.toThrow(/permission denied/);
  expect(resolved.rows).toEqual([{ laundry_cart_id: cartId }]);
});

import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("洗衣主管可在作業據點登錄具能力的洗衣設備並取得固定 QR 版本", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000601";
  const profileId = "40000000-0000-4000-8000-000000000601";
  const requestId = "60000000-0000-4000-8000-000000000601";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${authUserId}', 'equipment.admin@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id)
    values ('${profileId}', 'equipment.admin@example.com', '${authUserId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
    select '${profileId}', 'laundry_supervisor', id
    from public.operating_sites
    where code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    authUserId,
  ]);
  await database.exec("set role authenticated");

  const created = await database.query<{
    laundry_equipment_id: string;
    qr_version: number;
    already_applied: boolean;
    outcome: string;
  }>(
    `select * from public.register_laundry_equipment(
       $1::text, $2::text, $3::text, $4::integer, $5::jsonb, $6::jsonb, $7::uuid, $8::text
     )`,
    [
      "  Washer MAIN 01 ",
      "main",
      "washer",
      18,
      JSON.stringify(["SOILED", "BIB"]),
      JSON.stringify([]),
      requestId,
      "登錄 MAIN 洗衣機",
    ],
  );

  const equipment = await database.query<{
    name: string;
    equipment_type: string;
    capacity_kg: number;
    status: string;
    site_code: string;
    category_codes: string[];
  }>(
    `select
       equipment.name,
       equipment.equipment_type,
       equipment.capacity_kg,
       equipment.status,
       site.code as site_code,
       coalesce(array_agg(category.code order by category.code)
         filter (where category.code is not null), '{}'::text[]) as category_codes
     from public.laundry_equipment as equipment
     join public.operating_sites as site on site.id = equipment.operating_site_id
     left join public.laundry_equipment_categories as capability
       on capability.laundry_equipment_id = equipment.id
     left join public.laundry_categories as category
       on category.id = capability.laundry_category_id
     where equipment.id = $1::uuid
     group by equipment.id, site.code`,
    [created.rows[0]?.laundry_equipment_id],
  );

  expect(created.rows).toEqual([
    {
      laundry_equipment_id: expect.any(String),
      qr_version: 1,
      already_applied: false,
      outcome: "applied",
    },
  ]);
  expect(equipment.rows).toEqual([
    {
      name: "WASHER MAIN 01",
      equipment_type: "washer",
      capacity_kg: 18,
      status: "normal",
      site_code: "MAIN",
      category_codes: ["BIB", "SOILED"],
    },
  ]);
});

test("設備固定 QR 平時不變，例外重發使舊 QR 立即失效且狀態不可用時無法解析", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000602";
  const profileId = "40000000-0000-4000-8000-000000000602";
  const registerRequestId = "60000000-0000-4000-8000-000000000602";
  const updateRequestId = "60000000-0000-4000-8000-000000000603";
  const reissueRequestId = "60000000-0000-4000-8000-000000000604";

  await database.exec(`
    insert into auth.users (id, email) values ('${authUserId}', 'equipment.qr@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id)
      values ('${profileId}', 'equipment.qr@example.com', '${authUserId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${profileId}', 'laundry_supervisor', id from public.operating_sites where code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUserId]);
  await database.exec("set role authenticated");

  const registered = await database.query<{ laundry_equipment_id: string }>(
    `select laundry_equipment_id from public.register_laundry_equipment(
      $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8
    )`,
    ["Dryer QR 01", "MAIN", "dryer", 12, "[\"CURTAIN\"]", "[]", registerRequestId, "建立固定 QR"],
  );
  const equipmentId = registered.rows[0].laundry_equipment_id;
  const firstQr = await database.query<{ qr_token: string; qr_version: number }>(
    `select qr_token, qr_version from public.get_current_laundry_equipment_qr($1)`,
    [equipmentId],
  );
  const secondQr = await database.query<{ qr_token: string; qr_version: number }>(
    `select qr_token, qr_version from public.get_current_laundry_equipment_qr($1)`,
    [equipmentId],
  );

  expect(firstQr.rows).toEqual([{ qr_token: expect.stringMatching(/^wrq_v1\./), qr_version: 1 }]);
  expect(secondQr.rows).toEqual(firstQr.rows);

  const setAbnormal = await database.query(
    `select * from public.update_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    [equipmentId, "Dryer QR 01", 12, "abnormal", "[\"CURTAIN\"]", "[]", updateRequestId, "設備異常暫停"],
  );
  expect(setAbnormal.rows[0]).toMatchObject({ outcome: "applied", qr_version: 1 });
  await database.exec("set role service_role");
  expect((await database.query(`select * from public.resolve_laundry_equipment_qr($1)`, [firstQr.rows[0].qr_token])).rows).toEqual([]);
  await database.exec("set role authenticated");

  const setNormalRequestId = "60000000-0000-4000-8000-000000000605";
  await database.query(
    `select * from public.update_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    [equipmentId, "Dryer QR 01", 12, "normal", "[\"CURTAIN\"]", "[]", setNormalRequestId, "恢復可用"],
  );
  const reissued = await database.query<{ qr_token: string; qr_version: number }>(
    `select * from public.reissue_laundry_equipment_qr($1,$2,$3)`,
    [equipmentId, reissueRequestId, "QR 損壞重發"],
  );
  const newQr = await database.query<{ qr_token: string; qr_version: number }>(
    `select qr_token, qr_version from public.get_current_laundry_equipment_qr($1)`,
    [equipmentId],
  );
  expect(reissued.rows[0]).toMatchObject({ outcome: "applied", qr_version: 2 });
  expect(newQr.rows).toHaveLength(1);
  expect(newQr.rows[0].qr_token).not.toBe(firstQr.rows[0].qr_token);

  await database.exec("set role service_role");
  const oldResolution = await database.query(`select * from public.resolve_laundry_equipment_qr($1)`, [firstQr.rows[0].qr_token]);
  const newResolution = await database.query(`select * from public.resolve_laundry_equipment_qr($1)`, [newQr.rows[0].qr_token]);
  expect(oldResolution.rows).toEqual([]);
  expect(newResolution.rows[0]).toMatchObject({ laundry_equipment_id: equipmentId, status: "normal", qr_version: 2 });
});

test("洗衣主管可刪除從未使用的誤建設備並保留快照稽核", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000606";
  const profileId = "40000000-0000-4000-8000-000000000606";
  const registerRequestId = "60000000-0000-4000-8000-000000000606";
  const deleteRequestId = "60000000-0000-4000-8000-000000000607";
  const workerAuthUserId = "10000000-0000-4000-8000-000000000607";
  const workerProfileId = "40000000-0000-4000-8000-000000000607";

  await database.exec(`
    insert into auth.users (id, email) values
      ('${authUserId}', 'equipment.delete@example.com'),
      ('${workerAuthUserId}', 'equipment.delete.worker@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id) values
      ('${profileId}', 'equipment.delete@example.com', '${authUserId}'),
      ('${workerProfileId}', 'equipment.delete.worker@example.com', '${workerAuthUserId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${profileId}', 'laundry_supervisor', id from public.operating_sites where code = 'MAIN';
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${workerProfileId}', 'laundry_worker', id from public.operating_sites where code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUserId]);
  await database.exec("set role authenticated");

  const registered = await database.query<{ laundry_equipment_id: string }>(
    `select laundry_equipment_id from public.register_laundry_equipment(
      $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8
    )`,
    ["Wrong Washer 01", "MAIN", "washer", 18, "[]", "[]", registerRequestId, "誤建測試設備"],
  );
  const equipmentId = registered.rows[0].laundry_equipment_id;
  const qr = await database.query<{ qr_token: string }>(
    `select qr_token from public.get_current_laundry_equipment_qr($1)`,
    [equipmentId],
  );

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [workerAuthUserId]);
  const workerDenied = await database.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.delete_unused_laundry_equipment($1,$2,$3,$4)`,
    [equipmentId, "WRONG WASHER 01", "60000000-0000-4000-8000-000000000608", "洗衣員嘗試刪除設備"],
  );
  expect(workerDenied.rows).toEqual([{ outcome: "denied", reason_code: "scope_denied" }]);

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUserId]);
  const nameMismatch = await database.query<{ outcome: string; reason_code: string }>(
    `select outcome, reason_code from public.delete_unused_laundry_equipment($1,$2,$3,$4)`,
    [equipmentId, "OTHER WASHER", "60000000-0000-4000-8000-000000000609", "設備名稱確認錯誤"],
  );
  expect(nameMismatch.rows).toEqual([{ outcome: "denied", reason_code: "name_mismatch" }]);
  expect((await database.query(`select id from public.laundry_equipment where id=$1`, [equipmentId])).rows)
    .toEqual([{ id: equipmentId }]);

  const deleted = await database.query<{
    laundry_equipment_id: string;
    already_applied: boolean;
    outcome: string;
    reason_code: string;
  }>(
    `select * from public.delete_unused_laundry_equipment($1,$2,$3,$4)`,
    [equipmentId, "WRONG WASHER 01", deleteRequestId, "刪除誤建且未使用設備"],
  );

  expect(deleted.rows).toEqual([{
    laundry_equipment_id: equipmentId,
    already_applied: false,
    outcome: "applied",
    reason_code: "deleted",
  }]);

  await database.exec("reset role");
  expect((await database.query(`select id from public.laundry_equipment where id=$1`, [equipmentId])).rows).toEqual([]);
  expect((await database.query(`select id from private.laundry_equipment_qr_credentials where laundry_equipment_id=$1`, [equipmentId])).rows).toEqual([]);
  const audits = await database.query<{ action: string; laundry_equipment_id: string | null; before_name: string | null }>(
    `select action, laundry_equipment_id, before_state->>'name' as before_name
       from public.authorization_audit_events
      where request_id in ($1::uuid,$2::uuid)
      order by occurred_at`,
    [registerRequestId, deleteRequestId],
  );
  expect(audits.rows).toEqual([
    { action: "laundry_equipment_registered", laundry_equipment_id: null, before_name: null },
    { action: "laundry_equipment_deleted", laundry_equipment_id: null, before_name: "WRONG WASHER 01" },
  ]);

  await database.exec("set role service_role");
  expect((await database.query(`select * from public.resolve_laundry_equipment_qr($1)`, [qr.rows[0].qr_token])).rows).toEqual([]);
});

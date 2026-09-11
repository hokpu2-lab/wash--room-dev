import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("全新系統提供五個可用的預設洗滌分類", async () => {
  database = await createTestDatabase();

  const categories = await database.query<{
    code: string;
    name: string;
    sort_order: number;
    active: boolean;
  }>(
    `select code, name, sort_order, active
     from public.laundry_categories
     order by sort_order, code`,
  );

  expect(categories.rows).toEqual([
    { code: "DISINFECT", name: "消毒品", sort_order: 10, active: true },
    { code: "BIB", name: "圍兜", sort_order: 20, active: true },
    { code: "SOILED", name: "汙衣", sort_order: 30, active: true },
    { code: "CURTAIN", name: "床簾", sort_order: 40, active: true },
    { code: "OTHER", name: "其他", sort_order: 50, active: true },
  ]);
});

test("洗衣主管可新增、改名、排序及停用分類，且分類只能停用不能刪除", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000501";
  const profileId = "40000000-0000-4000-8000-000000000501";
  const createRequestId = "60000000-0000-4000-8000-000000000501";
  const updateRequestId = "60000000-0000-4000-8000-000000000502";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${authUserId}', 'category.admin@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id)
    values ('${profileId}', 'category.admin@example.com', '${authUserId}');
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
    laundry_category_id: string;
    already_applied: boolean;
  }>(
    `select * from public.create_laundry_category(
       $1::text, $2::text, $3::integer, $4::uuid, $5::text
     )`,
    [
      "special",
      "特殊布品",
      60,
      createRequestId,
      "新增特殊布品分類",
    ],
  );
  const categoryId = created.rows[0].laundry_category_id;

  const updated = await database.query<{
    laundry_category_id: string;
    already_applied: boolean;
  }>(
    `select * from public.update_laundry_category(
       $1::uuid, $2::text, $3::integer, $4::boolean, $5::uuid, $6::text
     )`,
    [
      categoryId,
      "特殊布品（停用）",
      5,
      false,
      updateRequestId,
      "分類改名並停用",
    ],
  );
  const category = await database.query<{
    code: string;
    name: string;
    sort_order: number;
    active: boolean;
  }>(
    `select code, name, sort_order, active
     from public.laundry_categories
     where id = $1::uuid`,
    [categoryId],
  );
  const audit = await database.query<{
    action: string;
    reason: string;
    before_state: unknown;
    after_state: unknown;
  }>(
    `select action, reason, before_state, after_state
     from public.authorization_audit_events
     where request_id in ($1::uuid, $2::uuid)
     order by occurred_at`,
    [createRequestId, updateRequestId],
  );

  expect(created.rows).toEqual([
    { laundry_category_id: expect.any(String), already_applied: false },
  ]);
  expect(updated.rows).toEqual([
    { laundry_category_id: categoryId, already_applied: false },
  ]);
  expect(category.rows).toEqual([
    {
      code: "SPECIAL",
      name: "特殊布品（停用）",
      sort_order: 5,
      active: false,
    },
  ]);
  expect(audit.rows).toEqual([
    {
      action: "laundry_category_created",
      reason: "新增特殊布品分類",
      before_state: null,
      after_state: {
        active: true,
        code: "SPECIAL",
        name: "特殊布品",
        sort_order: 60,
      },
    },
    {
      action: "laundry_category_updated",
      reason: "分類改名並停用",
      before_state: {
        active: true,
        code: "SPECIAL",
        name: "特殊布品",
        sort_order: 60,
      },
      after_state: {
        active: false,
        code: "SPECIAL",
        name: "特殊布品（停用）",
        sort_order: 5,
      },
    },
  ]);

  await expect(
    database.exec(
      `delete from public.laundry_categories where id = '${categoryId}'`,
    ),
  ).rejects.toThrow();
});

test("洗衣主管可建立草稿、發布程序，發布後版本不可原地修改", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000502";
  const profileId = "40000000-0000-4000-8000-000000000502";
  const draftRequestId = "60000000-0000-4000-8000-000000000503";
  const updateDraftRequestId = "60000000-0000-4000-8000-000000000507";
  const publishRequestId = "60000000-0000-4000-8000-000000000504";
  const revisionRequestId = "60000000-0000-4000-8000-000000000505";
  const revisionPublishRequestId = "60000000-0000-4000-8000-000000000506";
  const stages = [
    {
      stage_order: 1,
      name: "消毒浸泡",
      standard_minutes: 30,
      equipment_type: "disinfection_tank",
      compatibility_conditions: { category_codes: ["DISINFECT"] },
      transition_mode: "manual",
      requires_operator_confirmation: true,
    },
    {
      stage_order: 2,
      name: "清洗",
      standard_minutes: 45,
      equipment_type: "washer",
      compatibility_conditions: { category_codes: ["DISINFECT"] },
      transition_mode: "manual",
      requires_operator_confirmation: true,
    },
  ];
  const revisedStages = [
    ...stages,
    {
      stage_order: 3,
      name: "烘乾",
      standard_minutes: 35,
      equipment_type: "dryer",
      compatibility_conditions: { category_codes: ["DISINFECT"] },
      transition_mode: "manual",
      requires_operator_confirmation: true,
    },
  ];

  await database.exec(`
    insert into auth.users (id, email)
    values ('${authUserId}', 'procedure.admin@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id)
    values ('${profileId}', 'procedure.admin@example.com', '${authUserId}');
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
    procedure_template_id: string;
    procedure_version_id: string;
    version_no: number;
    already_applied: boolean;
  }>(
    `select * from public.create_procedure_template_draft(
       $1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::uuid, $7::text
     )`,
    [
      null,
      "MAIN",
      "DISINFECT",
      "消毒標準程序",
      JSON.stringify(stages),
      draftRequestId,
      "建立消毒標準程序草稿",
    ],
  );
  const templateId = created.rows[0].procedure_template_id;
  const draftVersionId = created.rows[0].procedure_version_id;
  const draft = await database.query<{
    status: string;
    version_no: number;
    template_name: string;
    stage_order: number;
    stage_name: string;
    standard_minutes: number;
    equipment_type: string;
    transition_mode: string;
    requires_operator_confirmation: boolean;
  }>(
    `select
       version.status,
       version.version_no,
       version.template_name,
       stage.stage_order,
       stage.name as stage_name,
       stage.standard_minutes,
       stage.equipment_type,
       stage.transition_mode,
       stage.requires_operator_confirmation
     from public.procedure_template_versions as version
     join public.procedure_template_stages as stage
       on stage.procedure_version_id = version.id
     where version.id = $1::uuid
     order by stage.stage_order`,
    [draftVersionId],
  );
  expect(created.rows[0]).toMatchObject({
    procedure_template_id: expect.any(String),
    procedure_version_id: expect.any(String),
    version_no: 1,
    already_applied: false,
  });
  expect(draft.rows).toEqual([
    {
      status: "draft",
      version_no: 1,
      template_name: "消毒標準程序",
      stage_order: 1,
      stage_name: "消毒浸泡",
      standard_minutes: 30,
      equipment_type: "disinfection_tank",
      transition_mode: "manual",
      requires_operator_confirmation: true,
    },
    {
      status: "draft",
      version_no: 1,
      template_name: "消毒標準程序",
      stage_order: 2,
      stage_name: "清洗",
      standard_minutes: 45,
      equipment_type: "washer",
      transition_mode: "manual",
      requires_operator_confirmation: true,
    },
  ]);

  const updatedDraft = await database.query(
    `select * from public.update_procedure_template_draft(
       $1::uuid, $2::text, $3::jsonb, $4::uuid, $5::text
     )`,
    [
      draftVersionId,
      "消毒標準程序草稿",
      JSON.stringify(stages),
      updateDraftRequestId,
      "調整消毒程序草稿名稱",
    ],
  );
  expect(updatedDraft.rows).toEqual([
    {
      procedure_template_id: templateId,
      procedure_version_id: draftVersionId,
      version_no: 1,
      already_applied: false,
    },
  ]);

  const published = await database.query(
    `select * from public.publish_procedure_template_version(
       $1::uuid, $2::uuid, $3::text
     )`,
    [draftVersionId, publishRequestId, "發布消毒標準程序 v1"],
  );
  expect(published.rows).toEqual([
    {
      procedure_template_id: templateId,
      procedure_version_id: draftVersionId,
      version_no: 1,
      already_applied: false,
    },
  ]);

  await expect(
    database.exec(
      `update public.procedure_template_versions
       set template_name = '不應被覆寫'
       where id = '${draftVersionId}'`,
    ),
  ).rejects.toThrow();

  const revised = await database.query<{
    procedure_template_id: string;
    procedure_version_id: string;
    version_no: number;
    already_applied: boolean;
  }>(
    `select * from public.create_procedure_template_draft(
       $1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::uuid, $7::text
     )`,
    [
      templateId,
      null,
      null,
      "消毒標準程序加烘乾",
      JSON.stringify(revisedStages),
      revisionRequestId,
      "新增烘乾階段版本",
    ],
  );
  const revisedVersionId = revised.rows[0].procedure_version_id;
  await database.query(
    `select * from public.publish_procedure_template_version(
       $1::uuid, $2::uuid, $3::text
     )`,
    [revisedVersionId, revisionPublishRequestId, "發布消毒標準程序 v2"],
  );

  const versions = await database.query<{
    version_no: number;
    status: string;
    template_name: string;
    stage_count: number;
  }>(
    `select
       version.version_no,
       version.status,
       version.template_name,
       count(stage.id)::integer as stage_count
     from public.procedure_template_versions as version
     left join public.procedure_template_stages as stage
       on stage.procedure_version_id = version.id
     where version.procedure_template_id = $1::uuid
     group by version.id
     order by version.version_no`,
    [templateId],
  );
  expect(versions.rows).toEqual([
    {
      version_no: 1,
      status: "retired",
      template_name: "消毒標準程序草稿",
      stage_count: 2,
    },
    {
      version_no: 2,
      status: "published",
      template_name: "消毒標準程序加烘乾",
      stage_count: 3,
    },
  ]);
});

test("程序拒絕讓實體設備自動完成，也不保存住民或病患資訊", async () => {
  database = await createTestDatabase();
  const authUserId = "10000000-0000-4000-8000-000000000503";
  const profileId = "40000000-0000-4000-8000-000000000503";

  await database.exec(`
    insert into auth.users (id, email)
    values ('${authUserId}', 'procedure.guard@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id)
    values ('${profileId}', 'procedure.guard@example.com', '${authUserId}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
    select '${profileId}', 'laundry_supervisor', id
    from public.operating_sites
    where code = 'MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    authUserId,
  ]);
  await database.exec("set role authenticated");

  const invalidStage = [
    {
      stage_order: 1,
      name: "自動洗衣",
      standard_minutes: 30,
      equipment_type: "washer",
      compatibility_conditions: {},
      transition_mode: "timer",
      requires_operator_confirmation: false,
    },
  ];
  const piiStage = [
    {
      stage_order: 1,
      name: "病患房號清單",
      standard_minutes: 30,
      equipment_type: "manual",
      compatibility_conditions: {},
      transition_mode: "manual",
      requires_operator_confirmation: true,
    },
  ];

  await expect(
    database.query(
      `select * from public.create_procedure_template_draft(
         null, 'MAIN', 'DISINFECT', '不應發布', $1::jsonb,
         '60000000-0000-4000-8000-000000000508'::uuid, '設備自動完成測試'
       )`,
      [JSON.stringify(invalidStage)],
    ),
  ).rejects.toThrow();
  await expect(
    database.query(
      `select * from public.create_procedure_template_draft(
         null, 'MAIN', 'DISINFECT', '病患資料程序', $1::jsonb,
         '60000000-0000-4000-8000-000000000509'::uuid, '個資防護測試'
       )`,
      [JSON.stringify(piiStage)],
    ),
  ).rejects.toThrow();

  const templates = await database.query<{ count: number }>(
    `select count(*)::integer as count from public.procedure_templates`,
  );
  expect(templates.rows).toEqual([{ count: 0 }]);
});

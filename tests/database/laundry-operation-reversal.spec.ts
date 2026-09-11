import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

const ids = {
  workerAuth: "11000000-0000-4000-8000-000000000001",
  workerProfile: "41000000-0000-4000-8000-000000000001",
  outsiderAuth: "11000000-0000-4000-8000-000000000099",
  outsiderProfile: "41000000-0000-4000-8000-000000000099",
  institution: "31000000-0000-4000-8000-000000000001",
  cart: "51000000-0000-4000-8000-000000000001",
  template: "71000000-0000-4000-8000-000000000001",
  version: "72000000-0000-4000-8000-000000000001",
  stage: "73000000-0000-4000-8000-000000000001",
  secondStage: "73000000-0000-4000-8000-000000000002",
  order: "81000000-0000-4000-8000-000000000001",
  batch: "82000000-0000-4000-8000-000000000001",
  equipment: "83000000-0000-4000-8000-000000000001",
  run: "84000000-0000-4000-8000-000000000001",
  reversalRequest: "85000000-0000-4000-8000-000000000001",
};

async function arrangeStartedStage() {
  database = await createTestDatabase();
  await database.exec(`
    insert into auth.users (id, email)
    values ('${ids.workerAuth}', 'reverse.worker@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id)
    values ('${ids.workerProfile}', 'reverse.worker@example.com', '${ids.workerAuth}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id)
      select '${ids.workerProfile}', 'laundry_worker', id
      from public.operating_sites where code = 'MAIN';
    insert into public.institutions (id, code, name, operating_site_id)
      select '${ids.institution}', 'REV-CARE', '逆流程測試機構', id
      from public.operating_sites where code = 'MAIN';
    insert into public.laundry_carts (id, cart_number, institution_id)
    values ('${ids.cart}', 'REV-CART-01', '${ids.institution}');
    insert into public.procedure_templates (id, operating_site_id, laundry_category_id)
      select '${ids.template}', site.id, category.id
      from public.operating_sites site
      join public.laundry_categories category on category.code = 'SOILED'
      where site.code = 'MAIN';
    insert into public.procedure_template_versions (
      id, procedure_template_id, version_no, template_name, status, published_at
    ) values ('${ids.version}', '${ids.template}', 1, '逆流程清洗', 'draft', null);
    insert into public.procedure_template_stages (
      id, procedure_version_id, stage_order, name, standard_minutes,
      equipment_type, transition_mode, requires_operator_confirmation
    ) values
      (
        '${ids.stage}', '${ids.version}', 1, '清洗', 45,
        'washer', 'manual', true
      ),
      (
        '${ids.secondStage}', '${ids.version}', 2, '烘乾', 50,
        'dryer', 'manual', true
      );
    update public.procedure_template_versions
      set status = 'published', published_at = now()
      where id = '${ids.version}';
    insert into public.laundry_orders (
      id, order_number, laundry_cart_id, institution_id, operating_site_id, status
    ) select
      '${ids.order}', 'MAIN-20260821-0001', '${ids.cart}', '${ids.institution}', id, 'in_process'
      from public.operating_sites where code = 'MAIN';
    insert into public.laundry_batches (
      id, laundry_order_id, source_laundry_cart_id, operating_site_id,
      laundry_category_id, procedure_template_id, procedure_version_id,
      status, current_stage_order, created_by_auth_user_id
    ) select
      '${ids.batch}', '${ids.order}', '${ids.cart}', site.id,
      category.id, '${ids.template}', '${ids.version}',
      'not_started', 1, '${ids.workerAuth}'
      from public.operating_sites site
      join public.laundry_categories category on category.code = 'SOILED'
      where site.code = 'MAIN';
    insert into public.laundry_equipment (
      id, operating_site_id, name, equipment_type, status, occupied
    ) select '${ids.equipment}', id, '逆流程洗衣機', 'washer', 'normal', true
      from public.operating_sites where code = 'MAIN';
    insert into public.laundry_batch_stage_runs (
      id, laundry_batch_id, procedure_stage_id, stage_order, attempt_no,
      laundry_equipment_id, operating_site_id, status, started_by_auth_user_id
    ) select
      '${ids.run}', '${ids.batch}', '${ids.stage}', 1, 1,
      '${ids.equipment}', id, 'in_progress', '${ids.workerAuth}'
      from public.operating_sites where code = 'MAIN';
    update public.laundry_batches
      set status = 'in_progress', active_stage_run_id = '${ids.run}'
      where id = '${ids.batch}';
  `);
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [ids.workerAuth]);
  await database.exec("set role authenticated");
}

test("洗衣員還原誤開始的設備階段會取消執行並釋放設備且保留更正紀錄", async () => {
  await arrangeStartedStage();

  const reversed = await database!.query<{
    laundry_batch_id: string;
    reversed_operation: string;
    restored_batch_status: string;
    restored_order_status: string;
    stage_order: number;
    already_applied: boolean;
    outcome: string;
    reason_code: string;
  }>(
    "select * from public.reverse_last_laundry_batch_operation($1, $2, $3)",
    [ids.batch, "誤掃到這台洗衣機", ids.reversalRequest],
  );
  const state = await database!.query<{
    batch_status: string;
    active_stage_run_id: string | null;
    run_status: string;
    occupied: boolean;
  }>(`
    select batch.status as batch_status, batch.active_stage_run_id,
      run.status as run_status, equipment.occupied
    from public.laundry_batches batch
    join public.laundry_batch_stage_runs run on run.id = '${ids.run}'
    join public.laundry_equipment equipment on equipment.id = '${ids.equipment}'
    where batch.id = '${ids.batch}'
  `);
  const correction = await database!.query<{ reason: string; correction_kind: string }>(
    "select reason, correction_kind from public.laundry_data_corrections where laundry_batch_id = $1",
    [ids.batch],
  );

  expect(reversed.rows).toEqual([{
    laundry_batch_id: ids.batch,
    reversed_operation: "stage_started",
    restored_batch_status: "not_started",
    restored_order_status: "awaiting_cleaning",
    stage_order: 1,
    already_applied: false,
    outcome: "applied",
    reason_code: "stage_start_reversed",
  }]);
  expect(state.rows).toEqual([{
    batch_status: "not_started",
    active_stage_run_id: null,
    run_status: "cancelled",
    occupied: false,
  }]);
  expect(correction.rows).toEqual([{
    reason: "誤掃到這台洗衣機",
    correction_kind: "reopen",
  }]);
});

test("洗衣員還原誤完成的設備階段會保留完成紀錄並重新開啟同一階段", async () => {
  await arrangeStartedStage();
  await database!.exec("reset role");
  await database!.exec(`
    update public.laundry_batch_stage_runs
      set status = 'completed', completed_at = now()
      where id = '${ids.run}';
    update public.laundry_equipment
      set occupied = false
      where id = '${ids.equipment}';
    update public.laundry_batches
      set status = 'not_started', current_stage_order = 2, active_stage_run_id = null
      where id = '${ids.batch}';
  `);
  await database!.exec("set role authenticated");

  const reversed = await database!.query<{
    laundry_batch_id: string;
    reversed_operation: string;
    restored_batch_status: string;
    restored_order_status: string;
    stage_order: number;
    already_applied: boolean;
    outcome: string;
    reason_code: string;
  }>(
    "select * from public.reverse_last_laundry_batch_operation($1, $2, $3)",
    [ids.batch, "衣物其實還沒有洗乾淨", ids.reversalRequest],
  );
  const state = await database!.query<{
    batch_status: string;
    current_stage_order: number;
    active_stage_run_id: string | null;
    run_status: string;
    completed_at: Date | null;
    occupied: boolean;
  }>(`
    select batch.status as batch_status, batch.current_stage_order,
      batch.active_stage_run_id, run.status as run_status, run.completed_at,
      equipment.occupied
    from public.laundry_batches batch
    join public.laundry_batch_stage_runs run on run.id = '${ids.run}'
    join public.laundry_equipment equipment on equipment.id = '${ids.equipment}'
    where batch.id = '${ids.batch}'
  `);

  expect(reversed.rows).toEqual([{
    laundry_batch_id: ids.batch,
    reversed_operation: "stage_completed",
    restored_batch_status: "not_started",
    restored_order_status: "in_process",
    stage_order: 1,
    already_applied: false,
    outcome: "applied",
    reason_code: "stage_completion_reopened",
  }]);
  expect(state.rows).toEqual([{
    batch_status: "not_started",
    current_stage_order: 1,
    active_stage_run_id: null,
    run_status: "completed",
    completed_at: expect.any(Date),
    occupied: false,
  }]);
});

test("洗衣員還原誤裝車會把來源車恢復待裝車並撤銷待取件", async () => {
  await arrangeStartedStage();
  await database!.exec("reset role");
  await database!.exec(`
    update public.laundry_batch_stage_runs
      set procedure_stage_id = '${ids.secondStage}', stage_order = 2,
        status = 'completed', completed_at = now()
      where id = '${ids.run}';
    update public.laundry_equipment
      set occupied = false
      where id = '${ids.equipment}';
    update public.laundry_batch_sources
      set load_status = 'loaded', loaded_at = now()
      where shared_batch_id = '${ids.batch}';
    update public.laundry_batches
      set status = 'loaded', current_stage_order = 2, active_stage_run_id = null,
        completed_at = null, loaded_at = now()
      where id = '${ids.batch}';
    update public.laundry_orders
      set status = 'ready_for_pickup'
      where id = '${ids.order}';
  `);
  await database!.exec("set role authenticated");

  const reversed = await database!.query<{
    laundry_batch_id: string;
    reversed_operation: string;
    restored_batch_status: string;
    restored_order_status: string;
    stage_order: number;
    already_applied: boolean;
    outcome: string;
    reason_code: string;
  }>(
    "select * from public.reverse_last_laundry_batch_operation($1, $2, $3)",
    [ids.batch, "其實還沒有放回來源洗衣車", ids.reversalRequest],
  );
  const state = await database!.query<{
    batch_status: string;
    completed_at: Date | null;
    loaded_at: Date | null;
    order_status: string;
    load_status: string;
    source_loaded_at: Date | null;
  }>(`
    select batch.status as batch_status, batch.completed_at, batch.loaded_at,
      laundry_order.status as order_status, source.load_status,
      source.loaded_at as source_loaded_at
    from public.laundry_batches batch
    join public.laundry_orders laundry_order on laundry_order.id = batch.laundry_order_id
    join public.laundry_batch_sources source on source.shared_batch_id = batch.id
    where batch.id = '${ids.batch}'
  `);

  expect(reversed.rows).toEqual([{
    laundry_batch_id: ids.batch,
    reversed_operation: "source_loaded",
    restored_batch_status: "completed",
    restored_order_status: "in_process",
    stage_order: 2,
    already_applied: false,
    outcome: "applied",
    reason_code: "source_load_reversed",
  }]);
  expect(state.rows).toEqual([{
    batch_status: "completed",
    completed_at: expect.any(Date),
    loaded_at: null,
    order_status: "in_process",
    load_status: "pending",
    source_loaded_at: null,
  }]);
});

test("相同還原請求重送只回傳既有結果且不會重複寫入更正紀錄", async () => {
  await arrangeStartedStage();

  const first = await database!.query(
    "select * from public.reverse_last_laundry_batch_operation($1, $2, $3)",
    [ids.batch, "重複送出測試", ids.reversalRequest],
  );
  const replay = await database!.query(
    "select * from public.reverse_last_laundry_batch_operation($1, $2, $3)",
    [ids.batch, "重複送出測試", ids.reversalRequest],
  );
  const corrections = await database!.query<{ count: number }>(
    "select count(*)::integer as count from public.laundry_data_corrections where laundry_batch_id = $1",
    [ids.batch],
  );

  expect(first.rows[0]).toMatchObject({
    already_applied: false,
    outcome: "applied",
    reason_code: "stage_start_reversed",
  });
  expect(replay.rows[0]).toMatchObject({
    already_applied: true,
    outcome: "applied",
    reason_code: "stage_start_reversed",
  });
  expect(corrections.rows).toEqual([{ count: 1 }]);
});

test("沒有該據點權限的帳號不能還原且不會改變設備或批次", async () => {
  await arrangeStartedStage();
  await database!.exec("reset role");
  await database!.exec(`
    insert into auth.users (id, email)
    values ('${ids.outsiderAuth}', 'reverse.outsider@example.com');
    insert into public.user_access_profiles (id, email, auth_user_id)
    values ('${ids.outsiderProfile}', 'reverse.outsider@example.com', '${ids.outsiderAuth}');
  `);
  await database!.query("select set_config('request.jwt.claim.sub', $1, false)", [ids.outsiderAuth]);
  await database!.exec("set role authenticated");

  const denied = await database!.query<{
    outcome: string;
    reason_code: string;
  }>(
    "select outcome, reason_code from public.reverse_last_laundry_batch_operation($1, $2, $3)",
    [ids.batch, "嘗試跨據點還原", ids.reversalRequest],
  );
  await database!.exec("reset role");
  const state = await database!.query<{
    batch_status: string;
    run_status: string;
    occupied: boolean;
    correction_count: number;
  }>(`
    select batch.status as batch_status, run.status as run_status,
      equipment.occupied,
      (select count(*)::integer from public.laundry_data_corrections
        where laundry_batch_id = batch.id) as correction_count
    from public.laundry_batches batch
    join public.laundry_batch_stage_runs run on run.id = '${ids.run}'
    join public.laundry_equipment equipment on equipment.id = '${ids.equipment}'
    where batch.id = '${ids.batch}'
  `);

  expect(denied.rows).toEqual([{
    outcome: "denied",
    reason_code: "worker_scope_denied",
  }]);
  expect(state.rows).toEqual([{
    batch_status: "in_progress",
    run_status: "in_progress",
    occupied: true,
    correction_count: 0,
  }]);
});

test("洗衣單已取件後拒絕還原", async () => {
  await arrangeStartedStage();
  await database!.exec("reset role");
  await database!.exec(`
    update public.laundry_orders
      set status = 'picked_up', closed_at = now()
      where id = '${ids.order}';
  `);
  await database!.exec("set role authenticated");

  const denied = await database!.query<{
    outcome: string;
    reason_code: string;
  }>(
    "select outcome, reason_code from public.reverse_last_laundry_batch_operation($1, $2, $3)",
    [ids.batch, "取件後嘗試回退", ids.reversalRequest],
  );

  expect(denied.rows).toEqual([{
    outcome: "denied",
    reason_code: "order_already_picked_up",
  }]);
});

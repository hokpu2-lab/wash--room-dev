import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

test("同據點兩個送洗機構主管不能讀取彼此的洗衣單、批次、階段、設備、異常與 Dashboard", async () => {
  database = await createTestDatabase();
  const site = await database.query<{ id: string }>(
    "select id from public.operating_sites where code = 'MAIN'",
  );
  const siteId = site.rows[0].id;
  const institutionA = "30000000-0000-4000-8000-000000000201";
  const institutionB = "30000000-0000-4000-8000-000000000202";
  const supervisorA = "10000000-0000-4000-8000-000000000201";
  const supervisorB = "10000000-0000-4000-8000-000000000202";
  const workerId = "10000000-0000-4000-8000-000000000203";
  const profileA = "40000000-0000-4000-8000-000000000201";
  const profileB = "40000000-0000-4000-8000-000000000202";
  const profileWorker = "40000000-0000-4000-8000-000000000203";
  const cartA = "41000000-0000-4000-8000-000000000201";
  const cartB = "41000000-0000-4000-8000-000000000202";
  const orderA = "51000000-0000-4000-8000-000000000201";
  const orderB = "51000000-0000-4000-8000-000000000202";
  const batchA = "61000000-0000-4000-8000-000000000201";
  const batchB = "61000000-0000-4000-8000-000000000202";
  const templateId = "71000000-0000-4000-8000-000000000201";
  const versionId = "72000000-0000-4000-8000-000000000201";
  const stageId = "73000000-0000-4000-8000-000000000201";
  const equipmentId = "81000000-0000-4000-8000-000000000201";
  const runA = "91000000-0000-4000-8000-000000000201";
  const runB = "91000000-0000-4000-8000-000000000202";
  const incidentA = "a1000000-0000-4000-8000-000000000201";
  const incidentB = "a1000000-0000-4000-8000-000000000202";

  await database.exec(`
    insert into auth.users (id, email, raw_app_meta_data) values
      ('${supervisorA}', 'inst.a@example.com', '{"provider":"email","providers":["email"]}'),
      ('${supervisorB}', 'inst.b@example.com', '{"provider":"email","providers":["email"]}'),
      ('${workerId}', 'site.worker@example.com', '{"provider":"email","providers":["email"]}');
    insert into public.user_access_profiles (id, email, auth_user_id) values
      ('${profileA}', 'inst.a@example.com', '${supervisorA}'),
      ('${profileB}', 'inst.b@example.com', '${supervisorB}'),
      ('${profileWorker}', 'site.worker@example.com', '${workerId}');
    insert into public.institutions (id, code, name, operating_site_id) values
      ('${institutionA}', 'CARE-A', '照護機構 A', '${siteId}'),
      ('${institutionB}', 'CARE-B', '照護機構 B', '${siteId}');
    insert into public.access_memberships (user_access_profile_id, role, institution_id) values
      ('${profileA}', 'institution_supervisor', '${institutionA}'),
      ('${profileB}', 'institution_supervisor', '${institutionB}');
    insert into public.access_memberships (user_access_profile_id, role, operating_site_id) values
      ('${profileWorker}', 'laundry_worker', '${siteId}');
    insert into public.laundry_carts (id, cart_number, institution_id) values
      ('${cartA}', 'CART-A-01', '${institutionA}'),
      ('${cartB}', 'CART-B-01', '${institutionB}');
    insert into public.laundry_orders (id, order_number, laundry_cart_id, institution_id, operating_site_id, status) values
      ('${orderA}', 'MAIN-20260818-0001', '${cartA}', '${institutionA}', '${siteId}', 'in_process'),
      ('${orderB}', 'MAIN-20260818-0002', '${cartB}', '${institutionB}', '${siteId}', 'in_process');
    insert into public.procedure_templates (id, operating_site_id, laundry_category_id)
      select '${templateId}', '${siteId}', id from public.laundry_categories where code = 'SOILED';
    insert into public.procedure_template_versions (id, procedure_template_id, version_no, template_name, status)
      values ('${versionId}', '${templateId}', 1, '汙衣程序', 'draft');
    insert into public.procedure_template_stages (id, procedure_version_id, stage_order, name, standard_minutes, equipment_type)
      values ('${stageId}', '${versionId}', 1, '清洗', 30, 'washer');
    update public.procedure_template_versions
      set status = 'published', published_at = now()
      where id = '${versionId}';
    insert into public.laundry_batches (
      id, laundry_order_id, source_laundry_cart_id, operating_site_id, laundry_category_id,
      procedure_template_id, procedure_version_id, status, created_by_auth_user_id
    )
      select '${batchA}', '${orderA}', '${cartA}', '${siteId}', category.id, '${templateId}', '${versionId}', 'in_progress', '${workerId}'
      from public.laundry_categories category where category.code = 'SOILED';
    insert into public.laundry_batches (
      id, laundry_order_id, source_laundry_cart_id, operating_site_id, laundry_category_id,
      procedure_template_id, procedure_version_id, status, created_by_auth_user_id
    )
      select '${batchB}', '${orderB}', '${cartB}', '${siteId}', category.id, '${templateId}', '${versionId}', 'in_progress', '${workerId}'
      from public.laundry_categories category where category.code = 'SOILED';
    insert into public.laundry_equipment (id, operating_site_id, name, equipment_type)
      values ('${equipmentId}', '${siteId}', 'WASHER CROSS 01', 'washer');
    insert into public.laundry_batch_stage_runs (
      id, laundry_batch_id, procedure_stage_id, stage_order, laundry_equipment_id,
      operating_site_id, started_by_auth_user_id
    ) values
      ('${runA}', '${batchA}', '${stageId}', 1, '${equipmentId}', '${siteId}', '${workerId}'),
      ('${runB}', '${batchB}', '${stageId}', 1, '${equipmentId}', '${siteId}', '${workerId}');
    alter table public.laundry_batch_incidents disable trigger enqueue_batch_incident_notification_after_insert;
    insert into public.laundry_batch_incidents (
      id, laundry_batch_id, incident_type, responsibility, reason, recorded_by_auth_user_id
    ) values
      ('${incidentA}', '${batchA}', 'damaged', '洗衣房', 'A 機構破損', '${workerId}'),
      ('${incidentB}', '${batchB}', 'damaged', '洗衣房', 'B 機構破損', '${workerId}');
    alter table public.laundry_batch_incidents enable trigger enqueue_batch_incident_notification_after_insert;
  `);

  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [supervisorA]);
  await database.exec("set role authenticated");

  const siteAccess = await database.query<{ has_site_access: boolean }>(
    `select private.has_site_access($1::uuid)`,
    [siteId],
  );
  const orders = await database.query<{ id: string }>("select id from public.laundry_orders");
  const batches = await database.query<{ id: string }>("select id from public.laundry_batches");
  const stages = await database.query<{ id: string }>("select id from public.laundry_batch_stage_runs");
  const equipment = await database.query<{ id: string }>("select id from public.laundry_equipment");
  const incidents = await database.query<{ id: string }>("select id from public.laundry_batch_incidents");
  const dashboard = await database.query<{ get_laundry_dashboard: { orders?: { in_process: number }; outcome?: string } }>(
    "select public.get_laundry_dashboard($1::uuid)",
    [siteId],
  );
  const snapshot = await database.query<{
    get_workspace_snapshot_with_details: {
      outcome: string;
      queue?: { items: Array<{ id: string }> };
      orders?: { in_process: number };
      order_details?: Array<{
        order_id: string;
        batches: Array<{
          category_name: string;
          active_equipment_name: string | null;
          progress: { overall_progress_percent: number };
        }>;
      }>;
    };
  }>("select public.get_workspace_snapshot_with_details($1::uuid)", [siteId]);

  expect(siteAccess.rows[0]?.has_site_access).toBe(false);
  expect(orders.rows.map((row) => row.id)).toEqual([orderA]);
  expect(batches.rows.map((row) => row.id)).toEqual([batchA]);
  expect(stages.rows.map((row) => row.id)).toEqual([runA]);
  expect(equipment.rows).toEqual([]);
  expect(incidents.rows.map((row) => row.id)).toEqual([incidentA]);
  expect(dashboard.rows[0]?.get_laundry_dashboard.orders?.in_process).toBe(1);
  expect(snapshot.rows[0]?.get_workspace_snapshot_with_details.outcome).toBe("ok");
  expect(snapshot.rows[0]?.get_workspace_snapshot_with_details.queue?.items.map((item) => item.id)).toEqual([orderA]);
  expect(snapshot.rows[0]?.get_workspace_snapshot_with_details.orders?.in_process).toBe(1);
  expect(snapshot.rows[0]?.get_workspace_snapshot_with_details.order_details).toMatchObject([
    {
      order_id: orderA,
      batches: [{
        category_name: "汙衣",
        active_equipment_name: null,
        progress: { overall_progress_percent: expect.any(Number) },
      }],
    },
  ]);

  await database.exec("reset role");
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [workerId]);
  await database.exec("set role authenticated");
  const workerOrders = await database.query<{ id: string }>(
    "select id from public.laundry_orders order by order_number",
  );
  expect(workerOrders.rows.map((row) => row.id)).toEqual([orderA, orderB]);
});

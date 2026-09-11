import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;
afterEach(async () => { await database?.close(); database = undefined; });

test("最後階段裝回來源車後可匿名取件，結案後同車可建立下一張單", async () => {
  database = await createTestDatabase();
  const supervisor = "10000000-0000-4000-8000-000000000931";
  const supervisorProfile = "40000000-0000-4000-8000-000000000931";
  const worker = "10000000-0000-4000-8000-000000000932";
  const workerProfile = "40000000-0000-4000-8000-000000000932";
  const ids = Array.from({ length: 10 }, (_, index) => `60000000-0000-4000-8000-0000000011${30 + index}`);
  await database.exec(`
    insert into auth.users (id,email) values ('${supervisor}','pickup.supervisor@example.com'),('${worker}','pickup.worker@example.com');
    insert into public.user_access_profiles (id,email,auth_user_id) values ('${supervisorProfile}','pickup.supervisor@example.com','${supervisor}'),('${workerProfile}','pickup.worker@example.com','${worker}');
    insert into public.access_memberships (user_access_profile_id,role,operating_site_id) select '${supervisorProfile}','laundry_supervisor',id from public.operating_sites where code='MAIN';
    insert into public.access_memberships (user_access_profile_id,role,operating_site_id) select '${workerProfile}','laundry_worker',id from public.operating_sites where code='MAIN';
    insert into public.institutions (code,name,operating_site_id) select 'PICKUP-CARE','取件測試機構',id from public.operating_sites where code='MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub',$1,false)`,[supervisor]); await database.exec("set role authenticated");
  const stages=[{stage_order:1,name:"清洗",standard_minutes:30,equipment_type:"washer",compatibility_conditions:{category_codes:["SOILED"]},transition_mode:"manual",requires_operator_confirmation:true}];
  const draft=await database.query<{procedure_template_id:string;procedure_version_id:string}>(`select * from public.create_procedure_template_draft(null,$1,$2,$3,$4::jsonb,$5,$6)`,["MAIN","SOILED","取件程序",JSON.stringify(stages),ids[0],"建立取件程序"]);
  await database.query(`select * from public.publish_procedure_template_version($1,$2,$3)`,[draft.rows[0].procedure_version_id,ids[1],"發布取件程序"]);
  const cart=await database.query<{laundry_cart_id:string}>(`select laundry_cart_id from public.register_laundry_cart($1,$2,$3,$4)`,["PICKUP-CART","PICKUP-CARE",ids[2],"建立取件車"]);
  const cartQr=await database.query<{qr_token:string}>(`select qr_token from public.get_current_laundry_cart_qr($1)`,[cart.rows[0].laundry_cart_id]);
  await database.exec("set role anon"); const order=await database.query<{laundry_order_id:string;status:string}>(`select laundry_order_id,status from public.create_laundry_order_from_cart_qr($1,$2)`,[cartQr.rows[0].qr_token,ids[3]]);
  await database.query(`select set_config('request.jwt.claim.sub',$1,false)`,[worker]); await database.exec("set role authenticated");
  const received=await database.query<{laundry_order_id:string}>(`select laundry_order_id from public.receive_laundry_order_from_cart_qr($1,$2::jsonb,$3)`,[cartQr.rows[0].qr_token,JSON.stringify(["SOILED"]),ids[4]]);
  const batch=await database.query<{id:string}>(`select id from public.laundry_batches where laundry_order_id=$1::uuid`,[received.rows[0].laundry_order_id]);
  await database.query(`select set_config('request.jwt.claim.sub',$1,false)`,[supervisor]);
  const equipment=await database.query<{laundry_equipment_id:string}>(`select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,["Washer PICKUP 01","MAIN","washer",18,JSON.stringify(["SOILED"]),JSON.stringify([draft.rows[0].procedure_template_id]),ids[5],"建立取件洗衣機"]);
  const equipmentQr=await database.query<{qr_token:string}>(`select qr_token from public.get_current_laundry_equipment_qr($1)`,[equipment.rows[0].laundry_equipment_id]);
  await database.query(`select set_config('request.jwt.claim.sub',$1,false)`,[worker]);
  await database.query(`select * from public.start_laundry_batch_washing_from_equipment_qr($1,$2,$3)`,[equipmentQr.rows[0].qr_token,batch.rows[0].id,ids[6]]);
  await database.query(`select * from public.complete_laundry_washing_and_start_drying($1,$2,$3)`,[batch.rows[0].id,equipmentQr.rows[0].qr_token,ids[7]]);
  const loaded=await database.query<{batch_status:string;order_status:string;reason_code:string}>(`select batch_status,order_status,reason_code from public.load_laundry_batch_to_source_cart($1,$2,$3)`,[batch.rows[0].id,cartQr.rows[0].qr_token,ids[8]]);
  expect(loaded.rows).toEqual([{batch_status:"loaded",order_status:"ready_for_pickup",reason_code:"loaded"}]);
  await database.exec("set role anon");
  const picked=await database.query<{status:string;reason_code:string}>(`select status,reason_code from public.pickup_laundry_order_from_cart_qr($1,$2)`,[cartQr.rows[0].qr_token,ids[9]]);
  expect(picked.rows).toEqual([{status:"picked_up",reason_code:"picked_up"}]);
  const next=await database.query<{status:string}>(`select status from public.create_laundry_order_from_cart_qr($1,$2)`,[cartQr.rows[0].qr_token,"60000000-0000-4000-8000-000000001140"]);
  expect(next.rows).toEqual([{status:"awaiting_receipt"}]);
  expect(order.rows[0].status).toBe("awaiting_receipt");
});

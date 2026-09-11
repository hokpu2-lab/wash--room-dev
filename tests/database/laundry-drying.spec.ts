import { afterEach, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase | undefined;

afterEach(async () => { await database?.close(); database = undefined; });

test("洗衣完成後掃相容烘衣機，原子釋放洗衣機並開始烘乾", async () => {
  database = await createTestDatabase();
  const supervisor = "10000000-0000-4000-8000-000000000921";
  const supervisorProfile = "40000000-0000-4000-8000-000000000921";
  const worker = "10000000-0000-4000-8000-000000000922";
  const workerProfile = "40000000-0000-4000-8000-000000000922";
  const ids = Array.from({ length: 10 }, (_, index) => `60000000-0000-4000-8000-0000000010${20 + index}`);
  await database.exec(`
    insert into auth.users (id,email) values ('${supervisor}','dry.supervisor@example.com'),('${worker}','dry.worker@example.com');
    insert into public.user_access_profiles (id,email,auth_user_id) values ('${supervisorProfile}','dry.supervisor@example.com','${supervisor}'),('${workerProfile}','dry.worker@example.com','${worker}');
    insert into public.access_memberships (user_access_profile_id,role,operating_site_id) select '${supervisorProfile}','laundry_supervisor',id from public.operating_sites where code='MAIN';
    insert into public.access_memberships (user_access_profile_id,role,operating_site_id) select '${workerProfile}','laundry_worker',id from public.operating_sites where code='MAIN';
    insert into public.institutions (code,name,operating_site_id) select 'DRY-CARE','烘乾測試機構',id from public.operating_sites where code='MAIN';
  `);
  await database.query(`select set_config('request.jwt.claim.sub',$1,false)`,[supervisor]); await database.exec("set role authenticated");
  const stages = [
    { stage_order: 1, name: "清洗", standard_minutes: 45, equipment_type: "washer", compatibility_conditions: { category_codes: ["SOILED"] }, transition_mode: "manual", requires_operator_confirmation: true },
    { stage_order: 2, name: "烘乾", standard_minutes: 30, equipment_type: "dryer", compatibility_conditions: { category_codes: ["SOILED"] }, transition_mode: "manual", requires_operator_confirmation: true },
  ];
  const draft = await database.query<{procedure_template_id:string;procedure_version_id:string}>(`select * from public.create_procedure_template_draft(null,$1,$2,$3,$4::jsonb,$5,$6)`,["MAIN","SOILED","烘乾測試程序",JSON.stringify(stages),ids[0],"建立烘乾程序"]);
  await database.query(`select * from public.publish_procedure_template_version($1,$2,$3)`,[draft.rows[0].procedure_version_id,ids[1],"發布烘乾程序"]);
  const cart=await database.query<{laundry_cart_id:string}>(`select laundry_cart_id from public.register_laundry_cart($1,$2,$3,$4)`,["DRY-CART","DRY-CARE",ids[2],"建立烘乾車"]);
  const cartQr=await database.query<{qr_token:string}>(`select qr_token from public.get_current_laundry_cart_qr($1)`,[cart.rows[0].laundry_cart_id]);
  await database.exec("set role anon"); await database.query(`select * from public.create_laundry_order_from_cart_qr($1,$2)`,[cartQr.rows[0].qr_token,ids[3]]);
  await database.query(`select set_config('request.jwt.claim.sub',$1,false)`,[worker]); await database.exec("set role authenticated");
  const received=await database.query<{laundry_order_id:string}>(`select laundry_order_id from public.receive_laundry_order_from_cart_qr($1,$2::jsonb,$3)`,[cartQr.rows[0].qr_token,JSON.stringify(["SOILED"]),ids[4]]);
  const batch=await database.query<{id:string}>(`select id from public.laundry_batches where laundry_order_id=$1::uuid`,[received.rows[0].laundry_order_id]);
  await database.query(`select set_config('request.jwt.claim.sub',$1,false)`,[supervisor]);
  const washer=await database.query<{laundry_equipment_id:string}>(`select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,["Washer DRY 01","MAIN","washer",18,JSON.stringify(["SOILED"]),JSON.stringify([draft.rows[0].procedure_template_id]),ids[5],"建立洗衣機"]);
  const dryer=await database.query<{laundry_equipment_id:string}>(`select laundry_equipment_id from public.register_laundry_equipment($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,["Dryer DRY 01","MAIN","dryer",18,JSON.stringify(["SOILED"]),JSON.stringify([draft.rows[0].procedure_template_id]),ids[6],"建立烘衣機"]);
  const washerQr=await database.query<{qr_token:string}>(`select qr_token from public.get_current_laundry_equipment_qr($1)`,[washer.rows[0].laundry_equipment_id]);
  const dryerQr=await database.query<{qr_token:string}>(`select qr_token from public.get_current_laundry_equipment_qr($1)`,[dryer.rows[0].laundry_equipment_id]);
  await database.query(`select set_config('request.jwt.claim.sub',$1,false)`,[worker]);
  await database.query(`select * from public.start_laundry_batch_washing_from_equipment_qr($1,$2,$3)`,[washerQr.rows[0].qr_token,batch.rows[0].id,ids[7]]);
  const drying=await database.query<{stage_order:number;status:string;reason_code:string}>(`select stage_order,status,reason_code from public.complete_laundry_washing_and_start_drying($1,$2,$3)`,[batch.rows[0].id,dryerQr.rows[0].qr_token,ids[8]]);
  const states=await database.query<{equipment_type:string;occupied:boolean}>(`select equipment_type,occupied from public.laundry_equipment where id in ($1::uuid,$2::uuid) order by equipment_type`,[washer.rows[0].laundry_equipment_id,dryer.rows[0].laundry_equipment_id]);
  expect(drying.rows).toEqual([{stage_order:2,status:"in_progress",reason_code:"drying_started"}]);
  expect(states.rows).toEqual([{equipment_type:"dryer",occupied:true},{equipment_type:"washer",occupied:false}]);
});

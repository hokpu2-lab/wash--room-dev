alter table private.laundry_equipment_qr_credentials
  alter column issued_by_auth_user_id drop not null;

do $$
declare
  main_site_id uuid;
  key_id smallint;
  secret bytea;
  washer_id uuid := '41000000-0000-4000-8000-000000000104';
  dryer_id uuid := '41000000-0000-4000-8000-000000000204';
  washer_nonce bytea;
  washer_token text;
  dryer_nonce bytea;
  dryer_token text;
  system_user_id uuid;
begin
  select id into main_site_id from public.operating_sites where code = 'MAIN';
  select id, signing_secret into key_id, secret from private.fixed_asset_qr_signing_keys where active order by id desc limit 1;
  select auth_user_id into system_user_id from public.user_access_profiles where active limit 1;
  if system_user_id is null then
    system_user_id := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;

  if main_site_id is not null and key_id is not null then
    -- 本館洗衣-4
    if not exists (select 1 from public.laundry_equipment where operating_site_id = main_site_id and name = '本館洗衣-4') then
      insert into public.laundry_equipment (id, operating_site_id, name, equipment_type, capacity_kg, status, occupied, current_qr_version)
      values (washer_id, main_site_id, '本館洗衣-4', 'washer', 1, 'normal', false, 1);

      washer_nonce := extensions.gen_random_bytes(32);
      washer_token := private.build_laundry_equipment_qr_token(washer_id, 1, washer_nonce, secret);

      insert into private.laundry_equipment_qr_credentials (laundry_equipment_id, version, nonce, signing_key_id, token_hash, issued_by_auth_user_id, issuance_reason)
      values (washer_id, 1, washer_nonce, key_id, extensions.digest(pg_catalog.convert_to(washer_token, 'utf8'), 'sha256'), system_user_id, '系統建立本館洗衣-4');
    end if;

    -- 本館烘衣-4
    if not exists (select 1 from public.laundry_equipment where operating_site_id = main_site_id and name = '本館烘衣-4') then
      insert into public.laundry_equipment (id, operating_site_id, name, equipment_type, capacity_kg, status, occupied, current_qr_version)
      values (dryer_id, main_site_id, '本館烘衣-4', 'dryer', 1, 'normal', false, 1);

      dryer_nonce := extensions.gen_random_bytes(32);
      dryer_token := private.build_laundry_equipment_qr_token(dryer_id, 1, dryer_nonce, secret);

      insert into private.laundry_equipment_qr_credentials (laundry_equipment_id, version, nonce, signing_key_id, token_hash, issued_by_auth_user_id, issuance_reason)
      values (dryer_id, 1, dryer_nonce, key_id, extensions.digest(pg_catalog.convert_to(dryer_token, 'utf8'), 'sha256'), system_user_id, '系統建立本館烘衣-4');
    end if;
  end if;
end $$;

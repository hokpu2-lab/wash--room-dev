-- 一次性：把初始洗滌程序規劃寫入已授權作業據點。
-- 使用前：migration 已推送、admin 已完成首位主管 bootstrap，且已在
-- Authentication 綁定 admin@auth.wash-room.invalid。
-- 在 Supabase SQL Editor 整段執行。已存在的據點＋分類組合會略過。
-- 裝車不是程序階段，最後一個設備階段完成後再掃來源車。

begin;

do $$
declare
  actor_id uuid;
  site_code text;
  spec record;
  draft record;
begin
  select profile.auth_user_id
  into actor_id
  from public.user_access_profiles as profile
  where profile.login_name = 'admin'
    and profile.active
    and profile.auth_user_id is not null;

  if actor_id is null then
    raise exception 'admin 尚未綁定 Auth user，請先完成首位主管 bootstrap';
  end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor_id, 'role', 'authenticated')::text,
    true
  );

  for site_code in
    select site.code
    from public.operating_sites as site
    join public.access_memberships as membership
      on membership.operating_site_id = site.id
    join public.user_access_profiles as profile
      on profile.id = membership.user_access_profile_id
    where profile.auth_user_id = actor_id
      and membership.role = 'laundry_supervisor'
      and membership.active
      and site.active
    order by site.code
  loop
    for spec in
      select *
      from (
        values
          (
            'DISINFECT',
            '消毒浸泡＋標準洗烘',
            '[
              {
                "stage_order": 1,
                "name": "浸泡",
                "standard_minutes": 30,
                "equipment_type": "disinfection_tank",
                "compatibility_conditions": {"category_codes": ["DISINFECT"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              },
              {
                "stage_order": 2,
                "name": "清洗",
                "standard_minutes": 45,
                "equipment_type": "washer",
                "compatibility_conditions": {"category_codes": ["DISINFECT"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              },
              {
                "stage_order": 3,
                "name": "烘乾",
                "standard_minutes": 35,
                "equipment_type": "dryer",
                "compatibility_conditions": {"category_codes": ["DISINFECT"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              }
            ]'::jsonb
          ),
          (
            'BIB',
            '標準洗烘',
            '[
              {
                "stage_order": 1,
                "name": "清洗",
                "standard_minutes": 45,
                "equipment_type": "washer",
                "compatibility_conditions": {"category_codes": ["BIB"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              },
              {
                "stage_order": 2,
                "name": "烘乾",
                "standard_minutes": 30,
                "equipment_type": "dryer",
                "compatibility_conditions": {"category_codes": ["BIB"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              }
            ]'::jsonb
          ),
          (
            'SOILED',
            '加強洗烘',
            '[
              {
                "stage_order": 1,
                "name": "清洗",
                "standard_minutes": 60,
                "equipment_type": "washer",
                "compatibility_conditions": {"category_codes": ["SOILED"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              },
              {
                "stage_order": 2,
                "name": "烘乾",
                "standard_minutes": 40,
                "equipment_type": "dryer",
                "compatibility_conditions": {"category_codes": ["SOILED"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              }
            ]'::jsonb
          ),
          (
            'CURTAIN',
            '大型織品洗烘',
            '[
              {
                "stage_order": 1,
                "name": "清洗",
                "standard_minutes": 60,
                "equipment_type": "washer",
                "compatibility_conditions": {"category_codes": ["CURTAIN"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              },
              {
                "stage_order": 2,
                "name": "烘乾",
                "standard_minutes": 50,
                "equipment_type": "dryer",
                "compatibility_conditions": {"category_codes": ["CURTAIN"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              }
            ]'::jsonb
          ),
          (
            'OTHER',
            '標準洗烘',
            '[
              {
                "stage_order": 1,
                "name": "清洗",
                "standard_minutes": 45,
                "equipment_type": "washer",
                "compatibility_conditions": {"category_codes": ["OTHER"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              },
              {
                "stage_order": 2,
                "name": "烘乾",
                "standard_minutes": 30,
                "equipment_type": "dryer",
                "compatibility_conditions": {"category_codes": ["OTHER"]},
                "transition_mode": "manual",
                "requires_operator_confirmation": true
              }
            ]'::jsonb
          )
      ) as planned(category_code, template_name, stages)
    loop
      if exists (
        select 1
        from public.procedure_templates as template
        join public.operating_sites as site
          on site.id = template.operating_site_id
        join public.laundry_categories as category
          on category.id = template.laundry_category_id
        where site.code = site_code
          and category.code = spec.category_code
      ) then
        continue;
      end if;

      select *
      into draft
      from public.create_procedure_template_draft(
        null,
        site_code,
        spec.category_code,
        spec.template_name,
        spec.stages,
        gen_random_uuid(),
        '依初始洗滌程序規劃建立預設範本'
      );

      perform public.publish_procedure_template_version(
        draft.procedure_version_id,
        gen_random_uuid(),
        '發布初始洗滌程序規劃'
      );
    end loop;
  end loop;
end $$;

select
  site.code as site_code,
  category.code as category_code,
  category.name as category_name,
  version.template_name,
  version.version_no,
  version.status,
  (
    select string_agg(
      stage.stage_order::text || '.' || stage.name || ' ' || stage.standard_minutes::text || '分',
      ' → ' order by stage.stage_order
    )
    from public.procedure_template_stages as stage
    where stage.procedure_version_id = version.id
  ) as stages
from public.procedure_templates as template
join public.operating_sites as site
  on site.id = template.operating_site_id
join public.laundry_categories as category
  on category.id = template.laundry_category_id
join public.procedure_template_versions as version
  on version.procedure_template_id = template.id
  and version.status = 'published'
order by site.code, category.sort_order;

commit;

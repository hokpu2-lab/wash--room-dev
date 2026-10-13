-- Migration: Update procedure template defaults and equipment duration configs
-- 消毒品: 消毒鍋(30分) -> 洗衣機(60分) -> 烘衣機(60分)
-- 圍兜: 烘衣機(20分)
-- 汙衣: 洗衣機(60分) -> 烘衣機(60分)
-- 床簾: 洗衣機(40分)
-- 其他: 洗衣機(60分) -> 烘衣機(60分)

-- 更新現有設備的預設清洗時間配置：若機型為消毒鍋且 default 為 60，調降為 30
update public.laundry_equipment
set cleaning_duration_minutes = 30,
    cleaning_duration_config = jsonb_set(cleaning_duration_config, '{default}', '30'::jsonb)
where equipment_type = 'disinfection_tank'
  and (cleaning_duration_minutes = 60 or cleaning_duration_config->>'default' = '60');

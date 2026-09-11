create or replace function private.validate_laundry_equipment_for_stage(
  target_equipment_id uuid,
  expected_equipment_type text,
  expected_site_id uuid,
  expected_category_code text,
  expected_procedure_template_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.laundry_equipment as equipment
    join public.operating_sites as site
      on site.id = equipment.operating_site_id
    join public.laundry_categories as category
      on category.code = upper(btrim(expected_category_code))
      and category.active
    join public.procedure_templates as template
      on template.id = expected_procedure_template_id
      and template.operating_site_id = expected_site_id
      and template.active
    join public.procedure_template_versions as version
      on version.procedure_template_id = template.id
      and version.status = 'published'
    join public.procedure_template_stages as stage
      on stage.procedure_version_id = version.id
      and stage.equipment_type in ('manual', expected_equipment_type)
    where equipment.id = target_equipment_id
      and equipment.operating_site_id = expected_site_id
      and equipment.equipment_type = expected_equipment_type
      and equipment.status = 'normal'
      and not equipment.occupied
      and site.active
      and (
        not exists (
          select 1
          from public.laundry_equipment_categories as capability
          where capability.laundry_equipment_id = equipment.id
        )
        or exists (
          select 1
          from public.laundry_equipment_categories as capability
          where capability.laundry_equipment_id = equipment.id
            and capability.laundry_category_id = category.id
        )
      )
      and (
        not exists (
          select 1
          from public.laundry_equipment_procedures as capability
          where capability.laundry_equipment_id = equipment.id
        )
        or exists (
          select 1
          from public.laundry_equipment_procedures as capability
          where capability.laundry_equipment_id = equipment.id
            and capability.procedure_template_id = template.id
        )
      )
  )
$$;

update public.laundry_equipment
set capacity_kg = 2, updated_at = now()
where capacity_kg is distinct from 2;

alter table public.laundry_equipment
  alter column capacity_kg set default 2;

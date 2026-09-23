update public.laundry_equipment
set capacity_kg = 1, updated_at = now()
where capacity_kg is distinct from 1;

alter table public.laundry_equipment
  alter column capacity_kg set default 1;

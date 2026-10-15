do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_rel
      join pg_class on pg_class.oid = pg_publication_rel.prrelid
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_publication_rel.prpubid = (
        select oid from pg_publication where pubname = 'supabase_realtime'
      )
        and pg_namespace.nspname = 'public'
        and pg_class.relname = 'laundry_batch_stage_runs'
    ) then
    execute 'alter publication supabase_realtime add table public.laundry_batch_stage_runs';
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_rel
      join pg_class on pg_class.oid = pg_publication_rel.prrelid
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_publication_rel.prpubid = (
        select oid from pg_publication where pubname = 'supabase_realtime'
      )
        and pg_namespace.nspname = 'public'
        and pg_class.relname = 'laundry_carts'
    ) then
    execute 'alter publication supabase_realtime add table public.laundry_carts';
  end if;
end
$$;

-- Campanita: altas públicas de socio sin esperar el poll.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'membership_applications'
    ) then
      alter publication supabase_realtime add table public.membership_applications;
    end if;
  end if;
end $$;

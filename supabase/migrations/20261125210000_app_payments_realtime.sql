-- Pagos de la app en el canal en vivo.
-- Socios con app ya escucha member_payments y mp_intents; sin estar en la
-- publicación el evento no sale y la ficha espera el poll.

alter table public.messages replica identity full;
alter table public.member_payments replica identity full;
alter table public.mp_intents replica identity full;

do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array['messages', 'member_payments', 'mp_intents']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = tbl
      ) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end loop;
  end if;
end $$;

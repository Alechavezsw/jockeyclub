-- La app recarga las métricas cuando se sube un corte nuevo.
-- Escritura: superadmin (el service role no pasa por RLS).
-- Realtime: el panel escucha INSERT/UPDATE/DELETE en club_snapshots.

drop policy if exists club_snapshots_superadmin_write on public.club_snapshots;
create policy club_snapshots_superadmin_write
  on public.club_snapshots
  for all
  to authenticated
  using (public.user_has_role('superadmin'))
  with check (public.user_has_role('superadmin'));

drop trigger if exists club_snapshots_updated_at on public.club_snapshots;
create trigger club_snapshots_updated_at
  before update on public.club_snapshots
  for each row execute function public.set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.club_snapshots;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.members;
exception
  when duplicate_object then null;
end
$$;
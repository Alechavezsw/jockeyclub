-- Disponibilidad: cualquier usuario autenticado puede leer reservas/lista de espera
drop policy if exists reservations_select on public.reservations;
create policy reservations_select on public.reservations for select using (auth.uid() is not null);

drop policy if exists waitlist_all on public.reservation_waitlist;
drop policy if exists waitlist_select on public.reservation_waitlist;
drop policy if exists waitlist_write on public.reservation_waitlist;

create policy waitlist_select on public.reservation_waitlist for select using (auth.uid() is not null);
create policy waitlist_write on public.reservation_waitlist for all using (
  public.has_staff_access()
  or exists (select 1 from public.members m where m.id = member_id and m.profile_id = auth.uid())
  or member_number in (select member_number from public.members where profile_id = auth.uid())
) with check (
  public.has_staff_access()
  or exists (select 1 from public.members m where m.id = member_id and m.profile_id = auth.uid())
  or member_number in (select member_number from public.members where profile_id = auth.uid())
);

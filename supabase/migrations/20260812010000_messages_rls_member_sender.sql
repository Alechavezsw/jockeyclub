-- Socio puede releer mensajes que envió con sender_key = member_number
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (
  public.has_staff_access()
  or sender_key = auth.uid()::text
  or recipient_key = auth.uid()::text
  or recipient_key = 'all'
  or recipient_key in (select member_number from public.members where profile_id = auth.uid())
  or sender_key in (select member_number from public.members where profile_id = auth.uid())
  or (recipient_key = 'ops' and public.has_staff_access())
);

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update using (
  public.has_staff_access()
  or recipient_key = auth.uid()::text
  or recipient_key in (select member_number from public.members where profile_id = auth.uid())
) with check (
  public.has_staff_access()
  or recipient_key = auth.uid()::text
  or recipient_key in (select member_number from public.members where profile_id = auth.uid())
);

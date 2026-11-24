-- En Supabase el esquema public otorga todo a authenticated al crear la tabla.
-- La revisión solo se lee. Escribir queda en service_role.

revoke all on table public.club_mail_previews from public, anon, authenticated;
revoke all on table public.club_mail_campaigns from public, anon, authenticated;
grant select on table public.club_mail_previews to authenticated;
grant select on table public.club_mail_campaigns to authenticated;

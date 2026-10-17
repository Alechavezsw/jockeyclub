-- Lectura de la clave de bandeja (el valor vive en Vault, no en el repo).
create or replace function public.read_resend_inbox_key()
returns text
language sql
stable
security definer
set search_path = vault, public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'RESEND_INBOX_API_KEY'
  limit 1;
$$;

revoke all on function public.read_resend_inbox_key() from public, anon, authenticated;
grant execute on function public.read_resend_inbox_key() to service_role;

-- Reloj del aviso de cuota. Si no existe el secreto service_role_key en Vault,
-- el job no se crea: hay que programarlo desde Integraciones → Cron
-- llamando a la función send-due-notices.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    return;
  end if;
  perform cron.schedule(
    'dues-due-notices',
    '*/10 12-23 * * *',
    $job$
    select net.http_post(
      url := 'https://papdsxgcvyncdxdvbdaa.supabase.co/functions/v1/send-due-notices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
      ),
      body := '{"scope":"batch"}'::jsonb,
      timeout_milliseconds := 60000
    );
    $job$
  );
end $$;

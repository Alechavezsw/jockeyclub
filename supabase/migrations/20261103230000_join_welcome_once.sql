-- La bienvenida de una solicitud la dispara la base, con la clave de servicio.
-- El navegador no llama a la función. Un solo envío por solicitud: claim_join_welcome
-- marca welcome_sent_at y la segunda llamada no manda nada.
-- Si falta service_role_key en Vault, la solicitud se guarda igual y el mail no sale.

create extension if not exists pg_net with schema extensions;

create or replace function public.claim_join_welcome(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.membership_applications;
begin
  update public.membership_applications
  set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('welcome_sent_at', to_jsonb(now()))
  where id = p_id
    and coalesce(meta->>'welcome_sent_at', '') = ''
  returning * into v_row;
  if v_row.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'full_name', v_row.full_name,
    'email', v_row.email
  );
end;
$$;

create or replace function public.release_join_welcome(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.membership_applications
  set meta = coalesce(meta, '{}'::jsonb) - 'welcome_sent_at'
  where id = p_id;
end;
$$;

revoke all on function public.claim_join_welcome(uuid) from public, anon, authenticated;
revoke all on function public.release_join_welcome(uuid) from public, anon, authenticated;
grant execute on function public.claim_join_welcome(uuid) to service_role;
grant execute on function public.release_join_welcome(uuid) to service_role;

create or replace function public.enqueue_join_welcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if NEW.email is null or position('@' in NEW.email) = 0 then
    return NEW;
  end if;
  if coalesce(NEW.meta->>'welcome_sent_at', '') <> '' then
    return NEW;
  end if;
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;
  if v_key is null or v_key = '' then
    return NEW;
  end if;
  perform net.http_post(
    url := 'https://papdsxgcvyncdxdvbdaa.supabase.co/functions/v1/send-join-welcome',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('applicationId', NEW.id),
    timeout_milliseconds := 10000
  );
  return NEW;
exception
  when others then
    return NEW;
end;
$$;

revoke all on function public.enqueue_join_welcome() from public, anon, authenticated;

drop trigger if exists membership_applications_join_welcome on public.membership_applications;
create trigger membership_applications_join_welcome
  after insert on public.membership_applications
  for each row
  execute function public.enqueue_join_welcome();

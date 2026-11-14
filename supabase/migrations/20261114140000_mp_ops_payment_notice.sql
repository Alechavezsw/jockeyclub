-- Mercado Pago acredita solo, pero la operación debe aparecer en Pagos entrantes.
-- Al aplicar el cobro (applied_at), avisamos a ops una sola vez (idempotente vía meta).

create or replace function public.mp_intent_notify_ops_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_msg_id uuid;
  v_ops_kind text;
  v_subject text;
  v_body text;
  v_name text;
  v_number text;
  v_money text;
  v_sender_key text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.applied_at is not null or new.applied_at is null then
    return new;
  end if;
  if coalesce(nullif(btrim(new.meta->>'ops_payment_notice_id'), ''), '') <> '' then
    return new;
  end if;
  if lower(coalesce(new.kind, '')) not in ('dues', 'subscription', 'booking', 'reservation', 'pool') then
    return new;
  end if;

  v_number := coalesce(nullif(btrim(new.member_number), ''), '');
  select coalesce(nullif(btrim(full_name), ''), 'Socio')
    into v_name
  from public.members
  where id = new.member_id;
  v_name := coalesce(v_name, 'Socio');

  v_money := trim(to_char(round(coalesce(new.amount, 0), 2), 'FM999G999G999D00'));
  if v_money = '' then
    v_money := '0,00';
  end if;
  v_money := '$ ' || v_money;

  if lower(new.kind) in ('booking', 'reservation') then
    v_ops_kind := 'booking_payment';
    v_subject := 'Operación Mercado Pago · reserva acreditada';
  elsif lower(new.kind) = 'pool' then
    v_ops_kind := 'dues_payment';
    v_subject := 'Operación Mercado Pago · pileta acreditada';
  else
    v_ops_kind := 'dues_payment';
    v_subject := 'Operación Mercado Pago · cuota acreditada';
  end if;

  v_body := v_name
    || case when v_number <> '' then ' (Nº ' || v_number || ')' else '' end
    || ' pagó por Mercado Pago.'
    || E'\nImporte: ' || v_money
    || E'\nComprobante: MP-' || substr(new.id::text, 1, 8)
    || case
         when coalesce(nullif(btrim(new.concept), ''), '') <> ''
           then E'\nConcepto: ' || left(btrim(new.concept), 200)
         else ''
       end
    || E'\nMercado Pago acredita solo: no hace falta imputar a mano.';

  v_sender_key := regexp_replace(v_number, '[^a-zA-Z0-9._-]', '', 'g');
  if v_sender_key = '' then
    v_sender_key := null;
  end if;

  insert into public.messages (
    sender_name,
    sender_key,
    recipient_key,
    subject,
    body,
    is_read,
    meta
  ) values (
    v_name,
    v_sender_key,
    'ops',
    v_subject,
    v_body,
    false,
    jsonb_build_object(
      'kind', v_ops_kind,
      'method', 'mercadopago',
      'paymentAuto', true,
      'paymentRequest', false,
      'mp_intent_id', new.id,
      'receiptNumber', 'MP-' || substr(new.id::text, 1, 8),
      'channel', coalesce(nullif(btrim(new.meta->>'channel'), ''), 'online')
    )
  )
  returning id into v_msg_id;

  if v_msg_id is not null then
    update public.mp_intents
    set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('ops_payment_notice_id', v_msg_id)
    where id = new.id;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_mp_intent_ops_payment_notice on public.mp_intents;

create trigger trg_mp_intent_ops_payment_notice
after update of applied_at on public.mp_intents
for each row
execute function public.mp_intent_notify_ops_payment();

revoke all on function public.mp_intent_notify_ops_payment() from public;
grant execute on function public.mp_intent_notify_ops_payment() to service_role;

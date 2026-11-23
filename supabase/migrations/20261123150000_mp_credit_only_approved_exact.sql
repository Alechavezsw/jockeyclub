-- Acredita Mercado Pago solo con estado approved y el importe exacto en centavos.
-- La adhesión de la suscripción no marca el cobro como aplicado.
-- No reescribe filas históricas: solo cambia las funciones.

create or replace function public.apply_mp_subscription(
  p_intent_id uuid,
  p_preapproval_id text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_intent public.mp_intents%rowtype;
  v_status text;
  v_adhesion text;
begin
  v_status := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));
  select * into v_intent from public.mp_intents where id = p_intent_id for update;
  if v_intent.id is null then raise exception 'No está la suscripción de Mercado Pago.'; end if;
  v_adhesion := case
    when v_status in ('authorized', 'approved') then 'authorized'
    when v_status in ('cancelled', 'paused') then 'cancelled'
    else 'rejected' end;
  update public.mp_intents set
    status = case when v_adhesion = 'authorized' then 'authorized' else v_status end,
    preapproval_id = coalesce(nullif(p_preapproval_id, ''), preapproval_id),
    updated_at = now()
  where id = v_intent.id;
  if v_intent.member_id is not null then
    update public.members set
      payment_method = case when v_adhesion = 'authorized' then 'debito' else payment_method end,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'mpAdhesion', v_adhesion,
        'mpPreapprovalId', coalesce(nullif(p_preapproval_id, ''), meta->>'mpPreapprovalId')
      )
    where id = v_intent.member_id;
  end if;
  return jsonb_build_object('ok', true, 'adhesion', v_adhesion, 'intent_id', v_intent.id);
end;
$function$;

do $patch$
declare
  def text;
  next text;
  approved_gate text := $gate$  if v_status <> 'approved' then
    return jsonb_build_object('ok', true, 'applied', false, 'status', v_status);
  end if;$gate$;
  loose_amount text := $loose$  v_amount := round(coalesce(nullif(p_paid_amount, 0), v_intent.amount), 2);
  if v_amount <= 0 then
    raise exception 'Importe de Mercado Pago inválido.';
  end if;

  if abs(v_amount - round(v_intent.amount, 2)) > 0.05 then
    if v_amount < round(v_intent.amount, 2) - 0.05 then
      raise exception 'Importe acreditado menor al cobro declarado.';
    end if;
    if v_amount > round(v_intent.amount * 1.5, 2) + 0.05 then
      raise exception 'Importe acreditado no corresponde al cobro.';
    end if;
  end if;$loose$;
  plain_amount text := $plain$  v_amount := round(coalesce(nullif(p_paid_amount, 0), v_intent.amount), 2);
  if v_amount <= 0 then
    raise exception 'Importe de Mercado Pago inválido.';
  end if;$plain$;
  exact_amount text := $exact$  v_amount := round(coalesce(p_paid_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'Importe de Mercado Pago inválido.';
  end if;
  if abs(v_amount - round(v_intent.amount, 2)) > 0.009 then
    raise exception 'Importe acreditado no coincide con el cobro (centavos).';
  end if;$exact$;
  currency_gate text := $cur$

  if upper(coalesce(btrim(v_intent.currency), '')) <> 'ARS' then
    raise exception 'Moneda de Mercado Pago inválida';
  end if;$cur$;
  tennis_guard text := $tennis$

  if v_intent.kind in ('dues', 'subscription')
     and lower(coalesce(v_intent.concept, '') || ' ' || coalesce(v_intent.meta->>'chargeScope', ''))
         ~* '(abono[_ -]*tenis|(^|[^a-z])tenis([^a-z]|$))' then
    raise exception 'El cobro de tenis no se imputa como cuota social.';
  end if;$tennis$;
begin
  def := pg_get_functiondef('public.apply_mp_approved_payment(uuid,text,text,numeric)'::regprocedure);
  next := def;
  next := replace(
    next,
    'if v_status not in (''approved'', ''authorized'') then',
    'if v_status <> ''approved'' then'
  );
  next := replace(
    next,
    'if upper(coalesce(nullif(btrim(v_intent.currency), ''''), ''ARS'')) <> ''ARS'' then',
    'if upper(coalesce(btrim(v_intent.currency), '''')) <> ''ARS'' then'
  );
  if position('Moneda de Mercado Pago inválida' in next) = 0 then
    if position(approved_gate in next) = 0 then
      raise exception 'apply_mp_approved_payment no tiene la salida de estado no aprobado.';
    end if;
    next := replace(next, approved_gate, approved_gate || currency_gate);
  end if;
  if position(loose_amount in next) > 0 then
    next := replace(next, loose_amount, exact_amount);
  elsif position(plain_amount in next) > 0 then
    next := replace(next, plain_amount, exact_amount);
  end if;
  if position('El cobro de tenis no se imputa como cuota social.' in next) = 0 then
    if position(approved_gate in next) = 0 then
      raise exception 'apply_mp_approved_payment no tiene la salida de estado no aprobado.';
    end if;
    next := replace(next, approved_gate, approved_gate || tennis_guard);
  end if;
  if position('amount * 1.5' in next) > 0
     or position('nullif(p_paid_amount, 0)' in next) > 0
     or position('v_status not in (''approved'', ''authorized'')' in next) > 0
     or position('centavos' in next) = 0 then
    raise exception 'apply_mp_approved_payment quedó sin el control de centavos.';
  end if;
  if next is distinct from def then
    execute next;
  end if;
end;
$patch$;

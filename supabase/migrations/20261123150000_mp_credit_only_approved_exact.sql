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
  end if;

  if nullif(btrim(coalesce(v_intent.meta->>'from_subscription', '')), '') is not null then
    declare
      v_sub_member uuid;
      v_sub_pre text;
    begin
      select s.member_id, s.preapproval_id into v_sub_member, v_sub_pre
      from public.mp_intents s
      where s.id = (v_intent.meta->>'from_subscription')::uuid
        and s.kind = 'subscription';
      if v_sub_member is null
         or v_sub_member is distinct from v_intent.member_id
         or coalesce(v_intent.preapproval_id, '') <> coalesce(v_sub_pre, '') then
        raise exception 'El débito no corresponde al socio de la suscripción.';
      end if;
    end;
  end if;$tennis$;
begin
  def := pg_get_functiondef('public.apply_mp_approved_payment(uuid,text,text,numeric)'::regprocedure);
  next := replace(def, chr(13), '');
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
  if position('chargeScope' in next) = 0 then
    if position('''mp_intent_id'', v_intent.id,' in next) = 0 then
      raise exception 'apply_mp_approved_payment no copia el alcance del cobro.';
    end if;
    next := replace(
      next,
      '''mp_intent_id'', v_intent.id,',
      '''mp_intent_id'', v_intent.id,' || chr(10) ||
      '        ''chargeScope'', nullif(btrim(coalesce(v_intent.meta->>''chargeScope'', '''')), ''''),'
    );
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

-- El mayor histórico no se reescribe. Las filas viejas quedan con charge_scope nulo
-- y siguen sumando igual. Solo los cobros nuevos guardan el alcance.
alter table public.member_dues_entries
  add column if not exists charge_scope text;

alter table public.member_dues_entries
  drop constraint if exists member_dues_entries_charge_scope_chk;

alter table public.member_dues_entries
  add constraint member_dues_entries_charge_scope_chk
  check (charge_scope is null or charge_scope in ('cuota_social', 'abono_tenis', 'reserva', 'otro'));

create or replace function public.member_payment_posts_dues()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_old numeric;
  v_delta numeric;
  v_key text;
  v_schedule jsonb;
  v_capital numeric;
  v_paid date;
  v_scope text;
  v_social numeric;
begin
  if coalesce(new.amount, 0) <= 0 then
    return new;
  end if;
  if public.member_id_is_dues_exempt(new.member_id) then
    return new;
  end if;

  select outstanding_balance into v_old
  from public.members
  where id = new.member_id
  for update;

  if not found then
    return new;
  end if;

  v_key := coalesce(new.idempotency_key, new.meta->>'idempotencyKey', '');
  v_schedule := case
    when jsonb_typeof(new.meta->'schedule') = 'array' then new.meta->'schedule'
    else '[]'::jsonb
  end;
  v_paid := coalesce(new.paid_at, current_date);
  v_scope := lower(btrim(coalesce(new.meta->>'chargeScope', '')));
  if v_scope = 'cuota_social' and coalesce(v_old, 0) > 0 then
    select round(coalesce(sum(amount), 0), 2) into v_social
    from public.member_dues_entries
    where member_id = new.member_id
      and coalesce(charge_scope, '') <> 'abono_tenis';
    v_old := least(v_old, greatest(coalesce(v_social, 0), 0));
  end if;
  if v_key not like 'cobro:%' then
    v_capital := public.impute_dues_account_payment(
      new.member_id,
      new.id,
      case when v_scope = 'cuota_social' then least(new.amount, greatest(v_old, 0)) else new.amount end,
      v_schedule,
      v_paid
    );
  end if;

  if v_old > 0 then
    if v_capital is not null then
      v_delta := -least(v_old, v_capital);
    else
      v_delta := -least(v_old, new.amount);
    end if;
  else
    v_delta := 0;
  end if;

  if v_delta = 0 then
    return new;
  end if;

  insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope)
  values (
    new.member_id,
    round(v_delta, 2),
    'payment',
    'payment:' || new.id::text,
    case when v_scope in ('cuota_social', 'abono_tenis') then v_scope else null end
  )
  on conflict (source) where source <> '' do nothing;

  update public.members
  set updated_at = now()
  where id = new.member_id;

  return new;
end;
$function$;

drop trigger if exists trg_member_payment_posts_dues on public.member_payments;
create trigger trg_member_payment_posts_dues
  after insert on public.member_payments
  for each row execute function public.member_payment_posts_dues();

create unique index if not exists journal_entries_source_uidx
  on public.journal_entries (source_module, source_id)
  where source_id is not null;

revoke all on function public.apply_mp_subscription(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_mp_subscription(uuid, text, text) to service_role;

revoke all on function public.apply_mp_approved_payment(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.apply_mp_approved_payment(uuid, text, text, numeric) to service_role;

-- Adhesión pendiente no queda como rechazo.
-- El débito de la suscripción imputa capital de cuota social, sin el 10 %.
-- No reescribe saldos, cobros ni adhesiones ya guardadas: solo reemplaza funciones.
-- No está aplicada en producción.

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
  v_member public.members%rowtype;
  v_status text;
  v_adhesion text;
  v_meta jsonb;
  v_method text;
  v_owns boolean;
begin
  v_status := lower(coalesce(nullif(btrim(p_status), ''), 'pending'));
  select * into v_intent from public.mp_intents where id = p_intent_id for update;
  if v_intent.id is null then raise exception 'No está la suscripción de Mercado Pago.'; end if;
  v_adhesion := case
    when v_status in ('authorized', 'approved') then 'authorized'
    when v_status in ('cancelled', 'paused') then 'cancelled'
    when v_status in ('pending', 'in_process') then 'pending'
    else 'rejected' end;
  update public.mp_intents set
    status = case when v_adhesion = 'authorized' then 'authorized' else v_status end,
    preapproval_id = coalesce(nullif(p_preapproval_id, ''), preapproval_id),
    updated_at = now()
  where id = v_intent.id;
  if v_intent.member_id is not null then
    select * into v_member from public.members where id = v_intent.member_id for update;
    if v_member.id is not null then
      v_meta := coalesce(v_member.meta, '{}'::jsonb);
      v_method := v_member.payment_method;
      v_owns := v_meta->>'mpDebitMethod' = 'mercadopago';
      if v_adhesion = 'authorized' and coalesce(v_method, '') is distinct from 'debito' then
        v_method := 'debito';
        v_meta := v_meta || jsonb_build_object('mpDebitMethod', 'mercadopago');
      elsif v_adhesion in ('cancelled', 'rejected') and v_owns then
        v_method := null;
        v_meta := v_meta - 'mpDebitMethod';
      end if;
      v_meta := v_meta || jsonb_build_object(
        'mpAdhesion', v_adhesion,
        'mpPreapprovalId', coalesce(nullif(p_preapproval_id, ''), v_meta->>'mpPreapprovalId')
      );
      update public.members set
        payment_method = v_method,
        meta = v_meta
      where id = v_member.id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'adhesion', v_adhesion, 'intent_id', v_intent.id);
end;
$function$;

create or replace function public.impute_dues_account_payment(
  p_member_id uuid,
  p_payment_id uuid,
  p_cash numeric,
  p_schedule jsonb,
  p_paid date
)
returns numeric
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cash numeric := round(coalesce(p_cash, 0), 2);
  v_old numeric;
  v_left numeric;
  v_sched numeric := 0;
  v_open numeric := 0;
  v_item jsonb;
  v_due_text text;
  v_due date;
  v_cap numeric;
  v_late numeric;
  v_period public.member_dues_periods%rowtype;
  v_capital_open numeric;
  v_late_base numeric;
  v_surcharge_open numeric;
  v_capital_take numeric;
  v_surcharge_take numeric;
  v_next_capital numeric;
  v_next_late numeric;
  v_applied numeric := 0;
  v_skip_surcharge boolean := current_setting('jockey.mp_debit_capital_only', true) = '1';
  v_schedule jsonb := case
    when jsonb_typeof(p_schedule) = 'array' then p_schedule
    else '[]'::jsonb
  end;
begin
  if p_member_id is null or p_payment_id is null or v_cash <= 0 then
    return null;
  end if;
  if exists (
    select 1 from public.dues_imputations
    where payment_id = p_payment_id and voided_at is null
  ) then
    return 0;
  end if;

  select outstanding_balance into v_old
  from public.members
  where id = p_member_id
  for update;
  if not found then
    return null;
  end if;
  v_old := round(coalesce(v_old, 0), 2);

  select coalesce(sum(capital_open), 0) into v_open
  from public.member_dues_periods
  where member_id = p_member_id
    and capital_open > 0
    and due_on > date '1900-01-10';

  if v_open > 0.009 then
    if v_old > 0.009 and abs(v_open - v_old) > 0.01 then
      return null;
    end if;
  else
    select coalesce(sum(round((value->>'capital')::numeric, 2)), 0) into v_sched
    from jsonb_array_elements(v_schedule)
    where left(coalesce(value->>'dueOn', ''), 10) > '1900-01-10'
      and coalesce(value->>'capital', '') ~ '^[0-9]+(\.[0-9]+)?$';
    if v_old > 0.009 and v_sched + 0.01 < v_old then
      return null;
    end if;

    v_left := greatest(v_old, 0);
    for v_item in
      select value
      from jsonb_array_elements(v_schedule)
      order by left(coalesce(value->>'dueOn', ''), 10)
    loop
      exit when v_left <= 0.009;
      v_due_text := left(coalesce(v_item->>'dueOn', ''), 10);
      if v_due_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_due_text <= '1900-01-10' then
        continue;
      end if;
      if coalesce(v_item->>'capital', '') !~ '^[0-9]+(\.[0-9]+)?$' then
        continue;
      end if;
      v_due := v_due_text::date;
      v_cap := least(round((v_item->>'capital')::numeric, 2), v_left);
      if v_cap <= 0 then
        continue;
      end if;
      v_late := v_cap;
      if coalesce(v_item->>'lateBase', '') ~ '^[0-9]+(\.[0-9]+)?$' then
        v_late := least(v_cap, round((v_item->>'lateBase')::numeric, 2));
      end if;
      insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
      values (p_member_id, v_due, v_cap, v_cap, greatest(v_late, 0))
      on conflict (member_id, due_on) do update
        set capital = public.member_dues_periods.capital + excluded.capital,
            capital_open = public.member_dues_periods.capital_open + excluded.capital,
            late_base = public.member_dues_periods.late_base + excluded.late_base
        where public.member_dues_periods.capital_open <= 0;
      v_left := round(v_left - v_cap, 2);
    end loop;
  end if;

  for v_period in
    select *
    from public.member_dues_periods
    where member_id = p_member_id
      and capital_open > 0
      and due_on > date '1900-01-10'
    order by due_on
    for update
  loop
    exit when v_cash <= 0.009;
    v_capital_open := round(v_period.capital_open, 2);
    v_late_base := round(coalesce(
      nullif(v_period.late_base, 0),
      case when v_period.due_on >= date '2026-10-10' then v_capital_open else 0 end
    ), 2);
    v_surcharge_open := case
      when v_skip_surcharge then 0
      when p_paid > v_period.due_on then round(v_late_base * 0.10, 2)
      else 0
    end;
    v_capital_take := least(v_cash, v_capital_open);
    v_surcharge_take := least(greatest(0, round(v_cash - v_capital_take, 2)), greatest(v_surcharge_open, 0));
    if v_capital_take <= 0 and v_surcharge_take <= 0 then
      continue;
    end if;
    v_next_capital := greatest(0, round(v_capital_open - v_capital_take, 2));
    v_next_late := case
      when v_capital_open > 0 then round(v_late_base * v_next_capital / v_capital_open, 2)
      else 0
    end;
    update public.member_dues_periods
    set capital_open = v_next_capital,
        late_base = greatest(0, v_next_late)
    where member_id = p_member_id
      and due_on = v_period.due_on;

    insert into public.dues_imputations (
      payment_id, member_id, due_on, capital, surcharge,
      capital_open, surcharge_open, late_base_taken, kind
    ) values (
      p_payment_id,
      p_member_id,
      v_period.due_on,
      v_capital_take,
      v_surcharge_take,
      v_next_capital,
      case
        when v_skip_surcharge then 0
        when p_paid > v_period.due_on then round(greatest(v_next_late, 0) * 0.10, 2)
        else 0
      end,
      greatest(0, round(v_late_base - v_next_late, 2)),
      'payment'
    );
    v_cash := round(v_cash - v_capital_take - v_surcharge_take, 2);
    v_applied := round(v_applied + v_capital_take, 2);
  end loop;

  return v_applied;
end;
$function$;

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
  v_debit_capital boolean := false;
  v_intent_id text;
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
  v_debit_capital := lower(coalesce(new.method, '')) in ('debito', 'debito_automatico')
    or coalesce(new.meta->>'channel', '') = 'subscription'
    or nullif(btrim(coalesce(new.meta->>'from_subscription', '')), '') is not null;
  v_intent_id := nullif(btrim(coalesce(new.meta->>'mp_intent_id', '')), '');
  if not v_debit_capital
     and v_intent_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select (
      coalesce(i.meta->>'channel', '') = 'subscription'
      or nullif(btrim(coalesce(i.meta->>'from_subscription', '')), '') is not null
    ) into v_debit_capital
    from public.mp_intents i
    where i.id = v_intent_id::uuid;
  end if;
  perform set_config('jockey.mp_debit_capital_only', case when v_debit_capital then '1' else '' end, true);
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

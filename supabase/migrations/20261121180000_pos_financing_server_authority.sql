-- Financiación POS: autoridad de servidor + cobro atómico con asiento.
-- NO aplicar en producción sin autorización explícita.
-- Depende de: app_settings.paymentPlans, registrar_cobro, chart_of_accounts, journal_entries.

-- ---------------------------------------------------------------------------
-- 0) Idempotencia de asientos de cuota (B9)
-- Ya existe journal_entries_mp_intent_source_uidx sobre (source_module, source_id)
-- para cuotas/pileta/reservas. Se agrega variante con voided_at is null para
-- permitir re-publicar tras anulación sin chocar con filas void.
-- ---------------------------------------------------------------------------
create unique index if not exists journal_entries_cuotas_source_uidx
  on public.journal_entries (source_id)
  where source_module = 'cuotas'
    and source_id is not null
    and voided_at is null;

-- ---------------------------------------------------------------------------
-- 1) Cuenta 4.1.05 (idempotente)
-- ---------------------------------------------------------------------------
insert into public.chart_of_accounts (
  id, code, name, account_type, parent_id, level, is_postable, is_cash_account, is_active
)
select
  'aaaaaaaa-0004-0004-0004-000000000115',
  '4.1.05',
  'Ingresos por financiación tarjetas',
  'income',
  parent_id,
  3,
  true,
  false,
  true
from public.chart_of_accounts
where code = '4.1.01'
limit 1
on conflict (code) do update
set name = excluded.name, is_postable = true, is_active = true;

-- ---------------------------------------------------------------------------
-- 2) Catálogo oficial de planes (app_settings) — solo lectura autenticada
-- ---------------------------------------------------------------------------
create or replace function public.payment_plans_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw jsonb;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  select value into v_raw
  from public.app_settings
  where key = 'paymentPlans'
  limit 1;
  if v_raw is null or jsonb_typeof(v_raw) <> 'array' then
    return '[]'::jsonb;
  end if;
  return v_raw;
end;
$$;

revoke all on function public.payment_plans_catalog() from public, anon;
grant execute on function public.payment_plans_catalog() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Autorización de financiación POS (servidor)
--    No confía en financingMode / financingAmount / voucherTotal del cliente.
-- ---------------------------------------------------------------------------
create or replace function public.authorize_pos_card_financing(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plans jsonb;
  v_plan jsonb;
  v_plan_id text;
  v_base numeric;
  v_surcharge numeric;
  v_installments int;
  v_mode text;
  v_percent numeric;
  v_fixed numeric;
  v_financing numeric := 0;
  v_voucher numeric;
  v_receipt numeric;
  v_allow_override boolean;
  v_client jsonb;
  v_day date;
  v_valid_from date;
  v_valid_to date;
  v_active boolean;
  v_applied_percent numeric := null;
  v_applied_fixed numeric := null;
  v_declared numeric;
  v_parsed numeric;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not (public.has_capability('payments.collect') or public.has_capability('members.write')) then
    raise exception 'Sin permiso para autorizar financiación POS.';
  end if;

  v_plans := public.payment_plans_catalog();
  v_plan_id := nullif(btrim(coalesce(p_payload->>'paymentPlanId', p_payload->>'planId', '')), '');
  if v_plan_id is null then
    raise exception 'Falta el plan POS autorizado.';
  end if;

  select value into v_plan
  from jsonb_array_elements(v_plans) as t(value)
  where lower(coalesce(value->>'id', '')) = lower(v_plan_id)
  limit 1;

  if v_plan is null then
    raise exception 'Plan POS «%» inexistente o no cargado en el catálogo.', v_plan_id;
  end if;

  v_active := coalesce((v_plan->>'active')::boolean, true);
  v_day := coalesce(nullif(left(coalesce(p_payload->>'dayISO', ''), 10), '')::date, public.club_today());
  begin
    v_valid_from := nullif(left(coalesce(v_plan->>'validFrom', ''), 10), '')::date;
    v_valid_to := nullif(left(coalesce(v_plan->>'validTo', ''), 10), '')::date;
  exception when others then
    v_valid_from := null;
    v_valid_to := null;
  end;
  if v_active is distinct from true
     or (v_valid_from is not null and v_day < v_valid_from)
     or (v_valid_to is not null and v_day > v_valid_to) then
    raise exception 'El plan POS «%» no está vigente.', coalesce(v_plan->>'label', v_plan_id);
  end if;

  v_base := round(coalesce(nullif(p_payload->>'financingBase', '')::numeric,
                           nullif(p_payload->>'socialAmount', '')::numeric, 0), 2);
  v_surcharge := round(coalesce(nullif(p_payload->>'surchargeAmount', '')::numeric, 0), 2);
  if v_base < 0 or v_surcharge < 0 then
    raise exception 'Base o mora inválidas para financiación POS.';
  end if;

  v_installments := greatest(1, coalesce(nullif(v_plan->>'installments', '')::int, 1));
  v_mode := case
    when coalesce(v_plan->>'financingMode', '') = 'club_keeps' then 'club_keeps'
    else 'issuer_keeps'
  end;
  v_allow_override := coalesce((v_plan->>'allowOperatorOverride')::boolean, false);

  -- Modalidad siempre del plan; rechazo si el cliente intenta otra.
  v_client := case when jsonb_typeof(p_payload->'clientCardFinancing') = 'object'
    then p_payload->'clientCardFinancing' else null end;
  if v_client is not null
     and nullif(v_client->>'mode', '') is not null
     and v_client->>'mode' is distinct from v_mode then
    raise exception 'La modalidad de financiación del plan no puede cambiarse desde caja.';
  end if;

  if v_installments <= 1 then
    v_financing := 0;
  else
    if v_allow_override
       and nullif(p_payload->>'fixedAmount', '') is not null then
      v_fixed := round((p_payload->>'fixedAmount')::numeric, 2);
      if v_fixed < 0 then raise exception 'El importe fijo de financiación no puede ser negativo.'; end if;
      v_applied_fixed := v_fixed;
      v_financing := v_fixed;
    elsif v_allow_override
          and nullif(p_payload->>'percent', '') is not null then
      v_percent := round((p_payload->>'percent')::numeric, 2);
      if v_percent < 0 then raise exception 'El porcentaje de financiación no puede ser negativo.'; end if;
      if v_percent > 100 then raise exception 'El porcentaje de financiación no puede superar 100 %%.'; end if;
      v_applied_percent := v_percent;
      v_financing := round(v_base * v_percent / 100.0, 2);
    elsif nullif(v_plan->>'financingFixed', '') is not null then
      v_applied_fixed := round((v_plan->>'financingFixed')::numeric, 2);
      v_financing := greatest(0, v_applied_fixed);
    elsif nullif(v_plan->>'financingPercent', '') is not null then
      v_applied_percent := round((v_plan->>'financingPercent')::numeric, 2);
      v_financing := round(v_base * v_applied_percent / 100.0, 2);
    else
      v_financing := 0;
    end if;
  end if;

  -- Cupón = capital + financiación + mora (mora no genera tasa).
  v_voucher := round(v_base + v_financing + v_surcharge, 2);

  -- B14: cupón declarado, monto del comprobante y total calculado — por separado.
  v_declared := nullif(p_payload->>'receiptVoucher', '')::numeric;
  if v_declared is null then
    v_declared := nullif(p_payload->>'voucherAmount', '')::numeric;
  end if;
  v_parsed := nullif(p_payload->'receiptParse'->>'amount', '')::numeric;

  if v_declared is not null and v_parsed is not null
     and abs(v_declared - v_parsed) > 0.01 then
    raise exception
      'El cupón declarado (%) no coincide con el monto del comprobante (%).',
      to_char(v_declared, 'FM999999990.00'),
      to_char(v_parsed, 'FM999999990.00');
  end if;
  if v_declared is not null and abs(v_declared - v_voucher) > 0.01 then
    raise exception
      'El cupón declarado (%) no coincide con el total calculado del plan (%). Resolvé la diferencia antes de acreditar.',
      to_char(v_declared, 'FM999999990.00'),
      to_char(v_voucher, 'FM999999990.00');
  end if;
  if v_parsed is not null and abs(v_parsed - v_voucher) > 0.01 then
    raise exception
      'El cupón del comprobante (%) no coincide con el total calculado del plan (%). Resolvé la diferencia antes de acreditar.',
      to_char(v_parsed, 'FM999999990.00'),
      to_char(v_voucher, 'FM999999990.00');
  end if;
  v_receipt := coalesce(v_declared, v_parsed);

  if v_client is not null then
    if abs(coalesce(nullif(v_client->>'financingAmount', '')::numeric, -1) - v_financing) > 0.01
       or abs(coalesce(nullif(v_client->>'voucherTotal', '')::numeric, -1) - v_voucher) > 0.01 then
      raise exception 'Los importes de financiación enviados no coinciden con el plan autorizado.';
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'mode', v_mode,
    'percent', v_applied_percent,
    'fixedAmount', v_applied_fixed,
    'baseAmount', v_base,
    'financingBase', v_base,
    'surchargeAmount', v_surcharge,
    'financingAmount', v_financing,
    'voucherTotal', v_voucher,
    'installments', v_installments,
    'planId', v_plan->>'id',
    'planLabel', v_plan->>'label',
    'cardBrand', v_plan->>'cardBrand',
    'acquirer', coalesce(v_plan->>'acquirer', v_plan->>'cardBrand'),
    'authReference', nullif(btrim(coalesce(
      p_payload->>'authReference',
      p_payload->'receiptParse'->>'reference',
      ''
    )), ''),
    'receiptVoucher', v_receipt,
    'authorizedByServer', true,
    'authorizedAt', to_jsonb(now()),
    'paymentPlanSnapshot', jsonb_build_object(
      'id', v_plan->>'id',
      'label', v_plan->>'label',
      'cardBrand', v_plan->>'cardBrand',
      'installments', v_installments,
      'acquirer', coalesce(v_plan->>'acquirer', v_plan->>'cardBrand'),
      'financingMode', v_mode,
      'financingPercent', v_applied_percent,
      'financingFixed', v_applied_fixed
    )
  ));
end;
$$;

revoke all on function public.authorize_pos_card_financing(jsonb) from public, anon;
grant execute on function public.authorize_pos_card_financing(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Resolver cuenta por nombre (COA)
-- ---------------------------------------------------------------------------
create or replace function public.coa_id_by_name(p_name text)
returns uuid
language sql
stable
as $$
  select id
  from public.chart_of_accounts
  where is_active
    and lower(name) = lower(btrim(p_name))
  order by level desc
  limit 1;
$$;

-- B15: cuenta del debe según medio autorizado (nunca del navegador).
create or replace function public.pos_resolve_journal_account(
  p_method text,
  p_bank_id text default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_method text := lower(nullif(btrim(coalesce(p_method, '')), ''));
  v_bank text := lower(nullif(btrim(coalesce(p_bank_id, '')), ''));
  v_name text;
begin
  if v_method in ('tarjeta', 'pos', 'pago pos', 'card') then
    v_name := 'Tarjetas a cobrar';
  elsif v_method in ('efectivo', 'a_cuenta', 'caja') then
    v_name := 'Caja General';
  elsif v_method = 'mercadopago' then
    v_name := 'Mercado Pago';
  elsif v_method in ('transferencia', 'debito') then
    if v_bank in ('mercadopago', 'mp') then
      v_name := 'Mercado Pago';
    else
      v_name := 'Banco Macro';
    end if;
  else
    raise exception 'Medio de cobro no autorizado para asiento POS: %', coalesce(p_method, '?');
  end if;

  if public.coa_id_by_name(v_name) is null then
    raise exception 'Cuenta contable autorizada inexistente en el plan: %', v_name;
  end if;
  return v_name;
end;
$$;

revoke all on function public.pos_resolve_journal_account(text, text) from public, anon;
grant execute on function public.pos_resolve_journal_account(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Publicar asiento de cuota — SOLO uso interno (B12)
-- Requiere set_config('jockey.internal_cuotas_journal','1',true) en la misma txn.
-- No ejecutable por authenticated/anon.
-- ---------------------------------------------------------------------------
create or replace function public.post_cuotas_journal_for_payment(
  p_payment_id uuid,
  p_entry jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_id uuid;
  v_entry public.journal_entries%rowtype;
  v_payment public.member_payments%rowtype;
  v_lines jsonb;
  v_line jsonb;
  v_order int := 0;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_account uuid;
  v_amt numeric;
begin
  -- B12: barrera interna — no basta con estar autenticado.
  if coalesce(current_setting('jockey.internal_cuotas_journal', true), '') is distinct from '1' then
    raise exception 'Operación contable reservada al cobro POS atómico.';
  end if;
  if p_payment_id is null then
    raise exception 'Falta el id del cobro para el asiento.';
  end if;

  -- B12: el asiento solo se vincula a un cobro real existente y no anulado.
  select * into v_payment
  from public.member_payments
  where id = p_payment_id
  for share;
  if not found then
    raise exception 'El cobro % no existe; no se publica asiento.', p_payment_id;
  end if;
  if coalesce(v_payment.meta->>'status', '') in ('void', 'voided')
     or nullif(v_payment.meta->>'voidedAt', '') is not null then
    raise exception 'El cobro % está anulado; no se publica asiento.', p_payment_id;
  end if;

  select id into v_existing
  from public.journal_entries
  where source_module = 'cuotas'
    and source_id = p_payment_id
    and voided_at is null
  limit 1;
  if v_existing is not null then
    select * into v_entry from public.journal_entries where id = v_existing;
    select coalesce(jsonb_agg(to_jsonb(l) order by l.line_order), '[]'::jsonb)
      into v_lines
    from public.journal_lines l
    where l.journal_entry_id = v_existing;
    return jsonb_build_object('entry', to_jsonb(v_entry), 'lines', v_lines, 'idempotent', true);
  end if;

  insert into public.journal_entries (
    fiscal_period_id, entry_date, concept, reference, status,
    source_module, source_id, created_by
  ) values (
    coalesce(nullif(p_entry->>'fiscalPeriodId', '')::uuid,
      (select id from public.fiscal_periods where not is_closed order by starts_on desc nulls last limit 1)),
    coalesce(nullif(p_entry->>'date', '')::date, public.club_today()),
    coalesce(nullif(p_entry->>'concept', ''), nullif(p_entry->>'description', ''), 'Cobro cuota social'),
    nullif(p_entry->>'reference', ''),
    'draft',
    'cuotas',
    p_payment_id,
    coalesce(auth.uid(), v_payment.recorded_by)
  )
  returning id into v_id;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_entry->'lines', '[]'::jsonb))
  loop
    v_order := v_order + 1;
    v_account := coalesce(
      nullif(v_line->>'accountId', '')::uuid,
      public.coa_id_by_name(coalesce(v_line->>'account', v_line->>'accountName', ''))
    );
    if v_account is null then
      raise exception 'Cuenta contable desconocida: %', coalesce(v_line->>'account', v_line->>'accountId', '?');
    end if;
    if coalesce(v_line->>'type', '') = 'debit' or coalesce(nullif(v_line->>'debit', '')::numeric, 0) > 0 then
      v_amt := round(coalesce(nullif(v_line->>'amount', '')::numeric, nullif(v_line->>'debit', '')::numeric, 0), 2);
      insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
      values (v_id, v_account, v_order, v_amt, 0, nullif(v_line->>'memo', ''));
      v_debit := v_debit + v_amt;
    else
      v_amt := round(coalesce(nullif(v_line->>'amount', '')::numeric, nullif(v_line->>'credit', '')::numeric, 0), 2);
      insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
      values (v_id, v_account, v_order, 0, v_amt, nullif(v_line->>'memo', ''));
      v_credit := v_credit + v_amt;
    end if;
  end loop;

  if v_order = 0 then
    raise exception 'Asiento sin líneas; no se publica.';
  end if;
  if abs(v_debit - v_credit) > 0.009 then
    raise exception 'Asiento desbalanceado: debe % ≠ haber %', v_debit, v_credit;
  end if;

  update public.journal_entries
  set status = 'posted',
      posted_at = now(),
      posted_by = coalesce(auth.uid(), v_payment.recorded_by)
  where id = v_id;

  select * into v_entry from public.journal_entries where id = v_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.line_order), '[]'::jsonb)
    into v_lines
  from public.journal_lines l
  where l.journal_entry_id = v_id;

  -- Auditoría obligatoria: si falla, no se confirma el asiento.
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    coalesce(auth.uid(), v_payment.recorded_by),
    'create',
    'journal_entries',
    v_id,
    jsonb_build_object(
      'source', 'cuotas',
      'paymentId', p_payment_id,
      'memberId', v_payment.member_id,
      'amount', v_payment.amount,
      'internal', true,
      'postedAt', now()
    )
  );

  return jsonb_build_object('entry', to_jsonb(v_entry), 'lines', v_lines, 'idempotent', false);
exception
  when unique_violation then
    select id into v_existing
    from public.journal_entries
    where source_module = 'cuotas' and source_id = p_payment_id and voided_at is null
    limit 1;
    if v_existing is null then raise; end if;
    select * into v_entry from public.journal_entries where id = v_existing;
    select coalesce(jsonb_agg(to_jsonb(l) order by l.line_order), '[]'::jsonb)
      into v_lines
    from public.journal_lines l
    where l.journal_entry_id = v_existing;
    return jsonb_build_object('entry', to_jsonb(v_entry), 'lines', v_lines, 'idempotent', true);
end;
$$;

revoke all on function public.post_cuotas_journal_for_payment(uuid, jsonb) from public, anon, authenticated;
-- Solo el dueño SECURITY DEFINER (y service_role operativo) pueden invocarla.
grant execute on function public.post_cuotas_journal_for_payment(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6) Cobro POS atómico (B13–B17):
--    cuentas servidor · mixto+mora con asignación · idempotencia inmutable
-- ---------------------------------------------------------------------------
create or replace function public.registrar_cobro_pos(
  p_member_id uuid,
  p_importe numeric,
  p_periodos jsonb,
  p_idempotency_key text,
  p_journal jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_periodos jsonb := coalesce(p_periodos, '{}'::jsonb);
  v_method text;
  v_auth jsonb;
  v_cobro jsonb;
  v_payment_id uuid;
  v_payment public.member_payments%rowtype;
  v_journal jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_cash numeric;
  v_discount numeric;
  v_financing numeric := 0;
  v_mode text := 'issuer_keeps';
  v_card_account text;
  v_resolved_account text;
  v_is_pos boolean := false;
  v_split jsonb;
  v_splits jsonb;
  v_auth_splits jsonb := '[]'::jsonb;
  v_imp_capital numeric := 0;
  v_imp_surcharge numeric := 0;
  v_claimed_base numeric;
  v_claimed_surcharge numeric;
  v_split_sum numeric := 0;
  v_pos_capital numeric := 0;
  v_split_cap_sum numeric := 0;
  v_split_sur_sum numeric := 0;
  v_split_cap numeric;
  v_split_sur numeric;
  v_split_amt numeric;
  v_client_account text;
  v_existing_meta jsonb;
  v_existing_plan text;
  v_existing_fin numeric;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not (public.has_capability('payments.collect') or public.has_capability('members.write')) then
    raise exception 'Sin permiso para cobrar POS.';
  end if;

  v_method := lower(nullif(btrim(coalesce(v_periodos->>'method', '')), ''));
  v_is_pos := v_method in ('tarjeta', 'pos')
    or (
      v_method = 'mixto'
      and exists (
        select 1
        from jsonb_array_elements(coalesce(v_periodos->'paymentSplits', '[]'::jsonb)) s
        where lower(coalesce(s->>'method', '')) in ('tarjeta', 'pos')
      )
    );

  if not v_is_pos then
    raise exception 'registrar_cobro_pos solo admite cobros POS / mixtos con POS.';
  end if;

  if jsonb_typeof(p_journal->'lines') = 'array'
     and jsonb_array_length(p_journal->'lines') > 0 then
    raise exception 'Las líneas del asiento no se aceptan desde el cliente.';
  end if;

  v_periodos := v_periodos - 'cardFinancing' - 'paymentPlanSnapshot';

  -- B15: resolver cuenta POS simple y rechazar journalAccount arbitrario.
  if v_method in ('tarjeta', 'pos') then
    v_card_account := public.pos_resolve_journal_account(v_method, v_periodos->>'bankId');
    v_client_account := nullif(btrim(coalesce(v_periodos->>'journalAccount', '')), '');
    if v_client_account is not null
       and lower(v_client_account) is distinct from lower(v_card_account) then
      raise exception
        'La cuenta contable «%» no está autorizada para POS. Debe ser «%».',
        v_client_account, v_card_account;
    end if;
  end if;

  if v_method = 'mixto' then
    v_splits := coalesce(v_periodos->'paymentSplits', '[]'::jsonb);
    select coalesce(sum((s->>'amount')::numeric), 0)
      into v_split_sum
    from jsonb_array_elements(v_splits) s;
    if abs(round(v_split_sum, 2) - round(p_importe, 2)) > 0.01 then
      raise exception 'Los tramos del pago mixto (%) no coinciden con el cobro (%).',
        to_char(v_split_sum, 'FM999999990.00'),
        to_char(p_importe, 'FM999999990.00');
    end if;
    -- B15: validar cuentas por tramo antes de acreditar.
    for v_split in select value from jsonb_array_elements(v_splits)
    loop
      v_resolved_account := public.pos_resolve_journal_account(
        v_split->>'method',
        v_split->>'bankId'
      );
      v_client_account := nullif(btrim(coalesce(v_split->>'journalAccount', '')), '');
      if v_client_account is not null
         and lower(v_client_account) is distinct from lower(v_resolved_account) then
        raise exception
          'La cuenta «%» no está autorizada para el medio %. Debe ser «%».',
          v_client_account, v_split->>'method', v_resolved_account;
      end if;
    end loop;
  end if;

  -- 1) Cobro + imputaciones.
  v_cobro := public.registrar_cobro(p_member_id, p_importe, v_periodos, p_idempotency_key);
  v_payment_id := (v_cobro->'payment'->>'id')::uuid;
  if v_payment_id is null then
    raise exception 'El cobro POS no devolvió id de pago.';
  end if;

  select * into v_payment from public.member_payments where id = v_payment_id;
  v_existing_meta := coalesce(v_payment.meta, '{}'::jsonb);

  -- B17: idempotencia inmutable — no reescribir snapshot ni asiento.
  if coalesce((v_cobro->>'idempotent')::boolean, false) then
    if abs(round(coalesce(v_payment.amount, 0), 2) - round(p_importe, 2)) > 0.01 then
      raise exception 'Conflicto de idempotencia: el importe no coincide con el cobro original.';
    end if;
    if v_payment.member_id is distinct from p_member_id then
      raise exception 'Conflicto de idempotencia: el socio no coincide con el cobro original.';
    end if;
    if lower(coalesce(v_payment.method, '')) is distinct from v_method then
      raise exception 'Conflicto de idempotencia: el medio no coincide con el cobro original.';
    end if;
    -- Períodos: si el reintento declara otros dueOn, conflicto.
    if jsonb_typeof(v_periodos->'periodDueOns') = 'array'
       and jsonb_typeof(v_existing_meta->'periodDueOns') = 'array'
       and v_existing_meta->'periodDueOns' is distinct from v_periodos->'periodDueOns' then
      raise exception 'Conflicto de idempotencia: los períodos no coinciden con el cobro original.';
    end if;
    v_existing_plan := coalesce(
      v_existing_meta->>'paymentPlanId',
      v_existing_meta->'cardFinancing'->>'planId',
      v_existing_meta->'paymentPlanSnapshot'->>'id',
      ''
    );
    if v_method in ('tarjeta', 'pos')
       and nullif(v_periodos->>'paymentPlanId', '') is not null
       and v_existing_plan <> ''
       and lower(v_existing_plan) is distinct from lower(v_periodos->>'paymentPlanId') then
      raise exception 'Conflicto de idempotencia: el plan POS no coincide con el cobro original.';
    end if;
    v_existing_fin := coalesce((v_existing_meta->'cardFinancing'->>'financingAmount')::numeric, -1);
    -- Interés / importe de financiación distinto → conflicto (no reescribir).
    if nullif(p_periodos->'cardFinancing'->>'financingAmount', '') is not null
       and v_existing_fin >= 0
       and abs(v_existing_fin - (p_periodos->'cardFinancing'->>'financingAmount')::numeric) > 0.01 then
      raise exception 'Conflicto de idempotencia: la financiación no coincide con el cobro original.';
    end if;
    if nullif(v_periodos->>'financingPercent', '') is not null
       and nullif(v_existing_meta->'cardFinancing'->>'appliedPercent', '') is not null
       and abs(
         (v_periodos->>'financingPercent')::numeric
         - (v_existing_meta->'cardFinancing'->>'appliedPercent')::numeric
       ) > 0.0001 then
      raise exception 'Conflicto de idempotencia: el interés POS no coincide con el cobro original.';
    end if;

    select jsonb_build_object(
      'entry', to_jsonb(e),
      'lines', coalesce((
        select jsonb_agg(to_jsonb(l) order by l.line_order)
        from public.journal_lines l where l.journal_entry_id = e.id
      ), '[]'::jsonb),
      'idempotent', true
    )
      into v_journal
    from public.journal_entries e
    where e.source_module = 'cuotas'
      and e.source_id = v_payment_id
      and e.voided_at is null
    limit 1;

    return v_cobro || jsonb_build_object(
      'journal', v_journal,
      'cardFinancing', v_existing_meta->'cardFinancing',
      'authorized', true,
      'idempotent', true
    );
  end if;

  -- 2) Bases desde imputaciones.
  select coalesce(sum(capital), 0), coalesce(sum(surcharge), 0)
    into v_imp_capital, v_imp_surcharge
  from public.dues_imputations
  where payment_id = v_payment_id;

  if v_imp_capital <= 0 and v_imp_surcharge <= 0 then
    v_imp_capital := round(coalesce(nullif(v_cobro->'payment'->'meta'->>'quota', '')::numeric, p_importe), 2);
    v_imp_surcharge := round(coalesce(nullif(v_cobro->'payment'->'meta'->>'surcharge', '')::numeric, 0), 2);
  end if;

  if nullif(p_periodos->>'financingBase', '') is not null
     or nullif(p_periodos->>'quota', '') is not null then
    v_claimed_base := round(coalesce(
      nullif(p_periodos->>'financingBase', '')::numeric,
      nullif(p_periodos->>'quota', '')::numeric
    ), 2);
    if abs(v_claimed_base - v_imp_capital) > 0.01 then
      raise exception
        'La base financiable enviada (%) no coincide con el capital imputado (%).',
        to_char(v_claimed_base, 'FM999999990.00'),
        to_char(v_imp_capital, 'FM999999990.00');
    end if;
  end if;
  if nullif(p_periodos->>'surchargeAmount', '') is not null
     or nullif(p_periodos->>'surcharge', '') is not null then
    v_claimed_surcharge := round(coalesce(
      nullif(p_periodos->>'surchargeAmount', '')::numeric,
      nullif(p_periodos->>'surcharge', '')::numeric,
      0
    ), 2);
    if abs(v_claimed_surcharge - v_imp_surcharge) > 0.01 then
      raise exception
        'La mora enviada (%) no coincide con la mora imputada (%).',
        to_char(v_claimed_surcharge, 'FM999999990.00'),
        to_char(v_imp_surcharge, 'FM999999990.00');
    end if;
  end if;

  -- 3) Autorizar plan(es).
  if v_method in ('tarjeta', 'pos') then
    v_auth := public.authorize_pos_card_financing(jsonb_build_object(
      'paymentPlanId', v_periodos->>'paymentPlanId',
      'financingBase', v_imp_capital,
      'surchargeAmount', v_imp_surcharge,
      'percent', v_periodos->>'financingPercent',
      'fixedAmount', v_periodos->>'financingFixed',
      'receiptVoucher', v_periodos->>'voucherAmount',
      'receiptParse', v_periodos->'receiptParse',
      'clientCardFinancing', p_periodos->'cardFinancing',
      'authReference', v_periodos->'receiptParse'->>'reference'
    ));
    v_financing := coalesce((v_auth->>'financingAmount')::numeric, 0);
    v_mode := coalesce(v_auth->>'mode', 'issuer_keeps');
    v_periodos := v_periodos || jsonb_build_object(
      'cardFinancing', v_auth,
      'voucherAmount', v_auth->>'voucherTotal',
      'paymentPlanSnapshot', v_auth->'paymentPlanSnapshot',
      'paymentPlanLabel', coalesce(v_periodos->>'paymentPlanLabel', v_auth->>'planLabel'),
      'journalAccount', v_card_account
    );
  else
    -- B16: mixto + mora exige asignación explícita capital/mora por tramo.
    v_splits := coalesce(v_periodos->'paymentSplits', '[]'::jsonb);
    if v_imp_surcharge > 0.009 then
      for v_split in select value from jsonb_array_elements(v_splits)
      loop
        if nullif(v_split->>'capitalAmount', '') is null
           or nullif(v_split->>'surchargeAmount', '') is null then
          raise exception
            'Pago mixto con mora y POS: cada tramo debe declarar capitalAmount y surchargeAmount. No se financia mora por defecto.';
        end if;
        v_split_cap := round((v_split->>'capitalAmount')::numeric, 2);
        v_split_sur := round((v_split->>'surchargeAmount')::numeric, 2);
        v_split_amt := round(coalesce(nullif(v_split->>'amount', '')::numeric, 0), 2);
        if abs(v_split_cap + v_split_sur - v_split_amt) > 0.01 then
          raise exception
            'En el tramo %, capital (%) + mora (%) debe igualar el importe (%).',
            coalesce(v_split->>'method', '?'),
            to_char(v_split_cap, 'FM999999990.00'),
            to_char(v_split_sur, 'FM999999990.00'),
            to_char(v_split_amt, 'FM999999990.00');
        end if;
        v_split_cap_sum := v_split_cap_sum + v_split_cap;
        v_split_sur_sum := v_split_sur_sum + v_split_sur;
      end loop;
      if abs(v_split_cap_sum - v_imp_capital) > 0.01
         or abs(v_split_sur_sum - v_imp_surcharge) > 0.01 then
        raise exception
          'La asignación capital/mora de los tramos no cierra con la liquidación (capital %/%, mora %/%).',
          to_char(v_split_cap_sum, 'FM999999990.00'), to_char(v_imp_capital, 'FM999999990.00'),
          to_char(v_split_sur_sum, 'FM999999990.00'), to_char(v_imp_surcharge, 'FM999999990.00');
      end if;
    end if;

    for v_split in select value from jsonb_array_elements(v_splits)
    loop
      v_resolved_account := public.pos_resolve_journal_account(
        v_split->>'method',
        v_split->>'bankId'
      );
      if lower(coalesce(v_split->>'method', '')) in ('tarjeta', 'pos') then
        if v_imp_surcharge > 0.009 then
          v_pos_capital := round((v_split->>'capitalAmount')::numeric, 2);
        else
          v_pos_capital := round(coalesce(nullif(v_split->>'amount', '')::numeric, 0), 2);
        end if;
        v_auth := public.authorize_pos_card_financing(jsonb_build_object(
          'paymentPlanId', v_split->>'paymentPlanId',
          'financingBase', v_pos_capital,
          'surchargeAmount', 0,
          'percent', v_split->>'financingPercent',
          'fixedAmount', v_split->>'financingFixed',
          'receiptVoucher', coalesce(v_split->>'voucherAmount', v_split->'receiptParse'->>'amount'),
          'receiptParse', v_split->'receiptParse',
          'clientCardFinancing', v_split->'cardFinancing'
        ));
        v_split := v_split || jsonb_build_object(
          'cardFinancing', v_auth,
          'voucherAmount', v_auth->>'voucherTotal',
          'paymentPlanSnapshot', v_auth->'paymentPlanSnapshot',
          'journalAccount', v_resolved_account,
          'financingBase', v_pos_capital,
          'capitalAmount', coalesce(nullif(v_split->>'capitalAmount', '')::numeric, v_pos_capital),
          'surchargeAmount', coalesce(nullif(v_split->>'surchargeAmount', '')::numeric, 0)
        );
        if coalesce((v_auth->>'mode'), '') = 'club_keeps' then
          v_financing := v_financing + coalesce((v_auth->>'financingAmount')::numeric, 0);
          v_mode := 'club_keeps';
        end if;
      else
        v_split := v_split || jsonb_build_object('journalAccount', v_resolved_account);
      end if;
      v_auth_splits := v_auth_splits || jsonb_build_array(v_split);
    end loop;
    v_periodos := v_periodos || jsonb_build_object('paymentSplits', v_auth_splits);
  end if;

  update public.member_payments
  set meta = coalesce(meta, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'cardFinancing', v_periodos->'cardFinancing',
    'voucherAmount', nullif(v_periodos->>'voucherAmount', '')::numeric,
    'paymentPlanSnapshot', v_periodos->'paymentPlanSnapshot',
    'paymentPlanId', v_periodos->>'paymentPlanId',
    'paymentSplits', v_periodos->'paymentSplits',
    'journalAccount', coalesce(v_periodos->>'journalAccount', v_card_account),
    'authorizedByServer', true
  ))
  where id = v_payment_id;

  -- 4) Asiento con cuentas resueltas en servidor (B15).
  v_cash := round(p_importe, 2);
  v_discount := round(coalesce(nullif(v_periodos->>'discount', '')::numeric, 0), 2);
  if v_card_account is null then
    v_card_account := public.pos_resolve_journal_account('tarjeta', null);
  end if;

  if v_method = 'mixto' then
    v_lines := '[]'::jsonb;
    for v_split in select value from jsonb_array_elements(coalesce(v_periodos->'paymentSplits', '[]'::jsonb))
    loop
      v_resolved_account := coalesce(
        nullif(v_split->>'journalAccount', ''),
        public.pos_resolve_journal_account(v_split->>'method', v_split->>'bankId')
      );
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account', v_resolved_account,
        'type', 'debit',
        'amount', round(coalesce(nullif(v_split->>'amount', '')::numeric, 0)
          + case
              when lower(coalesce(v_split->>'method', '')) in ('tarjeta', 'pos')
                   and coalesce(v_split->'cardFinancing'->>'mode', '') = 'club_keeps'
              then coalesce((v_split->'cardFinancing'->>'financingAmount')::numeric, 0)
              else 0
            end, 2)
      ));
    end loop;
    if v_discount > 0.009 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account', 'Descuentos sobre cuotas', 'type', 'debit', 'amount', v_discount
      ));
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account', 'Cuotas Sociales', 'type', 'credit', 'amount', round(v_cash + v_discount, 2)
    ));
    if v_mode = 'club_keeps' and v_financing > 0.009 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account', 'Ingresos por financiación tarjetas', 'type', 'credit', 'amount', v_financing
      ));
    end if;
  elsif v_mode = 'club_keeps' and v_financing > 0.009 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account', v_card_account, 'type', 'debit', 'amount', round(v_cash + v_financing, 2))
    );
    if v_discount > 0.009 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account', 'Descuentos sobre cuotas', 'type', 'debit', 'amount', v_discount
      ));
    end if;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account', 'Cuotas Sociales', 'type', 'credit', 'amount', round(v_cash + v_discount, 2)),
      jsonb_build_object('account', 'Ingresos por financiación tarjetas', 'type', 'credit', 'amount', v_financing)
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account', v_card_account, 'type', 'debit', 'amount', v_cash)
    );
    if v_discount > 0.009 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account', 'Descuentos sobre cuotas', 'type', 'debit', 'amount', v_discount
      ));
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account', 'Cuotas Sociales', 'type', 'credit', 'amount', round(v_cash + v_discount, 2)
    ));
  end if;

  perform set_config('jockey.internal_cuotas_journal', '1', true);

  v_journal := public.post_cuotas_journal_for_payment(
    v_payment_id,
    jsonb_strip_nulls(jsonb_build_object(
      'lines', v_lines,
      'concept', coalesce(p_journal->>'concept', p_journal->>'description', v_periodos->>'concept', 'Cobro cuota social'),
      'date', coalesce(p_journal->>'date', left(coalesce(v_periodos->>'paidAt', ''), 10)),
      'fiscalPeriodId', p_journal->>'fiscalPeriodId',
      'reference', p_journal->>'reference',
      'sourceModule', 'cuotas',
      'sourceId', v_payment_id
    ))
  );

  v_cobro := v_cobro || jsonb_build_object(
    'payment', to_jsonb((select p from public.member_payments p where p.id = v_payment_id))
  );

  return v_cobro || jsonb_build_object(
    'journal', v_journal,
    'cardFinancing', v_periodos->'cardFinancing',
    'authorized', true,
    'idempotent', false
  );
end;
$$;

revoke all on function public.registrar_cobro_pos(uuid, numeric, jsonb, text, jsonb) from public, anon;
grant execute on function public.registrar_cobro_pos(uuid, numeric, jsonb, text, jsonb) to authenticated, service_role;

comment on function public.registrar_cobro_pos(uuid, numeric, jsonb, text, jsonb) is
  'Cobro POS atómico B11–B17: cuentas servidor, mixto+mora con asignación, idempotencia inmutable, asiento interno.';

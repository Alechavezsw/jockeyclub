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

  v_receipt := nullif(p_payload->>'receiptVoucher', '')::numeric;
  if v_receipt is null and nullif(p_payload->'receiptParse'->>'amount', '') is not null then
    v_receipt := round((p_payload->'receiptParse'->>'amount')::numeric, 2);
  end if;
  if v_receipt is not null and abs(v_receipt - v_voucher) > 0.01 then
    raise exception
      'El cupón del comprobante (%) no coincide con el total calculado del plan (%). Resolvé la diferencia antes de acreditar.',
      to_char(v_receipt, 'FM999999990.00'),
      to_char(v_voucher, 'FM999999990.00');
  end if;

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

-- ---------------------------------------------------------------------------
-- 5) Publicar asiento de cuota idempotente por source_id
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
  v_lines jsonb;
  v_line jsonb;
  v_order int := 0;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_account uuid;
  v_amt numeric;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if p_payment_id is null then
    raise exception 'Falta el id del cobro para el asiento.';
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
    auth.uid()
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

  if abs(v_debit - v_credit) > 0.009 then
    raise exception 'Asiento desbalanceado: debe % ≠ haber %', v_debit, v_credit;
  end if;

  update public.journal_entries
  set status = 'posted', posted_at = now(), posted_by = auth.uid()
  where id = v_id;

  select * into v_entry from public.journal_entries where id = v_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.line_order), '[]'::jsonb)
    into v_lines
  from public.journal_lines l
  where l.journal_entry_id = v_id;

  begin
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (auth.uid(), 'create', 'journal_entries', v_id,
      jsonb_build_object('source', 'cuotas', 'paymentId', p_payment_id));
  exception when others then
    null;
  end;

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

revoke all on function public.post_cuotas_journal_for_payment(uuid, jsonb) from public, anon;
grant execute on function public.post_cuotas_journal_for_payment(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Cobro POS atómico: autorizar → registrar_cobro → asiento (misma txn)
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
  v_journal jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_cash numeric;
  v_discount numeric;
  v_financing numeric := 0;
  v_mode text := 'issuer_keeps';
  v_card_account text;
  v_is_pos boolean := false;
  v_split jsonb;
  v_splits jsonb;
  v_auth_splits jsonb := '[]'::jsonb;
  v_i int := 0;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
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

  -- Autorizar plan(es) desde catálogo; reescribir meta (no confiar en el cliente).
  if v_method in ('tarjeta', 'pos') then
    v_auth := public.authorize_pos_card_financing(jsonb_build_object(
      'paymentPlanId', v_periodos->>'paymentPlanId',
      'financingBase', coalesce(v_periodos->>'financingBase', v_periodos->>'quota', p_importe::text),
      'surchargeAmount', coalesce(v_periodos->>'surchargeAmount', v_periodos->>'surcharge', '0'),
      'percent', v_periodos->>'financingPercent',
      'fixedAmount', v_periodos->>'financingFixed',
      'receiptVoucher', v_periodos->>'voucherAmount',
      'receiptParse', v_periodos->'receiptParse',
      'clientCardFinancing', v_periodos->'cardFinancing',
      'authReference', v_periodos->'receiptParse'->>'reference'
    ));
    v_periodos := v_periodos
      || jsonb_build_object(
        'cardFinancing', v_auth,
        'voucherAmount', v_auth->>'voucherTotal',
        'paymentPlanSnapshot', v_auth->'paymentPlanSnapshot',
        'paymentPlanLabel', coalesce(v_periodos->>'paymentPlanLabel', v_auth->>'planLabel')
      );
    v_financing := coalesce((v_auth->>'financingAmount')::numeric, 0);
    v_mode := coalesce(v_auth->>'mode', 'issuer_keeps');
  else
    v_splits := coalesce(v_periodos->'paymentSplits', '[]'::jsonb);
    for v_split in select value from jsonb_array_elements(v_splits)
    loop
      v_i := v_i + 1;
      if lower(coalesce(v_split->>'method', '')) in ('tarjeta', 'pos') then
        v_auth := public.authorize_pos_card_financing(jsonb_build_object(
          'paymentPlanId', v_split->>'paymentPlanId',
          'financingBase', coalesce(v_split->>'financingBase', v_split->>'amount'),
          'surchargeAmount', coalesce(v_split->>'surchargeAmount', '0'),
          'percent', v_split->>'financingPercent',
          'fixedAmount', v_split->>'financingFixed',
          'receiptVoucher', coalesce(v_split->>'voucherAmount', v_split->'receiptParse'->>'amount'),
          'receiptParse', v_split->'receiptParse',
          'clientCardFinancing', v_split->'cardFinancing'
        ));
        v_split := v_split || jsonb_build_object(
          'cardFinancing', v_auth,
          'voucherAmount', v_auth->>'voucherTotal',
          'paymentPlanSnapshot', v_auth->'paymentPlanSnapshot'
        );
        if coalesce((v_auth->>'mode'), '') = 'club_keeps' then
          v_financing := v_financing + coalesce((v_auth->>'financingAmount')::numeric, 0);
          v_mode := 'club_keeps';
        end if;
      end if;
      v_auth_splits := v_auth_splits || jsonb_build_array(v_split);
    end loop;
    v_periodos := v_periodos || jsonb_build_object('paymentSplits', v_auth_splits);
  end if;

  -- Cobro + imputaciones + saldo (misma transacción).
  v_cobro := public.registrar_cobro(p_member_id, p_importe, v_periodos, p_idempotency_key);
  v_payment_id := (v_cobro->'payment'->>'id')::uuid;
  if v_payment_id is null then
    raise exception 'El cobro POS no devolvió id de pago.';
  end if;

  -- Asiento: montos desde valores autorizados (no desde el navegador).
  v_cash := round(p_importe, 2);
  v_discount := round(coalesce(nullif(v_periodos->>'discount', '')::numeric, 0), 2);
  v_card_account := coalesce(nullif(v_periodos->>'journalAccount', ''), 'Tarjetas a cobrar');

  if jsonb_typeof(p_journal->'lines') = 'array' and jsonb_array_length(p_journal->'lines') > 0 then
    -- Usa líneas del cliente solo como plantilla de cuentas; remonta importes si vienen type/amount.
    v_lines := p_journal->'lines';
  else
    if v_mode = 'club_keeps' and v_financing > 0.009 then
      v_lines := jsonb_build_array(
        jsonb_build_object('account', v_card_account, 'type', 'debit', 'amount', round(v_cash + v_financing, 2)),
        case when v_discount > 0.009 then
          jsonb_build_object('account', 'Descuentos sobre cuotas', 'type', 'debit', 'amount', v_discount)
        else null end,
        jsonb_build_object('account', 'Cuotas Sociales', 'type', 'credit', 'amount', round(v_cash + v_discount, 2)),
        jsonb_build_object('account', 'Ingresos por financiación tarjetas', 'type', 'credit', 'amount', v_financing)
      );
    else
      v_lines := jsonb_build_array(
        jsonb_build_object('account', v_card_account, 'type', 'debit', 'amount', v_cash),
        case when v_discount > 0.009 then
          jsonb_build_object('account', 'Descuentos sobre cuotas', 'type', 'debit', 'amount', v_discount)
        else null end,
        jsonb_build_object('account', 'Cuotas Sociales', 'type', 'credit', 'amount', round(v_cash + v_discount, 2))
      );
    end if;
    -- Quitar nulls del array
    select coalesce(jsonb_agg(value), '[]'::jsonb)
      into v_lines
    from jsonb_array_elements(v_lines) as t(value)
    where value is not null and value <> 'null'::jsonb;
  end if;

  v_journal := public.post_cuotas_journal_for_payment(
    v_payment_id,
    coalesce(p_journal, '{}'::jsonb) || jsonb_build_object(
      'lines', v_lines,
      'concept', coalesce(p_journal->>'concept', p_journal->>'description', v_periodos->>'concept', 'Cobro cuota social'),
      'date', coalesce(p_journal->>'date', left(coalesce(v_periodos->>'paidAt', ''), 10)),
      'sourceModule', 'cuotas',
      'sourceId', v_payment_id
    )
  );

  return v_cobro || jsonb_build_object(
    'journal', v_journal,
    'cardFinancing', v_periodos->'cardFinancing',
    'authorized', true
  );
end;
$$;

revoke all on function public.registrar_cobro_pos(uuid, numeric, jsonb, text, jsonb) from public, anon;
grant execute on function public.registrar_cobro_pos(uuid, numeric, jsonb, text, jsonb) to authenticated, service_role;

comment on function public.registrar_cobro_pos(uuid, numeric, jsonb, text, jsonb) is
  'Cobro POS atómico: autoriza plan/tasa en servidor, registra cobro e imputaciones y publica el asiento con source_id único.';

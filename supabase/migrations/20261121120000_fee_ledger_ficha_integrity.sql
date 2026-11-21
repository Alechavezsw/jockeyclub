-- Integridad ficha vs fee_ledger_lines.
-- No cierra masivamente pending: solo detecta, concilia con permiso, y evita reabrir períodos ya cubiertos.

-- 1) ¿El período YYYY-MM ya está cubierto en la ficha operativa?
create or replace function public.member_period_is_covered(
  p_member_id uuid,
  p_period_ym text
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_covered text;
  v_due date;
begin
  if p_member_id is null or p_period_ym !~ '^\d{4}-\d{2}$' then
    return false;
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found then
    return false;
  end if;

  v_covered := nullif(trim(coalesce(v_member.meta->>'duesCoveredThrough', '')), '');
  if v_covered ~ '^\d{4}-\d{2}' and left(v_covered, 7) >= p_period_ym then
    return true;
  end if;

  if exists (
    select 1
    from public.dues_imputations di
    where di.member_id = p_member_id
      and di.voided_at is null
      and to_char(di.due_on, 'YYYY-MM') = p_period_ym
      and (coalesce(di.capital, 0) + coalesce(di.surcharge, 0)) > 0.009
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.member_payments mp
    where mp.member_id = p_member_id
      and coalesce(mp.meta->>'status', '') not in ('void', 'anulled')
      and (
        to_char(mp.paid_at, 'YYYY-MM') = p_period_ym
        or coalesce(mp.period_label, '') ilike ('%' || to_char(to_date(p_period_ym || '-01', 'YYYY-MM-DD'), 'MM/YYYY') || '%')
        or coalesce(mp.meta->>'period', '') ilike ('%' || p_period_ym || '%')
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(mp.meta->'periodDueOns', '[]'::jsonb)) d
          where left(d, 7) = p_period_ym
        )
      )
  ) then
    return true;
  end if;

  -- Ficha al día con próximo vencimiento posterior al período → el período ya no es exigible.
  if coalesce(v_member.outstanding_balance, 0) <= 0.009
     and v_member.next_due_date is not null
     and to_char(v_member.next_due_date, 'YYYY-MM') > p_period_ym then
    return true;
  end if;

  v_due := (p_period_ym || '-10')::date;
  if exists (
    select 1
    from public.member_dues_periods mdp
    where mdp.member_id = p_member_id
      and mdp.due_on = v_due
      and coalesce(mdp.capital_open, 0) <= 0.009
  ) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.member_period_is_covered(uuid, text) from public;
grant execute on function public.member_period_is_covered(uuid, text) to authenticated;

-- 2) Cerrar pending de fee_ledger para meses dados (idempotente).
create or replace function public.apply_fee_ledger_collection_for_months(
  p_member_number text,
  p_months text[],
  p_paid_on date default current_date,
  p_cover numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cover numeric := coalesce(p_cover, 1e12);
  v_line record;
  v_take numeric;
  v_applied numeric := 0;
  v_ids text[] := '{}';
begin
  if coalesce(array_length(p_months, 1), 0) = 0 or nullif(trim(p_member_number), '') is null then
    return jsonb_build_object('applied', 0, 'lineIds', '[]'::jsonb);
  end if;

  for v_line in
    select id, pending
    from public.fee_ledger_lines
    where member_number = p_member_number::text
      and pending > 0.009
      and to_char(line_date, 'YYYY-MM') = any (p_months)
    order by line_date, id
    for update
  loop
    exit when v_cover <= 0.009;
    v_take := least(v_line.pending, v_cover);
    update public.fee_ledger_lines
    set collected = collected + v_take,
        pending = pending - v_take,
        collected_at = coalesce(collected_at, p_paid_on),
        collected_at_label = coalesce(
          nullif(collected_at_label, ''),
          to_char(p_paid_on, 'DD/MM/YYYY')
        )
    where id = v_line.id;
    v_cover := round(v_cover - v_take, 2);
    v_applied := round(v_applied + v_take, 2);
    v_ids := array_append(v_ids, v_line.id);
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'lineIds', to_jsonb(v_ids),
    'remainingCover', v_cover
  );
end;
$$;

revoke all on function public.apply_fee_ledger_collection_for_months(text, text[], date, numeric) from public;
revoke all on function public.apply_fee_ledger_collection_for_months(text, text[], date, numeric) from anon;
revoke all on function public.apply_fee_ledger_collection_for_months(text, text[], date, numeric) from authenticated;
-- Solo owner / funciones security definer (p. ej. registrar_cobro).

-- 3) post_fee_ledger_lines: no reabre períodos ya cubiertos en ficha.
create or replace function public.post_fee_ledger_lines(p_lines jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (
    public.has_accounting_access()
    or public.has_admin_access()
    or public.user_has_role('admin_employee')
  ) then
    raise exception 'Sin permiso para imputar cuentas contables';
  end if;

  with incoming_raw as (
    select
      e->>'id' as id,
      e->>'accountId' as account_id,
      coalesce(e->>'memberNumber', '') as member_number,
      coalesce(e->>'memberName', '') as member_name,
      coalesce(e->>'dni', '') as dni,
      nullif(e->>'date', '')::date as line_date,
      coalesce(e->>'dateLabel', '') as date_label,
      nullif(e->>'collectedAt', '')::date as collected_at,
      coalesce(e->>'collectedAtLabel', '') as collected_at_label,
      coalesce(e->>'type', '') as type_label,
      coalesce(e->>'description', '') as description,
      coalesce((e->>'amount')::numeric, 0) as amount,
      coalesce((e->>'collected')::numeric, 0) as collected,
      coalesce((e->>'pending')::numeric, 0) as pending,
      coalesce(nullif(e->>'source', ''), 'manual') as source
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
    where coalesce(e->>'id', '') <> ''
      and coalesce(e->>'accountId', '') <> ''
  ),
  incoming as (
    select
      r.*,
      m.id as member_id,
      case
        when r.line_date is not null
          and m.id is not null
          and public.member_period_is_covered(m.id, to_char(r.line_date, 'YYYY-MM'))
        then true
        else false
      end as already_covered
    from incoming_raw r
    left join public.members m on m.member_number::text = r.member_number
  ),
  normalized as (
    select
      id,
      account_id,
      member_number,
      member_name,
      dni,
      line_date,
      date_label,
      case when already_covered then coalesce(collected_at, current_date) else collected_at end as collected_at,
      case
        when already_covered then coalesce(nullif(collected_at_label, ''), to_char(current_date, 'DD/MM/YYYY'))
        else collected_at_label
      end as collected_at_label,
      type_label,
      description,
      amount,
      case when already_covered then amount else collected end as collected,
      case when already_covered then 0 else pending end as pending,
      case
        when already_covered and source = 'liquidation' then 'liquidation_sync_covered'
        else source
      end as source
    from incoming
  ),
  inserted as (
    insert into public.fee_ledger_lines (
      id, account_id, member_number, member_name, dni,
      line_date, date_label, collected_at, collected_at_label,
      type_label, description, amount, collected, pending, source
    )
    select
      id, account_id, member_number, member_name, dni,
      line_date, date_label, collected_at, collected_at_label,
      type_label, description, amount, collected, pending, source
    from normalized
    on conflict (id) do nothing
    returning account_id, amount
  )
  update public.fee_ledger_accounts a
  set balance = a.balance + d.amount
  from (
    select account_id, sum(amount) as amount
    from inserted
    group by account_id
  ) d
  where a.id = d.account_id
    and d.amount <> 0;
end;
$$;

revoke all on function public.post_fee_ledger_lines(jsonb) from public;
grant execute on function public.post_fee_ledger_lines(jsonb) to authenticated;

-- 4) Conciliación administrativa (sin inventar pago).
create or replace function public.admin_reconcile_fee_ledger_period(
  p_member_id uuid,
  p_period_ym text,
  p_reason text,
  p_evidence_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_note text := nullif(trim(coalesce(p_evidence_note, '')), '');
  v_line record;
  v_closed int := 0;
  v_amount numeric := 0;
  v_ids text[] := '{}';
  v_meta_key text;
begin
  if not (
    public.has_staff_access()
    or public.has_capability('dues.liquidate')
    or public.has_capability('members.write')
  ) then
    raise exception 'Sin permiso para conciliar fee_ledger';
  end if;

  if p_period_ym !~ '^\d{4}-\d{2}$' then
    raise exception 'Período inválido (YYYY-MM)';
  end if;
  if v_reason is null or length(v_reason) < 8 then
    raise exception 'Indicá un motivo de conciliación (mín. 8 caracteres)';
  end if;

  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    raise exception 'Socio no encontrado';
  end if;

  for v_line in
    select id, pending
    from public.fee_ledger_lines
    where member_number = v_member.member_number::text
      and to_char(line_date, 'YYYY-MM') = p_period_ym
      and pending > 0.009
    order by line_date, id
    for update
  loop
    update public.fee_ledger_lines
    set collected = collected + pending,
        pending = 0,
        collected_at = coalesce(collected_at, current_date),
        collected_at_label = coalesce(
          nullif(collected_at_label, ''),
          to_char(current_date, 'DD/MM/YYYY')
        ),
        source = case
          when source in ('liquidation', 'lila', 'manual') then source || '_admin_reconciled'
          else source
        end
    where id = v_line.id;
    v_closed := v_closed + 1;
    v_amount := round(v_amount + v_line.pending, 2);
    v_ids := array_append(v_ids, v_line.id);
  end loop;

  -- Idempotente: si ya no había pending, no falla.
  -- Clave estable tipo october2026LedgerStatus (inglés lowercase + año).
  v_meta_key := lower(to_char(to_date(p_period_ym || '-01', 'YYYY-MM-DD'), 'FMmonth'))
    || to_char(to_date(p_period_ym || '-01', 'YYYY-MM-DD'), 'YYYY')
    || 'LedgerStatus';

  update public.members
  set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
    v_meta_key,
    'conciliado administrativamente; ' || v_reason,
    'feeLedgerAdminReconcile',
    coalesce(meta->'feeLedgerAdminReconcile', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'period', p_period_ym,
        'reason', v_reason,
        'evidenceNote', v_note,
        'amount', v_amount,
        'lineIds', to_jsonb(v_ids),
        'at', now(),
        'by', auth.uid()
      )
    )
  ),
  updated_at = now()
  where id = p_member_id;

  begin
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'fee_ledger_admin_reconcile',
      'member',
      p_member_id::text,
      jsonb_build_object(
        'memberNumber', v_member.member_number,
        'period', p_period_ym,
        'reason', v_reason,
        'evidenceNote', v_note,
        'amount', v_amount,
        'lineIds', to_jsonb(v_ids),
        'closedLines', v_closed
      )
    );
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'memberNumber', v_member.member_number,
    'period', p_period_ym,
    'closedLines', v_closed,
    'amount', v_amount,
    'lineIds', to_jsonb(v_ids),
    'idempotent', v_closed = 0,
    'createdPayment', false
  );
end;
$$;

revoke all on function public.admin_reconcile_fee_ledger_period(uuid, text, text, text) from public;
grant execute on function public.admin_reconcile_fee_ledger_period(uuid, text, text, text) to authenticated;

-- 5) Detector: member_financial_integrity_v1
create or replace function public.member_financial_integrity_v1(
  p_member_number text default null
)
returns table (
  member_number text,
  full_name text,
  period_ym text,
  ficha_balance numeric,
  ledger_pending numeric,
  difference numeric,
  evidence text,
  probable_cause text,
  reconciliation_status text,
  anomaly_code text
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      m.id,
      m.member_number::text as member_number,
      m.full_name,
      coalesce(m.outstanding_balance, 0)::numeric as ficha_balance,
      m.next_due_date,
      nullif(trim(coalesce(m.meta->>'duesCoveredThrough', '')), '') as covered_through,
      f.id as line_id,
      f.line_date,
      to_char(f.line_date, 'YYYY-MM') as period_ym,
      coalesce(f.pending, 0)::numeric as ledger_pending,
      coalesce(f.collected, 0)::numeric as ledger_collected,
      coalesce(f.amount, 0)::numeric as ledger_amount,
      coalesce(f.source, '') as line_source
    from public.members m
    join public.fee_ledger_lines f
      on f.member_number = m.member_number::text
    where m.status = 'active'
      and (p_member_number is null or m.member_number::text = p_member_number)
      and f.line_date is not null
  ),
  scored as (
    select
      b.*,
      public.member_period_is_covered(b.id, b.period_ym) as covered,
      exists (
        select 1 from public.member_payments mp
        where mp.member_id = b.id
          and coalesce(mp.meta->>'status', '') not in ('void', 'anulled')
          and (
            to_char(mp.paid_at, 'YYYY-MM') = b.period_ym
            or exists (
              select 1 from jsonb_array_elements_text(coalesce(mp.meta->'periodDueOns', '[]'::jsonb)) d
              where left(d, 7) = b.period_ym
            )
          )
      ) as has_payment_for_period,
      exists (
        select 1 from public.dues_imputations di
        where di.member_id = b.id
          and di.voided_at is null
          and to_char(di.due_on, 'YYYY-MM') = b.period_ym
      ) as has_imputation
    from base b
  )
  select
    s.member_number,
    s.full_name,
    s.period_ym,
    s.ficha_balance,
    s.ledger_pending,
    round(s.ledger_pending - greatest(s.ficha_balance, 0), 2) as difference,
    concat_ws(
      ' · ',
      'línea ' || s.line_id,
      'source=' || s.line_source,
      case when s.covered_through is not null then 'coveredThrough=' || s.covered_through end,
      case when s.next_due_date is not null then 'nextDue=' || s.next_due_date::text end,
      case when s.has_payment_for_period then 'pago_periodo=si' else 'pago_periodo=no' end,
      case when s.has_imputation then 'imputacion=si' else 'imputacion=no' end
    ) as evidence,
    case
      when s.ficha_balance <= 0.009 and s.ledger_pending > 0.009 and s.covered
        then 'liquidacion_o_import_sin_cerrar_ledger'
      when s.ficha_balance <= 0.009 and s.ledger_pending > 0.009
        then 'ficha_cero_con_ledger_pendiente'
      when s.has_imputation and s.ledger_pending > 0.009
        then 'pago_imputado_ledger_abierto'
      when s.ledger_collected > 0.009 and not s.has_payment_for_period and s.line_source like '%admin_reconciled%'
        then 'conciliado_admin_sin_comprobante'
      when s.ledger_collected > 0.009 and not s.has_payment_for_period
        then 'ledger_cobrado_sin_pago_local'
      when abs(s.ledger_amount - (s.ledger_collected + s.ledger_pending)) > 0.01
        then 'descuadre_importe_linea'
      when s.ficha_balance <= 0.009
           and s.next_due_date is not null
           and to_char(s.next_due_date, 'YYYY-MM') <= s.period_ym
           and s.ledger_pending > 0.009
        then 'next_due_incoherente_con_pending'
      else 'revisar'
    end as probable_cause,
    case
      when s.line_source like '%admin_reconciled%' then 'conciliado_administrativamente'
      when s.ledger_pending <= 0.009 and (s.has_payment_for_period or s.has_imputation or s.covered)
        then 'pagado'
      when s.ficha_balance <= 0.009 and s.ledger_pending > 0.009
        then 'en_revision'
      when s.ledger_pending > 0.009
        then 'pendiente'
      else 'pagado'
    end as reconciliation_status,
    case
      when s.ficha_balance <= 0.009 and s.ledger_pending > 0.009
        then 'ficha_zero_ledger_pending'
      when s.has_imputation and s.ledger_pending > 0.009
        then 'paid_period_ledger_open'
      when s.ledger_collected > 0.009 and not s.has_payment_for_period and s.line_source not like '%admin_reconciled%'
        then 'ledger_collected_without_payment'
      when abs(s.ledger_amount - (s.ledger_collected + s.ledger_pending)) > 0.01
        then 'amount_mismatch'
      when s.ficha_balance <= 0.009
           and s.next_due_date is not null
           and to_char(s.next_due_date, 'YYYY-MM') <= s.period_ym
           and s.ledger_pending > 0.009
        then 'next_due_incoherent'
      else null
    end as anomaly_code
  from scored s
  where
    (s.ficha_balance <= 0.009 and s.ledger_pending > 0.009)
    or (s.has_imputation and s.ledger_pending > 0.009)
    or (s.ledger_collected > 0.009 and not s.has_payment_for_period and s.line_source not like '%admin_reconciled%' and s.line_source not like '%sync_covered%')
    or abs(s.ledger_amount - (s.ledger_collected + s.ledger_pending)) > 0.01
  order by s.member_number, s.period_ym;
$$;

revoke all on function public.member_financial_integrity_v1(text) from public;
grant execute on function public.member_financial_integrity_v1(text) to authenticated;

-- 6) Cierre contable: un solo mecanismo = registrar_cobro → apply_fee_ledger_collection_for_months.
-- NO crear trigger en dues_imputations: duplicaba cobros parciales (ver migración 20261121153000).

-- PASO 1 correctivo: un solo cierre contable, cobertura estricta, permisos, auditoría, Natalia.
-- No muta saldos de socios reales; no cierra pending masivo.

-- ---------------------------------------------------------------------------
-- B1: un único mecanismo = registrar_cobro (loop existente).
-- El trigger sync_fee_ledger_on_dues_imputation duplicaba cobros parciales
-- (imputación $35k + loop $35k → collected $70k). Se elimina.
-- ---------------------------------------------------------------------------
drop trigger if exists dues_imputations_sync_fee_ledger on public.dues_imputations;
drop function if exists public.sync_fee_ledger_on_dues_imputation();

-- ---------------------------------------------------------------------------
-- B3: apply_fee_ledger_collection_for_months solo interno (security definer).
-- No EXECUTE para authenticated / anon / public.
-- ---------------------------------------------------------------------------
create or replace function public.apply_fee_ledger_collection_for_months(
  p_member_number text,
  p_months text[],
  p_paid_on date default current_date,
  p_cover numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cover numeric := coalesce(p_cover, 1e12);
  v_line record;
  v_take numeric;
  v_applied numeric := 0;
  v_ids text[] := '{}';
begin
  -- Solo callable por funciones definer del owner (registrar_cobro / service role).
  if coalesce(array_length(p_months, 1), 0) = 0 or nullif(trim(p_member_number), '') is null then
    return jsonb_build_object('applied', 0, 'lineIds', '[]'::jsonb);
  end if;
  if v_cover is not null and v_cover <= 0.009 then
    return jsonb_build_object('applied', 0, 'lineIds', '[]'::jsonb, 'remainingCover', v_cover);
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
-- Owner / service_role retain execute by default.

-- ---------------------------------------------------------------------------
-- B2: cobertura estricta — no por paid_at del mes, ni ficha=0+next_due, ni imputación parcial.
-- ---------------------------------------------------------------------------
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
  v_meta_key text;
  v_imputed numeric;
  v_period_capital numeric;
begin
  if p_member_id is null or p_period_ym !~ '^\d{4}-\d{2}$' then
    return false;
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found then
    return false;
  end if;

  -- Conciliación administrativa trazable (clave en inglés fija, no depende de lc_time).
  v_meta_key := (array[
      'january','february','march','april','may','june',
      'july','august','september','october','november','december'
    ])[extract(month from to_date(p_period_ym || '-01', 'YYYY-MM-DD'))::int]
    || to_char(to_date(p_period_ym || '-01', 'YYYY-MM-DD'), 'YYYY')
    || 'LedgerStatus';
  if coalesce(v_member.meta->>v_meta_key, '') ilike '%conciliado administrativamente%' then
    return true;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_member.meta->'feeLedgerAdminReconcile', '[]'::jsonb)) r
    where left(coalesce(r->>'period', ''), 7) = p_period_ym
  ) then
    return true;
  end if;

  v_covered := nullif(trim(coalesce(v_member.meta->>'duesCoveredThrough', '')), '');
  if v_covered ~ '^\d{4}-\d{2}' and left(v_covered, 7) >= p_period_ym then
    return true;
  end if;

  v_due := (p_period_ym || '-10')::date;

  -- Período cerrado en schedule operativo (capital_open = 0).
  if exists (
    select 1
    from public.member_dues_periods mdp
    where mdp.member_id = p_member_id
      and mdp.due_on = v_due
      and coalesce(mdp.capital_open, 0) <= 0.009
      and coalesce(mdp.capital, 0) > 0.009
  ) then
    return true;
  end if;

  -- Imputaciones: cobertura plena (suma >= capital del período o capital_open residual 0 en última fila).
  select coalesce(sum(di.capital + di.surcharge), 0)
    into v_imputed
  from public.dues_imputations di
  where di.member_id = p_member_id
    and di.voided_at is null
    and coalesce(di.kind, 'cobro') is distinct from 'adelanto'
    and to_char(di.due_on, 'YYYY-MM') = p_period_ym;

  select coalesce(mdp.capital, 0)
    into v_period_capital
  from public.member_dues_periods mdp
  where mdp.member_id = p_member_id
    and mdp.due_on = v_due;

  if coalesce(v_period_capital, 0) > 0.009 and v_imputed + 0.009 >= v_period_capital then
    return true;
  end if;

  if exists (
    select 1
    from public.dues_imputations di
    where di.member_id = p_member_id
      and di.voided_at is null
      and coalesce(di.kind, 'cobro') is distinct from 'adelanto'
      and to_char(di.due_on, 'YYYY-MM') = p_period_ym
      and coalesce(di.capital_open, 0) <= 0.009
      and coalesce(di.capital, 0) > 0.009
  ) then
    return true;
  end if;

  -- Pago verificable solo si declara el período (periodDueOns / meta), no por paid_at del mes.
  if exists (
    select 1
    from public.member_payments mp
    where mp.member_id = p_member_id
      and coalesce(mp.meta->>'status', '') not in ('void', 'anulled')
      and (
        exists (
          select 1
          from jsonb_array_elements_text(coalesce(mp.meta->'periodDueOns', '[]'::jsonb)) d
          where left(d, 7) = p_period_ym
        )
        or coalesce(mp.meta->>'period', '') ilike ('%' || p_period_ym || '%')
        or coalesce(mp.period_label, '') ilike ('%' || to_char(to_date(p_period_ym || '-01', 'YYYY-MM-DD'), 'MM/YYYY') || '%')
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.member_period_is_covered(uuid, text) from public;
grant execute on function public.member_period_is_covered(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B4: admin_reconcile — entity_id uuid, auditoría atómica, sin fecha de cobro inventada,
--     sin silent catch, sin audit duplicado en reintento.
-- B3: permisos más estrictos (staff + capability).
-- ---------------------------------------------------------------------------
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
  v_already boolean := false;
begin
  if not (
    public.has_staff_access()
    and (
      public.has_capability('dues.liquidate')
      or public.has_capability('members.write')
      or public.has_admin_access()
    )
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

  v_meta_key := (array[
      'january','february','march','april','may','june',
      'july','august','september','october','november','december'
    ])[extract(month from to_date(p_period_ym || '-01', 'YYYY-MM-DD'))::int]
    || to_char(to_date(p_period_ym || '-01', 'YYYY-MM-DD'), 'YYYY')
    || 'LedgerStatus';

  v_already := coalesce(v_member.meta->>v_meta_key, '') ilike '%conciliado administrativamente%'
    or exists (
      select 1
      from jsonb_array_elements(coalesce(v_member.meta->'feeLedgerAdminReconcile', '[]'::jsonb)) r
      where left(coalesce(r->>'period', ''), 7) = p_period_ym
    );

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
        -- No inventar fecha de cobro: etiqueta administrativa, collected_at intacto si ya había.
        collected_at_label = coalesce(
          nullif(collected_at_label, ''),
          'conciliación administrativa'
        ),
        source = case
          when source in ('liquidation', 'lila', 'manual') then source || '_admin_reconciled'
          when source like '%_admin_reconciled' then source
          else source || '_admin_reconciled'
        end
    where id = v_line.id;
    v_closed := v_closed + 1;
    v_amount := round(v_amount + v_line.pending, 2);
    v_ids := array_append(v_ids, v_line.id);
  end loop;

  -- Reintento idempotente: sin pending nuevo y ya conciliado → no re-auditar ni re-append meta.
  if v_closed = 0 and v_already then
    return jsonb_build_object(
      'ok', true,
      'memberNumber', v_member.member_number,
      'period', p_period_ym,
      'closedLines', 0,
      'amount', 0,
      'lineIds', '[]'::jsonb,
      'idempotent', true,
      'createdPayment', false
    );
  end if;

  update public.members
  set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
    v_meta_key,
    'conciliado administrativamente; ' || v_reason,
    'feeLedgerAdminReconcile',
    case
      when v_already then coalesce(meta->'feeLedgerAdminReconcile', '[]'::jsonb)
      else coalesce(meta->'feeLedgerAdminReconcile', '[]'::jsonb) || jsonb_build_array(
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
    end
  ),
  updated_at = now()
  where id = p_member_id;

  -- Auditoría atómica con el cierre (sin swallow). entity_id es uuid.
  if not v_already then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'fee_ledger_admin_reconcile',
      'member',
      p_member_id,
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
  end if;

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
revoke all on function public.admin_reconcile_fee_ledger_period(uuid, text, text, text) from anon;
grant execute on function public.admin_reconcile_fee_ledger_period(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B5: member_financial_integrity_v1 — admin / lila / evidencia pendiente vs deuda.
-- ---------------------------------------------------------------------------
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
      m.meta,
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
      (array[
        'january','february','march','april','may','june',
        'july','august','september','october','november','december'
      ])[extract(month from b.line_date)::int]
        || to_char(b.line_date, 'YYYY')
        || 'LedgerStatus' as meta_status_key,
      public.member_period_is_covered(b.id, b.period_ym) as covered,
      exists (
        select 1 from public.member_payments mp
        where mp.member_id = b.id
          and coalesce(mp.meta->>'status', '') not in ('void', 'anulled')
          and (
            exists (
              select 1 from jsonb_array_elements_text(coalesce(mp.meta->'periodDueOns', '[]'::jsonb)) d
              where left(d, 7) = b.period_ym
            )
            or coalesce(mp.meta->>'period', '') ilike ('%' || b.period_ym || '%')
            or coalesce(mp.period_label, '') ilike ('%' || to_char(b.line_date, 'MM/YYYY') || '%')
          )
      ) as has_payment_for_period,
      exists (
        select 1 from public.dues_imputations di
        where di.member_id = b.id
          and di.voided_at is null
          and coalesce(di.kind, 'cobro') is distinct from 'adelanto'
          and to_char(di.due_on, 'YYYY-MM') = b.period_ym
          and coalesce(di.capital_open, 0) <= 0.009
          and coalesce(di.capital, 0) > 0.009
      ) as has_full_imputation,
      (
        coalesce(b.meta->> (
          (array[
            'january','february','march','april','may','june',
            'july','august','september','october','november','december'
          ])[extract(month from b.line_date)::int]
          || to_char(b.line_date, 'YYYY')
          || 'LedgerStatus'
        ), '') ilike '%conciliado administrativamente%'
        or b.line_source like '%admin_reconciled%'
        or exists (
          select 1
          from jsonb_array_elements(coalesce(b.meta->'feeLedgerAdminReconcile', '[]'::jsonb)) r
          where left(coalesce(r->>'period', ''), 7) = b.period_ym
        )
      ) as is_admin_reconciled,
      (b.line_source = 'lila' or b.line_source like 'lila%') as is_lila_import
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
      case when s.has_full_imputation then 'imputacion_plena=si' else 'imputacion_plena=no' end,
      case when s.is_admin_reconciled then 'admin=si' else null end,
      case when s.is_lila_import then 'import_lila=si' else null end
    ) as evidence,
    case
      when s.is_admin_reconciled then 'conciliado_admin_evidencia_pendiente'
      when s.is_lila_import and s.ledger_pending <= 0.009 then 'import_lila_sin_pago_local'
      when s.ficha_balance <= 0.009 and s.ledger_pending > 0.009 and s.covered
        then 'liquidacion_o_import_sin_cerrar_ledger'
      when s.ficha_balance <= 0.009 and s.ledger_pending > 0.009
        then 'ficha_cero_con_ledger_pendiente'
      when s.has_full_imputation and s.ledger_pending > 0.009
        then 'pago_imputado_ledger_abierto'
      when s.ledger_collected > 0.009 and not s.has_payment_for_period
           and not s.is_admin_reconciled and not s.is_lila_import
           and s.line_source not like '%sync_covered%'
        then 'ledger_cobrado_sin_pago_local'
      when abs(s.ledger_amount - (s.ledger_collected + s.ledger_pending)) > 0.01
        then 'descuadre_importe_linea'
      else 'revisar'
    end as probable_cause,
    case
      when s.is_admin_reconciled then 'conciliado_administrativamente'
      when s.is_lila_import and s.ledger_pending <= 0.009 then 'evidencia_pendiente'
      when s.ledger_pending <= 0.009 and (s.has_payment_for_period or s.has_full_imputation or s.covered)
        then 'pagado'
      when s.ficha_balance <= 0.009 and s.ledger_pending > 0.009
        then 'en_revision'
      when s.ledger_pending > 0.009
        then 'pendiente'
      else 'pagado'
    end as reconciliation_status,
    case
      when s.is_admin_reconciled and s.ledger_pending <= 0.009
        then 'admin_reconciled_evidence_pending'
      when s.is_lila_import and s.ledger_pending <= 0.009 and not s.has_payment_for_period
        then 'imported_lila_evidence_pending'
      when s.ficha_balance <= 0.009 and s.ledger_pending > 0.009
        then 'ficha_zero_ledger_pending'
      when s.has_full_imputation and s.ledger_pending > 0.009
        then 'paid_period_ledger_open'
      when s.ledger_collected > 0.009
           and not s.has_payment_for_period
           and not s.is_admin_reconciled
           and not s.is_lila_import
           and s.line_source not like '%admin_reconciled%'
           and s.line_source not like '%sync_covered%'
        then 'ledger_collected_without_payment'
      when abs(s.ledger_amount - (s.ledger_collected + s.ledger_pending)) > 0.01
        then 'amount_mismatch'
      else null
    end as anomaly_code
  from scored s
  where
    -- Deuda / desync operativo
    (s.ficha_balance <= 0.009 and s.ledger_pending > 0.009)
    or (s.has_full_imputation and s.ledger_pending > 0.009)
    or abs(s.ledger_amount - (s.ledger_collected + s.ledger_pending)) > 0.01
    -- Evidencia pendiente (no deuda): admin o lila sin pago local
    or (s.is_admin_reconciled and s.ledger_pending <= 0.009 and not s.has_payment_for_period)
    or (s.is_lila_import and s.ledger_pending <= 0.009 and not s.has_payment_for_period)
    -- Verdadera anomalía de cobro sin pago (excluye admin/lila/sync)
    or (
      s.ledger_collected > 0.009
      and not s.has_payment_for_period
      and not s.is_admin_reconciled
      and not s.is_lila_import
      and s.line_source not like '%admin_reconciled%'
      and s.line_source not like '%sync_covered%'
    )
  order by s.member_number, s.period_ym;
$$;

revoke all on function public.member_financial_integrity_v1(text) from public;
grant execute on function public.member_financial_integrity_v1(text) to authenticated;

-- registrar_cobro conserva su loop fee_ledger (único cierre). El trigger ya no existe.
-- apply_fee_ledger_collection_for_months queda como helper interno (security definer, sin EXECUTE a authenticated).

-- Cobrar cuota / Imputar: respetar regularizaciones admin parciales y no reinsuflar
-- meta.unpaidCapital histórico por encima de outstanding_balance.
--
-- PREPARE ONLY — no aplicar en producción sin autorización explícita.
-- No modifica outstanding_balance, no genera cobros ni ingresos.

-- 1) member_period_is_covered: parcial ≠ cubierto
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
  v_ledger_pending numeric;
begin
  if p_member_id is null or p_period_ym !~ '^\d{4}-\d{2}$' then
    return false;
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found then
    return false;
  end if;

  -- Regularización parcial: sigue exigible mientras el auxiliar tenga pending social.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_member.meta->'feeLedgerAdminPartialReconcile', '[]'::jsonb)) r
    where left(coalesce(r->>'period', ''), 7) = p_period_ym
  ) then
    select coalesce(sum(fl.pending), 0) into v_ledger_pending
    from public.fee_ledger_lines fl
    where fl.member_number = v_member.member_number
      and to_char(fl.line_date, 'YYYY-MM') = p_period_ym
      and coalesce(fl.pending, 0) > 0.009
      and coalesce(fl.type_label, '') not ilike '%tenis%';
    if coalesce(v_ledger_pending, 0) > 0.009 then
      return false;
    end if;
  end if;

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

-- 2) Alinear meta.unpaidCapital con outstanding cuando quedó histórico de más
--    (p. ej. 82000 vs ficha 54000). No toca outstanding_balance ni genera ingresos.
do $$
declare
  v_n int := 0;
begin
  with stale as (
    select m.id,
           m.outstanding_balance,
           (m.meta->>'unpaidCapital')::numeric as unpaid
    from public.members m
    where m.meta ? 'unpaidCapital'
      and (m.meta->>'unpaidCapital') ~ '^-?\d+(\.\d+)?$'
      and (m.meta->>'unpaidCapital')::numeric > m.outstanding_balance + 0.01
      and (
        m.meta ? 'feeLedgerAdminReconcile'
        or m.meta ? 'feeLedgerAdminPartialReconcile'
        or m.meta ? 'feeLedgerAdminReconcileBatch'
      )
  )
  update public.members m
  set meta = jsonb_set(
        coalesce(m.meta, '{}'::jsonb),
        '{unpaidCapital}',
        to_jsonb(round(s.outstanding_balance::numeric, 2)),
        true
      )
      || jsonb_build_object(
        'unpaidCapitalSyncedAt', to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD'),
        'unpaidCapitalSyncedFrom', s.unpaid,
        'unpaidCapitalSyncBatch', 'dues_impute_respect_admin_regularizations_20261124'
      ),
      updated_at = now()
  from stale s
  where m.id = s.id;

  get diagnostics v_n = row_count;
  raise notice 'unpaidCapital synced for % members (outstanding unchanged)', v_n;
end $$;

notify pgrst, 'reload schema';

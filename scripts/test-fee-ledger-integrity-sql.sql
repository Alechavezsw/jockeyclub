-- Pruebas de integración SQL (ejecutar en transacción + ROLLBACK).
-- No muta socios reales del padrón.

begin;

-- Fixture aislado
create temporary table if not exists _fee_test_log (step text, ok boolean, detail text);

do $$
declare
  v_member_id uuid := gen_random_uuid();
  v_account_id text := 'fca-test-integrity';
  v_line_id text := 'fll-test-partial-' || substr(v_member_id::text, 1, 8);
  v_nro text := '9' || lpad((floor(random()*100000))::int::text, 5, '0');
  v_res jsonb;
  v_pending numeric;
  v_collected numeric;
  v_cov boolean;
begin
  -- cuenta mínima si hace falta
  insert into public.fee_ledger_accounts (id, accessin_id, name, balance, is_active)
  values (v_account_id, 999001, 'TEST INTEGRITY', 0, true)
  on conflict (id) do nothing;

  insert into public.members (
    id, member_number, full_name, status, outstanding_balance, next_due_date, meta
  ) values (
    v_member_id, v_nro::bigint, 'TEST FEE LEDGER INTEGRITY', 'active', 70000,
    date '2026-11-10', '{}'::jsonb
  );

  insert into public.fee_ledger_lines (
    id, account_id, member_number, member_name, line_date, type_label, description,
    amount, collected, pending, source
  ) values (
    v_line_id, v_account_id, v_nro, 'TEST FEE LEDGER INTEGRITY', date '2026-11-01',
    'Cuota', 'Test parcial', 70000, 0, 70000, 'liquidation'
  );

  -- B1 parcial: un solo apply $35k
  v_res := public.apply_fee_ledger_collection_for_months(v_nro, array['2026-11'], date '2026-11-20', 35000);
  select pending, collected into v_pending, v_collected from public.fee_ledger_lines where id = v_line_id;
  if v_collected <> 35000 or v_pending <> 35000 then
    raise exception 'parcial falló: collected=% pending=% res=%', v_collected, v_pending, v_res;
  end if;

  -- segundo apply $35k (completo)
  v_res := public.apply_fee_ledger_collection_for_months(v_nro, array['2026-11'], date '2026-11-20', 35000);
  select pending, collected into v_pending, v_collected from public.fee_ledger_lines where id = v_line_id;
  if v_collected <> 70000 or v_pending <> 0 then
    raise exception 'completo falló: collected=% pending=%', v_collected, v_pending;
  end if;

  -- reintento no duplica
  v_res := public.apply_fee_ledger_collection_for_months(v_nro, array['2026-11'], date '2026-11-20', 35000);
  if coalesce((v_res->>'applied')::numeric, -1) <> 0 then
    raise exception 'reintento no idempotente: %', v_res;
  end if;

  -- B2: paid_at del mes no cubre
  insert into public.member_payments (id, member_id, amount, paid_at, method, concept, meta)
  values (
    gen_random_uuid(), v_member_id, 1000, date '2026-10-15', 'efectivo', 'otro',
    '{}'::jsonb
  );
  v_cov := public.member_period_is_covered(v_member_id, '2026-10');
  if v_cov then
    raise exception 'paid_at del mes no debe cubrir el período';
  end if;

  -- periodDueOns sí cubre
  update public.member_payments
  set meta = jsonb_build_object('periodDueOns', jsonb_build_array('2026-10-10'))
  where member_id = v_member_id;
  v_cov := public.member_period_is_covered(v_member_id, '2026-10');
  if not v_cov then
    raise exception 'periodDueOns debería cubrir';
  end if;

  raise notice 'SQL integration OK member=% nro=%', v_member_id, v_nro;
end;
$$;

rollback;

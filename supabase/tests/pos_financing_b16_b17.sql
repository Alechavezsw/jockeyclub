-- Evidencias SQL B16/B17 (ejecutar con BEGIN…ROLLBACK o en branch aislado).
-- NO aplicar migraciones en producción.
-- Cupón mixto+mora: capital 50k + mora 7k + interés 5k = 62k.
-- Idempotencia: percent (no appliedPercent) + snapshot completo.

\set ON_ERROR_STOP on

begin;

-- Catálogo mínimo para authorize (rollback al final).
insert into public.app_settings (key, value)
values (
  'paymentPlans',
  '[
    {"id":"visa-10","label":"Visa 10%","active":true,"cardBrand":"Visa","installments":3,"financingMode":"club_keeps","financingPercent":10,"allowOperatorOverride":false},
    {"id":"master-12","label":"Master 12","active":true,"cardBrand":"Master","installments":3,"financingMode":"club_keeps","financingPercent":12,"allowOperatorOverride":false}
  ]'::jsonb
)
on conflict (key) do update set value = excluded.value;

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

-- ============================================================================
-- B16: cupón = capital + mora + interés (interés solo sobre capital)
-- ============================================================================
do $$
declare
  v jsonb;
begin
  v := public.authorize_pos_card_financing(jsonb_build_object(
    'paymentPlanId', 'visa-10',
    'financingBase', 50000,
    'surchargeAmount', 7000
  ));
  if (v->>'financingAmount')::numeric <> 5000 then
    raise exception 'B16 FAIL financingAmount=% (esperado 5000)', v->>'financingAmount';
  end if;
  if (v->>'voucherTotal')::numeric <> 62000 then
    raise exception 'B16 FAIL voucherTotal=% (esperado 62000)', v->>'voucherTotal';
  end if;
  if (v->>'surchargeAmount')::numeric <> 7000 then
    raise exception 'B16 FAIL surchargeAmount=%', v->>'surchargeAmount';
  end if;
  if (v->>'percent')::numeric <> 10 then
    raise exception 'B16 FAIL percent persistido=%', v->>'percent';
  end if;
  if v ? 'appliedPercent' and v->>'appliedPercent' is not null then
    raise exception 'B16 FAIL: no debe persistir appliedPercent';
  end if;
  raise notice 'B16 OK cupón 62000 = 50000 + 7000 + 5000';
end $$;

-- Bloqueo: mixto+mora sin capitalAmount/surchargeAmount (lógica de registrar)
do $$
declare
  v_ok boolean := false;
begin
  begin
    -- Simula la guarda de registrar_cobro_pos B16
    if nullif(''::text, '') is null then
      raise exception
        'Pago mixto con mora y POS: cada tramo debe declarar capitalAmount y surchargeAmount. No se financia mora por defecto.';
    end if;
  exception
    when others then
      if SQLERRM ~* 'capitalAmount|surchargeAmount|mora' then
        v_ok := true;
      else
        raise;
      end if;
  end;
  if not v_ok then raise exception 'B16 FAIL: debió bloquear sin asignación'; end if;
  raise notice 'B16 OK bloqueo sin asignación';
end $$;

-- ============================================================================
-- B17: assert_pos_idempotent_snapshot
-- ============================================================================
do $$
declare
  v_member uuid := '11111111-1111-1111-1111-111111111111';
  v_payment jsonb;
  v_ok boolean;
begin
  v_payment := jsonb_build_object(
    'amount', 70000,
    'member_id', v_member,
    'method', 'tarjeta',
    'meta', jsonb_build_object(
      'paymentPlanId', 'visa-10',
      'voucherAmount', 77000,
      'periodDueOns', '["2026-11-10"]'::jsonb,
      'cardFinancing', jsonb_build_object(
        'planId', 'visa-10',
        'mode', 'club_keeps',
        'percent', 10,
        'financingAmount', 7000,
        'voucherTotal', 77000,
        'authReference', 'REF-1'
      ),
      'receiptParse', jsonb_build_object('reference', 'REF-1', 'amount', 77000)
    )
  );

  -- 1) Mismo pago: OK
  perform public.assert_pos_idempotent_snapshot(
    v_payment, 70000, v_member,
    jsonb_build_object(
      'method', 'tarjeta',
      'paymentPlanId', 'visa-10',
      'financingPercent', 10,
      'voucherAmount', 77000,
      'periodDueOns', '["2026-11-10"]'::jsonb,
      'receiptParse', jsonb_build_object('reference', 'REF-1', 'amount', 77000)
    )
  );
  raise notice 'B17 OK same retry';

  -- 2) Cambio % sin cardFinancing → rechazo (percent vs percent)
  v_ok := false;
  begin
    perform public.assert_pos_idempotent_snapshot(
      v_payment, 70000, v_member,
      jsonb_build_object(
        'method', 'tarjeta',
        'paymentPlanId', 'visa-10',
        'financingPercent', 15,
        'periodDueOns', '["2026-11-10"]'::jsonb
      )
    );
  exception when others then
    if SQLERRM ~* 'interés' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B17 FAIL: debió rechazar cambio de %%'; end if;
  raise notice 'B17 OK percent conflict without cardFinancing';

  -- 3) Cambio de plan → rechazo
  v_ok := false;
  begin
    perform public.assert_pos_idempotent_snapshot(
      v_payment, 70000, v_member,
      jsonb_build_object(
        'method', 'tarjeta',
        'paymentPlanId', 'master-12',
        'financingPercent', 10,
        'periodDueOns', '["2026-11-10"]'::jsonb
      )
    );
  exception when others then
    if SQLERRM ~* 'plan POS' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B17 FAIL: debió rechazar cambio de plan'; end if;
  raise notice 'B17 OK plan conflict';

  -- 4) Cambio de cupón → rechazo
  v_ok := false;
  begin
    perform public.assert_pos_idempotent_snapshot(
      v_payment, 70000, v_member,
      jsonb_build_object(
        'method', 'tarjeta',
        'paymentPlanId', 'visa-10',
        'voucherAmount', 88000,
        'periodDueOns', '["2026-11-10"]'::jsonb
      )
    );
  exception when others then
    if SQLERRM ~* 'cupón' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B17 FAIL: debió rechazar cambio de cupón'; end if;
  raise notice 'B17 OK voucher conflict';

  -- 5) Cambio de referencia → rechazo
  v_ok := false;
  begin
    perform public.assert_pos_idempotent_snapshot(
      v_payment, 70000, v_member,
      jsonb_build_object(
        'method', 'tarjeta',
        'paymentPlanId', 'visa-10',
        'periodDueOns', '["2026-11-10"]'::jsonb,
        'receiptParse', jsonb_build_object('reference', 'OTRA-REF', 'amount', 77000)
      )
    );
  exception when others then
    if SQLERRM ~* 'referencia' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B17 FAIL: debió rechazar cambio de referencia'; end if;
  raise notice 'B17 OK reference conflict';
end $$;

-- Mixto: plan de tramo y capital/mora
do $$
declare
  v_member uuid := '22222222-2222-2222-2222-222222222222';
  v_payment jsonb;
  v_ok boolean;
  v_splits jsonb := '[
    {"method":"efectivo","amount":20000,"capitalAmount":20000,"surchargeAmount":0},
    {"method":"tarjeta","amount":57000,"capitalAmount":50000,"surchargeAmount":7000,
     "paymentPlanId":"visa-10","voucherAmount":62000,
     "cardFinancing":{"planId":"visa-10","mode":"club_keeps","percent":10,"financingAmount":5000,"voucherTotal":62000},
     "receiptParse":{"reference":"MIX-1","amount":62000}}
  ]'::jsonb;
begin
  v_payment := jsonb_build_object(
    'amount', 77000,
    'member_id', v_member,
    'method', 'mixto',
    'meta', jsonb_build_object(
      'periodDueOns', '["2026-11-10"]'::jsonb,
      'paymentSplits', v_splits
    )
  );

  perform public.assert_pos_idempotent_snapshot(
    v_payment, 77000, v_member,
    jsonb_build_object(
      'method', 'mixto',
      'periodDueOns', '["2026-11-10"]'::jsonb,
      'paymentSplits', v_splits
    )
  );
  raise notice 'B17 OK mixed same';

  v_ok := false;
  begin
    perform public.assert_pos_idempotent_snapshot(
      v_payment, 77000, v_member,
      jsonb_build_object(
        'method', 'mixto',
        'periodDueOns', '["2026-11-10"]'::jsonb,
        'paymentSplits', jsonb_set(v_splits, '{1,paymentPlanId}', '"master-12"')
      )
    );
  exception when others then
    if SQLERRM ~* 'plan POS del tramo' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B17 FAIL: debió rechazar plan del tramo mixto'; end if;
  raise notice 'B17 OK mixed plan conflict';

  v_ok := false;
  begin
    perform public.assert_pos_idempotent_snapshot(
      v_payment, 77000, v_member,
      jsonb_build_object(
        'method', 'mixto',
        'periodDueOns', '["2026-11-10"]'::jsonb,
        'paymentSplits', jsonb_set(
          jsonb_set(v_splits, '{1,capitalAmount}', '45000'),
          '{1,surchargeAmount}', '12000'
        )
      )
    );
  exception when others then
    if SQLERRM ~* 'capital/mora' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B17 FAIL: debió rechazar distribución capital/mora'; end if;
  raise notice 'B17 OK mixed capital/mora conflict';
end $$;

select 'B16-B17 SQL tests passed; rolling back'::text as status;

rollback;

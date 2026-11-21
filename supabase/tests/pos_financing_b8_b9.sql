-- Evidencias SQL B8/B9 (ejecutar en branch aislado o BEGIN…ROLLBACK).
-- NO aplicar en producción.

\set ON_ERROR_STOP on

begin;

-- Catálogo de prueba (no commit).
insert into public.app_settings (key, value)
values (
  'paymentPlans',
  '[
    {"id":"visa-contado","label":"Visa contado","active":true,"cardBrand":"Visa","installments":1},
    {"id":"visa-3-a","label":"Visa 3 A","active":true,"cardBrand":"Visa","installments":3,"financingMode":"club_keeps","financingPercent":10,"allowOperatorOverride":false},
    {"id":"visa-3-expired","label":"Visa vencido","active":true,"cardBrand":"Visa","installments":3,"financingMode":"club_keeps","financingPercent":10,"validTo":"2020-01-01"}
  ]'::jsonb
)
on conflict (key) do update set value = excluded.value;

-- 1) Plan autorizado vigente
do $$
declare
  v jsonb;
begin
  v := public.authorize_pos_card_financing(jsonb_build_object(
    'paymentPlanId', 'visa-3-a',
    'financingBase', 40000,
    'surchargeAmount', 4000
  ));
  if (v->>'financingAmount')::numeric <> 4000 then
    raise exception 'FAIL plan vigente: financingAmount=%', v->>'financingAmount';
  end if;
  if (v->>'voucherTotal')::numeric <> 48000 then
    raise exception 'FAIL plan vigente: voucherTotal=%', v->>'voucherTotal';
  end if;
  if (v->>'mode') <> 'club_keeps' then
    raise exception 'FAIL modalidad';
  end if;
  raise notice 'OK plan autorizado vigente';
end $$;

-- 2) Plan inexistente
do $$
begin
  perform public.authorize_pos_card_financing(jsonb_build_object(
    'paymentPlanId', 'no-existe',
    'financingBase', 1000
  ));
  raise exception 'FAIL: debió rechazar plan inexistente';
exception
  when others then
    if SQLERRM ~* 'inexistente|no cargado' then
      raise notice 'OK plan inexistente: %', SQLERRM;
    else
      raise;
    end if;
end $$;

-- 3) Plan vencido
do $$
begin
  perform public.authorize_pos_card_financing(jsonb_build_object(
    'paymentPlanId', 'visa-3-expired',
    'financingBase', 1000
  ));
  raise exception 'FAIL: debió rechazar plan vencido';
exception
  when others then
    if SQLERRM ~* 'vigente' then
      raise notice 'OK plan vencido: %', SQLERRM;
    else
      raise;
    end if;
end $$;

-- 4) Manipulación cardFinancing
do $$
begin
  perform public.authorize_pos_card_financing(jsonb_build_object(
    'paymentPlanId', 'visa-3-a',
    'financingBase', 40000,
    'surchargeAmount', 0,
    'clientCardFinancing', jsonb_build_object(
      'mode', 'club_keeps',
      'financingAmount', 99999,
      'voucherTotal', 99999
    )
  ));
  raise exception 'FAIL: debió rechazar tamper de importes';
exception
  when others then
    if SQLERRM ~* 'no coinciden|autorizado' then
      raise notice 'OK tamper cardFinancing: %', SQLERRM;
    else
      raise;
    end if;
end $$;

-- 5) Manipulación modalidad A/B
do $$
begin
  perform public.authorize_pos_card_financing(jsonb_build_object(
    'paymentPlanId', 'visa-3-a',
    'financingBase', 40000,
    'clientCardFinancing', jsonb_build_object('mode', 'issuer_keeps', 'financingAmount', 4000, 'voucherTotal', 44000)
  ));
  raise exception 'FAIL: debió rechazar cambio de modalidad';
exception
  when others then
    if SQLERRM ~* 'modalidad' then
      raise notice 'OK tamper modalidad: %', SQLERRM;
    else
      raise;
    end if;
end $$;

-- 6) Cupón distinto del calculado
do $$
begin
  perform public.authorize_pos_card_financing(jsonb_build_object(
    'paymentPlanId', 'visa-3-a',
    'financingBase', 40000,
    'surchargeAmount', 0,
    'receiptVoucher', 50000
  ));
  raise exception 'FAIL: debió rechazar cupón distinto';
exception
  when others then
    if SQLERRM ~* 'cupón|comprobante|calculado' then
      raise notice 'OK cupón distinto: %', SQLERRM;
    else
      raise;
    end if;
end $$;

-- 7) Mora no entra en la tasa
do $$
declare
  v jsonb;
begin
  v := public.authorize_pos_card_financing(jsonb_build_object(
    'paymentPlanId', 'visa-3-a',
    'financingBase', 70000,
    'surchargeAmount', 7000
  ));
  if (v->>'financingAmount')::numeric <> 7000 then
    raise exception 'FAIL mora en tasa: financing=%', v->>'financingAmount';
  end if;
  if (v->>'voucherTotal')::numeric <> 84000 then
    raise exception 'FAIL voucher con mora: %', v->>'voucherTotal';
  end if;
  raise notice 'OK tasa solo sobre capital (mora aparte)';
end $$;

rollback;

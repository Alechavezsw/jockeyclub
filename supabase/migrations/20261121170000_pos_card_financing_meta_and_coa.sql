-- Financiación POS: whitelist meta en registrar_cobro + cuenta 4.1.05.
-- NO aplicar en producción sin autorización explícita.

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
on conflict (id) do nothing;

-- Ampliar meta del cobro: voucher, financiación, parse, journal, snapshot del plan.
do $mig$
declare
  v_sql text;
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
begin
  v_sql := pg_get_functiondef(v_fn::regprocedure);

  if position('''cardFinancing''' in v_sql) > 0 then
    raise notice 'cardFinancing ya está en registrar_cobro';
    return;
  end if;

  if position('''paymentPlanLabel''' in v_sql) > 0 then
    v_sql := replace(
      v_sql,
      '''paymentPlanLabel'', nullif(btrim(coalesce(p_periodos->>''paymentPlanLabel'', '''')), '''')',
      '''paymentPlanLabel'', nullif(btrim(coalesce(p_periodos->>''paymentPlanLabel'', '''')), ''''),
    ''voucherAmount'', nullif(p_periodos->>''voucherAmount'', '''')::numeric,
    ''cardFinancing'', p_periodos->''cardFinancing'',
    ''receiptParse'', p_periodos->''receiptParse'',
    ''journalAccount'', nullif(btrim(coalesce(p_periodos->>''journalAccount'', '''')), ''''),
    ''paymentPlanSnapshot'', p_periodos->''paymentPlanSnapshot'''
    );
  end if;

  if position('''cardFinancing''' in v_sql) = 0 and position('''paymentSplits''' in v_sql) > 0 then
    v_sql := regexp_replace(
      v_sql,
      '''paymentSplits'',\s*p_periodos->''paymentSplits''',
      '''paymentSplits'', p_periodos->''paymentSplits'',
    ''voucherAmount'', nullif(p_periodos->>''voucherAmount'', '''')::numeric,
    ''cardFinancing'', p_periodos->''cardFinancing'',
    ''receiptParse'', p_periodos->''receiptParse'',
    ''journalAccount'', nullif(btrim(coalesce(p_periodos->>''journalAccount'', '''')), ''''),
    ''paymentPlanSnapshot'', p_periodos->''paymentPlanSnapshot''',
      1
    );
  end if;

  if position('''cardFinancing''' in v_sql) = 0 then
    raise exception 'No se pudo agregar cardFinancing a registrar_cobro';
  end if;

  execute v_sql;
end;
$mig$;

-- B18: reintento real con dueOns (como cobroPeriods) vía registrar_cobro_pos.
-- Ejecutar en BEGIN…ROLLBACK o branch aislado. NO aplicar en producción.
-- Requiere: pos_normalize_due_ons, assert_pos_idempotent_snapshot, registrar_cobro_pos
-- (migración 20261121180000) o crearlas en la misma transacción de prueba.

\set ON_ERROR_STOP on

begin;

-- Auth de prueba (superadmin conocido en el entorno de dry-run).
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from public.profiles where role::text = 'superadmin' limit 1),
    'role', 'authenticated'
  )::text,
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  if auth.uid() is null then
    raise exception 'B18 setup: auth.uid() null — no se puede invocar registrar_cobro_pos';
  end if;
  if not public.has_capability('payments.collect') then
    raise exception 'B18 setup: sin payments.collect';
  end if;
end $$;

-- Catálogo mínimo
insert into public.app_settings (key, value)
values (
  'paymentPlans',
  '[{"id":"visa-10","label":"Visa 10%","active":true,"cardBrand":"Visa","installments":3,"financingMode":"club_keeps","financingPercent":10}]'::jsonb
)
on conflict (key) do update set value = excluded.value;

-- Socio throwaway (rollback)
insert into public.members (
  id, member_number, full_name, tier, status, outstanding_balance, next_due_date, meta
) values (
  'b18b18b1-b18b-4b18-b18b-b18b18b18b18',
  'B18-TEST-99901',
  'B18 Idempotencia',
  'socio_familiar',
  'active',
  70000,
  '2026-11-10',
  '{}'::jsonb
);

-- Objeto períodos = forma cobroPeriods() (dueOns, no periodDueOns)
-- Primer cobro POS
do $$
declare
  v_member uuid := 'b18b18b1-b18b-4b18-b18b-b18b18b18b18';
  v_key text := 'b18-idem-key-1';
  v_periods jsonb;
  v1 jsonb;
  v2 jsonb;
  v_bad jsonb;
  v_ok boolean;
  v_payment_id uuid;
  v_journal_id uuid;
  v_count int;
begin
  v_periods := jsonb_build_object(
    'dueOns', jsonb_build_array('2026-11-10'),
    'method', 'tarjeta',
    'paymentPlanId', 'visa-10',
    'paymentPlanLabel', 'Visa 10%',
    'quota', 70000,
    'surcharge', 0,
    'voucherAmount', 77000,
    'financingPercent', 10,
    'receiptParse', jsonb_build_object('amount', 77000, 'reference', 'B18-REF'),
    'receiptName', 'b18.jpg',
    'concept', 'Cuota social · Noviembre de 2026'
  );

  -- 1) Primer cobro
  v1 := public.registrar_cobro_pos(v_member, 70000, v_periods, v_key, null);
  if coalesce((v1->>'idempotent')::boolean, false) then
    raise exception 'B18 FAIL: primer cobro no debe ser idempotent';
  end if;
  v_payment_id := (v1->'payment'->>'id')::uuid;
  if v_payment_id is null then
    raise exception 'B18 FAIL: sin payment id';
  end if;
  if public.pos_normalize_due_ons(v1->'payment'->'meta')
     is distinct from public.pos_normalize_due_ons(v_periods) then
    raise exception 'B18 FAIL: periodDueOns persistidos ≠ dueOns enviados';
  end if;
  if v1->'journal'->'entry'->>'id' is null then
    raise exception 'B18 FAIL: primer cobro sin asiento';
  end if;
  v_journal_id := (v1->'journal'->'entry'->>'id')::uuid;
  raise notice 'B18 OK primer cobro payment=% journal=%', v_payment_id, v_journal_id;

  -- 2) Reintento idéntico con dueOns → mismo pago / asiento
  v2 := public.registrar_cobro_pos(v_member, 70000, v_periods, v_key, null);
  if not coalesce((v2->>'idempotent')::boolean, false) then
    raise exception 'B18 FAIL: reintento debió ser idempotent';
  end if;
  if (v2->'payment'->>'id')::uuid is distinct from v_payment_id then
    raise exception 'B18 FAIL: reintento devolvió otro pago';
  end if;
  if (v2->'journal'->'entry'->>'id')::uuid is distinct from v_journal_id then
    raise exception 'B18 FAIL: reintento devolvió otro asiento';
  end if;
  -- snapshot financiero intacto
  if v2->'cardFinancing' is distinct from v1->'cardFinancing'
     and v2->'payment'->'meta'->'cardFinancing' is distinct from v1->'payment'->'meta'->'cardFinancing' then
    -- permitir null vs object solo si ambos vacíos
    if coalesce(v1->'payment'->'meta'->'cardFinancing', '{}'::jsonb)
       is distinct from coalesce(v2->'payment'->'meta'->'cardFinancing', '{}'::jsonb) then
      raise exception 'B18 FAIL: reintento modificó cardFinancing';
    end if;
  end if;
  select count(*) into v_count from public.member_payments
  where meta->>'idempotencyKey' = v_key;
  if v_count <> 1 then
    raise exception 'B18 FAIL: se duplicó el pago (count=%)', v_count;
  end if;
  select count(*) into v_count from public.journal_entries
  where source_module = 'cuotas' and source_id = v_payment_id and voided_at is null;
  if v_count <> 1 then
    raise exception 'B18 FAIL: se duplicó el asiento (count=%)', v_count;
  end if;
  raise notice 'B18 OK reintento dueOns sin conflicto ni duplicados';

  -- 3) Períodos distintos → conflicto
  v_ok := false;
  begin
    perform public.registrar_cobro_pos(
      v_member, 70000,
      v_periods || jsonb_build_object('dueOns', jsonb_build_array('2099-01-10')),
      v_key, null
    );
  exception when others then
    if SQLERRM ~* 'períodos|periodos' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B18 FAIL: debió rechazar períodos distintos'; end if;
  raise notice 'B18 OK conflicto por períodos';

  -- 4) Interés distinto → conflicto
  v_ok := false;
  begin
    perform public.registrar_cobro_pos(
      v_member, 70000,
      v_periods || jsonb_build_object('financingPercent', 15),
      v_key, null
    );
  exception when others then
    if SQLERRM ~* 'interés|financiación' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B18 FAIL: debió rechazar interés distinto'; end if;
  raise notice 'B18 OK conflicto por interés';

  -- 5) Otro comprobante → conflicto
  v_ok := false;
  begin
    perform public.registrar_cobro_pos(
      v_member, 70000,
      v_periods || jsonb_build_object(
        'receiptParse', jsonb_build_object('amount', 77000, 'reference', 'OTRA-REF')
      ),
      v_key, null
    );
  exception when others then
    if SQLERRM ~* 'referencia|comprobante' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B18 FAIL: debió rechazar otro comprobante'; end if;
  raise notice 'B18 OK conflicto por comprobante';

  -- 6) Falta asiento original → integridad
  update public.journal_entries
  set voided_at = now()
  where id = v_journal_id;
  v_ok := false;
  begin
    perform public.registrar_cobro_pos(v_member, 70000, v_periods, v_key, null);
  exception when others then
    if SQLERRM ~* 'Integridad POS|asiento contable original' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'B18 FAIL: debió exigir asiento original'; end if;
  -- restaurar asiento para conteos finales
  update public.journal_entries set voided_at = null where id = v_journal_id;
  raise notice 'B18 OK integridad sin asiento';

  -- 7) Concurrente: misma clave → un solo pago (segunda llamada idempotent)
  v_bad := public.registrar_cobro_pos(v_member, 70000, v_periods, v_key, null);
  if not coalesce((v_bad->>'idempotent')::boolean, false) then
    raise exception 'B18 FAIL: segunda concurrente debió ser idempotent';
  end if;
  select count(*) into v_count from public.member_payments where meta->>'idempotencyKey' = v_key;
  if v_count <> 1 then
    raise exception 'B18 FAIL concurrente: pagos=%', v_count;
  end if;
  raise notice 'B18 OK concurrente / única acreditación';
end $$;

select 'B18 SQL registrar_cobro_pos retry passed; rolling back'::text as status;

rollback;

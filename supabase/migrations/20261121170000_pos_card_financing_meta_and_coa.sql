-- Financiación POS: cuenta 4.1.05 + meta POS en registrar_cobro.
-- NO aplicar en producción sin autorización explícita.
-- Estrategia: helper puro + una inyección estable (sin reescribir el cuerpo por replace frágil de muchos campos).

-- 1) Cuenta COA idempotente (unique code)
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
set
  name = excluded.name,
  account_type = excluded.account_type,
  is_postable = true,
  is_active = true;

-- 2) Helper: extrae meta POS desde p_periodos (fuente única, testeable)
create or replace function public.cobro_periodos_pos_meta(p_periodos jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_periodos is null or jsonb_typeof(p_periodos) <> 'object' then '{}'::jsonb
    else jsonb_strip_nulls(jsonb_build_object(
      'voucherAmount', nullif(p_periodos->>'voucherAmount', '')::numeric,
      'cardFinancing', case
        when jsonb_typeof(p_periodos->'cardFinancing') = 'object' then p_periodos->'cardFinancing'
        else null
      end,
      'receiptParse', case
        when jsonb_typeof(p_periodos->'receiptParse') = 'object' then p_periodos->'receiptParse'
        else null
      end,
      'journalAccount', nullif(btrim(coalesce(p_periodos->>'journalAccount', '')), ''),
      'paymentPlanSnapshot', case
        when jsonb_typeof(p_periodos->'paymentPlanSnapshot') = 'object' then p_periodos->'paymentPlanSnapshot'
        else null
      end
    ))
  end;
$$;

comment on function public.cobro_periodos_pos_meta(jsonb) is
  'Meta POS para merge en registrar_cobro. La autoridad de plan/tasa/asiento vive en registrar_cobro_pos (20261121180000); este helper solo transporta meta ya autorizada.';

revoke all on function public.cobro_periodos_pos_meta(jsonb) from public;
grant execute on function public.cobro_periodos_pos_meta(jsonb) to authenticated, service_role;

-- 3) Inyectar merge en registrar_cobro (un solo marcador estable)
do $mig$
declare
  v_sql text;
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
  v_marker text := 'v_meta := coalesce(v_meta, ''{}''::jsonb) || public.cobro_periodos_pos_meta(p_periodos);';
  v_anchor text := 'v_meta := jsonb_strip_nulls(jsonb_build_object(';
begin
  v_sql := pg_get_functiondef(v_fn::regprocedure);

  if position('cobro_periodos_pos_meta(p_periodos)' in v_sql) > 0 then
    raise notice 'registrar_cobro ya mergea cobro_periodos_pos_meta';
    return;
  end if;

  if position(v_anchor in v_sql) = 0 then
    raise exception 'Ancla v_meta no encontrada en registrar_cobro; abortando migración POS.';
  end if;

  -- Insertar el merge inmediatamente después del primer cierre de jsonb_strip_nulls(...);
  -- Buscamos el patrón: final del build_object de v_meta seguido de ');'
  -- Usamos un marcador único: la línea de importSource dentro de v_meta.
  if position('''importSource''' in v_sql) > 0 then
    v_sql := regexp_replace(
      v_sql,
      '(v_meta := jsonb_strip_nulls\(jsonb_build_object\([\s\S]*?''importSource''[\s\S]*?\);)',
      E'\\1\n  ' || v_marker,
      1
    );
  else
    raise exception 'No se encontró importSource en v_meta de registrar_cobro.';
  end if;

  if position('cobro_periodos_pos_meta(p_periodos)' in v_sql) = 0 then
    raise exception 'Falló la inyección de cobro_periodos_pos_meta en registrar_cobro.';
  end if;

  execute v_sql;
end;
$mig$;

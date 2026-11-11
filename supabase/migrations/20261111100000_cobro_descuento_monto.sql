-- Descuento de mostrador: un monto con detalle.
-- No cambia el capital ni el 10 %. El dinero que entra es el cobro menos el descuento.
-- La imputación cubre la cuota como si hubieran pagado el total.

insert into public.chart_of_accounts (
  id, code, name, account_type, parent_id, level, is_postable, is_cash_account, description
)
select
  'aaaaaaaa-0005-0005-0005-000000000117',
  '5.1.07',
  'Descuentos sobre cuotas',
  'expense',
  parent_id,
  3,
  true,
  false,
  'Descuento en monto al cobrar la cuota'
from public.chart_of_accounts
where code = '5.1.06'
  and not exists (
    select 1 from public.chart_of_accounts where code = '5.1.07'
  );

do $patch$
declare
  def text;
begin
  select pg_get_functiondef('public.registrar_cobro(uuid,numeric,jsonb,text)'::regprocedure)
    into def;

  if strpos(def, 'descuento de mostrador') > 0 then
    return;
  end if;

  if strpos(def, 'v_sched_late numeric;') = 0 then
    raise exception 'No está la variable del recargo de agenda';
  end if;
  def := replace(
    def,
    'v_sched_late numeric;',
    E'v_sched_late numeric;\n  v_discount numeric := 0;'
  );

  if strpos(def, 'v_surcharge := coalesce(nullif(p_periodos->>''surcharge'', '''')::numeric, 0);') = 0 then
    raise exception 'No está el recargo declarado del cobro';
  end if;
  def := replace(
    def,
    'v_surcharge := coalesce(nullif(p_periodos->>''surcharge'', '''')::numeric, 0);',
    $sql$v_surcharge := coalesce(nullif(p_periodos->>'surcharge', '')::numeric, 0);
  -- descuento de mostrador: monto, con detalle. No reescribe la cuota.
  v_discount := round(coalesce(nullif(p_periodos->>'discount', '')::numeric, 0), 2);
  if v_discount < 0 then
    raise exception 'El descuento no puede ser negativo.';
  end if;
  if v_discount > 0 and char_length(btrim(coalesce(p_periodos->>'discountDetail', ''))) < 3 then
    raise exception 'Falta el detalle del descuento.';
  end if;$sql$
  );

  if strpos(def, '''importSource'', nullif(btrim(coalesce(p_periodos->>''importSource'', '''')), '''')') = 0 then
    raise exception 'No está el meta del cobro';
  end if;
  def := replace(
    def,
    '''importSource'', nullif(btrim(coalesce(p_periodos->>''importSource'', '''')), '''')',
    $sql$'discount', case when v_discount > 0 then v_discount else null end,
    'discountDetail', case when v_discount > 0 then nullif(btrim(coalesce(p_periodos->>'discountDetail', '')), '') else null end,
    'importSource', nullif(btrim(coalesce(p_periodos->>'importSource', '')), '')$sql$
  );

  if strpos(def, E'v_cash := round(p_importe, 2);\n  if v_old > 0 then') = 0 then
    raise exception 'No está el arranque del cobro de períodos';
  end if;
  def := replace(
    def,
    E'v_cash := round(p_importe, 2);\n  if v_old > 0 then',
    E'v_cash := round(p_importe + case when v_old > 0 then v_discount else 0 end, 2);\n  if v_old > 0 then'
  );

  if strpos(def, 'abs(v_open - round(p_importe, 2)) <= 0.01') = 0 then
    raise exception 'No está el pase del mes abierto';
  end if;
  def := replace(
    def,
    'abs(v_open - round(p_importe, 2)) <= 0.01',
    'abs(v_open - round(p_importe + v_discount, 2)) <= 0.01'
  );

  execute def;
end
$patch$;

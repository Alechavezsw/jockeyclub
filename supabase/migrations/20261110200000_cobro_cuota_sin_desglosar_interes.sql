-- La cuota no se parte para inventar intereses.
-- Primero entra el capital. El 10 % se suma encima solo si el mes ya
-- venció y sobra plata. Si el cobro es el mes en curso (el 10 o antes)
-- y el único saldo abierto es el mes anterior por el mismo importe,
-- ese saldo es la cuota de este mes.

do $patch$
declare
  def text;
  old text;
  new text;
begin
  select pg_get_functiondef('public.registrar_cobro(uuid,numeric,jsonb,text)'::regprocedure)
    into def;

  if strpos(def, 'Primero entra la cuota') > 0 then
    return;
  end if;

  old := $old$
  v_cash := round(p_importe, 2);
  if v_old > 0 then
    for v_period in
$old$;
  if strpos(def, old) = 0 then
    raise exception 'No está el arranque del cobro de períodos';
  end if;

  new := $new$
  v_cash := round(p_importe, 2);
  if v_old > 0 then
    declare
      v_declared text;
      v_open_n int;
      v_from date;
      v_open numeric;
    begin
      if jsonb_typeof(v_due_ons) = 'array' and jsonb_array_length(v_due_ons) = 1 then
        v_declared := left(coalesce(
          v_due_ons->0->>'dueOn',
          v_due_ons->0->>'date',
          trim(both '"' from (v_due_ons->0)::text)
        ), 10);
        if v_declared ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           and v_declared::date >= v_today then
          select count(*) into v_open_n
          from public.member_dues_periods
          where member_id = p_member_id and capital_open > 0;
          if v_open_n = 1 then
            select due_on, capital_open into v_from, v_open
            from public.member_dues_periods
            where member_id = p_member_id and capital_open > 0;
            if v_from < v_declared::date
               and abs(v_open - round(p_importe, 2)) <= 0.01
               and not exists (
                 select 1 from public.member_dues_periods
                 where member_id = p_member_id and due_on = v_declared::date
               ) then
              update public.member_dues_periods
              set due_on = v_declared::date,
                  late_base = 0
              where member_id = p_member_id and due_on = v_from;
            end if;
          end if;
        end if;
      end if;
    end;

    for v_period in
$new$;
  def := replace(def, old, new);

  old := $old$
      v_total := round(v_period.capital_open + v_surcharge_open, 2);
      if v_total <= 0 then
        continue;
      end if;
      v_take := least(v_cash, v_total);
      if v_surcharge_open > 0 then
        v_capital_take := round(v_take * v_period.capital_open / v_total, 2);
      else
        v_capital_take := v_take;
      end if;
      v_surcharge_take := round(v_take - v_capital_take, 2);
$old$;
  if strpos(def, old) = 0 then
    raise exception 'No está el reparto proporcional del interés';
  end if;

  new := $new$
      if v_period.capital_open <= 0 and v_surcharge_open <= 0 then
        continue;
      end if;
      -- Primero entra la cuota. El 10 % solo si sobra plata.
      v_capital_take := least(v_cash, v_period.capital_open);
      v_surcharge_take := least(
        greatest(0, round(v_cash - v_capital_take, 2)),
        v_surcharge_open
      );
      v_take := round(v_capital_take + v_surcharge_take, 2);
      if v_take <= 0 then
        continue;
      end if;
$new$;
  execute replace(def, old, new);
end
$patch$;

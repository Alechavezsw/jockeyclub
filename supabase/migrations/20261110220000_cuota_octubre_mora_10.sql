-- Desde octubre, toda cuota en mora (después del 10) lleva 10 %.
-- Si la base quedó en 0, el recargo se calcula sobre la cuota abierta.

do $patch$
declare
  def text;
  mark constant text := 'Desde octubre la cuota abierta también lleva 10';
begin
  def := pg_get_functiondef('public.registrar_cobro(uuid,numeric,jsonb,text)'::regprocedure);
  if strpos(def, mark) > 0 then
    return;
  end if;

  if strpos(def, 'round(late_base * 0.10, 2)') = 0
     or strpos(def, 'round(v_period.late_base * 0.10, 2)') = 0 then
    raise exception 'No está el recargo del cobro';
  end if;

  def := replace(
    def,
    'round(late_base * 0.10, 2)',
    'round(coalesce(nullif(late_base, 0), case when due_on >= date ''2026-10-10'' then capital_open else 0 end) * 0.10, 2)'
  );
  def := replace(
    def,
    'round(v_period.late_base * 0.10, 2)',
    'round(coalesce(nullif(v_period.late_base, 0), case when v_period.due_on >= date ''2026-10-10'' then v_period.capital_open else 0 end) * 0.10, 2) /* ' || mark || ' */'
  );

  if strpos(def, 'nullif(v_item->>''lateBase''') > 0
     and strpos(def, 'v_sched_due >= ''2026-10-10''') = 0 then
    def := replace(
      def,
      'and v_today > v_sched_due::date' || E'\n' || '         and v_sched_late > 0 then',
      'and v_today > v_sched_due::date' || E'\n'
      || '         and (v_sched_late > 0 or (v_sched_due >= ''2026-10-10'' and coalesce((v_item->>''capital'')::numeric, 0) > 0)) then' || E'\n'
      || '        if v_sched_late <= 0 then' || E'\n'
      || '          v_sched_late := round(coalesce((v_item->>''capital'')::numeric, 0), 2);' || E'\n'
      || '        end if;'
    );
  end if;

  execute def;
end
$patch$;

update public.member_dues_periods p
set late_base = p.capital_open
from public.members m
where p.member_id = m.id
  and p.due_on >= date '2026-10-10'
  and p.capital_open > 0
  and p.late_base <= 0
  and m.tier in ('socio_familiar', 'socio_individual');

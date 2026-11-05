-- Día civil del club (Argentina). Supabase corre en UTC: entre las 21:00 y
-- las 24:00 del día 10, current_date ya es el 11 y cobraba recargo de más.
-- El recargo y el fallback de paidAt usan club_today(), no current_date.

create or replace function public.club_today()
returns date
language sql
stable
parallel safe
set timezone to 'America/Argentina/Buenos_Aires'
as $$
  select (timezone('America/Argentina/Buenos_Aires', now()))::date;
$$;

revoke all on function public.club_today() from public, anon;
grant execute on function public.club_today() to authenticated, service_role;

comment on function public.club_today() is
  'Fecha de hoy en Argentina. Usar en mora/recargo: current_date en UTC se adelanta a las 21:00 AR.';

alter function public.registrar_cobro(uuid, numeric, jsonb, text)
  set timezone to 'America/Argentina/Buenos_Aires';

do $patch$
declare
  v_sql text;
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
begin
  v_sql := pg_get_functiondef(v_fn::regprocedure);

  -- Preferir club_today() sobre el cálculo inline.
  if position('public.club_today()' in v_sql) = 0 then
    if position(
      'v_today := (timezone(''America/Argentina/Buenos_Aires'', now()))::date;'
      in v_sql
    ) > 0 then
      v_sql := replace(
        v_sql,
        'v_today := (timezone(''America/Argentina/Buenos_Aires'', now()))::date;',
        'v_today := public.club_today();'
      );
    elsif position('v_today := current_date;' in v_sql) > 0 then
      v_sql := replace(v_sql, 'v_today := current_date;', 'v_today := public.club_today();');
    elsif position(
      'v_paid := coalesce(nullif(left(coalesce(p_periodos->>''paidAt'', ''''), 10), '''')::date, current_date);'
      in v_sql
    ) > 0 then
      raise exception 'registrar_cobro todavía usa current_date en paidAt; aplicar cobro_paid_at_backdate primero';
    end if;
  end if;

  -- Por si quedó alguna comparación de mora con v_paid.
  v_sql := replace(
    v_sql,
    'when v_paid > due_on and due_on > date ''1900-01-10''',
    'when v_today > due_on and due_on > date ''1900-01-10'''
  );
  v_sql := replace(
    v_sql,
    'when v_paid > v_period.due_on and v_period.due_on > date ''1900-01-10''',
    'when v_today > v_period.due_on and v_period.due_on > date ''1900-01-10'''
  );

  execute v_sql;
end;
$patch$;

-- mp_next_dues_date también miraba current_date (UTC).
do $mp$
declare
  v_sql text;
  v_oid oid;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mp_next_dues_date'
  order by p.oid
  limit 1;
  if v_oid is null then
    return;
  end if;
  v_sql := pg_get_functiondef(v_oid);
  if position('current_date' in v_sql) > 0 then
    v_sql := replace(v_sql, 'current_date', 'public.club_today()');
    execute v_sql;
  end if;
  execute format(
    'alter function %s set timezone to %L',
    v_oid::regprocedure,
    'America/Argentina/Buenos_Aires'
  );
end;
$mp$;

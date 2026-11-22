-- Hotfix PR #13: rechazar dueOns no cobrables en registrar_cobro.
-- No sustituye un mes pedido por otro abierto.
-- NO aplicar en producción sin autorización explícita.

create or replace function public.cobro_assert_due_ons_collectable(
  p_member_id uuid,
  p_due_ons jsonb,
  p_adelanto boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_due date;
  v_open numeric;
  v_other_open int;
begin
  if p_adelanto then
    return;
  end if;
  if p_member_id is null then
    return;
  end if;
  if jsonb_typeof(p_due_ons) is distinct from 'array' then
    return;
  end if;
  if jsonb_array_length(p_due_ons) = 0 then
    return;
  end if;

  for v_item in select value from jsonb_array_elements(p_due_ons)
  loop
    begin
      v_due := left(coalesce(
        v_item->>'dueOn',
        v_item->>'date',
        trim(both '"' from v_item::text)
      ), 10)::date;
    exception when others then
      raise exception 'Período de cobro inválido.';
    end;

    if v_due <= date '1900-01-10' then
      continue;
    end if;

    select coalesce(capital_open, 0)
      into v_open
    from public.member_dues_periods
    where member_id = p_member_id
      and due_on = v_due;

    if found and v_open <= 0.01 then
      raise exception
        'Ese período ya está pago o cerrado y no se puede volver a cobrar.';
    end if;

    if not found or v_open <= 0.01 then
      select count(*)::int
        into v_other_open
      from public.member_dues_periods
      where member_id = p_member_id
        and capital_open > 0.01
        and due_on > date '1900-01-10'
        and due_on is distinct from v_due;

      if coalesce(v_other_open, 0) > 0 then
        raise exception
          'Ese período no es cobrable en este momento. No se sustituye por otro mes.';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.cobro_assert_due_ons_collectable(uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.cobro_assert_due_ons_collectable(uuid, jsonb, boolean)
  to authenticated, service_role;

comment on function public.cobro_assert_due_ons_collectable(uuid, jsonb, boolean) is
  'Rechaza dueOns ya cerrados o no abiertos cuando hay otra deuda abierta; sin sustitución de mes.';

do $$
declare
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
  v_sql text;
  v_anchor text := 'v_adelanto := lower(coalesce(p_periodos->>''adelanto'', '''')) in (''true'', ''t'', ''1'');';
  v_inject text := $i$v_adelanto := lower(coalesce(p_periodos->>'adelanto', '')) in ('true', 't', '1');
  perform public.cobro_assert_due_ons_collectable(p_member_id, v_due_ons, v_adelanto);$i$;
begin
  select pg_get_functiondef(v_fn::regprocedure) into v_sql;
  if v_sql is null then
    raise exception 'No se encontró %', v_fn;
  end if;
  if position('cobro_assert_due_ons_collectable' in v_sql) > 0 then
    raise notice 'registrar_cobro ya valida dueOns cobrables';
    return;
  end if;
  if position(v_anchor in v_sql) = 0 then
    raise exception 'Ancla v_adelanto no encontrada en registrar_cobro; abortando.';
  end if;
  v_sql := replace(v_sql, v_anchor, v_inject);
  if position('cobro_assert_due_ons_collectable' in v_sql) = 0 then
    raise exception 'No se inyectó cobro_assert_due_ons_collectable en registrar_cobro.';
  end if;
  execute v_sql;
end;
$$;

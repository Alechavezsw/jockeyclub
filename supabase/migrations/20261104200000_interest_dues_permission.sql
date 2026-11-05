-- Generar intereses y cargar deuda: no para cajero ni portero.
-- has_accounting_access() los incluía (caja), y save_interest_run /
-- apply_member_balance_deltas respondían 200. Quedan en dues.liquidate
-- (contador / superadmin). La liquidación de administración sigue por has_admin_access.

create or replace function public.save_interest_run(p_run jsonb, p_entries jsonb)
returns void
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Argentina/Buenos_Aires'
as $$
declare
  v_id text;
begin
  if not public.has_capability('dues.liquidate') then
    raise exception 'Sin permiso para generar intereses';
  end if;

  v_id := p_run->>'id';
  if v_id is null or v_id = '' then
    raise exception 'Falta el identificador de la generación';
  end if;

  insert into public.interest_runs (
    id, generator_id, generator_label, imputation_date, status,
    entries_created, total_amount, percentage, separate_entries, created_at
  ) values (
    v_id,
    p_run->>'generatorId',
    coalesce(p_run->>'generatorLabel', ''),
    coalesce((p_run->>'imputationDate')::date, public.club_today()),
    coalesce(p_run->>'status', 'completed'),
    coalesce((p_run->>'entriesCreated')::integer, 0),
    coalesce((p_run->>'totalAmount')::numeric, 0),
    coalesce((p_run->>'percentage')::numeric, 0),
    coalesce((p_run->>'separateEntries')::boolean, false),
    coalesce((p_run->>'createdAt')::timestamptz, now())
  );

  insert into public.interest_run_entries (
    id, run_id, member_number, member_name, amount, description, balance_base
  )
  select
    e->>'id',
    v_id,
    e->>'memberId',
    coalesce(e->>'memberName', ''),
    coalesce((e->>'amount')::numeric, 0),
    coalesce(e->>'description', ''),
    coalesce((e->>'balanceBase')::numeric, 0)
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
  where coalesce((e->>'amount')::numeric, 0) > 0
    and coalesce(e->>'memberId', '') <> '';

  update public.members m
  set outstanding_balance = coalesce(m.outstanding_balance, 0) + e.amount
  from (
    select member_number, sum(amount) as amount
    from public.interest_run_entries
    where run_id = v_id
    group by member_number
  ) e
  where m.member_number = e.member_number;
end;
$$;

create or replace function public.cancel_interest_run(p_run_id text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  st text;
begin
  if not public.has_capability('dues.liquidate') then
    raise exception 'Sin permiso para anular intereses';
  end if;

  select status into st
  from public.interest_runs
  where id = p_run_id
  for update;

  if st is null then
    raise exception 'Generación inexistente';
  end if;
  if st <> 'completed' then
    return;
  end if;

  update public.members m
  set outstanding_balance = greatest(0, coalesce(m.outstanding_balance, 0) - e.amount)
  from (
    select member_number, sum(amount) as amount
    from public.interest_run_entries
    where run_id = p_run_id
    group by member_number
  ) e
  where m.member_number = e.member_number;

  update public.interest_runs
  set status = 'cancelled', cancelled_at = now()
  where id = p_run_id;
end;
$$;

-- apply_member_balance_deltas: misma firma, solo cambia el permiso.
do $patch$
declare
  v_sql text;
begin
  v_sql := pg_get_functiondef('public.apply_member_balance_deltas(jsonb)'::regprocedure);
  if position('Sin permiso para imputar cuotas' in v_sql) = 0 then
    raise exception 'No se encontró el control de apply_member_balance_deltas';
  end if;
  if position('has_capability(''dues.liquidate'')' in v_sql) = 0 then
    v_sql := replace(
      v_sql,
      'if not (public.has_accounting_access() or public.has_admin_access()) then
    raise exception ''Sin permiso para imputar cuotas'';
  end if;',
      'if not (public.has_capability(''dues.liquidate'') or public.has_admin_access()) then
    raise exception ''Sin permiso para imputar cuotas'';
  end if;'
    );
    if position('has_capability(''dues.liquidate'')' in v_sql) = 0 then
      raise exception 'No se pudo actualizar el permiso de apply_member_balance_deltas';
    end if;
    execute v_sql;
  end if;
end;
$patch$;

drop policy if exists interest_generators_access on public.interest_generators;
create policy interest_generators_access
  on public.interest_generators for all
  to authenticated
  using (public.has_capability('dues.liquidate'))
  with check (public.has_capability('dues.liquidate'));

drop policy if exists interest_runs_access on public.interest_runs;
create policy interest_runs_access
  on public.interest_runs for all
  to authenticated
  using (public.has_capability('dues.liquidate'))
  with check (public.has_capability('dues.liquidate'));

drop policy if exists interest_run_entries_access on public.interest_run_entries;
create policy interest_run_entries_access
  on public.interest_run_entries for all
  to authenticated
  using (public.has_capability('dues.liquidate'))
  with check (public.has_capability('dues.liquidate'));

revoke all on function public.save_interest_run(jsonb, jsonb) from public, anon;
grant execute on function public.save_interest_run(jsonb, jsonb) to authenticated;
revoke all on function public.cancel_interest_run(text) from public, anon;
grant execute on function public.cancel_interest_run(text) to authenticated;

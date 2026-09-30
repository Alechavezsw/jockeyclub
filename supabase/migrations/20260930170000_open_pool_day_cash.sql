-- La caja de pileta se abre una vez para el día. Cada habilitación solo anota el canon.

create or replace function public.open_pool_day_cash()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_register public.cash_registers%rowtype;
  v_session public.cash_sessions%rowtype;
  v_opened boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_staff_access() then
    raise exception 'No tenés permiso para abrir la caja.';
  end if;

  select r.* into v_register
  from public.cash_registers r
  join public.chart_of_accounts a on a.id = r.account_id
  where r.is_active is true
    and (a.code = '1.1.01' or a.name = 'Caja General')
  order by case when a.code = '1.1.01' then 0 else 1 end, r.code
  limit 1;

  if v_register.id is null then
    raise exception 'No hay Caja General configurada.';
  end if;

  select * into v_session
  from public.cash_sessions
  where cash_register_id = v_register.id
    and status = 'open'
  limit 1;

  if v_session.id is null then
    insert into public.cash_sessions (
      cash_register_id, opened_by, opening_balance, status, notes
    ) values (
      v_register.id, auth.uid(), 0, 'open', 'Abierta al habilitar pileta'
    )
    returning * into v_session;
    v_opened := true;
  end if;

  return jsonb_build_object(
    'cash_session_id', v_session.id,
    'cash_register_id', v_register.id,
    'opening_balance', v_session.opening_balance,
    'opened_at', v_session.opened_at,
    'opened', v_opened
  );
end;
$$;

create or replace function public.record_pool_canon(
  p_amount numeric,
  p_concept text,
  p_member_id uuid,
  p_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_register public.cash_registers%rowtype;
  v_session public.cash_sessions%rowtype;
  v_income uuid;
  v_entry uuid;
  v_movement uuid;
  v_concept text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_staff_access() then
    raise exception 'No tenés permiso para habilitar pileta.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Importe de canon inválido.';
  end if;

  select r.* into v_register
  from public.cash_registers r
  join public.chart_of_accounts a on a.id = r.account_id
  where r.is_active is true
    and (a.code = '1.1.01' or a.name = 'Caja General')
  order by case when a.code = '1.1.01' then 0 else 1 end, r.code
  limit 1;

  if v_register.id is null then
    raise exception 'No hay Caja General configurada.';
  end if;

  select id into v_income
  from public.chart_of_accounts
  where is_active is true
    and (code = '4.1.02' or name = 'Reservas e Instalaciones')
  order by case when code = '4.1.02' then 0 else 1 end
  limit 1;

  if v_income is null then
    raise exception 'Falta la cuenta Reservas e Instalaciones en el plan.';
  end if;

  select * into v_session
  from public.cash_sessions
  where cash_register_id = v_register.id
    and status = 'open'
  limit 1;

  if v_session.id is null then
    raise exception 'Abrí la caja del día antes de habilitar.';
  end if;

  v_concept := left(coalesce(nullif(btrim(p_concept), ''), 'Canon pileta'), 240);

  insert into public.journal_entries (
    fiscal_period_id, entry_date, concept, status, source_module, created_by
  ) values (
    '11111111-1111-1111-1111-111111111111',
    coalesce(p_date, current_date),
    v_concept,
    'draft',
    'pileta',
    auth.uid()
  )
  returning id into v_entry;

  insert into public.journal_lines (journal_entry_id, account_id, line_order, debit, credit, memo)
  values
    (v_entry, v_register.account_id, 1, p_amount, 0, 'Caja General'),
    (v_entry, v_income, 2, 0, p_amount, 'Canon pileta');

  update public.journal_entries
  set status = 'posted',
      posted_at = now(),
      posted_by = auth.uid()
  where id = v_entry;

  insert into public.cash_movements (
    cash_session_id, movement_type, amount, concept,
    related_account_id, member_id, created_by, journal_entry_id
  ) values (
    v_session.id, 'income', p_amount, v_concept,
    v_income, p_member_id, auth.uid(), v_entry
  )
  returning id into v_movement;

  return jsonb_build_object(
    'journal_entry_id', v_entry,
    'cash_movement_id', v_movement,
    'cash_session_id', v_session.id
  );
end;
$$;

revoke all on function public.open_pool_day_cash() from public;
grant execute on function public.open_pool_day_cash() to authenticated;

revoke all on function public.record_pool_canon(numeric, text, uuid, date) from public;
grant execute on function public.record_pool_canon(numeric, text, uuid, date) to authenticated;

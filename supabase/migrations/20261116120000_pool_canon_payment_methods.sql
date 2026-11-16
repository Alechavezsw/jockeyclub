-- Canon pileta: mismos medios de cobro que la app (efectivo, transferencia, tarjeta, débito).
-- Mercado Pago sigue por QR / webhook.

create or replace function public.record_pool_canon_impl(
  p_amount numeric,
  p_concept text,
  p_member_id uuid,
  p_date date,
  p_method text default 'efectivo',
  p_bank_journal text default null
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
  v_debit_account uuid;
  v_entry uuid;
  v_movement uuid;
  v_concept text;
  v_method text;
  v_bank text;
  v_memo text;
  v_needs_cash boolean;
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

  v_method := lower(translate(btrim(coalesce(p_method, 'efectivo')),
    'ÁÉÍÓÚÜÑáéíóúüñ',
    'AEIOUUNaeiouun'));
  if v_method in ('caja', 'cash') then
    v_method := 'efectivo';
  end if;
  if v_method not in ('efectivo', 'transferencia', 'tarjeta', 'debito') then
    raise exception 'Medio de pago inválido para canon de pileta.';
  end if;

  v_needs_cash := v_method in ('efectivo', 'tarjeta');
  v_bank := nullif(btrim(coalesce(p_bank_journal, '')), '');

  select id into v_income
  from public.chart_of_accounts
  where is_active is true
    and (code = '4.1.02' or name = 'Reservas e Instalaciones')
  order by case when code = '4.1.02' then 0 else 1 end
  limit 1;

  if v_income is null then
    raise exception 'Falta la cuenta Reservas e Instalaciones en el plan.';
  end if;

  if v_needs_cash then
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
      raise exception 'Abrí la caja del día antes de habilitar.';
    end if;

    v_debit_account := v_register.account_id;
    v_memo := case when v_method = 'tarjeta' then 'Tarjeta · Caja General' else 'Caja General' end;
  else
    if v_bank is null then
      v_bank := 'Banco Macro';
    end if;
    select id into v_debit_account
    from public.chart_of_accounts
    where is_active is true
      and name = v_bank
    order by code
    limit 1;
    if v_debit_account is null then
      raise exception 'No está la cuenta % en el plan.', v_bank;
    end if;
    v_memo := v_bank;
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
    (v_entry, v_debit_account, 1, p_amount, 0, v_memo),
    (v_entry, v_income, 2, 0, p_amount, 'Canon pileta');

  update public.journal_entries
  set status = 'posted',
      posted_at = now(),
      posted_by = auth.uid()
  where id = v_entry;

  if v_needs_cash then
    insert into public.cash_movements (
      cash_session_id, movement_type, amount, concept,
      related_account_id, member_id, created_by, journal_entry_id
    ) values (
      v_session.id, 'income', p_amount, v_concept,
      v_income, p_member_id, auth.uid(), v_entry
    )
    returning id into v_movement;
  end if;

  return jsonb_build_object(
    'journal_entry_id', v_entry,
    'cash_movement_id', v_movement,
    'cash_session_id', v_session.id,
    'payment_method', v_method,
    'bank_journal', case when v_needs_cash then null else v_bank end
  );
end;
$$;

create or replace function public.record_pool_canon(
  p_amount numeric,
  p_concept text,
  p_member_id uuid,
  p_date date,
  p_method text default 'efectivo',
  p_bank_journal text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.member_status;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_capability('pool.operate') then
    raise exception 'No tenés permiso para habilitar pileta.';
  end if;
  if p_member_id is not null then
    select m.status into v_status from public.members m where m.id = p_member_id;
    if v_status is distinct from 'active'::public.member_status then
      raise exception 'El socio no está habilitado para pileta (estado: %).', coalesce(v_status::text, 'sin ficha');
    end if;
  end if;
  return public.record_pool_canon_impl(
    p_amount, p_concept, p_member_id, p_date, p_method, p_bank_journal
  );
end;
$$;

-- Una sola firma (con defaults) para que PostgREST no dude entre sobrecargas.
drop function if exists public.record_pool_canon(numeric, text, uuid, date);
drop function if exists public.record_pool_canon_impl(numeric, text, uuid, date);

revoke all on function public.record_pool_canon(numeric, text, uuid, date, text, text) from public, anon;
grant execute on function public.record_pool_canon(numeric, text, uuid, date, text, text) to authenticated;
revoke all on function public.record_pool_canon_impl(numeric, text, uuid, date, text, text) from public, anon, authenticated;

-- Un segundo cobro no puede caer sobre una cuota ya saldada.
-- Si supera la deuda, se rechaza. El adelanto explícito queda como
-- crédito y se imputa a la próxima cuota, no al mes que ya se pagó.

alter table public.dues_imputations
  add column if not exists kind text not null default 'cobro';

create or replace function public.member_payment_posts_dues()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric;
  v_delta numeric;
begin
  if coalesce(new.amount, 0) <= 0 then
    return new;
  end if;
  if public.member_id_is_dues_exempt(new.member_id) then
    return new;
  end if;

  select outstanding_balance into v_old
  from public.members
  where id = new.member_id
  for update;

  if not found then
    return new;
  end if;

  -- Solo baja deuda abierta. Un saldo a favor no se come con otro cobro:
  -- el adelanto lo anota registrar_cobro.
  if v_old > 0 then
    v_delta := -least(v_old, new.amount);
  else
    v_delta := 0;
  end if;

  if v_delta = 0 then
    return new;
  end if;

  insert into public.member_dues_entries (member_id, amount, kind, source)
  values (new.member_id, round(v_delta, 2), 'payment', 'payment:' || new.id::text)
  on conflict (source) where source <> '' do nothing;

  update public.members
  set updated_at = now()
  where id = new.member_id;

  return new;
end;
$$;

create or replace function public.apply_member_balance_deltas(p_deltas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_accounting_access() or public.has_admin_access()) then
    raise exception 'Sin permiso para imputar cuotas';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce((e->>'amount')::numeric, 0) < 0
  ) then
    raise exception 'Un crédito de cuota es una nota de crédito, no un importe libre.';
  end if;

  insert into public.member_dues_entries (member_id, amount, kind, source)
  select m.id, round(d.amount, 2), 'debt', ''
  from (
    select
      e->>'memberId' as member_number,
      sum(coalesce((e->>'amount')::numeric, 0)) as amount
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce(e->>'memberId', '') <> ''
    group by e->>'memberId'
  ) d
  join public.members m on m.member_number::text = d.member_number
  where d.amount <> 0
    and not public.member_is_dues_exempt(m);

  insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
  select
    m.id,
    p.due_on,
    p.capital,
    greatest(0, round(p.capital - coalesce(pre.prepaid, 0), 2)),
    p.late_base
  from (
    select
      e->>'memberId' as member_number,
      (per->>'dueOn')::date as due_on,
      round(coalesce((per->>'capital')::numeric, 0), 2) as capital,
      round(coalesce((per->>'lateBase')::numeric, 0), 2) as late_base
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    cross join lateral jsonb_array_elements(coalesce(e->'periods', '[]'::jsonb)) per
    where coalesce(e->>'memberId', '') <> ''
      and (per->>'dueOn') ~ '^\d{4}-\d{2}-\d{2}$'
  ) p
  join public.members m on m.member_number::text = p.member_number
  left join lateral (
    select coalesce(sum(i.capital), 0) as prepaid
    from public.dues_imputations i
    where i.member_id = m.id
      and i.due_on = p.due_on
      and i.voided_at is null
      and i.kind = 'adelanto'
  ) pre on true
  where p.capital > 0
    and not public.member_is_dues_exempt(m)
  on conflict (member_id, due_on) do update
  set capital = public.member_dues_periods.capital + excluded.capital,
      capital_open = greatest(0, round(
        public.member_dues_periods.capital_open
        + excluded.capital
        - least(
            excluded.capital,
            greatest(0, coalesce((
              select sum(i.capital)
              from public.dues_imputations i
              where i.member_id = public.member_dues_periods.member_id
                and i.due_on = public.member_dues_periods.due_on
                and i.voided_at is null
                and i.kind = 'adelanto'
            ), 0) - (public.member_dues_periods.capital - public.member_dues_periods.capital_open))
          )
      , 2)),
      late_base = public.member_dues_periods.late_base + excluded.late_base;

  update public.members m
  set updated_at = now()
  from (
    select e->>'memberId' as member_number
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce(e->>'memberId', '') <> ''
    group by e->>'memberId'
  ) d
  where m.member_number::text = d.member_number;
end;
$$;

-- registrar_cobro ya está en producción: se le agregan el tope y el adelanto
-- sin reescribir el resto del cobro.
do $patch$
declare
  v_sql text;
  v_fn text := 'public.registrar_cobro(uuid, numeric, jsonb, text)';
  v_start int;
  v_end int;
  v_check text := $check$

  v_adelanto := lower(coalesce(p_periodos->>'adelanto', '')) in ('true', 't', '1');

  select coalesce(sum(capital_open), 0),
         coalesce(sum(
           case
             when v_paid > due_on and due_on > date '1900-01-10'
               then round(late_base * 0.10, 2)
             else 0
           end
         ), 0)
    into v_open_capital, v_surcharge_due
  from public.member_dues_periods
  where member_id = p_member_id
    and capital_open > 0;

  v_payable := round(greatest(v_old, 0) + v_surcharge_due, 2);
  if round(p_importe, 2) > v_payable + 0.01 and not v_adelanto then
    raise exception 'El cobro supera la deuda. Para adelantar una cuota hay que marcarlo como adelanto.';
  end if;
$check$;
  v_advance text := $advance$
  if round(v_cash, 2) > 0.01 then
    if not v_adelanto then
      raise exception 'El cobro supera la deuda. Para adelantar una cuota hay que marcarlo como adelanto.';
    end if;
    select max(due_on) into v_last_due
    from public.member_dues_periods
    where member_id = p_member_id
      and due_on > date '1900-01-10';
    if v_last_due is null then
      if extract(day from v_paid) <= 10 then
        v_advance_due := (date_trunc('month', v_paid))::date + 9;
      else
        v_advance_due := (date_trunc('month', v_paid) + interval '1 month')::date + 9;
      end if;
    else
      v_advance_due := (date_trunc('month', v_last_due) + interval '1 month')::date + 9;
    end if;
    insert into public.dues_imputations (
      payment_id, member_id, due_on, capital, surcharge,
      capital_open, surcharge_open, late_base_taken, kind
    ) values (
      v_payment.id, p_member_id, v_advance_due,
      round(v_cash, 2), 0, 0, 0, 0, 'adelanto'
    );
    insert into public.member_dues_entries (member_id, amount, kind, source)
    values (
      p_member_id,
      round(-v_cash, 2),
      'adelanto',
      'adelanto:' || v_payment.id::text
    );
    update public.member_payments
    set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'adelanto', true,
      'advanceDueOn', v_advance_due
    )
    where id = v_payment.id;
    v_cash := 0;
  end if;

  $advance$;
begin
  v_sql := pg_get_functiondef(v_fn::regprocedure);

  if position('v_imputations jsonb := ''[]''::jsonb;' in v_sql) = 0 then
    raise exception 'No se encontró el declare de registrar_cobro';
  end if;
  v_sql := replace(
    v_sql,
    'v_imputations jsonb := ''[]''::jsonb;',
    'v_imputations jsonb := ''[]''::jsonb;' || E'\n'
    || '  v_adelanto boolean := false;' || E'\n'
    || '  v_payable numeric := 0;' || E'\n'
    || '  v_open_capital numeric := 0;' || E'\n'
    || '  v_surcharge_due numeric := 0;' || E'\n'
    || '  v_advance_due date;' || E'\n'
    || '  v_last_due date;'
  );

  if position('v_old := coalesce(v_member.outstanding_balance, 0);' in v_sql) = 0 then
    raise exception 'No se encontró el saldo inicial de registrar_cobro';
  end if;
  v_sql := replace(
    v_sql,
    'v_old := coalesce(v_member.outstanding_balance, 0);',
    'v_old := coalesce(v_member.outstanding_balance, 0);' || v_check
  );

  v_start := position('elsif v_cash > 0 then' in v_sql);
  v_end := position('v_cover := round(v_capital_paid + v_surcharge_paid, 2);' in v_sql);
  if v_start = 0 or v_end = 0 or v_end < v_start then
    raise exception 'No se encontró la imputación del sobrante';
  end if;
  v_sql := substring(v_sql from 1 for v_start - 1)
        || 'end if;' || E'\n\n  '
        || substring(v_sql from v_end);

  if position('select min(due_on) into v_open_due' in v_sql) = 0 then
    raise exception 'No se encontró el próximo vencimiento de registrar_cobro';
  end if;
  v_sql := replace(
    v_sql,
    'select min(due_on) into v_open_due',
    v_advance || 'select min(due_on) into v_open_due'
  );

  if position('coalesce(v_open_due, v_next_due, next_due_date)' in v_sql) = 0 then
    raise exception 'No se encontró el update de next_due_date';
  end if;
  v_sql := replace(
    v_sql,
    'coalesce(v_open_due, v_next_due, next_due_date)',
    'coalesce(v_open_due, v_advance_due, v_next_due, next_due_date)'
  );

  execute v_sql;
end;
$patch$;

create or replace function public.revert_dues_payment(p_payment_id uuid, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.member_dues_entries%rowtype;
  v_balance numeric;
  v_key text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_meta jsonb;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not (
    public.has_capability('payments.void')
    or public.has_capability('members.write')
    or public.user_has_role('tesorero')
  ) then
    raise exception 'Sin permiso para anular el cobro.';
  end if;
  if char_length(v_reason) < 8 then
    raise exception 'Falta el motivo de la anulación (mínimo 8 caracteres).';
  end if;

  select meta, member_id into v_meta, v_member_id
  from public.member_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'No se encontró el cobro.';
  end if;
  if coalesce(v_meta->>'status', '') = 'void' or coalesce(v_meta->>'voidedAt', '') <> '' then
    raise exception 'Ese cobro ya está anulado.';
  end if;

  update public.member_dues_periods p
  set capital_open = round(p.capital_open + i.capital, 2),
      late_base = round(p.late_base + i.late_base_taken, 2)
  from public.dues_imputations i
  where i.payment_id = p_payment_id
    and i.voided_at is null
    and p.member_id = i.member_id
    and p.due_on = i.due_on;

  update public.dues_imputations
  set voided_at = now()
  where payment_id = p_payment_id
    and voided_at is null;

  update public.member_payments
  set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
    'status', 'void',
    'voidReason', v_reason,
    'voidedAt', now(),
    'voidedBy', auth.uid()
  )
  where id = p_payment_id;

  select * into v_entry
  from public.member_dues_entries
  where source = 'payment:' || p_payment_id::text;

  if found then
    insert into public.member_dues_entries (member_id, amount, kind, source)
    values (v_entry.member_id, round(-v_entry.amount, 2), 'void', 'void:' || p_payment_id::text)
    on conflict (source) where source <> '' do nothing;

    select meta->>'idempotencyKey' into v_key
    from public.member_payments
    where id = p_payment_id;

    if coalesce(v_key, '') <> '' and exists (
      select 1 from public.member_dues_entries
      where source = 'impute:' || v_key
    ) and not exists (
      select 1 from public.member_dues_entries
      where source = 'void-impute:' || p_payment_id::text
    ) then
      insert into public.member_dues_entries (member_id, amount, kind, source)
      select member_id, round(-amount, 2), 'void', 'void-impute:' || p_payment_id::text
      from public.member_dues_entries
      where source = 'impute:' || v_key;
    end if;
  end if;

  insert into public.member_dues_entries (member_id, amount, kind, source)
  select member_id, round(-amount, 2), 'void', 'void-adelanto:' || p_payment_id::text
  from public.member_dues_entries
  where source = 'adelanto:' || p_payment_id::text
  on conflict (source) where source <> '' do nothing;

  update public.members
  set updated_at = now()
  where id = v_member_id
  returning outstanding_balance into v_balance;

  return coalesce(v_balance, 0);
end;
$$;

notify pgrst, 'reload schema';

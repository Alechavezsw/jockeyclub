-- Cada cobro deja a qué período fue la plata, del mes más viejo al más nuevo.
-- El saldo sigue siendo capital. El 10 % se anota en la imputación y no entra al saldo.

create table if not exists public.member_dues_periods (
  member_id uuid not null references public.members (id) on delete cascade,
  due_on date not null,
  capital numeric(14, 2) not null check (capital >= 0),
  capital_open numeric(14, 2) not null check (capital_open >= 0),
  late_base numeric(14, 2) not null default 0 check (late_base >= 0),
  primary key (member_id, due_on)
);

create table if not exists public.dues_imputations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.member_payments (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  due_on date not null,
  capital numeric(14, 2) not null default 0 check (capital >= 0),
  surcharge numeric(14, 2) not null default 0 check (surcharge >= 0),
  capital_open numeric(14, 2) not null default 0 check (capital_open >= 0),
  surcharge_open numeric(14, 2) not null default 0 check (surcharge_open >= 0),
  late_base_taken numeric(14, 2) not null default 0 check (late_base_taken >= 0),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_id, due_on)
);

create index if not exists dues_imputations_member_idx
  on public.dues_imputations (member_id, due_on);

alter table public.member_dues_periods enable row level security;
alter table public.dues_imputations enable row level security;

drop policy if exists member_dues_periods_select on public.member_dues_periods;
create policy member_dues_periods_select on public.member_dues_periods
  for select
  using (
    (select public.has_capability('payments.read'))
    or exists (
      select 1 from public.members m
      where m.id = member_id and m.profile_id = auth.uid()
    )
  );

drop policy if exists dues_imputations_select on public.dues_imputations;
create policy dues_imputations_select on public.dues_imputations
  for select
  using (
    (select public.has_capability('payments.read'))
    or exists (
      select 1 from public.members m
      where m.id = member_id and m.profile_id = auth.uid()
    )
  );

grant select on public.member_dues_periods to authenticated;
grant select on public.dues_imputations to authenticated;

comment on table public.dues_imputations is
  'Pago por período. El cobro entra del vencimiento más viejo al más nuevo.';
comment on table public.member_dues_periods is
  'Capital todavía abierto por vencimiento. late_base es la parte que lleva 10 %.';

-- La liquidación nueva abre el mes. No mueve saldo de más: el capital ya entra por member_dues_entries.
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
  select m.id, p.due_on, p.capital, p.capital, p.late_base
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
  where p.capital > 0
    and not public.member_is_dues_exempt(m)
  on conflict (member_id, due_on) do update
  set capital = public.member_dues_periods.capital + excluded.capital,
      capital_open = public.member_dues_periods.capital_open + excluded.capital,
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

create or replace function public.reverse_liquidated_dues_periods(
  p_pack jsonb,
  p_year integer,
  p_month integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.member_dues_periods p
  set capital = greatest(0, round(p.capital - d.amount, 2)),
      capital_open = greatest(0, round(p.capital_open - d.amount, 2)),
      late_base = greatest(0, round(p.late_base - d.late_base, 2))
  from (
    select m.id as member_id,
           coalesce(
             case when (c->>'dueOn') ~ '^\d{4}-\d{2}-\d{2}$' then (c->>'dueOn')::date end,
             make_date(p_year, p_month, 10)
           ) as due_on,
           round(sum(coalesce((c->>'addAmount')::numeric, (c->>'amount')::numeric, 0)), 2) as amount,
           round(sum(
             case
               when coalesce(c->>'tierId', '') = ''
                 or lower(c->>'tierId') in ('socio_familiar', 'socio_individual')
               then coalesce((c->>'addAmount')::numeric, (c->>'amount')::numeric, 0)
               else 0
             end
           ), 2) as late_base
    from jsonb_array_elements(coalesce(p_pack->'charges', '[]'::jsonb)) c
    join public.members m
      on m.member_number::text = coalesce(nullif(btrim(c->>'memberId'), ''), nullif(btrim(c->>'memberNumber'), ''))
    group by 1, 2
  ) d
  where p.member_id = d.member_id
    and p.due_on = d.due_on
    and d.amount <> 0;
end;
$$;

revoke all on function public.reverse_liquidated_dues_periods(jsonb, integer, integer) from public, anon;

-- Al reabrir, el mes liquidado deja de estar abierto.
do $$
declare
  v_sql text;
  v_mark text := 'if v_row.status = ''processed'' then';
  v_call text := 'if v_row.status = ''processed'' then perform public.reverse_liquidated_dues_periods(v_pack, v_row.year, v_row.month);';
begin
  v_sql := pg_get_functiondef('public.reopen_fee_period(text, text)'::regprocedure);
  if position('reverse_liquidated_dues_periods' in v_sql) > 0 then
    return;
  end if;
  if position(v_mark in v_sql) = 0 then
    raise exception 'No se pudo enganchar la reapertura de períodos';
  end if;
  v_sql := replace(v_sql, v_mark, v_call);
  execute v_sql;
end;
$$;

create or replace function public.registrar_cobro(
  p_member_id uuid,
  p_importe numeric,
  p_periodos jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_payment public.member_payments%rowtype;
  v_period public.member_dues_periods%rowtype;
  v_due_ons jsonb := '[]'::jsonb;
  v_months text[] := '{}';
  v_item jsonb;
  v_due text;
  v_quota numeric;
  v_surcharge numeric;
  v_gross numeric;
  v_old numeric;
  v_now numeric;
  v_credit numeric;
  v_applied numeric;
  v_left numeric;
  v_new numeric;
  v_cover numeric;
  v_line record;
  v_take numeric;
  v_paid date;
  v_next_due date;
  v_open_due date;
  v_method text;
  v_concept text;
  v_receipt text;
  v_meta jsonb;
  v_cash numeric;
  v_cap numeric;
  v_late numeric;
  v_surcharge_open numeric;
  v_total numeric;
  v_capital_take numeric;
  v_surcharge_take numeric;
  v_next_capital numeric;
  v_next_late numeric;
  v_next_surcharge numeric;
  v_capital_paid numeric := 0;
  v_surcharge_paid numeric := 0;
  v_should numeric;
  v_imputations jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_capability('members.write') then
    raise exception 'Sin permiso para registrar el cobro.';
  end if;
  if p_member_id is null then
    raise exception 'Falta el socio.';
  end if;
  if p_importe is null or p_importe < 0 then
    raise exception 'Importe de cobro inválido.';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'Falta la clave del cobro.';
  end if;
  if coalesce(p_periodos->>'waiveSurcharge', '') in ('true', 't', '1')
     or coalesce(nullif(p_periodos->>'waivedSurcharge', '')::numeric, 0) > 0 then
    raise exception 'El recargo no se perdona al cobrar.';
  end if;

  select * into v_member
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'No se encontró el socio.';
  end if;

  if jsonb_typeof(p_periodos) = 'array' then
    v_due_ons := p_periodos;
  elsif jsonb_typeof(p_periodos) = 'object' then
    v_due_ons := coalesce(p_periodos->'dueOns', p_periodos->'periods', '[]'::jsonb);
  end if;
  if jsonb_typeof(v_due_ons) <> 'array' then
    v_due_ons := '[]'::jsonb;
  end if;

  for v_item in select value from jsonb_array_elements(v_due_ons)
  loop
    v_due := left(coalesce(v_item->>'dueOn', v_item->>'date', trim(both '"' from v_item::text)), 10);
    if v_due ~ '^\d{4}-\d{2}-\d{2}$' then
      v_months := array_append(v_months, left(v_due, 7));
    end if;
  end loop;

  select * into v_payment
  from public.member_payments
  where meta->>'idempotencyKey' = p_idempotency_key
  limit 1;

  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'dueOn', i.due_on,
      'capital', i.capital,
      'surcharge', i.surcharge,
      'capitalOpen', i.capital_open,
      'surchargeOpen', i.surcharge_open
    ) order by i.due_on), '[]'::jsonb)
      into v_imputations
    from public.dues_imputations i
    where i.payment_id = v_payment.id and i.voided_at is null;
    return jsonb_build_object(
      'payment', to_jsonb(v_payment),
      'outstandingBalance', v_member.outstanding_balance,
      'nextDueDate', v_member.next_due_date,
      'imputations', v_imputations,
      'idempotent', true
    );
  end if;

  v_paid := coalesce(
    nullif(left(coalesce(p_periodos->>'paidAt', ''), 10), '')::date,
    current_date
  );
  v_method := nullif(btrim(coalesce(p_periodos->>'method', '')), '');
  v_concept := nullif(btrim(coalesce(p_periodos->>'concept', '')), '');
  v_receipt := nullif(btrim(coalesce(p_periodos->>'receiptNumber', '')), '');
  v_quota := nullif(p_periodos->>'quota', '')::numeric;
  v_surcharge := coalesce(nullif(p_periodos->>'surcharge', '')::numeric, 0);
  if nullif(p_periodos->>'nextDueDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_next_due := (p_periodos->>'nextDueDate')::date;
  end if;

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'idempotencyKey', p_idempotency_key,
    'periodDueOns', v_due_ons,
    'paidAt', p_periodos->>'paidAt',
    'time', p_periodos->>'time',
    'quota', v_quota,
    'surcharge', v_surcharge,
    'waiveSurcharge', p_periodos->>'waiveSurcharge',
    'waivedSurcharge', nullif(p_periodos->>'waivedSurcharge', '')::numeric,
    'creditApplied', nullif(p_periodos->>'creditApplied', '')::numeric,
    'bank', p_periodos->>'bankName',
    'bankId', p_periodos->>'bankId',
    'receiptName', p_periodos->>'receiptName',
    'receiptPath', p_periodos->>'receiptPath',
    'receiptBucket', p_periodos->>'receiptBucket',
    'receiptMime', p_periodos->>'receiptMime',
    'receiptSize', nullif(p_periodos->>'receiptSize', '')::numeric,
    'paymentPlanId', p_periodos->>'paymentPlanId',
    'paymentPlanLabel', p_periodos->>'paymentPlanLabel',
    'paymentSplits', p_periodos->'paymentSplits'
  ));

  v_old := coalesce(v_member.outstanding_balance, 0);

  begin
    insert into public.member_payments (
      member_id, amount, paid_at, method, concept, period_label, receipt_number, recorded_by, meta
    ) values (
      p_member_id,
      round(p_importe, 2),
      v_paid,
      v_method,
      coalesce(v_concept, 'Cuota social'),
      nullif(array_to_string(v_months, ', '), ''),
      v_receipt,
      auth.uid(),
      v_meta
    )
    returning * into v_payment;
  exception
    when unique_violation then
    select * into v_payment
    from public.member_payments
    where meta->>'idempotencyKey' = p_idempotency_key
    limit 1;
    if not found then
      raise;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'dueOn', i.due_on,
      'capital', i.capital,
      'surcharge', i.surcharge,
      'capitalOpen', i.capital_open,
      'surchargeOpen', i.surcharge_open
    ) order by i.due_on), '[]'::jsonb)
      into v_imputations
    from public.dues_imputations i
    where i.payment_id = v_payment.id and i.voided_at is null;
    return jsonb_build_object(
      'payment', to_jsonb(v_payment),
      'outstandingBalance', v_member.outstanding_balance,
      'nextDueDate', v_member.next_due_date,
      'imputations', v_imputations,
      'idempotent', true
    );
  end;

  if v_old > 0 and not exists (
    select 1 from public.member_dues_periods where member_id = p_member_id
  ) then
    v_left := v_old;
    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_periodos->'schedule', '[]'::jsonb))
      order by value->>'dueOn'
    loop
      exit when v_left <= 0;
      v_due := left(coalesce(v_item->>'dueOn', ''), 10);
      if v_due !~ '^\d{4}-\d{2}-\d{2}$' then
        continue;
      end if;
      v_cap := round(coalesce((v_item->>'capital')::numeric, 0), 2);
      if v_cap <= 0 then
        continue;
      end if;
      v_late := round(coalesce((v_item->>'lateBase')::numeric, 0), 2);
      v_take := least(v_cap, v_left);
      if v_cap > 0 then
        v_late := round(v_late * v_take / v_cap, 2);
      end if;
      insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
      values (p_member_id, v_due::date, v_take, v_take, greatest(v_late, 0))
      on conflict (member_id, due_on) do update
      set capital = public.member_dues_periods.capital + excluded.capital,
          capital_open = public.member_dues_periods.capital_open + excluded.capital,
          late_base = public.member_dues_periods.late_base + excluded.late_base;
      v_left := round(v_left - v_take, 2);
    end loop;
    if v_left > 0 then
      insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
      values (p_member_id, date '1900-01-10', v_left, v_left, 0)
      on conflict (member_id, due_on) do update
      set capital = public.member_dues_periods.capital + excluded.capital,
          capital_open = public.member_dues_periods.capital_open + excluded.capital;
    end if;
  end if;

  v_cash := round(p_importe, 2);
  if v_old > 0 then
    for v_period in
      select *
      from public.member_dues_periods
      where member_id = p_member_id
        and capital_open > 0
      order by due_on
      for update
    loop
      exit when v_cash <= 0;
      v_surcharge_open := case
        when v_paid > v_period.due_on and v_period.due_on > date '1900-01-10'
          then round(v_period.late_base * 0.10, 2)
        else 0
      end;
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
      v_next_capital := greatest(0, round(v_period.capital_open - v_capital_take, 2));
      if v_period.capital_open > 0 then
        v_next_late := round(v_period.late_base * v_next_capital / v_period.capital_open, 2);
      else
        v_next_late := 0;
      end if;
      v_next_surcharge := case
        when v_paid > v_period.due_on and v_period.due_on > date '1900-01-10'
          then round(v_next_late * 0.10, 2)
        else 0
      end;
      insert into public.dues_imputations (
        payment_id, member_id, due_on, capital, surcharge,
        capital_open, surcharge_open, late_base_taken
      ) values (
        v_payment.id, p_member_id, v_period.due_on,
        v_capital_take, v_surcharge_take,
        v_next_capital, v_next_surcharge,
        greatest(0, round(v_period.late_base - v_next_late, 2))
      );
      update public.member_dues_periods
      set capital_open = v_next_capital,
          late_base = v_next_late
      where member_id = p_member_id
        and due_on = v_period.due_on;
      v_capital_paid := round(v_capital_paid + v_capital_take, 2);
      v_surcharge_paid := round(v_surcharge_paid + v_surcharge_take, 2);
      v_cash := round(v_cash - v_take, 2);
    end loop;
  elsif v_cash > 0 then
    select min(value->>'dueOn') into v_due
    from jsonb_array_elements(coalesce(p_periodos->'schedule', '[]'::jsonb))
    where value->>'dueOn' ~ '^\d{4}-\d{2}-\d{2}$'
      and value->>'dueOn' > '1900-01-10';
    if v_due is null then
      v_due := to_char(v_paid, 'YYYY-MM') || '-10';
    end if;
    insert into public.dues_imputations (
      payment_id, member_id, due_on, capital, surcharge, capital_open, surcharge_open, late_base_taken
    ) values (
      v_payment.id, p_member_id, v_due::date, v_cash, 0, 0, 0, 0
    );
    v_capital_paid := 0;
  end if;

  v_cover := round(v_capital_paid + v_surcharge_paid, 2);
  if v_cover <= 0 then
    v_cover := round(coalesce(v_quota, 0) + coalesce(v_surcharge, 0), 2);
  end if;
  if v_cover <= 0 then
    v_cover := round(p_importe, 2);
  end if;

  if cardinality(v_months) > 0 then
    for v_line in
      select id, pending
      from public.fee_ledger_lines
      where member_number = v_member.member_number::text
        and pending > 0
        and to_char(line_date, 'YYYY-MM') = any (v_months)
      order by line_date, id
      for update
    loop
      exit when v_cover <= 0;
      v_take := least(v_line.pending, v_cover);
      update public.fee_ledger_lines
      set collected = collected + v_take,
          pending = pending - v_take,
          collected_at = v_paid,
          collected_at_label = to_char(v_paid, 'DD/MM/YYYY')
      where id = v_line.id;
      v_cover := round(v_cover - v_take, 2);
    end loop;
  end if;

  select outstanding_balance into v_now
  from public.members
  where id = p_member_id;

  if v_old > 0 then
    v_should := round(v_old - v_capital_paid, 2);
  else
    v_should := coalesce(v_now, 0);
  end if;

  if round(coalesce(v_should, 0) - coalesce(v_now, 0), 2) <> 0 then
    insert into public.member_dues_entries (member_id, amount, kind, source)
    values (
      p_member_id,
      round(v_should - coalesce(v_now, 0), 2),
      'payment_adjust',
      'impute:' || p_idempotency_key
    );
  end if;

  select min(due_on) into v_open_due
  from public.member_dues_periods
  where member_id = p_member_id
    and capital_open > 0
    and due_on > date '1900-01-10';

  update public.member_payments
  set period_label = coalesce((
        select string_agg(
          case
            when i.due_on <= date '1900-01-10' then 'Saldo anterior'
            else to_char(i.due_on, 'MM/YYYY')
          end,
          ', ' order by i.due_on
        )
        from public.dues_imputations i
        where i.payment_id = v_payment.id and i.voided_at is null
      ), period_label),
      meta = meta || jsonb_build_object(
        'quota', v_capital_paid,
        'surcharge', v_surcharge_paid
      )
  where id = v_payment.id
  returning * into v_payment;

  update public.members
  set next_due_date = coalesce(v_open_due, v_next_due, next_due_date),
      overdue_since = case when coalesce(v_should, 0) <= 0 then null else overdue_since end,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('lastPaymentDate', to_char(v_paid, 'YYYY-MM-DD'))
  where id = p_member_id
  returning outstanding_balance into v_new;

  select coalesce(jsonb_agg(jsonb_build_object(
    'dueOn', i.due_on,
    'capital', i.capital,
    'surcharge', i.surcharge,
    'capitalOpen', i.capital_open,
    'surchargeOpen', i.surcharge_open
  ) order by i.due_on), '[]'::jsonb)
    into v_imputations
  from public.dues_imputations i
  where i.payment_id = v_payment.id and i.voided_at is null;

  return jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'outstandingBalance', v_new,
    'nextDueDate', coalesce(v_open_due, v_next_due, v_member.next_due_date),
    'imputations', v_imputations,
    'idempotent', false
  );
end;
$$;

create or replace function public.revert_dues_payment(p_payment_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.member_dues_entries%rowtype;
  v_balance numeric;
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_capability('members.write') then
    raise exception 'Sin permiso para anular el cobro.';
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

    update public.members
    set updated_at = now()
    where id = v_entry.member_id
    returning outstanding_balance into v_balance;
    return coalesce(v_balance, 0);
  end if;

  select m.outstanding_balance into v_balance
  from public.member_payments p
  join public.members m on m.id = p.member_id
  where p.id = p_payment_id;
  return coalesce(v_balance, 0);
end;
$$;

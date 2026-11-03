-- El saldo de cuota no lo escribe el navegador.
-- Es la suma de movimientos: apertura (deuda histórica) + deudas nuevas − pagos.
-- La apertura conserva el saldo que ya estaba en la ficha. No se reconstruye desde el libro.

create table if not exists public.member_dues_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  amount numeric(14, 2) not null,
  kind text not null,
  source text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists member_dues_entries_member_idx
  on public.member_dues_entries (member_id);

create unique index if not exists member_dues_entries_source_idx
  on public.member_dues_entries (source)
  where source <> '';

alter table public.members drop constraint if exists members_outstanding_balance_check;

insert into public.member_dues_entries (member_id, amount, kind, source)
select m.id, m.outstanding_balance, 'opening', 'opening:' || m.id::text
from public.members m
where m.outstanding_balance <> 0
  and not public.member_is_dues_exempt(m)
on conflict (source) where source <> '' do nothing;

create or replace function public.member_dues_balance(p_member_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce(sum(amount), 0), 2)
  from public.member_dues_entries
  where member_id = p_member_id;
$$;

create or replace function public.keep_member_dues_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.member_is_dues_exempt(new) then
    new.outstanding_balance := 0;
    return new;
  end if;
  new.outstanding_balance := public.member_dues_balance(new.id);
  return new;
end;
$$;

drop trigger if exists trg_member_dues_balance on public.members;
create trigger trg_member_dues_balance
  before insert or update on public.members
  for each row execute function public.keep_member_dues_balance();

comment on column public.members.outstanding_balance is
  'Suma de member_dues_entries. El navegador no la escribe.';

create or replace view public.member_dues_balances as
select member_id, round(coalesce(sum(amount), 0), 2) as outstanding_balance
from public.member_dues_entries
group by member_id;

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

  if v_old >= 0 then
    v_delta := -least(v_old, new.amount);
  else
    v_delta := least(-v_old, new.amount);
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

drop trigger if exists trg_member_payment_posts_dues on public.member_payments;
create trigger trg_member_payment_posts_dues
  after insert on public.member_payments
  for each row execute function public.member_payment_posts_dues();

create or replace function public.post_member_dues_delta(
  p_member_id uuid,
  p_amount numeric,
  p_kind text,
  p_source text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not (
    public.has_capability('members.write')
    or public.has_admin_access()
    or public.has_accounting_access()
  ) then
    raise exception 'Sin permiso para mover el saldo.';
  end if;
  if p_member_id is null or p_amount is null or p_amount = 0 then
    select public.member_dues_balance(p_member_id) into v_balance;
    return coalesce(v_balance, 0);
  end if;

  insert into public.member_dues_entries (member_id, amount, kind, source)
  values (
    p_member_id,
    round(p_amount, 2),
    coalesce(nullif(btrim(p_kind), ''), 'ajuste'),
    coalesce(p_source, '')
  )
  on conflict (source) where source <> '' do nothing;

  update public.members
  set updated_at = now()
  where id = p_member_id
  returning outstanding_balance into v_balance;

  return coalesce(v_balance, 0);
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
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_capability('members.write') then
    raise exception 'Sin permiso para anular el cobro.';
  end if;

  select * into v_entry
  from public.member_dues_entries
  where source = 'payment:' || p_payment_id::text;

  if found then
    insert into public.member_dues_entries (member_id, amount, kind, source)
    values (v_entry.member_id, round(-v_entry.amount, 2), 'void', 'void:' || p_payment_id::text)
    on conflict (source) where source <> '' do nothing;

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
  join public.members m on m.member_number = d.member_number
  where d.amount <> 0
    and not public.member_is_dues_exempt(m);

  update public.members m
  set updated_at = now()
  from (
    select e->>'memberId' as member_number
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce(e->>'memberId', '') <> ''
    group by e->>'memberId'
  ) d
  where m.member_number = d.member_number;
end;
$$;

create or replace function public.reverse_member_balance_deltas(p_deltas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_capability('dues.liquidate') then
    raise exception 'Sin permiso para corregir una liquidación';
  end if;

  insert into public.member_dues_entries (member_id, amount, kind, source)
  select m.id, round(d.amount, 2), 'reversal', ''
  from (
    select
      e->>'memberId' as member_number,
      sum(coalesce((e->>'amount')::numeric, 0)) as amount
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce(e->>'memberId', '') <> ''
    group by e->>'memberId'
  ) d
  join public.members m on m.member_number = d.member_number
  where d.amount <> 0
    and not public.member_is_dues_exempt(m);

  update public.members m
  set updated_at = now()
  from (
    select e->>'memberId' as member_number
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce(e->>'memberId', '') <> ''
    group by e->>'memberId'
  ) d
  where m.member_number = d.member_number;
end;
$$;

-- Abrir Mi cuenta no vuelve a inventar el saldo con la hora de la computadora.
create or replace function public.sync_own_dues_standing()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.members%rowtype;
begin
  if auth.uid() is null then
    return null;
  end if;

  select * into m
  from public.members
  where profile_id = auth.uid()
  limit 1;

  if not found then
    return null;
  end if;

  if public.member_is_dues_exempt(m) then
    return jsonb_build_object(
      'outstanding', 0,
      'monthsBehind', 0,
      'nextDue', m.next_due_date,
      'overdueSince', null,
      'lastPaymentDate', m.meta->>'lastPaymentDate',
      'monthly', 0
    );
  end if;

  return jsonb_build_object(
    'outstanding', coalesce(m.outstanding_balance, 0),
    'monthsBehind', 0,
    'nextDue', m.next_due_date,
    'overdueSince', m.overdue_since,
    'lastPaymentDate', m.meta->>'lastPaymentDate',
    'monthly', 0
  );
end;
$$;

revoke all on function public.member_dues_balance(uuid) from public, anon;
revoke all on function public.post_member_dues_delta(uuid, numeric, text, text) from public, anon;
revoke all on function public.revert_dues_payment(uuid) from public, anon;
grant execute on function public.member_dues_balance(uuid) to authenticated;
grant execute on function public.post_member_dues_delta(uuid, numeric, text, text) to authenticated;
grant execute on function public.revert_dues_payment(uuid) to authenticated;
grant select on public.member_dues_balances to authenticated;

alter table public.member_dues_entries enable row level security;

drop policy if exists member_dues_entries_read on public.member_dues_entries;
create policy member_dues_entries_read
  on public.member_dues_entries
  for select
  to authenticated
  using (true);

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
  v_method text;
  v_concept text;
  v_receipt text;
  v_meta jsonb;
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
    return jsonb_build_object(
      'payment', to_jsonb(v_payment),
      'outstandingBalance', v_member.outstanding_balance,
      'nextDueDate', v_member.next_due_date,
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

  begin
    insert into public.member_payments (
      member_id,
      amount,
      paid_at,
      method,
      concept,
      period_label,
      receipt_number,
      recorded_by,
      meta
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
    return jsonb_build_object(
        'payment', to_jsonb(v_payment),
        'outstandingBalance', v_member.outstanding_balance,
        'nextDueDate', v_member.next_due_date,
        'idempotent', true
      );
  end;

  v_cover := round(coalesce(v_quota, 0) + coalesce(v_surcharge, 0), 2);
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

  v_old := coalesce(v_member.outstanding_balance, 0);
  if v_old > 0 then
    -- El efectivo que supera la deuda es el recargo, que no estaba en el saldo.
    v_new := greatest(round(v_old - p_importe, 2), 0);
  else
    v_gross := coalesce(v_quota, 0) + coalesce(v_surcharge, 0);
    if v_gross <= 0 then
      v_gross := p_importe;
    end if;
    v_credit := round(-v_old, 2);
    v_applied := least(v_credit, v_gross);
    v_left := round(v_credit - v_applied, 2);
    v_new := case when v_left > 0 then -v_left else 0 end;
  end if;

  select outstanding_balance into v_now
  from public.members
  where id = p_member_id;

  if round(coalesce(v_new, 0) - coalesce(v_now, 0), 2) <> 0 then
    insert into public.member_dues_entries (member_id, amount, kind, source)
    values (
      p_member_id,
      round(v_new - coalesce(v_now, 0), 2),
      'payment_adjust',
      'adjust:' || p_idempotency_key
    );
  end if;

  update public.members
  set next_due_date = coalesce(v_next_due, next_due_date),
      overdue_since = case when v_new <= 0 then null else overdue_since end,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('lastPaymentDate', to_char(v_paid, 'YYYY-MM-DD'))
  where id = p_member_id
  returning outstanding_balance into v_new;

  return jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'outstandingBalance', v_new,
    'nextDueDate', coalesce(v_next_due, v_member.next_due_date),
    'idempotent', false
  );
end;
$$;

revoke all on function public.registrar_cobro(uuid, numeric, jsonb, text) from public, anon;
grant execute on function public.registrar_cobro(uuid, numeric, jsonb, text) to authenticated;

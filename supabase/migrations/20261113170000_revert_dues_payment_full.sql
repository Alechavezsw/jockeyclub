-- Anulación de cobro: revierte toda la transacción de cuota
-- (periodos, entries, adelanto, fee_ledger, vencimiento, último pago, unpaidCapital).

do $meta$
declare
  v_sql text;
  v_old text := $o$'idempotencyKey', p_idempotency_key,
    'periodDueOns', v_due_ons,$o$;
  v_new text := $n$'idempotencyKey', p_idempotency_key,
    'periodDueOns', v_due_ons,
    'balanceBefore', nullif(p_periodos->>'balanceBefore', '')::numeric,
    'nextDueBefore', nullif(p_periodos->>'nextDueBefore', ''),
    'lastPaymentBefore', nullif(p_periodos->>'lastPaymentBefore', ''),$n$;
begin
  v_sql := pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure);
  if strpos(v_sql, '''balanceBefore'', nullif(p_periodos') > 0 then
    return;
  end if;
  if strpos(v_sql, v_old) = 0 then
    raise exception 'No está el meta de registrar_cobro para snapshots de anulación';
  end if;
  execute replace(v_sql, v_old, v_new);
end
$meta$;

create or replace function public.revert_dues_payment(p_payment_id uuid, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
set "TimeZone" = 'America/Argentina/Buenos_Aires'
as $$
declare
  v_entry public.member_dues_entries%rowtype;
  v_balance numeric;
  v_key text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_meta jsonb;
  v_member_id uuid;
  v_member public.members%rowtype;
  v_next date;
  v_last text;
  v_open_capital numeric := 0;
  v_imp record;
  v_left numeric;
  v_take numeric;
  v_line record;
  v_month text;
  v_member_number text;
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

  select * into v_member
  from public.members
  where id = v_member_id
  for update;

  if not found then
    raise exception 'No se encontró el socio del cobro.';
  end if;

  v_member_number := coalesce(v_member.member_number::text, '');

  -- 1) Reabrir períodos imputados por este cobro.
  update public.member_dues_periods p
  set capital_open = round(p.capital_open + i.capital, 2),
      late_base = round(p.late_base + i.late_base_taken, 2)
  from public.dues_imputations i
  where i.payment_id = p_payment_id
    and i.voided_at is null
    and p.member_id = i.member_id
    and p.due_on = i.due_on;

  -- 2) Revertir fee_ledger (meses del recibo) con el capital (+ recargo) imputado.
  for v_imp in
    select due_on,
           round(coalesce(capital, 0) + coalesce(surcharge, 0), 2) as cover
    from public.dues_imputations
    where payment_id = p_payment_id
      and voided_at is null
      and due_on > date '1900-01-10'
    order by due_on
  loop
    v_left := greatest(v_imp.cover, 0);
    v_month := to_char(v_imp.due_on, 'YYYY-MM');
    if v_left <= 0.009 or v_member_number = '' then
      continue;
    end if;
    for v_line in
      select id, collected, pending
      from public.fee_ledger_lines
      where member_number = v_member_number
        and collected > 0.009
        and to_char(line_date, 'YYYY-MM') = v_month
      order by line_date desc, id desc
      for update
    loop
      exit when v_left <= 0.009;
      v_take := least(v_line.collected, v_left);
      update public.fee_ledger_lines
      set collected = round(collected - v_take, 2),
          pending = round(pending + v_take, 2),
          collected_at = case
            when round(collected - v_take, 2) <= 0.009 then null
            else collected_at
          end,
          collected_at_label = case
            when round(collected - v_take, 2) <= 0.009 then null
            else collected_at_label
          end
      where id = v_line.id;
      v_left := round(v_left - v_take, 2);
    end loop;
  end loop;

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

  select outstanding_balance into v_balance
  from public.members
  where id = v_member_id;

  select coalesce(sum(capital_open), 0)
    into v_open_capital
  from public.member_dues_periods
  where member_id = v_member_id
    and capital_open > 0.009;

  -- Vencimiento: snapshot del cobro, o el período abierto más viejo.
  begin
    if coalesce(nullif(v_meta->>'nextDueBefore', ''), '') ~ '^\d{4}-\d{2}-\d{2}$' then
      v_next := (v_meta->>'nextDueBefore')::date;
    end if;
  exception when others then
    v_next := null;
  end;

  if v_next is null then
    select min(due_on) into v_next
    from public.member_dues_periods
    where member_id = v_member_id
      and capital_open > 0.009
      and due_on > date '1900-01-10';
  end if;

  v_last := nullif(btrim(coalesce(v_meta->>'lastPaymentBefore', '')), '');
  if v_last is null or v_last = '' then
    select to_char(
      (timezone('America/Argentina/Buenos_Aires', p.paid_at))::date,
      'YYYY-MM-DD'
    )
      into v_last
    from public.member_payments p
    where p.member_id = v_member_id
      and p.id <> p_payment_id
      and coalesce(p.meta->>'status', '') <> 'void'
      and coalesce(p.meta->>'voidedAt', '') = ''
    order by p.paid_at desc nulls last
    limit 1;
  end if;

  update public.members
  set next_due_date = v_next,
      overdue_since = case
        when coalesce(v_balance, 0) <= 0.01 then null
        when v_next is not null and v_next < public.club_today() then v_next
        else overdue_since
      end,
      meta = (coalesce(meta, '{}'::jsonb) - 'lastPaymentDate')
        || case
          when v_last is null then '{}'::jsonb
          else jsonb_build_object('lastPaymentDate', v_last)
        end
        || jsonb_build_object(
          'unpaidCapital', round(greatest(v_open_capital, 0), 2)
        ),
      updated_at = now()
  where id = v_member_id
  returning outstanding_balance into v_balance;

  return coalesce(v_balance, 0);
end;
$$;

notify pgrst, 'reload schema';

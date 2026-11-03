-- Un cobro de cuota es una sola transacción: recibo, períodos y saldo.
-- Si falla, no queda el saldo en cero sin pago.

create unique index if not exists member_payments_idempotency_key_idx
  on public.member_payments ((meta->>'idempotencyKey'))
  where coalesce(meta->>'idempotencyKey', '') <> '';

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

  update public.members
  set outstanding_balance = v_new,
      next_due_date = coalesce(v_next_due, next_due_date),
      overdue_since = case when v_new <= 0 then null else overdue_since end,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('lastPaymentDate', to_char(v_paid, 'YYYY-MM-DD'))
  where id = p_member_id;

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

-- Bonificaciones y descuentos: solo un superadmin escribe, y queda el motivo.
-- Quitar un recargo cobrado no pasa por el delta abierto: es un RPC propio.

alter table public.discount_rules
  add column if not exists change_reason text;

alter table public.fixed_discounts
  add column if not exists change_reason text;

drop policy if exists discount_rules_access on public.discount_rules;
drop policy if exists discount_rules_read on public.discount_rules;
drop policy if exists discount_rules_insert on public.discount_rules;
drop policy if exists discount_rules_update on public.discount_rules;
drop policy if exists discount_rules_delete on public.discount_rules;

create policy discount_rules_read on public.discount_rules
  for select to authenticated
  using (public.has_accounting_access());

create policy discount_rules_insert on public.discount_rules
  for insert to authenticated
  with check (public.user_has_role('superadmin'));

create policy discount_rules_update on public.discount_rules
  for update to authenticated
  using (public.user_has_role('superadmin'))
  with check (public.user_has_role('superadmin'));

create policy discount_rules_delete on public.discount_rules
  for delete to authenticated
  using (public.user_has_role('superadmin'));

drop policy if exists fixed_disc_access on public.fixed_discounts;
drop policy if exists fixed_discounts_read on public.fixed_discounts;
drop policy if exists fixed_discounts_insert on public.fixed_discounts;
drop policy if exists fixed_discounts_update on public.fixed_discounts;
drop policy if exists fixed_discounts_delete on public.fixed_discounts;

create policy fixed_discounts_read on public.fixed_discounts
  for select to authenticated
  using (public.has_accounting_access());

create policy fixed_discounts_insert on public.fixed_discounts
  for insert to authenticated
  with check (public.user_has_role('superadmin'));

create policy fixed_discounts_update on public.fixed_discounts
  for update to authenticated
  using (public.user_has_role('superadmin'))
  with check (public.user_has_role('superadmin'));

create policy fixed_discounts_delete on public.fixed_discounts
  for delete to authenticated
  using (public.user_has_role('superadmin'));

create or replace function public.audit_benefit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
begin
  if not public.user_has_role('superadmin') then
    raise exception 'Solo un superadmin puede cargar bonificaciones.';
  end if;

  v_reason := nullif(btrim(coalesce(
    case when tg_op = 'DELETE' then null else new.change_reason end,
    nullif(current_setting('jockey.benefit_reason', true), '')
  )), '');

  if v_reason is null or char_length(v_reason) < 8 then
    raise exception 'Falta el motivo de la bonificación (mínimo 8 caracteres).';
  end if;

  if tg_op = 'INSERT' then
    v_old := null;
    v_new := to_jsonb(new) - 'change_reason';
    v_id := new.id;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'change_reason';
    v_new := to_jsonb(new) - 'change_reason';
    v_id := new.id;
  else
    v_old := to_jsonb(old) - 'change_reason';
    v_new := null;
    v_id := old.id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_id,
    jsonb_build_object(
      'old', v_old,
      'new', v_new,
      'reason', v_reason,
      'actor_id', auth.uid()
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_discount_rules on public.discount_rules;
create trigger trg_audit_discount_rules
  before insert or update or delete on public.discount_rules
  for each row execute function public.audit_benefit_change();

drop trigger if exists trg_audit_fixed_discounts on public.fixed_discounts;
create trigger trg_audit_fixed_discounts
  before insert or update or delete on public.fixed_discounts
  for each row execute function public.audit_benefit_change();

create or replace function public.reject_waived_surcharge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.meta->>'waiveSurcharge', '') in ('true', 't', '1')
     or coalesce(nullif(new.meta->>'waivedSurcharge', '')::numeric, 0) > 0 then
    raise exception 'El recargo no se perdona al cobrar.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_waived_surcharge on public.member_payments;
create trigger trg_reject_waived_surcharge
  before insert or update on public.member_payments
  for each row execute function public.reject_waived_surcharge();

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
  if p_kind in ('surcharge_credit', 'waive')
     or coalesce(p_source, '') like 'surcharge-off:%' then
    raise exception 'El recargo se quita solo con quitar_recargo_cuota.';
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

create or replace function public.quitar_recargo_cuota(
  p_payment_id uuid,
  p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.member_payments%rowtype;
  v_surcharge numeric;
  v_balance numeric;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.user_has_role('superadmin') then
    raise exception 'Solo un superadmin puede quitar un recargo.';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) < 8 then
    raise exception 'Falta el motivo para quitar el recargo (mínimo 8 caracteres).';
  end if;
  if p_payment_id is null then
    raise exception 'Falta el cobro.';
  end if;

  select * into v_payment
  from public.member_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'No se encontró el cobro.';
  end if;
  if coalesce(v_payment.meta->>'status', '') in ('void', 'cancelled')
     or exists (
       select 1
       from public.member_dues_entries
       where source = 'void:' || p_payment_id::text
     ) then
    raise exception 'Ese cobro está anulado.';
  end if;
  if coalesce(v_payment.meta->>'surchargeRemovedAt', '') <> '' then
    raise exception 'Ese recargo ya se borró.';
  end if;

  v_surcharge := round(coalesce(nullif(v_payment.meta->>'surcharge', '')::numeric, 0), 2);
  if v_surcharge <= 0 then
    raise exception 'Este cobro no tiene recargo.';
  end if;

  insert into public.member_dues_entries (member_id, amount, kind, source)
  values (
    v_payment.member_id,
    -v_surcharge,
    'surcharge_credit',
    'surcharge-off:' || p_payment_id::text
  )
  on conflict (source) where source <> '' do nothing;

  update public.member_payments
  set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
    'surcharge', 0,
    'removedSurcharge', v_surcharge,
    'surchargeRemovedAt', now(),
    'surchargeRemovedBy', auth.uid(),
    'surchargeRemoveReason', v_reason
  )
  where id = p_payment_id;

  update public.members
  set updated_at = now()
  where id = v_payment.member_id
  returning outstanding_balance into v_balance;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'quitar_recargo',
    'member_payments',
    p_payment_id,
    jsonb_build_object(
      'old', jsonb_build_object('surcharge', v_surcharge),
      'new', jsonb_build_object('surcharge', 0),
      'reason', v_reason,
      'actor_id', auth.uid(),
      'member_id', v_payment.member_id
    )
  );

  return coalesce(v_balance, 0);
end;
$$;

revoke all on function public.quitar_recargo_cuota(uuid, text) from public, anon;
grant execute on function public.quitar_recargo_cuota(uuid, text) to authenticated;
revoke all on function public.post_member_dues_delta(uuid, numeric, text, text) from public, anon;
grant execute on function public.post_member_dues_delta(uuid, numeric, text, text) to authenticated;

-- El cobro rechaza un recargo perdonado en el mostrador.
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

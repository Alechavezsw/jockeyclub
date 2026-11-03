-- Una liquidación procesada no se reescribe.
-- Reabrirla es un RPC de superadmin: la base calcula qué deuda devolver y lo audita.
-- Un ajuste posterior es una nota de crédito o débito, no un importe suelto.

create or replace function public.block_processed_fee_period()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('jockey.fee_period_reopen', true) = '1' then
    return new;
  end if;
  if old.status = 'processed' then
    raise exception 'Una liquidación procesada no se modifica. Corregí con una nota de crédito o débito.';
  end if;
  if old.status = 'pending' and new.status = 'draft' then
    raise exception 'Reabrir una liquidación es solo para un superadmin.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_processed_fee_period on public.fee_period_closures;
create trigger trg_block_processed_fee_period
  before update on public.fee_period_closures
  for each row execute function public.block_processed_fee_period();

create or replace function public.void_fee_period_ledger(p_period_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'La liquidación se reabre con reopen_fee_period. Una procesada no se borra a mano.';
end;
$$;

create or replace function public.reverse_member_balance_deltas(p_deltas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Los importes los calcula la base al reabrir. No se aceptan deltas sueltos.';
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

create or replace function public.reopen_fee_period(p_period_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.fee_period_closures%rowtype;
  v_reason text;
  v_keep boolean;
  v_n integer;
  v_pack jsonb;
  v_reopens jsonb;
  v_history jsonb;
  v_reversals jsonb := '[]'::jsonb;
  v_missing text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.user_has_role('superadmin') then
    raise exception 'Solo un superadmin puede reabrir una liquidación.';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) < 8 then
    raise exception 'Describí el error grave.';
  end if;
  if coalesce(btrim(p_period_id), '') = '' then
    raise exception 'Período inválido';
  end if;

  select * into v_row
  from public.fee_period_closures
  where id = p_period_id
  for update;

  if not found then
    raise exception 'Período no encontrado.';
  end if;
  if (v_row.year * 12 + v_row.month) < (2026 * 12 + 11) then
    raise exception 'Hasta octubre de 2026 la liquidación quedó en LILA.';
  end if;
  if v_row.status not in ('processed', 'pending') then
    raise exception 'Solo se reabre un período ya generado.';
  end if;

  v_keep := v_row.status = 'pending';
  v_pack := coalesce(v_row.pack, '{}'::jsonb);
  v_n := coalesce(jsonb_array_length(v_pack->'reopens'), 0) + 1;

  if v_row.status = 'processed' then
    if coalesce(jsonb_array_length(v_pack->'charges'), 0) = 0 and coalesce(v_row.amount, 0) > 0 then
      raise exception 'Esta liquidación no guarda el detalle por socio, así que no se puede anular.';
    end if;

    select string_agg(distinct d.member_number, ', ')
      into v_missing
    from (
      select coalesce(nullif(btrim(c->>'memberId'), ''), nullif(btrim(c->>'memberNumber'), '')) as member_number,
             sum(coalesce((c->>'addAmount')::numeric, (c->>'amount')::numeric, 0)) as amount
      from jsonb_array_elements(coalesce(v_pack->'charges', '[]'::jsonb)) c
      group by 1
    ) d
    left join public.members m on m.member_number::text = d.member_number
    where d.member_number is not null
      and d.amount <> 0
      and m.id is null;

    if v_missing is not null then
      raise exception 'No se encontró un socio de la liquidación (%).', v_missing;
    end if;

    insert into public.member_dues_entries (member_id, amount, kind, source)
    select m.id,
           round(-d.amount, 2),
           'reversal',
           'reopen:' || p_period_id || ':' || v_n::text || ':' || d.member_number
    from (
      select coalesce(nullif(btrim(c->>'memberId'), ''), nullif(btrim(c->>'memberNumber'), '')) as member_number,
             sum(coalesce((c->>'addAmount')::numeric, (c->>'amount')::numeric, 0)) as amount
      from jsonb_array_elements(coalesce(v_pack->'charges', '[]'::jsonb)) c
      group by 1
    ) d
    join public.members m on m.member_number::text = d.member_number
    where d.member_number is not null
      and d.amount <> 0
      and not public.member_is_dues_exempt(m);

    update public.members m
    set updated_at = now()
    where m.member_number::text in (
      select coalesce(nullif(btrim(c->>'memberId'), ''), nullif(btrim(c->>'memberNumber'), ''))
      from jsonb_array_elements(coalesce(v_pack->'charges', '[]'::jsonb)) c
    );

    select coalesce(jsonb_agg(jsonb_build_object(
      'memberId', d.member_number,
      'addAmount', d.amount,
      'outstandingBalance', m.outstanding_balance
    )), '[]'::jsonb)
      into v_reversals
    from (
      select coalesce(nullif(btrim(c->>'memberId'), ''), nullif(btrim(c->>'memberNumber'), '')) as member_number,
             round(sum(coalesce((c->>'addAmount')::numeric, (c->>'amount')::numeric, 0)), 2) as amount
      from jsonb_array_elements(coalesce(v_pack->'charges', '[]'::jsonb)) c
      group by 1
    ) d
    join public.members m on m.member_number::text = d.member_number
    where d.member_number is not null
      and d.amount <> 0
      and not public.member_is_dues_exempt(m);

    with doomed as (
      delete from public.fee_ledger_lines
      where source = 'liquidation'
        and id like 'fll-%-' || p_period_id || '-%'
      returning account_id, amount
    )
    update public.fee_ledger_accounts a
    set balance = a.balance - d.amount
    from (
      select account_id, sum(amount) as amount
      from doomed
      group by account_id
    ) d
    where a.id = d.account_id
      and d.amount <> 0;
  end if;

  v_reopens := coalesce(v_pack->'reopens', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'at', to_jsonb(now()),
    'reason', v_reason,
    'amount', v_row.amount,
    'generatedAt', v_row.generated_at,
    'statusWas', v_row.status,
    'byId', auth.uid()
  ));
  v_history := coalesce(v_pack->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'type', 'reverted',
    'at', to_jsonb(now()),
    'reason', v_reason,
    'amount', v_row.amount,
    'generatedAt', v_row.generated_at,
    'statusWas', v_row.status,
    'byId', auth.uid()
  ));
  v_pack := v_pack || jsonb_build_object(
    'charges', '[]'::jsonb,
    'reopens', v_reopens,
    'history', v_history,
    'availableAt', 'null'::jsonb,
    'total', case when v_keep then coalesce(v_pack->'total', to_jsonb(v_row.amount)) else to_jsonb(0) end
  );

  perform set_config('jockey.fee_period_reopen', '1', true);

  update public.fee_period_closures
  set status = 'draft',
      amount = case when v_keep then amount else 0 end,
      generated_at = null,
      lines = case when v_keep then lines else '[]'::jsonb end,
      pack = v_pack
  where id = p_period_id
  returning * into v_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'reopen_fee_period',
    'fee_period_closures',
    null,
    jsonb_build_object(
      'periodId', p_period_id,
      'old', jsonb_build_object('status', case when v_keep then 'pending' else 'processed' end),
      'new', jsonb_build_object('status', 'draft'),
      'reason', v_reason,
      'actor_id', auth.uid(),
      'reversals', v_reversals
    )
  );

  return jsonb_build_object(
    'period', to_jsonb(v_row),
    'reversals', v_reversals
  );
end;
$$;

create or replace function public.nota_ajuste_cuota(
  p_member_number text,
  p_kind text,
  p_amount numeric,
  p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_reason text;
  v_kind text;
  v_amount numeric;
  v_signed numeric;
  v_balance numeric;
  v_old numeric;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.user_has_role('superadmin') then
    raise exception 'Solo un superadmin puede cargar una nota de cuota.';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) < 8 then
    raise exception 'Falta el motivo de la nota (mínimo 8 caracteres).';
  end if;
  v_kind := lower(btrim(coalesce(p_kind, '')));
  if v_kind not in ('credito', 'debito') then
    raise exception 'La nota es de crédito o de débito.';
  end if;
  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'El importe de la nota tiene que ser mayor a cero.';
  end if;

  select * into v_member
  from public.members
  where member_number::text = btrim(p_member_number)
  for update;

  if not found then
    raise exception 'No se encontró el socio.';
  end if;
  if public.member_is_dues_exempt(v_member) then
    raise exception 'Ese socio no abona cuota.';
  end if;

  v_old := coalesce(v_member.outstanding_balance, 0);
  v_signed := case when v_kind = 'credito' then -v_amount else v_amount end;

  insert into public.member_dues_entries (member_id, amount, kind, source)
  values (
    v_member.id,
    v_signed,
    case when v_kind = 'credito' then 'credit_note' else 'debit_note' end,
    'nota:' || gen_random_uuid()::text
  );

  update public.members
  set updated_at = now()
  where id = v_member.id
  returning outstanding_balance into v_balance;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'nota_ajuste_cuota',
    'members',
    v_member.id,
    jsonb_build_object(
      'old', jsonb_build_object('outstandingBalance', v_old),
      'new', jsonb_build_object('outstandingBalance', v_balance),
      'reason', v_reason,
      'actor_id', auth.uid(),
      'kind', v_kind,
      'amount', v_amount,
      'memberNumber', v_member.member_number
    )
  );

  return coalesce(v_balance, 0);
end;
$$;

revoke all on function public.reopen_fee_period(text, text) from public, anon;
grant execute on function public.reopen_fee_period(text, text) to authenticated;
revoke all on function public.nota_ajuste_cuota(text, text, numeric, text) from public, anon;
grant execute on function public.nota_ajuste_cuota(text, text, numeric, text) to authenticated;
revoke all on function public.void_fee_period_ledger(text) from public, anon;
revoke all on function public.reverse_member_balance_deltas(jsonb) from public, anon;
grant execute on function public.void_fee_period_ledger(text) to authenticated;
grant execute on function public.reverse_member_balance_deltas(jsonb) to authenticated;

-- Anula las líneas de una liquidación de la app y devuelve las deudas del socio.
-- No toca el corte de Lila: solo borra ids de liquidación de ese período.

create or replace function public.void_fee_period_ledger(p_period_id text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.has_capability('dues.liquidate') then
    raise exception 'Sin permiso para corregir una liquidación';
  end if;
  if coalesce(p_period_id, '') = '' then
    raise exception 'Período inválido';
  end if;

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
end;
$$;

create or replace function public.reverse_member_balance_deltas(p_deltas jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.has_capability('dues.liquidate') then
    raise exception 'Sin permiso para corregir una liquidación';
  end if;

  update public.members m
  set outstanding_balance = coalesce(m.outstanding_balance, 0) + d.amount
  from (
    select
      e->>'memberId' as member_number,
      sum(coalesce((e->>'amount')::numeric, 0)) as amount
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce(e->>'memberId', '') <> ''
    group by e->>'memberId'
  ) d
  where m.member_number = d.member_number
    and d.amount <> 0;
end;
$$;

revoke all on function public.void_fee_period_ledger(text) from public;
revoke all on function public.reverse_member_balance_deltas(jsonb) from public;
grant execute on function public.void_fee_period_ledger(text) to authenticated;
grant execute on function public.reverse_member_balance_deltas(jsonb) to authenticated;

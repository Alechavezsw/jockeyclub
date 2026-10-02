-- Suma o resta deuda de socios. Lo usa la liquidación de cuotas.

create or replace function public.apply_member_balance_deltas(p_deltas jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (public.has_accounting_access() or public.has_admin_access()) then
    raise exception 'Sin permiso para imputar cuotas';
  end if;

  update public.members m
  set outstanding_balance = greatest(0, coalesce(m.outstanding_balance, 0) + d.amount)
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

revoke all on function public.apply_member_balance_deltas(jsonb) from public;
grant execute on function public.apply_member_balance_deltas(jsonb) to authenticated;

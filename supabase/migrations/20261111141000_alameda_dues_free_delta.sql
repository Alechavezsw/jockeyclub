-- Caso particular: si la ficha tiene meta.duesFreeThrough (AAAA-MM) y todos
-- los meses del delta caen en ese tope o antes, no se imputa. Enero y el
-- resto del padrón siguen igual.

create or replace function public.member_delta_is_dues_free(p_member public.members, p_deltas jsonb)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    coalesce(p_member.meta->>'duesFreeThrough', '') ~ '^\d{4}-\d{2}'
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
      cross join lateral jsonb_array_elements(coalesce(e->'periods', '[]'::jsonb)) per
      where e->>'memberId' = p_member.member_number::text
        and (per->>'dueOn') ~ '^\d{4}-\d{2}-\d{2}$'
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
      cross join lateral jsonb_array_elements(coalesce(e->'periods', '[]'::jsonb)) per
      where e->>'memberId' = p_member.member_number::text
        and (per->>'dueOn') ~ '^\d{4}-\d{2}-\d{2}$'
        and left(per->>'dueOn', 7) > left(p_member.meta->>'duesFreeThrough', 7)
    );
$function$;

revoke all on function public.member_delta_is_dues_free(public.members, jsonb) from public, anon;
grant execute on function public.member_delta_is_dues_free(public.members, jsonb) to service_role;

create or replace function public.apply_member_balance_deltas(p_deltas jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (
    coalesce(auth.role(), '') = 'service_role'
    or public.has_capability('dues.liquidate')
    or public.has_admin_access()
  ) then
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
    and not public.member_is_dues_exempt(m)
    and not public.member_delta_is_dues_free(m, p_deltas);

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
    and not public.member_delta_is_dues_free(m, p_deltas)
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
  set
    meta = coalesce(m.meta, '{}'::jsonb) || jsonb_build_object(
      'unpaidCapital',
      round(
        coalesce((m.meta->>'unpaidCapital')::numeric, m.outstanding_balance, 0) + d.amount
      , 2)
    ),
    updated_at = now()
  from (
    select
      e->>'memberId' as member_number,
      sum(coalesce((e->>'amount')::numeric, 0)) as amount
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce(e->>'memberId', '') <> ''
    group by e->>'memberId'
  ) d
  where m.member_number::text = d.member_number
    and d.amount <> 0
    and not public.member_is_dues_exempt(m)
    and not public.member_delta_is_dues_free(m, p_deltas);
end;
$function$;

revoke all on function public.apply_member_balance_deltas(jsonb) from public, anon;
grant execute on function public.apply_member_balance_deltas(jsonb) to authenticated, service_role;

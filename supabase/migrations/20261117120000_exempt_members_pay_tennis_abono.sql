-- Vitalicio / fundador / comisión: sin cuota social, pero sí abono tenis.
-- El saldo de ficha sigue a member_dues_entries (tenis); no se fuerza a 0.
-- addOnOnly en liquidación alcanza aunque el tenis esté en un adherente del hogar.

create or replace function public.member_has_tennis_abono(m public.members)
returns boolean
language sql
stable
as $$
  select
    coalesce(m.tier::text, '') ~* 'abono[_ ]?tenis'
    or coalesce(m.meta->>'cuotaCategories', '') ~* 'abono[_ ]?tenis'
    or exists (
      select 1
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(coalesce(m.meta->'cuotaCategories', 'null'::jsonb)) = 'array'
            then m.meta->'cuotaCategories'
          else '[]'::jsonb
        end
      ) cat
      where cat ~* 'abono[_ ]?tenis'
    );
$$;

create or replace function public.member_delta_is_add_on_only(p_deltas jsonb, p_member_number text)
returns boolean
language sql
stable
as $$
  select coalesce((
    select bool_and(coalesce(lower(e->>'addOnOnly'), '') in ('true', 't', '1'))
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where e->>'memberId' = p_member_number
  ), false);
$$;

create or replace function public.keep_member_dues_balance()
returns trigger
language plpgsql
as $$
begin
  -- Exentos: saldo = deuda en entries (abono tenis). Sin entries → 0.
  new.outstanding_balance := public.member_dues_balance(new.id);
  return new;
end;
$$;

create or replace function public.zero_exempt_member_dues()
returns trigger
language plpgsql
as $$
begin
  if public.member_is_dues_exempt(new) then
    new.overdue_since := null;
    -- No pisar deuda de tenis: el saldo lo fija keep_member_dues_balance vía entries.
    new.outstanding_balance := public.member_dues_balance(new.id);
  end if;
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
    and (
      not public.member_is_dues_exempt(m)
      or public.member_delta_is_add_on_only(p_deltas, d.member_number)
    )
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
    and (
      not public.member_is_dues_exempt(m)
      or public.member_delta_is_add_on_only(p_deltas, p.member_number)
    )
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
    and (
      not public.member_is_dues_exempt(m)
      or public.member_delta_is_add_on_only(p_deltas, d.member_number)
    )
    and not public.member_delta_is_dues_free(m, p_deltas);
end;
$$;

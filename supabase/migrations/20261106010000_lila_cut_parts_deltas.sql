-- Corte LILA = apertura cierta. Liquidación suma capital; cobro resta capital
-- (y recargos de stock LILA). El 10 % nuevo no se mete en meta ni en el saldo.

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
    and not public.member_is_dues_exempt(m);

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

  -- Suma capital al desglose LILA vivo (apertura + liquidaciones).
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
    and not public.member_is_dues_exempt(m);
end;
$function$;

revoke all on function public.apply_member_balance_deltas(jsonb) from public, anon;
grant execute on function public.apply_member_balance_deltas(jsonb) to authenticated, service_role;

-- Cada imputación de cobro resta solo su capital (y recargos de stock LILA).
create or replace function public.sync_lila_parts_after_imputations()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bal numeric;
  v_stock numeric;
  v_meta jsonb;
  v_cap numeric;
  v_sur numeric;
begin
  if new.voided_at is not null then
    return new;
  end if;
  if coalesce(new.kind, 'cuota') = 'adelanto' then
    return new;
  end if;

  v_cap := round(coalesce(new.capital, 0), 2);
  v_sur := round(coalesce(new.surcharge, 0), 2);
  if v_cap = 0 and v_sur = 0 then
    return new;
  end if;

  select outstanding_balance, coalesce(meta, '{}'::jsonb)
    into v_bal, v_meta
  from public.members
  where id = new.member_id
  for update;

  if not found then
    return new;
  end if;

  v_stock := greatest(0, coalesce((v_meta->>'unpaidSurcharges')::numeric, 0));

  if coalesce(v_bal, 0) <= 0 then
    v_meta := v_meta || jsonb_build_object(
      'unpaidCapital', 0,
      'unpaidSurcharges', 0,
      'unpaidInterest', 0,
      'unallocatedBalance', 0
    );
  else
    v_meta := v_meta || jsonb_build_object(
      'unpaidCapital',
      greatest(0, round(
        coalesce((v_meta->>'unpaidCapital')::numeric, v_bal, 0) - v_cap
      , 2)),
      'unpaidSurcharges',
      greatest(0, round(v_stock - least(v_stock, v_sur), 2))
    );
  end if;

  update public.members
  set meta = v_meta,
      updated_at = now()
  where id = new.member_id;

  return new;
end;
$function$;

drop trigger if exists trg_sync_lila_parts_after_imputations on public.dues_imputations;
create trigger trg_sync_lila_parts_after_imputations
  after insert on public.dues_imputations
  for each row
  execute function public.sync_lila_parts_after_imputations();

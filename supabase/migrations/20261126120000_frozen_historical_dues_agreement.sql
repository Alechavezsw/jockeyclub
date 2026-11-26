-- Acuerdo de deuda histórica congelada.
-- No crea deuda, no toca pagos y no cambia la regla general de recargo.
-- Marcha atrás: supabase/migrations rollback al final de este archivo (comentario).
--   1. Restaurar registrar_cobro y cobro_assert_due_ons_collectable desde la migración anterior.
--   2. drop view public.member_dues_frozen_agreement_balances;
--   3. drop table public.member_dues_frozen_periods;
--   4. drop table public.member_dues_frozen_agreements;
--   5. drop function public.cobro_reject_frozen_manipulation(uuid, text[], jsonb, numeric);
--   6. drop function public.cobro_period_surcharge_open(uuid, date, numeric, numeric, date);
--   7. drop function public.cobro_due_is_frozen(uuid, date);
--   8. drop function public.authorize_frozen_dues_agreement(uuid, jsonb, text);
--   9. drop function public.revoke_frozen_dues_agreement(uuid, text);
--  10. drop function public.can_manage_frozen_dues_agreement();

create table if not exists public.member_dues_frozen_agreements (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  status text not null default 'active' check (status in ('active', 'revoked', 'settled')),
  original_amount numeric(14, 2) not null check (original_amount >= 0),
  no_repricing boolean not null default true,
  no_surcharge boolean not null default true,
  authorized_by uuid,
  authorized_by_label text not null,
  authorized_at timestamptz not null default now(),
  note text not null default '',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text
);

create unique index if not exists member_dues_frozen_agreements_one_active
  on public.member_dues_frozen_agreements (member_id)
  where status = 'active';

create table if not exists public.member_dues_frozen_periods (
  agreement_id uuid not null references public.member_dues_frozen_agreements (id),
  member_id uuid not null references public.members (id),
  due_on date not null,
  capital_authorized numeric(14, 2) not null check (capital_authorized > 0),
  primary key (agreement_id, due_on)
);

create index if not exists member_dues_frozen_periods_member_due
  on public.member_dues_frozen_periods (member_id, due_on);

alter table public.member_dues_frozen_agreements enable row level security;
alter table public.member_dues_frozen_periods enable row level security;

drop policy if exists frozen_agreements_select on public.member_dues_frozen_agreements;
create policy frozen_agreements_select
  on public.member_dues_frozen_agreements
  for select
  to authenticated
  using (
    (select public.has_staff_access())
    or member_id in (
      select m.id from public.members m where m.profile_id = (select auth.uid())
    )
  );

drop policy if exists frozen_periods_select on public.member_dues_frozen_periods;
create policy frozen_periods_select
  on public.member_dues_frozen_periods
  for select
  to authenticated
  using (
    (select public.has_staff_access())
    or member_id in (
      select m.id from public.members m where m.profile_id = (select auth.uid())
    )
  );

grant select on public.member_dues_frozen_agreements to authenticated;
grant select on public.member_dues_frozen_periods to authenticated;

create or replace function public.can_manage_frozen_dues_agreement()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('admin', 'superadmin', 'accountant')
    or public.user_has_role('admin')
    or public.user_has_role('superadmin')
    or public.user_has_role('accountant')
    or public.has_capability('dues.liquidate');
$$;

create or replace function public.cobro_due_is_frozen(p_member_id uuid, p_due date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.member_dues_frozen_agreements a
    join public.member_dues_frozen_periods p on p.agreement_id = a.id
    where a.member_id = p_member_id
      and a.status = 'active'
      and a.no_surcharge
      and p.due_on = p_due
  );
$$;

create or replace function public.cobro_period_surcharge_open(
  p_member_id uuid,
  p_due date,
  p_late_base numeric,
  p_capital_open numeric,
  p_today date
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.cobro_due_is_frozen(p_member_id, p_due) then 0
    when p_today > p_due and p_due > date '1900-01-10' then round(
      coalesce(
        nullif(p_late_base, 0),
        case when p_due >= date '2026-10-10' then p_capital_open else 0 end
      ) * 0.10,
      2
    )
    else 0
  end;
$$;

create or replace function public.cobro_reject_frozen_manipulation(
  p_member_id uuid,
  p_seen text[],
  p_periodos jsonb,
  p_importe numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due text;
  v_open numeric;
  v_sched_cap numeric;
  v_sched_sur numeric;
  v_frozen numeric := 0;
  v_normal numeric := 0;
  v_any boolean := false;
begin
  if p_member_id is null or p_seen is null or cardinality(p_seen) = 0 then
    return;
  end if;
  if not exists (
    select 1
    from unnest(p_seen) as due(due)
    where public.cobro_due_is_frozen(p_member_id, due::date)
  ) then
    return;
  end if;

  foreach v_due in array p_seen loop
    select round(coalesce(capital_open, 0), 2)
      into v_open
    from public.member_dues_periods
    where member_id = p_member_id
      and due_on = v_due::date;
    v_open := coalesce(v_open, 0);

    select round(coalesce(sum(round(coalesce(nullif(s.value->>'capital', '')::numeric, 0), 2)), 0), 2),
           round(coalesce(sum(round(coalesce(nullif(s.value->>'surcharge', '')::numeric, 0), 2)), 0), 2)
      into v_sched_cap, v_sched_sur
    from jsonb_array_elements(coalesce(p_periodos->'schedule', '[]'::jsonb)) s
    where left(coalesce(s.value->>'dueOn', ''), 10) = v_due;

    if public.cobro_due_is_frozen(p_member_id, v_due::date) then
      v_any := true;
      if coalesce(v_sched_sur, 0) > 0.01 then
        raise exception 'El período % del acuerdo histórico no admite recargo.', v_due;
      end if;
      if coalesce(v_sched_cap, 0) > v_open + 0.01 then
        raise exception
          'El capital pedido (%) supera el importe autorizado (%) del acuerdo histórico.',
          v_sched_cap, v_open;
      end if;
      v_frozen := round(
        v_frozen + case
          when coalesce(v_sched_cap, 0) > 0.01 then least(v_sched_cap, v_open)
          else v_open
        end,
        2
      );
    else
      v_normal := round(v_normal + case
        when coalesce(v_sched_cap, 0) > 0.01 then v_sched_cap
        else v_open
      end, 2);
    end if;
  end loop;

  if v_any
     and v_normal <= 0.01
     and coalesce(nullif(p_periodos->>'surcharge', '')::numeric, 0) > 0.01 then
    raise exception 'El acuerdo histórico no admite recargo.';
  end if;

  if v_any and p_importe is not null
     and round(p_importe, 2) > round(v_normal * 1.10 + v_frozen, 2) + 0.01 then
    raise exception
      'El importe supera el capital autorizado. Los períodos del acuerdo histórico no llevan recargo ni actualización.';
  end if;
end;
$$;

create or replace view public.member_dues_frozen_agreement_balances
with (security_invoker = true) as
select
  a.id,
  a.member_id,
  a.status,
  a.original_amount,
  a.no_repricing,
  a.no_surcharge,
  a.authorized_by,
  a.authorized_by_label,
  a.authorized_at,
  a.note,
  coalesce(periods.remaining_amount, 0) as remaining_amount,
  greatest(0, round(a.original_amount - coalesce(periods.remaining_amount, 0), 2)) as paid_amount,
  coalesce(periods.periods, '[]'::jsonb) as periods
from public.member_dues_frozen_agreements a
left join lateral (
  select
    round(coalesce(sum(coalesce(dp.capital_open, 0)), 0), 2) as remaining_amount,
    coalesce(jsonb_agg(jsonb_build_object(
      'dueOn', to_char(p.due_on, 'YYYY-MM-DD'),
      'capitalAuthorized', p.capital_authorized,
      'capitalOpen', coalesce(dp.capital_open, 0)
    ) order by p.due_on), '[]'::jsonb) as periods
  from public.member_dues_frozen_periods p
  left join public.member_dues_periods dp
    on dp.member_id = p.member_id
   and dp.due_on = p.due_on
  where p.agreement_id = a.id
) periods on true;

grant select on public.member_dues_frozen_agreement_balances to authenticated;

create or replace function public.authorize_frozen_dues_agreement(
  p_member_id uuid,
  p_periods jsonb,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_due date;
  v_open numeric;
  v_sum numeric := 0;
  v_count int := 0;
begin
  if auth.uid() is null or not public.can_manage_frozen_dues_agreement() then
    raise exception 'No autorizado para crear o modificar un acuerdo de deuda histórica.';
  end if;
  if p_member_id is null or jsonb_typeof(p_periods) is distinct from 'array' or jsonb_array_length(p_periods) = 0 then
    raise exception 'El acuerdo necesita socio y períodos.';
  end if;
  if exists (
    select 1 from public.member_dues_frozen_agreements
    where member_id = p_member_id and status = 'active'
  ) then
    raise exception 'Ese socio ya tiene un acuerdo de deuda histórica activo.';
  end if;

  for v_item in select value from jsonb_array_elements(p_periods) loop
    v_due := left(coalesce(v_item->>'dueOn', ''), 10)::date;
    select round(coalesce(capital_open, 0), 2)
      into v_open
    from public.member_dues_periods
    where member_id = p_member_id and due_on = v_due;
    if not found or coalesce(v_open, 0) <= 0.01 then
      raise exception 'El período % no tiene capital abierto. El acuerdo no crea deuda.', v_due;
    end if;
    if abs(coalesce(nullif(v_item->>'capital', '')::numeric, v_open) - v_open) > 0.01 then
      raise exception 'El capital informado de % no coincide con el abierto en la base.', v_due;
    end if;
    v_sum := round(v_sum + v_open, 2);
    v_count := v_count + 1;
  end loop;

  insert into public.member_dues_frozen_agreements (
    member_id, status, original_amount, no_repricing, no_surcharge,
    authorized_by, authorized_by_label, authorized_at, note
  ) values (
    p_member_id, 'active', v_sum, true, true,
    auth.uid(),
    'Administración',
    now(),
    coalesce(p_note, '')
  ) returning id into v_id;

  insert into public.member_dues_frozen_periods (agreement_id, member_id, due_on, capital_authorized)
  select v_id, p_member_id, left(coalesce(value->>'dueOn', ''), 10)::date, round(coalesce(dp.capital_open, 0), 2)
  from jsonb_array_elements(p_periods) as items(value)
  join public.member_dues_periods dp
    on dp.member_id = p_member_id
   and dp.due_on = left(coalesce(value->>'dueOn', ''), 10)::date;

  if (select count(*) from public.member_dues_frozen_periods where agreement_id = v_id) <> v_count then
    raise exception 'No se pudieron registrar los períodos del acuerdo.';
  end if;
  return v_id;
end;
$$;

create or replace function public.revoke_frozen_dues_agreement(
  p_agreement_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_manage_frozen_dues_agreement() then
    raise exception 'No autorizado para crear o modificar un acuerdo de deuda histórica.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Falta el motivo para dejar sin efecto el acuerdo (mínimo 8 caracteres).';
  end if;
  update public.member_dues_frozen_agreements
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = auth.uid(),
      revoke_reason = btrim(p_reason)
  where id = p_agreement_id
    and status = 'active';
  if not found then
    raise exception 'No hay un acuerdo activo con ese identificador.';
  end if;
end;
$$;

grant execute on function public.can_manage_frozen_dues_agreement() to authenticated;
grant execute on function public.authorize_frozen_dues_agreement(uuid, jsonb, text) to authenticated;
grant execute on function public.revoke_frozen_dues_agreement(uuid, text) to authenticated;

-- Congela la deuda ya abierta de Maximiliano Usin. No inserta capital nuevo.
do $$
declare
  v_member uuid := '71228a4a-c3b2-4aef-88ee-3ef19055e117';
  v_sum numeric;
  v_count int;
  v_id uuid;
begin
  if exists (
    select 1 from public.member_dues_frozen_agreements
    where member_id = v_member and status = 'active'
  ) then
    return;
  end if;
  select round(coalesce(sum(capital_open), 0), 2), count(*)::int
    into v_sum, v_count
  from public.member_dues_periods
  where member_id = v_member
    and capital_open > 0.01
    and due_on > date '1900-01-10';
  if v_sum is distinct from 1071000 or v_count is distinct from 22 then
    raise exception
      'No se congela la deuda de 9685: capital % en % períodos (se esperaba 1071000 en 22).',
      v_sum, v_count;
  end if;
  insert into public.member_dues_frozen_agreements (
    member_id, status, original_amount, no_repricing, no_surcharge,
    authorized_by_label, authorized_at, note
  ) values (
    v_member,
    'active',
    1071000,
    true,
    true,
    'Administración',
    timestamptz '2026-11-26 15:00:00-03',
    'Deuda histórica con importe congelado. La autorización previa está en members.meta.adminHistoricalAgreement9685. Sin actualización y sin recargo entre 2025-01 y 2026-10. No agrega períodos ni cobra de más.'
  ) returning id into v_id;
  insert into public.member_dues_frozen_periods (agreement_id, member_id, due_on, capital_authorized)
  select v_id, member_id, due_on, round(capital_open, 2)
  from public.member_dues_periods
  where member_id = v_member
    and capital_open > 0.01
    and due_on > date '1900-01-10';
end;
$$;

-- El cobro deja de sumar 10 % en los períodos congelados y rechaza un importe inflado.
do $$
declare
  v_sql text;
  v_before text;
begin
  select pg_get_functiondef('public.registrar_cobro(uuid, numeric, jsonb, text)'::regprocedure)
    into v_sql;
  v_before := v_sql;
  if strpos(v_sql, 'cobro_period_surcharge_open') = 0 then
    v_sql := replace(
      v_sql,
      'then round(coalesce(nullif(late_base, 0), case when due_on >= date ''2026-10-10'' then capital_open else 0 end) * 0.10, 2)',
      'then public.cobro_period_surcharge_open(member_id, due_on, late_base, capital_open, v_today)'
    );
    v_sql := replace(
      v_sql,
      'then round(coalesce(nullif(v_period.late_base, 0), case when v_period.due_on >= date ''2026-10-10'' then v_period.capital_open else 0 end) * 0.10, 2)',
      'then public.cobro_period_surcharge_open(p_member_id, v_period.due_on, v_period.late_base, v_period.capital_open, v_today)'
    );
    v_sql := replace(
      v_sql,
      'and due_on < v_today',
      'and due_on < v_today and not public.cobro_due_is_frozen(p_member_id, due_on)'
    );
    if (length(v_sql) - length(replace(v_sql, 'cobro_period_surcharge_open', '')))
         / length('cobro_period_surcharge_open') < 2
       or strpos(v_sql, 'cobro_due_is_frozen(p_member_id, due_on)') = 0 then
      raise exception 'No se pudo actualizar registrar_cobro para el acuerdo histórico.';
    end if;
    execute v_sql;
  end if;

  select pg_get_functiondef('public.cobro_assert_due_ons_collectable(uuid, jsonb, jsonb, numeric)'::regprocedure)
    into v_sql;
  v_before := v_sql;
  if strpos(v_sql, 'cobro_reject_frozen_manipulation') = 0 then
    v_sql := replace(
      v_sql,
      '  -- Tope de importe: no cobrar más que el capital exigible (+10 % mora máx.).',
      '  perform public.cobro_reject_frozen_manipulation(p_member_id, v_seen, p_periodos, p_importe);' || chr(10) ||
      '  -- Tope de importe: no cobrar más que el capital exigible (+10 % mora máx.).'
    );
    if v_sql = v_before then
      raise exception 'No se pudo actualizar la validación de períodos cobrables.';
    end if;
    execute v_sql;
  end if;
end;
$$;

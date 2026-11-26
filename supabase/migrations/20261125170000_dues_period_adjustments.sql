-- Ajuste administrativo por período (Cobrar cuota).
--
-- Un administrador corrige qué mes debe un socio y cuánto capital debe ese mes.
-- Cada corrección es un registro auditado por período: quién, cuándo, antes, después y motivo.
--
-- Regla maestra:
--   - No toca members.outstanding_balance (el saldo de la ficha es el control).
--   - Un ajuste siempre tiene mes. No hay ajustes sin período.
--   - No se crea un mes que todavía no empezó.
--   - Un mes pago o regularizado no se vuelve a abrir.
--   - El recargo del 10 % no se ajusta acá: lo sigue calculando la regla de cada mes.
--
-- El ajuste deja el capital abierto del mes en member_dues_periods, que es lo que
-- registrar_cobro / registrar_cobro_pos validan. Así el cobro, la imputación, la caja
-- y el asiento salen con el importe corregido. El recibo lleva el ajuste en
-- member_payments.meta.periodAdjustments (lo escribe un trigger, no el navegador).

create table if not exists public.dues_period_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  member_number text,
  due_on date not null check (due_on > date '1900-01-10'),
  action text not null check (action in ('set', 'remove')),
  capital numeric(14, 2) check (capital is null or capital >= 0),
  previous_capital_open numeric(14, 2),
  previous_row_existed boolean not null default false,
  reason text not null check (length(btrim(reason)) >= 8),
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  voided_by_name text,
  void_reason text,
  applied_payment_ids uuid[] not null default '{}'::uuid[],
  constraint dues_period_adjustments_set_has_capital
    check (action <> 'set' or coalesce(capital, 0) > 0)
);

comment on table public.dues_period_adjustments is
  'Corrección administrativa de un mes de cuota social (capital exigible o mes no adeudado). Auditada. No modifica el saldo de la ficha.';

create unique index if not exists dues_period_adjustments_active_uidx
  on public.dues_period_adjustments (member_id, due_on)
  where voided_at is null;

create index if not exists dues_period_adjustments_member_idx
  on public.dues_period_adjustments (member_number, due_on);

alter table public.dues_period_adjustments enable row level security;

drop policy if exists dues_period_adjustments_select on public.dues_period_adjustments;
create policy dues_period_adjustments_select on public.dues_period_adjustments
  for select
  using ((select public.has_staff_access()));

revoke all on table public.dues_period_adjustments from public, anon;
grant select on table public.dues_period_adjustments to authenticated;
grant all on table public.dues_period_adjustments to service_role;

-- Solo administrador / superadministrador (no empleado de administración).
create or replace function public.dues_adjustment_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role()::text in ('admin', 'superadmin'), false)
    or coalesce(public.user_has_role('admin'), false)
    or coalesce(public.user_has_role('superadmin'), false);
$$;

revoke all on function public.dues_adjustment_is_admin() from public, anon;
grant execute on function public.dues_adjustment_is_admin() to authenticated, service_role;

create or replace function public.dues_adjustment_actor_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = auth.uid()),
    (select nullif(btrim(p.email), '') from public.profiles p where p.id = auth.uid()),
    'Administrador'
  );
$$;

revoke all on function public.dues_adjustment_actor_name() from public, anon, authenticated;
grant execute on function public.dues_adjustment_actor_name() to service_role;

-- Corrige un mes: 'set' = debe ese capital; 'remove' = ese mes no se debe.
create or replace function public.ajustar_cuota_periodo(
  p_member_id uuid,
  p_due_on date,
  p_action text,
  p_capital numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_due date;
  v_today date := public.club_today();
  v_member record;
  v_open numeric;
  v_capital numeric;
  v_existed boolean;
  v_imputed numeric := 0;
  v_paid_evidence boolean := false;
  v_row public.dues_period_adjustments;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.dues_adjustment_is_admin() then
    raise exception 'Solo un administrador puede corregir la cuota.';
  end if;
  if p_member_id is null or p_due_on is null then
    raise exception 'Falta el socio o el mes.';
  end if;
  if v_action not in ('set', 'remove') then
    raise exception 'Acción de ajuste inválida.';
  end if;
  if length(v_reason) < 8 then
    raise exception 'Escribí el motivo del ajuste (mínimo 8 caracteres).';
  end if;

  -- El período se identifica por su mes; vence el día 10.
  v_due := make_date(extract(year from p_due_on)::int, extract(month from p_due_on)::int, 10);
  if date_trunc('month', v_due) > date_trunc('month', v_today) then
    raise exception 'No se crea una cuota de un mes que no empezó.';
  end if;

  select id, member_number, coalesce(tier::text, '') as tier
    into v_member
  from public.members
  where id = p_member_id;
  if not found then
    raise exception 'No se encontró el socio.';
  end if;

  if v_action = 'set' then
    v_capital := round(coalesce(p_capital, 0), 2);
    if v_capital <= 0.009 then
      raise exception 'El capital del mes tiene que ser mayor que cero.';
    end if;
    if v_capital > 10000000 then
      raise exception 'El capital del mes es demasiado alto.';
    end if;
  else
    v_capital := null;
  end if;

  select capital_open
    into v_open
  from public.member_dues_periods
  where member_id = p_member_id and due_on = v_due
  for update;
  v_existed := found;

  select coalesce(sum(coalesce(i.capital, 0)), 0)
    into v_imputed
  from public.dues_imputations i
  join public.member_payments p on p.id = i.payment_id
  where i.member_id = p_member_id
    and i.due_on = v_due
    and i.voided_at is null
    and coalesce(p.meta->>'status', 'paid') not in ('void', 'cancelled');

  select exists (
    select 1
    from public.member_payments p
    where p.member_id = p_member_id
      and coalesce(p.meta->>'status', 'paid') not in ('void', 'cancelled')
      and (
        p.meta->'periodDueOns' @> to_jsonb(array[to_char(v_due, 'YYYY-MM-DD')])
      )
  ) into v_paid_evidence;
  v_paid_evidence := v_paid_evidence or v_imputed > 0.009;

  -- Un mes pago o regularizado no se vuelve a abrir.
  if v_action = 'set' and v_paid_evidence and coalesce(v_open, 0) <= 0.009 then
    raise exception 'Ese mes ya está pago y no se vuelve a abrir.';
  end if;

  -- El ajuste anterior del mismo mes queda reemplazado (no se borra).
  v_name := public.dues_adjustment_actor_name();
  update public.dues_period_adjustments
  set voided_at = now(),
      voided_by = auth.uid(),
      voided_by_name = v_name,
      void_reason = 'Reemplazado por un ajuste nuevo'
  where member_id = p_member_id
    and due_on = v_due
    and voided_at is null;

  insert into public.dues_period_adjustments (
    member_id, member_number, due_on, action, capital,
    previous_capital_open, previous_row_existed, reason,
    created_by, created_by_name
  ) values (
    p_member_id, v_member.member_number, v_due, v_action, v_capital,
    case when v_existed then round(coalesce(v_open, 0), 2) else null end,
    v_existed, v_reason,
    auth.uid(), v_name
  )
  returning * into v_row;

  if v_action = 'set' then
    if v_existed then
      update public.member_dues_periods
      set capital_open = v_capital,
          capital = round(greatest(capital, v_imputed + v_capital), 2),
          late_base = v_capital
      where member_id = p_member_id and due_on = v_due;
    else
      insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
      values (p_member_id, v_due, round(v_imputed + v_capital, 2), v_capital, v_capital);
    end if;
  elsif v_existed then
    update public.member_dues_periods
    set capital_open = 0,
        late_base = 0
    where member_id = p_member_id and due_on = v_due;
  end if;

  begin
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'dues_period_adjust',
      'members',
      p_member_id,
      jsonb_build_object(
        'adjustmentId', v_row.id,
        'memberNumber', v_member.member_number,
        'dueOn', to_char(v_due, 'YYYY-MM-DD'),
        'action', v_action,
        'capital', v_capital,
        'previousCapitalOpen', v_row.previous_capital_open,
        'reason', v_reason,
        'by', v_name
      )
    );
  exception when others then
    null; -- el registro propio ya guarda la auditoría
  end;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.ajustar_cuota_periodo(uuid, date, text, numeric, text) from public, anon;
grant execute on function public.ajustar_cuota_periodo(uuid, date, text, numeric, text) to authenticated, service_role;

-- Anula un ajuste: el mes vuelve al capital abierto que tenía antes.
create or replace function public.anular_ajuste_cuota_periodo(
  p_adjustment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.dues_period_adjustments;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.dues_adjustment_is_admin() then
    raise exception 'Solo un administrador puede anular un ajuste de cuota.';
  end if;
  if length(v_reason) < 8 then
    raise exception 'Escribí el motivo de la anulación (mínimo 8 caracteres).';
  end if;

  select * into v_row
  from public.dues_period_adjustments
  where id = p_adjustment_id
  for update;
  if not found then
    raise exception 'No se encontró el ajuste.';
  end if;
  if v_row.voided_at is not null then
    raise exception 'Ese ajuste ya está anulado.';
  end if;
  if cardinality(v_row.applied_payment_ids) > 0 then
    raise exception 'Ese ajuste ya se cobró. Anulá el cobro primero.';
  end if;

  v_name := public.dues_adjustment_actor_name();
  update public.dues_period_adjustments
  set voided_at = now(),
      voided_by = auth.uid(),
      voided_by_name = v_name,
      void_reason = v_reason
  where id = v_row.id
  returning * into v_row;

  if v_row.previous_row_existed then
    update public.member_dues_periods
    set capital_open = coalesce(v_row.previous_capital_open, 0),
        late_base = coalesce(v_row.previous_capital_open, 0)
    where member_id = v_row.member_id and due_on = v_row.due_on;
  else
    delete from public.member_dues_periods
    where member_id = v_row.member_id
      and due_on = v_row.due_on
      and not exists (
        select 1 from public.dues_imputations i
        where i.member_id = v_row.member_id and i.due_on = v_row.due_on and i.voided_at is null
      );
  end if;

  begin
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'dues_period_adjust_void',
      'members',
      v_row.member_id,
      jsonb_build_object(
        'adjustmentId', v_row.id,
        'dueOn', to_char(v_row.due_on, 'YYYY-MM-DD'),
        'reason', v_reason,
        'by', v_name
      )
    );
  exception when others then
    null;
  end;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.anular_ajuste_cuota_periodo(uuid, text) from public, anon;
grant execute on function public.anular_ajuste_cuota_periodo(uuid, text) to authenticated, service_role;

-- El cobro lleva el ajuste: meta.periodAdjustments en el recibo.
-- Lo escribe el servidor para cualquier camino (caja, POS, Mercado Pago).
create or replace function public.member_payment_attach_period_adjustments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dues text[];
  v_list jsonb;
begin
  if new.meta is null or jsonb_typeof(new.meta->'periodDueOns') is distinct from 'array' then
    return new;
  end if;
  if coalesce(new.meta->>'status', 'paid') in ('void', 'cancelled') then
    return new;
  end if;

  select coalesce(array_agg(distinct left(coalesce(e->>'dueOn', trim(both '"' from e::text)), 7)), '{}')
    into v_dues
  from jsonb_array_elements(new.meta->'periodDueOns') e;

  if cardinality(v_dues) = 0 then
    return new;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'dueOn', to_char(a.due_on, 'YYYY-MM-DD'),
      'action', a.action,
      'capital', a.capital,
      'previousCapitalOpen', a.previous_capital_open,
      'reason', a.reason,
      'by', a.created_by_name,
      'byId', a.created_by,
      'at', a.created_at
    ) order by a.due_on), '[]'::jsonb)
    into v_list
  from public.dues_period_adjustments a
  where a.member_id = new.member_id
    and a.voided_at is null
    and a.action = 'set'
    and to_char(a.due_on, 'YYYY-MM') = any (v_dues);

  if jsonb_array_length(v_list) > 0 then
    new.meta := new.meta || jsonb_build_object('periodAdjustments', v_list);
  elsif new.meta ? 'periodAdjustments' and tg_op = 'INSERT' then
    -- El navegador no puede inventar un ajuste.
    new.meta := new.meta - 'periodAdjustments';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_member_payment_attach_period_adjustments on public.member_payments;
create trigger trg_member_payment_attach_period_adjustments
before insert or update of meta on public.member_payments
for each row execute function public.member_payment_attach_period_adjustments();

create or replace function public.member_payment_mark_period_adjustments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.meta is null or jsonb_typeof(new.meta->'periodAdjustments') is distinct from 'array' then
    return new;
  end if;
  update public.dues_period_adjustments a
  set applied_payment_ids = array_append(a.applied_payment_ids, new.id)
  where a.id in (
      select (e->>'id')::uuid
      from jsonb_array_elements(new.meta->'periodAdjustments') e
      where (e->>'id') ~ '^[0-9a-f-]{36}$'
    )
    and not (new.id = any (a.applied_payment_ids));
  return new;
end;
$$;

drop trigger if exists trg_member_payment_mark_period_adjustments on public.member_payments;
create trigger trg_member_payment_mark_period_adjustments
after insert or update of meta on public.member_payments
for each row execute function public.member_payment_mark_period_adjustments();

revoke all on function public.member_payment_attach_period_adjustments() from public, anon, authenticated;
revoke all on function public.member_payment_mark_period_adjustments() from public, anon, authenticated;

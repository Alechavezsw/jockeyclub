-- Guarda cuándo se anuló la reserva (meta.cancelledAt) al cancelar socio o club.

create or replace function public.cancelar_reserva(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reservations%rowtype;
  v_old_status text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if p_id is null then
    raise exception 'Reserva inválida.';
  end if;

  select * into v_row
  from public.reservations
  where id = p_id
  for update;

  if not found then
    raise exception 'No se encontró la reserva.';
  end if;

  if not exists (
    select 1
    from public.members m
    where m.profile_id = auth.uid()
      and (m.id = v_row.member_id or m.member_number::text = v_row.member_number)
  ) then
    raise exception 'Solo podés cancelar tu propia reserva.';
  end if;

  v_old_status := v_row.status;
  if v_old_status is distinct from 'cancelled' then
    update public.reservations
    set
      status = 'cancelled',
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('cancelledAt', to_jsonb(v_now))
    where id = p_id
    returning * into v_row;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'cancelar_reserva',
      'reservations',
      v_row.id,
      jsonb_build_object(
        'old', jsonb_build_object('status', v_old_status),
        'new', jsonb_build_object('status', 'cancelled', 'cancelledAt', v_now),
        'actor_id', auth.uid()
      )
    );
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.anular_reserva_club(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reservations%rowtype;
  v_old_status text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_staff_access() then
    raise exception 'Solo el personal puede anular reservas del club.';
  end if;
  if p_id is null then
    raise exception 'Reserva inválida.';
  end if;

  select * into v_row
  from public.reservations
  where id = p_id
  for update;

  if not found then
    raise exception 'No se encontró la reserva.';
  end if;

  v_old_status := v_row.status;
  if v_old_status is distinct from 'cancelled' then
    update public.reservations
    set
      status = 'cancelled',
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('cancelledAt', to_jsonb(v_now))
    where id = p_id
    returning * into v_row;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'anular_reserva_club',
      'reservations',
      v_row.id,
      jsonb_build_object(
        'old', jsonb_build_object('status', v_old_status),
        'new', jsonb_build_object('status', 'cancelled', 'cancelledAt', v_now),
        'actor_id', auth.uid()
      )
    );
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.cancelar_reserva(uuid) from public, anon;
grant execute on function public.cancelar_reserva(uuid) to authenticated;
revoke all on function public.anular_reserva_club(uuid) from public, anon;
grant execute on function public.anular_reserva_club(uuid) to authenticated;

-- Backfill: reservas ya canceladas sin cancelledAt usan updated_at.
update public.reservations
set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('cancelledAt', to_jsonb(updated_at))
where status = 'cancelled'
  and (meta->>'cancelledAt') is null;

-- El socio no reescribe su reserva. Solo puede cancelarla, y eso lo hace la RPC.
-- Fecha, cancha, horario y estado los cambia el personal.

drop policy if exists reservations_update on public.reservations;
create policy reservations_update on public.reservations
  for update
  using (public.has_staff_access())
  with check (public.has_staff_access());

create or replace function public.cancelar_reserva(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reservations%rowtype;
  v_old_status text;
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
    set status = 'cancelled'
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
        'new', jsonb_build_object('status', 'cancelled'),
        'actor_id', auth.uid()
      )
    );
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.cancelar_reserva(uuid) from public, anon;
grant execute on function public.cancelar_reserva(uuid) to authenticated;

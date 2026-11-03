-- Un turno activo es uno solo por espacio, día y hora.
-- Los turnos anteriores al 3/11/2026 quedan afuera: el padrón de Lila
-- tiene el mismo horario (sobre todo 11:00) en varios socios distintos.
-- Cancelar esas filas borraría historia. Desde hoy, el índice impide el doble.

create unique index if not exists reservations_active_slot_uidx
  on public.reservations (facility_id, reservation_date, time_slot)
  where status <> 'cancelled'
    and reservation_date >= date '2026-11-03';

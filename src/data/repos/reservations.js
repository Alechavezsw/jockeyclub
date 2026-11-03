import * as M from '../mappers';
import { unwrap, reservationSlotTakenMessage, DbError } from '../errors';
import { sb, audit } from './shared.js';

// ---- Reservations ----
export async function listReservations({ limit, memberNumber, fromDate } = {}) {
  let q = sb().from('reservations').select('*').order('reservation_date', { ascending: false });
  if (memberNumber) q = q.eq('member_number', String(memberNumber));
  if (fromDate) q = q.gte('reservation_date', fromDate);
  if (limit && Number(limit) > 0) q = q.limit(Number(limit));
  const rows = await unwrap(q, 'No se pudieron cargar reservas');
  return (rows || []).map(M.reservationFromRow);
}

/** Turnos ocupados sin nombre de socio (para el portal). */
export async function listReservationOccupancy({ limit, fromDate } = {}) {
  let q = sb()
    .from('reservation_occupancy')
    .select('id, facility_id, reservation_date, time_slot, status, guests, created_at')
    .order('reservation_date', { ascending: false });
  if (fromDate) q = q.gte('reservation_date', fromDate);
  if (limit && Number(limit) > 0) q = q.limit(Number(limit));
  const rows = await unwrap(q, 'No se pudo cargar la ocupación de canchas');
  return (rows || []).map(M.reservationOccupancyFromRow);
}

function rethrowReservation(err) {
  const taken = reservationSlotTakenMessage(err?.cause) || reservationSlotTakenMessage(err);
  if (taken) throw new DbError(taken, err);
  throw err;
}

export async function createReservation(res, memberDbId) {
  let saved;
  try {
    saved = await unwrap(
      sb().from('reservations').insert(M.reservationToRow(res, memberDbId)).select().single(),
      'No se pudo crear reserva'
    );
  } catch (err) {
    rethrowReservation(err);
  }
  await audit('create', 'reservations', saved.id);
  return M.reservationFromRow(saved);
}

/** El socio solo cancela. La base no le deja cambiar fecha, cancha ni estado. */
export async function cancelOwnReservation(id) {
  const data = await unwrap(
    sb().rpc('cancelar_reserva', { p_id: id }),
    'No se pudo cancelar la reserva',
  );
  if (!data?.id) throw new Error('No se pudo cancelar la reserva');
  return M.reservationFromRow(data);
}

export async function updateReservation(id, patch) {
  const row = {};
  if (patch.status != null) row.status = patch.status;
  if (patch.date != null) row.reservation_date = patch.date;
  if (patch.time != null) row.time_slot = patch.time;
  if (patch.guests != null) row.guests = patch.guests;
  if (patch.notes != null) row.notes = patch.notes;
  const metaFields = [
    'guestNames', 'facilityName', 'endTime', 'estimatedPrice', 'chargedPrice',
    'paymentMethod', 'imputed', 'feeImputed', 'imputedAt', 'imputationEntryId',
    'accountEntry', 'balanceBefore',
  ];
  const touchesMeta = Boolean(patch.meta) || metaFields.some((key) => patch[key] !== undefined);
  if (touchesMeta) {
    const current = await unwrap(
      sb().from('reservations').select('meta').eq('id', id).single(),
      'No se pudo leer la reserva'
    );
    const nextMeta = { ...(current?.meta || {}), ...(patch.meta || {}) };
    for (const key of metaFields) {
      if (patch[key] !== undefined) nextMeta[key] = patch[key];
    }
    row.meta = nextMeta;
  }
  let saved;
  try {
    saved = await unwrap(
      sb().from('reservations').update(row).eq('id', id).select().single(),
      'No se pudo actualizar reserva'
    );
  } catch (err) {
    rethrowReservation(err);
  }
  return M.reservationFromRow(saved);
}

export async function listWaitlist() {
  const rows = await unwrap(
    sb().from('reservation_waitlist').select('*').order('created_at'),
    'No se pudo cargar lista de espera'
  );
  return (rows || []).map(M.waitlistFromRow);
}

export async function upsertWaitlistEntry(entry, memberDbId) {
  const row = {
    facility_id: entry.facilityId,
    member_id: memberDbId || entry.memberDbId || null,
    member_number: entry.memberId,
    member_name: entry.memberName,
    desired_date: entry.date,
    time_slot: entry.time || null,
    status: entry.status || 'waiting',
    notified_at: entry.notifiedAt || null,
    meta: { facilityName: entry.facilityName || '' },
  };
  if (entry.id && String(entry.id).includes('-')) {
    const saved = await unwrap(
      sb().from('reservation_waitlist').update(row).eq('id', entry.id).select().single()
    );
    return M.waitlistFromRow(saved);
  }
  const saved = await unwrap(
    sb().from('reservation_waitlist').insert(row).select().single(),
    'No se pudo agregar a lista de espera'
  );
  return M.waitlistFromRow(saved);
}

export async function replaceWaitlist(entries, memberLookup) {
  await sb().from('reservation_waitlist').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (!entries?.length) return [];
  const rows = entries.map((e) => ({
    facility_id: e.facilityId,
    member_id: memberLookup?.[e.memberId] || e.memberDbId || null,
    member_number: e.memberId,
    member_name: e.memberName,
    desired_date: e.date,
    time_slot: e.time || null,
    status: e.status || 'waiting',
    notified_at: e.notifiedAt || null,
    meta: { facilityName: e.facilityName || '' },
  }));
  const saved = await unwrap(sb().from('reservation_waitlist').insert(rows).select());
  return (saved || []).map(M.waitlistFromRow);
}

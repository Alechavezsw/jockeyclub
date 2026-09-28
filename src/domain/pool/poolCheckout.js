export const POOL_MP_PENDING = 'Mercado Pago se cobra cuando esté la app. Hasta entonces el canon entra en efectivo, en la caja.';

/**
 * El canon en efectivo entra en la caja abierta y en el libro.
 * La asistencia no cobra. Mercado Pago queda para la app.
 */
export async function chargePoolCanon({ entry, member, recordPoolCanon }) {
  const amount = Number(entry?.payment?.amount) || 0;
  const method = entry?.payment?.method || 'efectivo';
  const memberDbId = member?.id || entry?.memberDbId || null;
  if (amount <= 0 || method === 'asistencia') {
    return { ...entry, memberDbId };
  }
  if (method === 'mercadopago') {
    throw new Error(POOL_MP_PENDING);
  }
  if (method !== 'efectivo') {
    throw new Error('Cobrá el canon en efectivo para que entre en la caja.');
  }
  if (typeof recordPoolCanon !== 'function') {
    throw new Error('Abrí la Caja General para cobrar el canon de pileta.');
  }
  const who = entry.kind === 'guest'
    ? `${entry.guestName || 'invitado'} (anfitrión ${member?.name || entry.memberName || 'socio'})`
    : (member?.name || entry.memberName || 'socio');
  const saved = await recordPoolCanon({
    amount,
    concept: `Canon pileta — ${who}`,
    memberDbId,
    date: entry.date,
  });
  return {
    ...entry,
    memberDbId,
    journalEntryId: saved?.journalEntry?.id || null,
    cashMovementId: saved?.movement?.id || null,
  };
}

export function withChargedPoolEntry(accesses, entry, charged) {
  return [charged, ...(accesses || []).filter((row) => row !== entry && row.id !== entry.id)];
}

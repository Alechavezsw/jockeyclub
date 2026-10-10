export const POOL_MP_PENDING = 'El canon de Mercado Pago se acredita cuando confirma el pago.';

/**
 * El canon en efectivo entra en la caja abierta y en el libro.
 * La asistencia no cobra. Mercado Pago lo acredita el webhook.
 */
export async function chargePoolCanon({ entry, member, recordPoolCanon }) {
  const amount = Number(entry?.payment?.amount) || 0;
  const method = entry?.payment?.method || 'efectivo';
  const memberDbId = member?.id || entry?.memberDbId || null;
  if (amount <= 0 || method === 'asistencia') {
    return { ...entry, memberDbId };
  }
  if (method === 'mercadopago') {
    if (entry?.journalEntryId) return { ...entry, memberDbId };
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

import { createAccountEntry } from '../accounting/accountEntries';
import { applyEntryToMembers } from '../accounting/memberBalances';
import { todayAR } from '../../lib/arDate';


export const POOL_MP_PENDING = 'El canon de Mercado Pago se acredita cuando confirma el pago.';

/**
 * Canon cobrado en caja: cargo + pago en la cuenta del socio (neto 0).
 * No mezcla con deuda de cuota: el saldo no cambia; el extracto sí registra pileta.
 */
export function buildPoolAccountEntries({ entry, member } = {}) {
  const amount = Number(entry?.payment?.amount) || 0;
  const method = entry?.payment?.method || 'efectivo';
  if (amount <= 0 || method === 'asistencia' || method === 'mercadopago') return [];

  const memberNumber = String(entry?.memberId || member?.memberId || '').replace(/\D/g, '')
    || String(entry?.memberId || member?.memberId || '');
  if (!memberNumber) return [];

  const date = entry?.date || todayAR();
  const baseId = entry?.id || `pool-${Date.now().toString(36)}`;
  const memberName = member?.name || entry?.memberName || '';
  const description = entry?.kind === 'guest'
    ? `Canon pileta invitado · ${entry.guestName || 'invitado'}`
    : `Canon pileta · ${memberName || 'socio'}`;
  const voucher = String(entry?.cashMovementId || entry?.journalEntryId || entry?.id || '');

  return [
    createAccountEntry({
      id: `${baseId}-cargo`,
      type: 'otro',
      memberNumber,
      memberName,
      value: amount,
      date,
      description,
      source: 'pool_canon',
      voucher,
    }),
    createAccountEntry({
      id: `${baseId}-pago`,
      type: 'pago',
      memberNumber,
      memberName,
      value: amount,
      date,
      description: `Pago ${description}`,
      source: 'pool_canon',
      voucher,
      paymentMethods: [{ method: 'efectivo', amount }],
    }),
  ];
}

/** Anota cargo+pago en extracto y aplica neto 0 al padrón en memoria. */
export function applyPoolAccountPass(members = [], accountEntries = []) {
  const rows = Array.isArray(accountEntries) ? accountEntries : [];
  if (!rows.length) return members || [];
  return rows.reduce((list, row) => applyEntryToMembers(list, row), members || []);
}

/**
 * El canon en efectivo entra en la caja abierta y en el libro,
 * y deja cargo+pago en la cuenta del socio (sin mover la deuda de cuota).
 * La asistencia no cobra. Mercado Pago lo acredita el webhook.
 */
export async function chargePoolCanon({ entry, member, recordPoolCanon }) {
  const amount = Number(entry?.payment?.amount) || 0;
  const method = entry?.payment?.method || 'efectivo';
  const memberDbId = member?.id || entry?.memberDbId || null;
  if (amount <= 0 || method === 'asistencia') {
    return { ...entry, memberDbId, accountEntries: [] };
  }
  if (method === 'mercadopago') {
    if (entry?.journalEntryId) {
      return { ...entry, memberDbId, accountEntries: entry.accountEntries || [] };
    }
    throw new Error(POOL_MP_PENDING);
  }
  if (method !== 'efectivo') {
    throw new Error('Cobrá el canon en efectivo para que entre en la caja.');
  }
  if (typeof recordPoolCanon !== 'function') {
    throw new Error('No se pudo registrar el canon en caja. Reintentá en unos segundos.');
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
  const charged = {
    ...entry,
    memberDbId,
    journalEntryId: saved?.journalEntry?.id || null,
    cashMovementId: saved?.movement?.id || null,
  };
  return {
    ...charged,
    accountEntries: buildPoolAccountEntries({ entry: charged, member }),
  };
}

export function withChargedPoolEntry(accesses, entry, charged) {
  return [charged, ...(accesses || []).filter((row) => row !== entry && row.id !== entry.id)];
}

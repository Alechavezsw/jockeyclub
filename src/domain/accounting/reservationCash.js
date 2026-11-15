/**
 * Cobro de seña / confirmación de reserva → asiento de tesorería (caja o banco).
 * Mercado Pago ya asienta el webhook; cuenta corriente no mueve caja.
 */

import { buildPostedEntry } from './journal.js';
import { DEFAULT_CHART_OF_ACCOUNTS, resolveAccountId } from './chartOfAccounts.js';
import { todayISODateAR } from '../../lib/arDate.js';
import {
  reservationCollectedAmount,
  reservationTotalPrice,
} from '../reservations/bookingRules.js';

const SKIP_METHODS = new Set(['cuenta_corriente', 'cuenta', 'mercadopago', 'mp']);

export function reservationCashMethodKey(method) {
  return String(method || 'efectivo').trim().toLowerCase();
}

/** true si el medio debe asentar en caja/banco al confirmar o cobrar. */
export function reservationCashShouldPost(method) {
  const key = reservationCashMethodKey(method);
  if (!key) return false;
  return !SKIP_METHODS.has(key);
}

/** Caja General (efectivo/tarjeta) o Banco Macro (transferencia). */
export function reservationCashTreasuryAccount(method) {
  const key = reservationCashMethodKey(method);
  if (key === 'transferencia' || key === 'transfer') return 'Banco Macro';
  return 'Caja General';
}

export function reservationCashConcept(reservation, {
  scope = 'deposit',
  confirm = false,
} = {}) {
  const place = String(reservation?.facilityName || reservation?.facilityId || 'instalación').trim();
  const when = String(reservation?.date || '').trim();
  const time = String(reservation?.time || '').trim();
  const who = String(reservation?.memberName || '').trim();
  const slot = [when, time].filter(Boolean).join(' ');
  const head = confirm
    ? (scope === 'total' ? 'Confirmación · Reserva' : 'Confirmación · Seña reserva')
    : (scope === 'total' ? 'Reserva' : scope === 'balance' ? 'Saldo reserva' : 'Seña reserva');
  return [head, place, slot, who].filter(Boolean).join(' · ').slice(0, 240);
}

export function reservationCashAmount(reservation, { amount } = {}) {
  if (amount != null && Number.isFinite(Number(amount)) && Number(amount) > 0) {
    return Math.round(Number(amount));
  }
  // Si el saldo ya tiene asiento, acá solo entra la seña.
  if (reservation?.balanceJournalId) {
    const deposit = Number(reservation?.depositAmount);
    if (Number.isFinite(deposit) && deposit > 0) return Math.round(deposit);
    const charged = Number(reservation?.chargedPrice) || 0;
    const balance = Number(reservation?.balanceAmount) || 0;
    const seña = Math.round(charged - balance);
    if (seña > 0) return seña;
  }
  return reservationCollectedAmount(reservation);
}

export function reservationCashScope(reservation, amount) {
  const total = reservationTotalPrice(null, reservation);
  const collected = Math.round(Number(amount) || 0);
  if (total > 0 && collected + 0.5 >= total) return 'total';
  return 'deposit';
}

/**
 * Asiento posted: Debe caja/banco · Haber Reservas e Instalaciones.
 * null si no corresponde asentar.
 */
export function buildReservationCashJournal({
  reservation,
  amount,
  method,
  scope,
  confirm = false,
  chart = DEFAULT_CHART_OF_ACCOUNTS,
  date,
} = {}) {
  if (!reservation) return null;
  if (!reservationCashShouldPost(method || reservation.paymentMethod)) return null;
  if (reservation?.rentalWaived === true) return null;
  const amt = reservationCashAmount(reservation, { amount });
  if (!(amt > 0)) return null;
  if (reservation.depositJournalId || reservation.cashJournalId) return null;

  const resolvedScope = scope || reservationCashScope(reservation, amt);
  const treasuryName = reservationCashTreasuryAccount(method || reservation.paymentMethod);
  const treasuryId = resolveAccountId(chart, treasuryName) || resolveAccountId(chart, 'Caja General');
  const incomeId = resolveAccountId(chart, 'Reservas e Instalaciones');
  if (!treasuryId || !incomeId) {
    throw new Error('Faltan Caja General / Banco o Reservas e Instalaciones en el plan.');
  }

  const concept = reservationCashConcept(reservation, {
    scope: resolvedScope,
    confirm: confirm || resolvedScope === 'deposit',
  });

  return buildPostedEntry({
    date: date || todayISODateAR(),
    description: concept,
    sourceModule: 'reservas',
    sourceId: reservation.id || null,
    chart,
    lines: [
      { accountId: treasuryId, debit: amt, credit: 0, memo: treasuryName },
      { accountId: incomeId, debit: 0, credit: amt, memo: concept },
    ],
  });
}

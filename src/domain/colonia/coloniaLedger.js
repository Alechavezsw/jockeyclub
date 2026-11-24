/**
 * Submayor Colonia — independiente de members.outstanding_balance y dues.
 */

import { COLONIA_CHARGE_CONCEPTS } from './coloniaConstants';
import { coloniaMethodLabel } from './coloniaConstants';

export function moneyArs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function summarizeColoniaAccount({ charges = [], payments = [] } = {}) {
  const charged = moneyArs(
    (charges || [])
      .filter((c) => String(c.status || 'posted') !== 'void')
      .reduce((sum, c) => sum + moneyArs(c.amount), 0),
  );
  const confirmed = moneyArs(
    (payments || [])
      .filter((p) => String(p.status || '') === 'confirmed')
      .reduce((sum, p) => sum + moneyArs(p.amount), 0),
  );
  const pending = moneyArs(
    (payments || [])
      .filter((p) => String(p.status || '') === 'pending')
      .reduce((sum, p) => sum + moneyArs(p.amount), 0),
  );
  const balance = moneyArs(charged - confirmed);
  return {
    totalContracted: charged,
    totalCollected: confirmed,
    pendingConfirmation: pending,
    balanceDue: balance,
    isSettled: balance <= 0 && pending === 0,
  };
}

export function buildColoniaCharge({
  enrollmentId,
  seasonId,
  concept,
  planKey = null,
  amount,
  studentId = null,
  siblingGroupId = null,
  note = '',
} = {}) {
  const conceptKey = String(concept || '');
  if (!COLONIA_CHARGE_CONCEPTS[conceptKey]) {
    throw new Error('Concepto de Colonia inválido.');
  }
  const value = moneyArs(amount);
  if (value < 0) throw new Error('El cargo no puede ser negativo.');
  return {
    enrollmentId,
    seasonId,
    studentId,
    siblingGroupId,
    concept: conceptKey,
    planKey,
    amount: value,
    currency: 'ARS',
    status: 'posted',
    note: String(note || '').trim(),
    affectsSocialDues: false,
    affectsMemberOutstandingBalance: false,
  };
}

export function buildColoniaReceipt({
  payment,
  student,
  guardian,
  season,
  chargeConcepts = [],
} = {}) {
  return {
    club: 'Jockey Club San Juan',
    conceptLabel: 'Colonia de Verano',
    fiscalClaim: false,
    fiscalNote: 'Recibo interno de Colonia. No constituye factura fiscal.',
    studentName: student?.fullName || student?.full_name || '—',
    guardianName: guardian?.fullName || guardian?.full_name || '—',
    seasonName: season?.name || season?.code || '—',
    amount: moneyArs(payment?.amount),
    currency: 'ARS',
    paidAt: payment?.confirmedAt || payment?.paidAt || payment?.createdAt || null,
    method: coloniaMethodLabel(payment?.method),
    methodKey: payment?.method || null,
    reference: payment?.externalReference || payment?.id || null,
    status: payment?.status || null,
    chargeConcepts: chargeConcepts || [],
  };
}

/** Garantiza que un payload de Colonia no toque deuda social. */
export function assertColoniaFinanceIsolation(payload = {}) {
  if (payload.affectsSocialDues === true) {
    throw new Error('Un movimiento de Colonia no puede afectar la cuota social.');
  }
  if (payload.affectsMemberOutstandingBalance === true) {
    throw new Error('Un movimiento de Colonia no puede modificar members.outstanding_balance.');
  }
  if (payload.imputeTo === 'dues' || payload.chargeScope === 'social' || payload.chargeScope === 'cuota') {
    throw new Error('No se puede imputar un pago de Colonia a cuota social.');
  }
  return true;
}

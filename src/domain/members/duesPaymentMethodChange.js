/** Cambio de medio de pago en un cobro ya registrado (con auditoría). */

import { CLUB_BANK_ACCOUNTS, journalAccountForPayment } from './clubBanks';

const METHOD_LABELS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  mixto: 'Pago mixto',
  mercadopago: 'Mercado Pago',
  debito: 'Débito',
  caja: 'Efectivo',
};

function methodLabelOf(method, bankName) {
  if (method === 'transferencia') {
    return bankName ? `Transferencia ${bankName}` : 'Transferencia';
  }
  return METHOD_LABELS[method] || method || 'Pago';
}

/** Medios editables en comprobantes (no mixto: hay que anular y volver a cobrar). */
export const EDITABLE_DUES_METHODS = ['efectivo', 'transferencia', 'tarjeta', 'mercadopago', 'debito'];

/** Reescribe el concepto del asiento / movimiento de caja con el nuevo medio. */
export function rewriteDuesCobroConcept(concept, methodLabel) {
  const label = String(methodLabel || '').trim();
  const raw = String(concept || '');
  if (!label || !raw) return raw;
  if (/Cobro cuota social\s*\([^)]*\)/i.test(raw)) {
    return raw.replace(/Cobro cuota social\s*\([^)]*\)/i, `Cobro cuota social (${label})`);
  }
  if (/^Cobro cuota social\b/i.test(raw)) {
    return raw.replace(/^Cobro cuota social\b/i, `Cobro cuota social (${label})`);
  }
  return raw;
}

/**
 * Cambia el medio de un cobro ya registrado y deja rastro de quién / cuándo / por qué.
 * No toca el importe ni el saldo; solo el medio y su auditoría.
 */
export function changeDuesPaymentMethod(payment, {
  method,
  bankId = null,
  bankName = null,
  changedBy = null,
  changedByName = 'Administración',
  reason = '',
  today = new Date(),
} = {}) {
  if (!payment) throw new Error('No se encontró el cobro.');
  if (payment.status === 'void' || payment.status === 'cancelled' || payment.voidedAt) {
    throw new Error('Ese cobro está anulado.');
  }
  const prevMethod = String(payment.method || '').trim().toLowerCase();
  if (prevMethod === 'mixto') {
    throw new Error('Un pago mixto no se puede cambiar de medio. Anulalo y cobrá de nuevo.');
  }
  const nextMethod = String(method || '').trim().toLowerCase();
  if (!EDITABLE_DUES_METHODS.includes(nextMethod)) {
    throw new Error('Medio de pago no válido.');
  }
  const why = String(reason || '').trim();
  if (why.length < 8) {
    throw new Error('Falta el motivo del cambio (mínimo 8 caracteres).');
  }

  const resolvedBankId = nextMethod === 'transferencia'
    ? (bankId || payment.bankId || CLUB_BANK_ACCOUNTS[0]?.id || null)
    : null;
  const bank = resolvedBankId
    ? (CLUB_BANK_ACCOUNTS.find((row) => row.id === resolvedBankId) || CLUB_BANK_ACCOUNTS[0] || null)
    : null;
  const resolvedBankName = nextMethod === 'transferencia'
    ? (bankName || bank?.name || payment.bankName || null)
    : null;
  const methodLabel = methodLabelOf(nextMethod, resolvedBankName);

  if (
    prevMethod === nextMethod
    && String(payment.bankId || '') === String(resolvedBankId || '')
  ) {
    throw new Error('El medio ya es ese.');
  }

  const changedAt = today instanceof Date ? today.toISOString() : String(today);
  const historyEntry = {
    from: prevMethod || null,
    fromLabel: payment.methodLabel || methodLabelOf(prevMethod, payment.bankName),
    to: nextMethod,
    toLabel: methodLabel,
    at: changedAt,
    by: String(changedByName || 'Administración').trim() || 'Administración',
    byId: changedBy || null,
    reason: why,
  };
  const methodHistory = [
    ...(Array.isArray(payment.methodHistory) ? payment.methodHistory : []),
    historyEntry,
  ];

  return {
    ...payment,
    method: nextMethod,
    methodLabel,
    bankId: resolvedBankId,
    bankName: resolvedBankName,
    journalAccount: journalAccountForPayment(nextMethod, resolvedBankId),
    methodChangedAt: changedAt,
    methodChangedBy: changedBy || null,
    methodChangedByName: historyEntry.by,
    methodChangeReason: why,
    previousMethod: prevMethod || null,
    methodHistory,
  };
}

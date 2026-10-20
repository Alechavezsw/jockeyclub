/** Módulos de tesorería: cobranzas NN, débitos Galicia, fijos, órdenes de pago. */

import { formatISODateLongAR, todayISODateAR } from '../../lib/arDate';
import { buildPostedEntry } from './journal';

export const UNIDENTIFIED_STATUS = {
  pending: 'Pendiente',
  matched: 'Identificada',
  rejected: 'Rechazada',
};

export const DEBIT_STATUS = {
  scheduled: 'Programado',
  sent: 'Enviado',
  settled: 'Acreditado',
  rejected: 'Rechazado',
};

export const PAYMENT_ORDER_STATUS = {
  draft: 'Borrador',
  approved: 'Aprobada',
  paid: 'Pagada',
  cancelled: 'Anulada',
};

export const DEFAULT_UNIDENTIFIED_COLLECTIONS = [];
export const DEFAULT_GALICIA_DEBITS = [];
export const DEFAULT_FIXED_EXPENSES = [];
export const DEFAULT_FIXED_DISCOUNTS = [];
export const DEFAULT_PAYMENT_ORDERS = [];

const DEMO_TREASURY_IDS = new Set([
  'nn-1', 'nn-2', 'gal-1', 'gal-2', 'fix-1', 'fix-2', 'fd-1', 'fd-2', 'fd-3', 'po-1',
]);

export function withoutDemoTreasuryRows(rows = []) {
  return (rows || []).filter((row) => !DEMO_TREASURY_IDS.has(String(row?.id || '')));
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function nextFixedExpenseDate(dayOfMonth, asOf = todayISODateAR()) {
  const day = Math.min(28, Math.max(1, Number(dayOfMonth) || 1));
  const [year, month, date] = String(asOf).split('-').map(Number);
  if (!year || !month || !date) return asOf;
  if (date <= day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function buildLiveUnidentified(items = [], today = new Date()) {
  const asOf = todayISODateAR(today);
  const rows = withoutDemoTreasuryRows(items);
  const pending = rows.filter((row) => row.status === 'pending');
  return {
    asOf,
    asOfLabel: formatISODateLongAR(asOf),
    rows,
    pending,
    pendingCount: pending.length,
    pendingTotal: roundMoney(pending.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
  };
}

export function buildLiveGalicia(items = [], today = new Date()) {
  const asOf = todayISODateAR(today);
  const period = asOf.slice(0, 7);
  const rows = withoutDemoTreasuryRows(items);
  const ofPeriod = rows.filter((row) => String(row.period || '').slice(0, 7) === period);
  const active = ofPeriod.filter((row) => row.status !== 'rejected');
  return {
    asOf,
    asOfLabel: formatISODateLongAR(asOf),
    period,
    rows,
    ofPeriod,
    scheduled: ofPeriod.filter((row) => row.status === 'scheduled').length,
    sent: ofPeriod.filter((row) => row.status === 'sent').length,
    settled: ofPeriod.filter((row) => row.status === 'settled').length,
    amount: roundMoney(active.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
  };
}

export function buildLiveFixedExpenses(items = [], today = new Date()) {
  const asOf = todayISODateAR(today);
  const rows = withoutDemoTreasuryRows(items).map((row) => ({
    ...row,
    nextDate: nextFixedExpenseDate(row.dayOfMonth, asOf),
  }));
  const active = rows.filter((row) => row.active);
  return {
    asOf,
    asOfLabel: formatISODateLongAR(asOf),
    rows,
    activeCount: active.length,
    monthly: roundMoney(active.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
  };
}

export function createUnidentifiedCollection({ date, amount, bankRef, originLabel, note }) {
  if (!amount || Number(amount) <= 0) throw new Error('Importe inválido.');
  return {
    id: `nn-${Date.now()}`,
    date: date || todayISODateAR(),
    amount: Number(amount),
    bankRef: String(bankRef || '').trim() || `REF-${Date.now()}`,
    originLabel: String(originLabel || 'Cobranza bancaria').trim(),
    note: String(note || '').trim(),
    status: 'pending',
    matchedMemberId: null,
    createdAt: new Date().toISOString(),
  };
}

export function matchUnidentifiedCollection(item, memberId) {
  if (!item || item.status !== 'pending') throw new Error('Solo se identifican cobranzas pendientes.');
  if (!memberId) throw new Error('Seleccione un socio.');
  return {
    ...item,
    status: 'matched',
    matchedMemberId: memberId,
    matchedAt: new Date().toISOString(),
  };
}

export function rejectUnidentifiedCollection(item, reason = '') {
  return {
    ...item,
    status: 'rejected',
    note: reason ? `${item.note || ''} · Rechazo: ${reason}`.trim() : item.note,
    rejectedAt: new Date().toISOString(),
  };
}

export function createGaliciaDebit({ period, memberName, memberId, cbuMask, amount, scheduledDate }) {
  if (!memberId || !amount) throw new Error('Socio e importe son obligatorios.');
  return {
    id: `gal-${Date.now()}`,
    period: period || todayISODateAR().slice(0, 7),
    memberName: memberName || '',
    memberId,
    cbuMask: cbuMask || '****0000',
    amount: Number(amount),
    status: 'scheduled',
    scheduledDate: scheduledDate || todayISODateAR(),
    createdAt: new Date().toISOString(),
  };
}

export function setGaliciaDebitStatus(item, status) {
  if (!DEBIT_STATUS[status]) throw new Error('Estado inválido.');
  return { ...item, status, updatedAt: new Date().toISOString() };
}

export function createFixedExpense({ name, vendorName, amount, dayOfMonth, accountHint }) {
  if (!String(name || '').trim() || !amount) throw new Error('Nombre e importe son obligatorios.');
  return {
    id: `fx-${Date.now()}`,
    name: String(name).trim(),
    vendorName: String(vendorName || '').trim(),
    amount: Number(amount),
    dayOfMonth: Math.min(28, Math.max(1, Number(dayOfMonth) || 1)),
    accountHint: String(accountHint || 'Servicios e Insumos').trim(),
    active: true,
  };
}

export function createFixedDiscount({ name, percent, appliesTo }) {
  if (!String(name || '').trim()) throw new Error('Nombre obligatorio.');
  const p = Number(percent);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('Porcentaje inválido (0-100).');
  return {
    id: `fd-${Date.now()}`,
    name: String(name).trim(),
    percent: p,
    appliesTo: appliesTo || 'general',
    active: true,
  };
}

export function createPaymentOrder({ date, payee, concept, amount, paymentMethod }) {
  if (!String(payee || '').trim() || !amount) throw new Error('Beneficiario e importe son obligatorios.');
  const asOf = todayISODateAR();
  const stamp = new Date();
  const number = `OP-${asOf.slice(0, 4)}-${asOf.slice(5, 7)}${asOf.slice(8, 10)}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`;
  return {
    id: `po-${Date.now()}`,
    number,
    date: date || asOf,
    payee: String(payee).trim(),
    concept: String(concept || '').trim(),
    amount: Number(amount),
    status: 'draft',
    paymentMethod: paymentMethod || 'transferencia',
    createdAt: stamp.toISOString(),
  };
}

export function setPaymentOrderStatus(order, status) {
  if (!PAYMENT_ORDER_STATUS[status]) throw new Error('Estado inválido.');
  return { ...order, status, updatedAt: new Date().toISOString() };
}

/** Asiento al identificar una cobranza NN: Debe Banco / Haber Cuotas. */
export function buildUnidentifiedMatchEntry(item, chart) {
  const amount = Number(item.amount) || 0;
  if (amount <= 0) return null;
  return buildPostedEntry({
    date: item.date || todayISODateAR(),
    description: `Cobranza identificada ${item.bankRef || item.originLabel || ''}`.trim(),
    lines: [
      { account: 'Banco Nación', type: 'debit', amount },
      { account: 'Cuotas Sociales', type: 'credit', amount },
    ],
    sourceModule: 'tesoreria',
    chart,
  });
}

/** Asiento al acreditar débito Galicia: Debe Banco / Haber Cuotas. */
export function buildGaliciaSettledEntry(item, chart) {
  const amount = Number(item.amount) || 0;
  if (amount <= 0) return null;
  return buildPostedEntry({
    date: item.scheduledDate || todayISODateAR(),
    description: `Débito Galicia acreditado — ${item.memberName || item.memberId || ''}`.trim(),
    lines: [
      { account: 'Banco Nación', type: 'debit', amount },
      { account: 'Cuotas Sociales', type: 'credit', amount },
    ],
    sourceModule: 'tesoreria',
    chart,
  });
}

/** Asiento al pagar una orden: Debe gasto/servicios / Haber Banco. */
export function buildPaymentOrderPaidEntry(order, chart) {
  const amount = Number(order.amount) || 0;
  if (amount <= 0) return null;
  return buildPostedEntry({
    date: order.date || todayISODateAR(),
    description: `Orden de pago ${order.number || ''} — ${order.payee || order.beneficiary || ''}`.trim(),
    lines: [
      { account: 'Servicios e Insumos', type: 'debit', amount },
      { account: 'Banco Nación', type: 'credit', amount },
    ],
    sourceModule: 'tesoreria',
    chart,
  });
}

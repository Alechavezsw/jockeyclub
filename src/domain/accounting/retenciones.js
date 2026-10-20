/** Retenciones practicadas sobre órdenes de pago a proveedores. */

import { formatISODateLongAR, todayISODateAR } from '../../lib/arDate';
import { readSnapshot } from '../../data/snapshots';

const EMPTY_RETENCIONES_SEED = Object.freeze({
  ACCESSIN_RETENCIONES: [],
  ACCESSIN_RETENCIONES_AS_OF: '',
  ACCESSIN_RETENCIONES_GENERATED_ON: '',
  ACCESSIN_RETENCIONES_PERIOD_FROM: '',
  ACCESSIN_RETENCIONES_PERIOD_TO: '',
});

/** Snapshot histórico; vacío hasta que carga (ver data/snapshots). */
export function retencionesSeed() {
  return readSnapshot('accessinRetenciones', EMPTY_RETENCIONES_SEED);
}

export const RETENCION_STATUS = {
  recorded: 'Registrada',
  void: 'Anulada',
};

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function retentionAmountOf(row) {
  return Number(row?.retentionAmount ?? row?.withholdingAmount ?? row?.retencion) || 0;
}

export function createRetencion({
  clientName = 'Jockey Club San Juan',
  supplierName = '',
  paymentOrderNumber = '',
  paymentOrderAmount = 0,
  retentionType = '',
  retentionDate = todayISODateAR(),
  retentionAmount = 0,
  lineNumber = null,
  notes = '',
  paymentOrderId = '',
} = {}) {
  const amount = Number(retentionAmount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error('El monto de retención es obligatorio.');
  }
  if (!String(supplierName || '').trim() && !String(clientName || '').trim()) {
    throw new Error('Indique cliente o proveedor.');
  }

  return {
    id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    lineNumber: lineNumber != null ? Number(lineNumber) || null : null,
    clientName: String(clientName || '').trim(),
    supplierName: String(supplierName || '').trim(),
    paymentOrderNumber: String(paymentOrderNumber || '').trim(),
    paymentOrderAmount: Number(paymentOrderAmount) || 0,
    paymentOrderId: String(paymentOrderId || '').trim(),
    retentionType: String(retentionType || '').trim(),
    retentionDate: isoDate(retentionDate) || todayISODateAR(),
    retentionAmount: amount,
    status: 'recorded',
    notes: String(notes || '').trim(),
    source: 'manual',
    asOf: todayISODateAR(),
    createdAt: new Date().toISOString(),
  };
}

export function updateRetencion(item, patch = {}) {
  if (!item) throw new Error('Retención no encontrada.');
  const nextAmount = patch.retentionAmount != null
    ? Number(patch.retentionAmount)
    : item.retentionAmount;
  if (!Number.isFinite(nextAmount) || nextAmount === 0) {
    throw new Error('El monto de retención es obligatorio.');
  }
  return {
    ...item,
    ...patch,
    clientName: patch.clientName != null ? String(patch.clientName).trim() : item.clientName,
    supplierName: patch.supplierName != null ? String(patch.supplierName).trim() : item.supplierName,
    paymentOrderNumber: patch.paymentOrderNumber != null
      ? String(patch.paymentOrderNumber).trim()
      : item.paymentOrderNumber,
    paymentOrderAmount: patch.paymentOrderAmount != null
      ? Number(patch.paymentOrderAmount) || 0
      : item.paymentOrderAmount,
    retentionType: patch.retentionType != null ? String(patch.retentionType).trim() : item.retentionType,
    retentionDate: patch.retentionDate != null
      ? String(patch.retentionDate).slice(0, 10)
      : item.retentionDate,
    retentionAmount: nextAmount,
    notes: patch.notes != null ? String(patch.notes).trim() : (item.notes || ''),
    updatedAt: new Date().toISOString(),
  };
}

export function retencionTotals(items = []) {
  const active = items.filter((r) => r.status !== 'void');
  const byType = {};
  let total = 0;
  let paymentOrders = 0;
  for (const r of active) {
    const amt = Number(r.retentionAmount) || 0;
    total += amt;
    paymentOrders += Number(r.paymentOrderAmount) || 0;
    const key = r.retentionType || 'Sin tipo';
    byType[key] = (byType[key] || 0) + amt;
  }
  return {
    count: active.length,
    total: roundMoney(total),
    paymentOrders: roundMoney(paymentOrders),
    byType: Object.fromEntries(
      Object.entries(byType).map(([key, value]) => [key, roundMoney(value)])
    ),
  };
}

export function compareRetenciones(a, b) {
  const da = String(a.retentionDate || '');
  const db = String(b.retentionDate || '');
  if (da !== db) return db.localeCompare(da);
  return (Number(a.lineNumber) || 0) - (Number(b.lineNumber) || 0);
}

export function retentionFromPaymentOrder(order) {
  if (!order || order.deletedAt || order.orderKind === 'member') return null;
  if (order.status === 'void' || order.status === 'cancelled') return null;
  const amount = retentionAmountOf(order);
  if (amount === 0) return null;
  const date = isoDate(order.retentionDate || order.date || order.paidAt || order.dueDate);
  return {
    id: `ret-op-${order.id}`,
    lineNumber: null,
    clientName: 'Jockey Club San Juan',
    supplierName: String(order.payee || order.beneficiary || order.supplierName || '').trim(),
    paymentOrderNumber: String(order.number || order.paymentOrderNumber || '').trim(),
    paymentOrderAmount: Number(order.amount) || 0,
    paymentOrderId: String(order.id || ''),
    retentionType: String(order.retentionType || 'Retención').trim(),
    retentionDate: date,
    retentionAmount: amount,
    status: 'recorded',
    notes: String(order.concept || '').trim(),
    source: 'payment_order',
    asOf: todayISODateAR(),
  };
}

export function mergeLiveRetenciones(retenciones = [], paymentOrders = []) {
  const rows = (retenciones || []).filter(Boolean);
  const linked = new Set(
    rows.flatMap((row) => [
      String(row.paymentOrderId || ''),
      String(row.paymentOrderNumber || '').trim().toLowerCase(),
    ]).filter(Boolean)
  );
  const extra = (paymentOrders || []).flatMap((order) => {
    const row = retentionFromPaymentOrder(order);
    if (!row) return [];
    if (linked.has(String(row.paymentOrderId || ''))) return [];
    const number = String(row.paymentOrderNumber || '').trim().toLowerCase();
    if (number && linked.has(number)) return [];
    return [row];
  });
  return [...rows, ...extra];
}

export function filterRetenciones(items = [], filter = {}) {
  const q = String(filter.query || '').trim().toLowerCase();
  const month = String(filter.monthKey || '').slice(0, 7);
  const type = filter.type && filter.type !== 'all' ? filter.type : '';
  return (items || []).filter((row) => {
    if (!row || row.status === 'void') return false;
    if (month && isoDate(row.retentionDate).slice(0, 7) !== month) return false;
    if (type && row.retentionType !== type) return false;
    if (!q) return true;
    return (
      String(row.supplierName || '').toLowerCase().includes(q)
      || String(row.clientName || '').toLowerCase().includes(q)
      || String(row.paymentOrderNumber || '').toLowerCase().includes(q)
      || String(row.retentionType || '').toLowerCase().includes(q)
    );
  });
}

export function buildLiveRetenciones({
  retenciones = [],
  paymentOrders = [],
  today = new Date(),
} = {}) {
  const asOf = todayISODateAR(today);
  const month = asOf.slice(0, 7);
  const rows = mergeLiveRetenciones(retenciones, paymentOrders).toSorted(compareRetenciones);
  const active = rows.filter((row) => row.status !== 'void');
  const ofMonth = active.filter((row) => isoDate(row.retentionDate).slice(0, 7) === month);
  const totals = retencionTotals(active);
  const monthTotals = retencionTotals(ofMonth);
  const dates = active.map((row) => isoDate(row.retentionDate)).filter(Boolean).toSorted();
  const months = [...new Set(active.map((row) => isoDate(row.retentionDate).slice(0, 7)).filter(Boolean))]
    .toSorted()
    .toReversed();
  return {
    asOf,
    asOfLabel: formatISODateLongAR(asOf),
    month,
    rows: active,
    count: totals.count,
    total: totals.total,
    paymentOrders: totals.paymentOrders,
    byType: totals.byType,
    monthCount: monthTotals.count,
    monthTotal: monthTotals.total,
    monthPaymentOrders: monthTotals.paymentOrders,
    periodFrom: dates[0] || asOf,
    periodTo: dates[dates.length - 1] || asOf,
    months,
  };
}

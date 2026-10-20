/** Pagos a proveedores: snapshot de corte + órdenes y gastos pagados de la app. */

import { readSnapshot } from '../../data/snapshots';
import { todayISODateAR } from '../../lib/arDate';
import { formatAccessinCashDate } from './cashLedger';

const EMPTY_SUPPLIER_PAYMENTS_SEED = Object.freeze({
  ACCESSIN_SUPPLIER_PAYMENTS: [],
  ACCESSIN_SUPPLIER_PAYMENTS_AS_OF: '',
  ACCESSIN_SUPPLIER_PAYMENTS_METHOD_LABELS: {},
  ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT: {},
});

const METHOD_LABELS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  debito: 'Débito',
  tarjeta: 'Tarjeta',
  otros: 'Otros',
};

function isoDate(value) {
  const key = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function methodLabel(method, fallback = '') {
  const key = String(method || '').toLowerCase();
  return METHOD_LABELS[key] || fallback || METHOD_LABELS.otros;
}

function earliestDate(rows = [], fallback = '') {
  let min = '';
  rows.forEach((row) => {
    const date = isoDate(row.date);
    if (date && (!min || date < min)) min = date;
  });
  return min || fallback;
}

/** Snapshot `accessinSupplierPayments`; vacío hasta que carga (ver data/snapshots). */
export function supplierPaymentsSeed() {
  return readSnapshot('accessinSupplierPayments', EMPTY_SUPPLIER_PAYMENTS_SEED);
}

export function supplierPaymentMethodLabels() {
  return {
    ...METHOD_LABELS,
    ...supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS_METHOD_LABELS,
  };
}

export function supplierPaymentsTotal(items = supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS) {
  return roundMoney((items || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
}

export function supplierPaymentsSummary(
  items = supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS,
  snapshot = supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
) {
  const list = items || [];
  const byMethod = {};
  list.forEach((row) => {
    const method = row.paymentMethod || 'otros';
    byMethod[method] = (byMethod[method] || 0) + (Number(row.amount) || 0);
  });
  return {
    asOf: snapshot?.asOf || supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS_AS_OF,
    periodFrom: snapshot?.periodFrom,
    periodTo: snapshot?.periodTo,
    count: list.length,
    totalAmount: supplierPaymentsTotal(list),
    byMethod: Object.fromEntries(
      Object.entries(byMethod).map(([key, value]) => [key, roundMoney(value)])
    ),
  };
}

export function supplierPaymentsBalanceCards(
  items = supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS,
  snapshot = supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
) {
  const summary = supplierPaymentsSummary(items, snapshot);
  const labels = supplierPaymentMethodLabels();
  const methodCards = Object.entries(summary.byMethod)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([method, value]) => ({
      id: `method-${method}`,
      label: labels[method] || method,
      value,
      caption: 'Importe del período',
      filter: { paymentMethod: method },
    }));

  return [
    {
      id: 'total',
      label: 'Total pagado',
      value: summary.totalAmount,
      caption: summary.count
        ? `${summary.count} pago(s) · ${formatAccessinCashDate(summary.periodFrom)} → ${formatAccessinCashDate(summary.periodTo)}`
        : `Al ${formatAccessinCashDate(summary.asOf)} · sin pagos registrados`,
      emphasize: true,
      filter: null,
    },
    {
      id: 'count',
      label: 'Pagos',
      value: summary.count,
      caption: 'Órdenes y gastos pagados',
      isCount: true,
      filter: null,
    },
    ...methodCards,
  ];
}

export function filterAccessinSupplierPayments(items = [], filter = {}) {
  const {
    paymentMethod = null,
    bankName = null,
    query = '',
    limit = null,
  } = filter || {};
  const q = String(query || '').trim().toLowerCase();
  let rows = [...(items || [])];
  if (paymentMethod) rows = rows.filter((row) => row.paymentMethod === paymentMethod);
  if (bankName) rows = rows.filter((row) => row.bankName === bankName);
  if (q) {
    rows = rows.filter((row) => {
      const hay = [
        row.orderId,
        row.supplierName,
        row.concept,
        row.invoiceNumber,
        row.preparedBy,
        row.authorizedBy,
        row.withdrawnBy,
        row.bankName,
        row.paymentMethodLabel,
      ].map((value) => String(value || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  rows.sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate) return byDate;
    return String(b.orderId || '').localeCompare(String(a.orderId || ''));
  });
  if (limit != null && limit >= 0) return rows.slice(0, limit);
  return rows;
}

export function paymentFromOrder(order) {
  if (!order || order.deletedAt || order.orderKind === 'member') return null;
  if (order.status === 'void' || order.status === 'cancelled') return null;
  const amount = roundMoney(order.amount);
  if (amount <= 0) return null;
  const date = isoDate(order.paidAt || order.date || order.dueDate);
  if (!date) return null;
  const method = String(order.paymentMethod || 'transferencia').toLowerCase();
  return {
    id: `live-pay-${order.id}`,
    orderId: order.number || order.paymentOrderNumber || order.id,
    date,
    supplierName: order.payee || order.beneficiary || order.supplierName || '',
    concept: order.concept || 'Pago a proveedor',
    invoiceNumber: order.invoiceNumber || '',
    paymentMethod: method,
    paymentMethodLabel: methodLabel(method, order.paymentMethodLabel),
    bankName: order.bankName || '',
    preparedBy: order.preparedBy || '',
    authorizedBy: order.authorizedBy || '',
    amount,
    origin: 'app',
    paymentOrderId: String(order.id || ''),
  };
}

export function paymentFromPaidExpense(expense) {
  if (!expense || expense.status !== 'paid') return null;
  const amount = roundMoney(expense.amount);
  if (amount <= 0) return null;
  const date = isoDate(expense.paidAt || expense.expenseDate);
  if (!date) return null;
  const method = String(expense.paymentMethod || 'efectivo').toLowerCase();
  return {
    id: `live-exp-${expense.id}`,
    orderId: expense.expenseNumber || expense.invoiceNumber || expense.id,
    date,
    supplierName: expense.vendorName || expense.supplierName || expense.payee || 'Gasto pagado',
    concept: expense.concept || 'Pago de gasto',
    invoiceNumber: expense.invoiceNumber || '',
    paymentMethod: method,
    paymentMethodLabel: methodLabel(method, expense.paymentMethodLabel),
    bankName: expense.bankName || '',
    preparedBy: expense.requestedBy || '',
    authorizedBy: expense.approvedBy || '',
    amount,
    origin: 'app',
    paymentOrderId: expense.paymentOrderId ? String(expense.paymentOrderId) : '',
    expenseId: String(expense.id || ''),
  };
}

export function mergeLiveSupplierPayments(items = [], extra = []) {
  const byId = new Map();
  const linked = new Set();
  (items || []).forEach((row) => {
    const key = String(row.id || row.orderId || '');
    if (key) byId.set(key, row);
    const orderId = String(row.orderId || '').trim().toLowerCase();
    if (orderId) linked.add(orderId);
    const paymentOrderId = String(row.paymentOrderId || '').trim();
    if (paymentOrderId) linked.add(paymentOrderId);
  });
  extra.forEach((row) => {
    if (!row) return;
    const key = String(row.id || row.orderId || '');
    if (!key || byId.has(key)) return;
    const orderId = String(row.orderId || '').trim().toLowerCase();
    if (orderId && linked.has(orderId)) return;
    const paymentOrderId = String(row.paymentOrderId || '').trim();
    if (paymentOrderId && linked.has(paymentOrderId)) return;
    byId.set(key, row);
    if (orderId) linked.add(orderId);
    if (paymentOrderId) linked.add(paymentOrderId);
  });
  return [...byId.values()].sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate) return byDate;
    return String(b.orderId || '').localeCompare(String(a.orderId || ''));
  });
}

export function buildLiveSupplierPayments({
  items = [],
  snapshot = supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
  paymentOrders = [],
  expenses = [],
  today = new Date(),
} = {}) {
  const asOf = todayISODateAR(today);
  const cutoff = isoDate(snapshot?.asOf || snapshot?.periodTo) || asOf;
  const extras = [
    ...(paymentOrders || []).map(paymentFromOrder),
    ...(expenses || []).map(paymentFromPaidExpense),
  ].filter((row) => row && row.date > cutoff);
  const rows = mergeLiveSupplierPayments(items, extras);
  const liveSnapshot = {
    ...snapshot,
    asOf,
    periodFrom: snapshot?.periodFrom || earliestDate(rows, cutoff),
    periodTo: asOf,
  };
  return {
    asOf,
    asOfLabel: formatAccessinCashDate(asOf),
    cutoff,
    cutoffLabel: formatAccessinCashDate(cutoff),
    periodFrom: liveSnapshot.periodFrom,
    extraCount: extras.length,
    rows,
    cards: supplierPaymentsBalanceCards(rows, liveSnapshot),
    methodLabels: supplierPaymentMethodLabels(),
  };
}

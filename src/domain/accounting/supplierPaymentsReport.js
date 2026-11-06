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

function monthLabelES(monthKey = '') {
  const month = String(monthKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return '';
  const [y, m] = month.split('-').map(Number);
  const raw = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : month;
}

function summarizeSupplierList(list = []) {
  const byMethod = {};
  const byMethodCount = {};
  list.forEach((row) => {
    const method = row.paymentMethod || 'otros';
    const amount = Number(row.amount) || 0;
    byMethod[method] = (byMethod[method] || 0) + amount;
    byMethodCount[method] = (byMethodCount[method] || 0) + 1;
  });
  return {
    count: list.length,
    totalAmount: supplierPaymentsTotal(list),
    byMethod: Object.fromEntries(
      Object.entries(byMethod).map(([key, value]) => [key, roundMoney(value)])
    ),
    byMethodCount,
  };
}

/** Resumen acotado a un día o a un mes (misma lógica que caja / cobranzas). */
export function supplierPaymentsScopedSummary(items = [], { onDate = null, monthKey = null } = {}) {
  const day = isoDate(onDate);
  const month = String(monthKey || '').slice(0, 7);
  let list = [...(items || [])];
  if (day) {
    list = list.filter((row) => isoDate(row.date) === day);
  } else if (/^\d{4}-\d{2}$/.test(month)) {
    list = list.filter((row) => String(row.date || '').slice(0, 7) === month);
  }
  return summarizeSupplierList(list);
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

/**
 * Tarjetas: pagado hoy + acumulado del mes (no el histórico ene→hoy).
 * Devuelve `{ cards, dayTotal, monthTotal, monthLabel, asOfLabel, ... }`.
 */
export function supplierPaymentsBalanceCards(
  items = supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS,
  snapshot = supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
) {
  const asOf = isoDate(snapshot?.asOf) || isoDate(supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS_AS_OF);
  const monthKey = asOf.slice(0, 7);
  const monthLabel = monthLabelES(monthKey);
  const asOfLabel = formatAccessinCashDate(asOf);
  const labels = supplierPaymentMethodLabels();
  const daySummary = supplierPaymentsScopedSummary(items, { onDate: asOf });
  const monthSummary = supplierPaymentsScopedSummary(items, { monthKey });

  const methodKeys = [...new Set([
    ...Object.keys(monthSummary.byMethod),
    ...Object.keys(daySummary.byMethod),
  ])].sort((a, b) => (monthSummary.byMethod[b] || 0) - (monthSummary.byMethod[a] || 0));

  const methodCards = methodKeys.map((method) => {
    const dayInflow = daySummary.byMethod[method] || 0;
    const monthInflow = monthSummary.byMethod[method] || 0;
    const dayCount = daySummary.byMethodCount[method] || 0;
    const monthCount = monthSummary.byMethodCount[method] || 0;
    return {
      id: `method-${method}`,
      label: labels[method] || method,
      value: monthInflow,
      dayInflow,
      dayCount,
      monthInflow,
      monthCount,
      caption: dayInflow > 0
        ? `Hoy ${formatAccessinCashDate(asOf)}`
        : `Hoy sin pagos · ${asOfLabel}`,
      subcaption: `En el mes · ${monthLabel}`,
      filter: { paymentMethod: method },
    };
  });

  return {
    asOf,
    asOfLabel,
    monthKey,
    monthLabel,
    dayTotal: daySummary.totalAmount,
    dayCount: daySummary.count,
    monthTotal: monthSummary.totalAmount,
    monthCount: monthSummary.count,
    cards: [
      {
        id: 'total',
        label: 'Total pagado',
        value: monthSummary.totalAmount,
        dayInflow: daySummary.totalAmount,
        dayCount: daySummary.count,
        monthInflow: monthSummary.totalAmount,
        monthCount: monthSummary.count,
        caption: daySummary.totalAmount > 0
          ? `Hoy ${asOfLabel}`
          : `Hoy sin pagos · ${asOfLabel}`,
        subcaption: `En el mes · ${monthLabel}`,
        emphasize: true,
        filter: null,
      },
      ...methodCards,
    ],
  };
}

export function filterAccessinSupplierPayments(items = [], filter = {}) {
  const {
    paymentMethod = null,
    bankName = null,
    monthKey = null,
    onDate = null,
    query = '',
    limit = null,
  } = filter || {};
  const q = String(query || '').trim().toLowerCase();
  let rows = [...(items || [])];
  if (paymentMethod) rows = rows.filter((row) => row.paymentMethod === paymentMethod);
  const day = isoDate(onDate);
  if (day) {
    rows = rows.filter((row) => isoDate(row.date) === day);
  } else {
    const month = String(monthKey || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      rows = rows.filter((row) => String(row.date || '').slice(0, 7) === month);
    }
  }
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
  const balance = supplierPaymentsBalanceCards(rows, liveSnapshot);
  return {
    asOf,
    asOfLabel: formatAccessinCashDate(asOf),
    monthKey: balance.monthKey,
    monthLabel: balance.monthLabel,
    dayTotal: balance.dayTotal,
    dayCount: balance.dayCount,
    monthTotal: balance.monthTotal,
    monthCount: balance.monthCount,
    cutoff,
    cutoffLabel: formatAccessinCashDate(cutoff),
    periodFrom: liveSnapshot.periodFrom,
    extraCount: extras.length,
    rows,
    cards: balance.cards,
    balance,
    methodLabels: supplierPaymentMethodLabels(),
  };
}

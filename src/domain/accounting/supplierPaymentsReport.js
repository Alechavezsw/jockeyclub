/** Helpers de pagos a proveedores Accessin/LILA. */

import {
  ACCESSIN_SUPPLIER_PAYMENTS,
  ACCESSIN_SUPPLIER_PAYMENTS_AS_OF,
  ACCESSIN_SUPPLIER_PAYMENTS_METHOD_LABELS,
  ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
} from '../../data/seed/accessinSupplierPayments';
import { formatAccessinCashDate } from './cashLedger';

export {
  ACCESSIN_SUPPLIER_PAYMENTS,
  ACCESSIN_SUPPLIER_PAYMENTS_AS_OF,
  ACCESSIN_SUPPLIER_PAYMENTS_METHOD_LABELS,
  ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
};

export function supplierPaymentsTotal(items = ACCESSIN_SUPPLIER_PAYMENTS) {
  return Math.round((items || []).reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
}

export function supplierPaymentsSummary(
  items = ACCESSIN_SUPPLIER_PAYMENTS,
  snapshot = ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
) {
  const list = items || [];
  const byMethod = {};
  list.forEach((row) => {
    const m = row.paymentMethod || 'otros';
    byMethod[m] = (byMethod[m] || 0) + (Number(row.amount) || 0);
  });
  return {
    asOf: snapshot?.asOf || ACCESSIN_SUPPLIER_PAYMENTS_AS_OF,
    periodFrom: snapshot?.periodFrom,
    periodTo: snapshot?.periodTo,
    count: list.length,
    totalAmount: supplierPaymentsTotal(list),
    byMethod: Object.fromEntries(
      Object.entries(byMethod).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
  };
}

export function supplierPaymentsBalanceCards(
  items = ACCESSIN_SUPPLIER_PAYMENTS,
  snapshot = ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
) {
  const summary = supplierPaymentsSummary(items, snapshot);
  const methodCards = Object.entries(summary.byMethod)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([method, value]) => ({
      id: `method-${method}`,
      label: ACCESSIN_SUPPLIER_PAYMENTS_METHOD_LABELS[method] || method,
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
        ? `${summary.count} orden(es) · ${formatAccessinCashDate(summary.periodFrom)} → ${formatAccessinCashDate(summary.periodTo)}`
        : `Accessin al ${formatAccessinCashDate(summary.asOf)} · sin órdenes en el reporte`,
      emphasize: true,
      filter: null,
    },
    {
      id: 'count',
      label: 'Órdenes',
      value: summary.count,
      caption: 'Pagos a proveedores',
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
  if (paymentMethod) rows = rows.filter((r) => r.paymentMethod === paymentMethod);
  if (bankName) rows = rows.filter((r) => r.bankName === bankName);
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.orderId,
        r.supplierName,
        r.concept,
        r.invoiceNumber,
        r.preparedBy,
        r.authorizedBy,
        r.withdrawnBy,
        r.bankName,
        r.paymentMethodLabel,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  rows.sort((a, b) => {
    const d = String(b.date || '').localeCompare(String(a.date || ''));
    if (d) return d;
    return String(b.orderId || '').localeCompare(String(a.orderId || ''));
  });
  if (limit != null && limit >= 0) return rows.slice(0, limit);
  return rows;
}

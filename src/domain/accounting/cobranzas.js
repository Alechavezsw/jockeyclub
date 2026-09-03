/** Helpers de cobranzas Accessin/LILA. */

import {
  ACCESSIN_COBRANZAS,
  ACCESSIN_COBRANZAS_AS_OF,
  ACCESSIN_COBRANZAS_METHOD_LABELS,
  ACCESSIN_COBRANZAS_SNAPSHOT,
} from '../../data/seed/accessinCobranzas';
import { formatAccessinCashDate } from './cashLedger';

export {
  ACCESSIN_COBRANZAS,
  ACCESSIN_COBRANZAS_AS_OF,
  ACCESSIN_COBRANZAS_METHOD_LABELS,
  ACCESSIN_COBRANZAS_SNAPSHOT,
};

export function cobranzasTotal(items = ACCESSIN_COBRANZAS) {
  return Math.round((items || []).reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
}

export function cobranzasSummary(items = ACCESSIN_COBRANZAS, snapshot = ACCESSIN_COBRANZAS_SNAPSHOT) {
  const list = items || [];
  const byType = {};
  const byMethod = {};
  list.forEach((row) => {
    const t = row.type || 'Otros';
    const m = row.paymentMethod || 'otros';
    byType[t] = (byType[t] || 0) + (Number(row.amount) || 0);
    byMethod[m] = (byMethod[m] || 0) + (Number(row.amount) || 0);
  });
  return {
    asOf: snapshot?.asOf || ACCESSIN_COBRANZAS_AS_OF,
    periodFrom: snapshot?.periodFrom,
    periodTo: snapshot?.periodTo,
    count: list.length,
    totalAmount: cobranzasTotal(list),
    byType: Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    byMethod: Object.fromEntries(
      Object.entries(byMethod).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
  };
}

export function cobranzasBalanceCards(items = ACCESSIN_COBRANZAS, snapshot = ACCESSIN_COBRANZAS_SNAPSHOT) {
  const summary = cobranzasSummary(items, snapshot);
  const typeCards = Object.entries(summary.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, value]) => ({
      id: `type-${type}`,
      label: type,
      value,
      caption: 'Importe del período',
      filter: { type },
    }));

  return [
    {
      id: 'total',
      label: 'Total cobrado',
      value: summary.totalAmount,
      caption: `${summary.count} líneas · ${formatAccessinCashDate(summary.periodFrom)} → ${formatAccessinCashDate(summary.periodTo)}`,
      emphasize: true,
      filter: null,
    },
    ...typeCards,
  ];
}

export function filterAccessinCobranzas(items = [], filter = {}) {
  const {
    type = null,
    paymentMethod = null,
    bankName = null,
    query = '',
    limit = null,
  } = filter || {};
  const q = String(query || '').trim().toLowerCase();
  let rows = [...(items || [])];
  if (type) rows = rows.filter((r) => r.type === type);
  if (paymentMethod) rows = rows.filter((r) => r.paymentMethod === paymentMethod);
  if (bankName) rows = rows.filter((r) => r.bankName === bankName);
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.receiptId,
        r.memberNumber,
        r.memberName,
        r.firstName,
        r.lastName,
        r.documentNumber,
        r.concept,
        r.type,
        r.bankName,
        r.paymentMethodLabel,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  rows.sort((a, b) => {
    const d = String(b.date || '').localeCompare(String(a.date || ''));
    if (d) return d;
    return String(b.receiptId || '').localeCompare(String(a.receiptId || ''));
  });
  if (limit != null && limit >= 0) return rows.slice(0, limit);
  return rows;
}

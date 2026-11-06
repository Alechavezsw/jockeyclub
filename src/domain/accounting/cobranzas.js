/** Helpers de cobranzas Accessin/LILA. */

import { readSnapshot } from '../../data/snapshots';
import { formatAccessinCashDate } from './cashLedger';

const EMPTY_COBRANZAS_SEED = Object.freeze({
  ACCESSIN_COBRANZAS: [],
  ACCESSIN_COBRANZAS_AS_OF: '',
  ACCESSIN_COBRANZAS_METHOD_LABELS: {},
  ACCESSIN_COBRANZAS_SNAPSHOT: {},
});

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function monthLabelES(monthKey = '') {
  const month = String(monthKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return '';
  const [y, m] = month.split('-').map(Number);
  const raw = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : month;
}

/** Snapshot `accessinCobranzas`; vacío hasta que carga (ver data/snapshots). */
export function cobranzasSeed() {
  return readSnapshot('accessinCobranzas', EMPTY_COBRANZAS_SEED);
}

export function cobranzasTotal(items = cobranzasSeed().ACCESSIN_COBRANZAS) {
  return roundMoney((items || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
}

function summarizeCobranzasList(list = []) {
  const byType = {};
  const byTypeCount = {};
  const byMethod = {};
  list.forEach((row) => {
    const t = String(row.type || '').trim() || 'Otros';
    const m = row.paymentMethod || 'otros';
    const amount = Number(row.amount) || 0;
    byType[t] = (byType[t] || 0) + amount;
    byTypeCount[t] = (byTypeCount[t] || 0) + 1;
    byMethod[m] = (byMethod[m] || 0) + amount;
  });
  return {
    count: list.length,
    totalAmount: cobranzasTotal(list),
    byType: Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, roundMoney(v)])
    ),
    byTypeCount,
    byMethod: Object.fromEntries(
      Object.entries(byMethod).map(([k, v]) => [k, roundMoney(v)])
    ),
  };
}

/** Resumen acotado a un día o a un mes (misma lógica que las tarjetas de caja). */
export function cobranzasScopedSummary(items = [], { onDate = null, monthKey = null } = {}) {
  const day = isoDate(onDate);
  const month = String(monthKey || '').slice(0, 7);
  let list = [...(items || [])];
  if (day) {
    list = list.filter((row) => isoDate(row.date) === day);
  } else if (/^\d{4}-\d{2}$/.test(month)) {
    list = list.filter((row) => String(row.date || '').slice(0, 7) === month);
  }
  return summarizeCobranzasList(list);
}

export function cobranzasSummary(
  items = cobranzasSeed().ACCESSIN_COBRANZAS,
  snapshot = cobranzasSeed().ACCESSIN_COBRANZAS_SNAPSHOT,
) {
  const stats = summarizeCobranzasList(items || []);
  return {
    asOf: snapshot?.asOf || cobranzasSeed().ACCESSIN_COBRANZAS_AS_OF,
    periodFrom: snapshot?.periodFrom,
    periodTo: snapshot?.periodTo,
    ...stats,
  };
}

/**
 * Tarjetas de cobranzas: ingreso del día + acumulado del mes (no el histórico entero).
 * Devuelve `{ cards, dayTotal, monthTotal, monthLabel, asOfLabel, ... }`.
 */
export function cobranzasBalanceCards(
  items = cobranzasSeed().ACCESSIN_COBRANZAS,
  snapshot = cobranzasSeed().ACCESSIN_COBRANZAS_SNAPSHOT,
) {
  const asOf = isoDate(snapshot?.asOf) || isoDate(cobranzasSeed().ACCESSIN_COBRANZAS_AS_OF);
  const monthKey = asOf.slice(0, 7);
  const monthLabel = monthLabelES(monthKey);
  const asOfLabel = formatAccessinCashDate(asOf);
  const daySummary = cobranzasScopedSummary(items, { onDate: asOf });
  const monthSummary = cobranzasScopedSummary(items, { monthKey });

  const typeKeys = [...new Set([
    ...Object.keys(monthSummary.byType),
    ...Object.keys(daySummary.byType),
  ])].sort((a, b) => (monthSummary.byType[b] || 0) - (monthSummary.byType[a] || 0));

  const typeCards = typeKeys.map((type) => {
    const dayInflow = daySummary.byType[type] || 0;
    const monthInflow = monthSummary.byType[type] || 0;
    const dayCount = daySummary.byTypeCount[type] || 0;
    const monthCount = monthSummary.byTypeCount[type] || 0;
    return {
      id: `type-${type}`,
      label: type,
      value: monthInflow,
      dayInflow,
      dayCount,
      monthInflow,
      monthCount,
      caption: dayInflow > 0
        ? `Hoy +$ ${dayInflow.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `Hoy sin cobros · ${asOfLabel}`,
      subcaption: `En el mes · ${monthLabel}`,
      filter: { type },
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
        label: 'Total cobrado',
        value: monthSummary.totalAmount,
        dayInflow: daySummary.totalAmount,
        dayCount: daySummary.count,
        monthInflow: monthSummary.totalAmount,
        monthCount: monthSummary.count,
        caption: daySummary.totalAmount > 0
          ? `Hoy +$ ${daySummary.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : `Hoy sin cobros · ${asOfLabel}`,
        subcaption: `En el mes · ${monthLabel}`,
        emphasize: true,
        filter: null,
      },
      ...typeCards,
    ],
  };
}

export function filterAccessinCobranzas(items = [], filter = {}) {
  const {
    type = null,
    paymentMethod = null,
    bankName = null,
    memberNumbers = null,
    monthKey = null,
    onDate = null,
    query = '',
    limit = null,
  } = filter || {};
  const q = String(query || '').trim().toLowerCase();
  let rows = [...(items || [])];
  if (type) rows = rows.filter((r) => (r.type || 'Otros') === type);
  if (paymentMethod) rows = rows.filter((r) => r.paymentMethod === paymentMethod);
  const day = isoDate(onDate);
  if (day) {
    rows = rows.filter((r) => isoDate(r.date) === day);
  } else {
    const month = String(monthKey || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      rows = rows.filter((r) => String(r.date || '').slice(0, 7) === month);
    }
  }
  if (bankName) rows = rows.filter((r) => r.bankName === bankName);
  if (memberNumbers?.length) {
    const keys = new Set(
      memberNumbers.map((n) => String(n || '').replace(/\D/g, '')).filter(Boolean)
    );
    rows = rows.filter((r) => keys.has(String(r.memberNumber || '').replace(/\D/g, '')));
  }
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

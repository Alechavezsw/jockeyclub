import {
  buildEventImputationJournal,
  imputedEventReservations,
  reservationChargeAmount,
} from './eventImputation';
import { periodLabel, resolveFeePeriods } from './feeBilling';
import { journalDateKey, postedJournalEntries } from './journal';

export function liquidationJournalId(year, month) {
  return `je-liq-${Number(year)}-${String(Number(month)).padStart(2, '0')}`;
}

export function lilaCashJournalId(date, walletKind, direction) {
  return `je-lila-${date}-${walletKind || 'cash'}-${direction}`;
}

export function liveCashJournalId(movementId) {
  return movementId ? `je-cash-${movementId}` : '';
}

export function eventJournalId(reservation) {
  const key = reservation?.id || reservation?.accessinId;
  return key ? `je-evt-${key}` : '';
}

function liquidationDate(period) {
  const raw = String(period?.generatedAt || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const year = Number(period?.year) || 2026;
  const month = String(Number(period?.month) || 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export function buildFeePeriodJournalEntry(period) {
  if (!period || period.status !== 'processed') return null;
  const amount = Math.round(Number(period.amount) || 0);
  if (amount <= 0) return null;
  const date = liquidationDate(period);
  return {
    id: liquidationJournalId(period.year, period.month),
    date,
    description: `Liquidación de cuotas · ${periodLabel(period)}`,
    status: 'posted',
    sourceModule: 'cuotas',
    sourceId: period.id,
    origin: period.source === 'app' ? 'app' : 'lila',
    createdAt: `${date}T00:00:00.000Z`,
    lines: [
      { account: 'Cuentas a Cobrar', type: 'debit', amount },
      { account: 'Cuotas Sociales', type: 'credit', amount },
    ],
  };
}

function cashIsOut(row) {
  const type = String(row?.movementType || '').toLowerCase();
  return type === 'expense' || type === 'transfer_out' || type === 'egreso';
}

function cashWalletKind(row) {
  return row?.walletKind === 'bank' ? 'bank' : 'cash';
}

function cashAccountName(kind) {
  return kind === 'bank' ? 'Banco Nación' : 'Caja General';
}

export function buildLilaCashJournalEntries(movements = []) {
  const buckets = new Map();
  for (const row of movements || []) {
    const date = journalDateKey({ date: row?.date });
    if (!date) continue;
    const amount = Math.round((Number(row.amount) || 0) * 100) / 100;
    if (!(amount > 0)) continue;
    const wallet = cashWalletKind(row);
    const direction = cashIsOut(row) ? 'out' : 'in';
    const key = `${date}|${wallet}|${direction}`;
    const current = buckets.get(key) || {
      date,
      wallet,
      direction,
      amount: 0,
      count: 0,
    };
    current.amount += amount;
    current.count += 1;
    buckets.set(key, current);
  }

  return [...buckets.values()].map((bucket) => {
    const amount = Math.round(bucket.amount * 100) / 100;
    const cashAccount = cashAccountName(bucket.wallet);
    const counterpart = bucket.direction === 'out' ? 'Servicios e Insumos' : 'Cuentas a Cobrar';
    const walletLabel = bucket.wallet === 'bank' ? 'Bancos' : 'Caja';
    const lines = bucket.direction === 'in'
      ? [
        { account: cashAccount, type: 'debit', amount },
        { account: counterpart, type: 'credit', amount },
      ]
      : [
        { account: counterpart, type: 'debit', amount },
        { account: cashAccount, type: 'credit', amount },
      ];
    return {
      id: lilaCashJournalId(bucket.date, bucket.wallet, bucket.direction),
      date: bucket.date,
      description: bucket.direction === 'in'
        ? `${walletLabel} · ${bucket.count} ${bucket.count === 1 ? 'ingreso' : 'ingresos'}`
        : `${walletLabel} · ${bucket.count} ${bucket.count === 1 ? 'egreso' : 'egresos'}`,
      status: 'posted',
      sourceModule: 'caja',
      origin: 'lila',
      createdAt: `${bucket.date}T12:00:00.000Z`,
      lines,
    };
  });
}

export function buildLiveCashJournalEntries(movements = [], posted = []) {
  const postedIds = new Set((posted || []).map((entry) => String(entry.id)));
  return (movements || []).flatMap((row) => {
    if (row?.journalEntryId && postedIds.has(String(row.journalEntryId))) return [];
    const amount = Math.round((Number(row.amount) || 0) * 100) / 100;
    if (!(amount > 0)) return [];
    const date = journalDateKey({ date: row.date || row.createdAt });
    if (!date) return [];
    const id = liveCashJournalId(row.id);
    if (!id || postedIds.has(id)) return [];
    const isOut = cashIsOut(row);
    const cashAccount = 'Caja General';
    const counterpart = isOut ? 'Servicios e Insumos' : 'Cuentas a Cobrar';
    return [{
      id,
      date,
      description: row.concept || 'Movimiento de caja',
      status: 'posted',
      sourceModule: 'caja',
      origin: 'app',
      sourceId: row.id,
      createdAt: row.createdAt || `${date}T12:00:00.000Z`,
      lines: isOut
        ? [
          { account: counterpart, type: 'debit', amount },
          { account: cashAccount, type: 'credit', amount },
        ]
        : [
          { account: cashAccount, type: 'debit', amount },
          { account: counterpart, type: 'credit', amount },
        ],
    }];
  });
}

export function buildEventJournalEntries(reservations = [], posted = []) {
  const postedIds = new Set(
    (posted || []).flatMap((entry) => [String(entry.id || ''), String(entry.sourceId || '')]),
  );
  return imputedEventReservations(reservations).flatMap((reservation) => {
    const id = eventJournalId(reservation);
    if (!id || postedIds.has(id) || postedIds.has(String(reservation.id || ''))) return [];
    const amount = reservationChargeAmount(reservation, undefined, { includeCharged: true });
    if (!(amount > 0)) return [];
    const journal = buildEventImputationJournal(reservation, amount, {
      name: reservation.memberName,
      memberId: reservation.memberId,
    });
    return [{
      ...journal,
      id,
      status: 'posted',
      sourceModule: 'eventos',
      origin: 'app',
      sourceId: reservation.id || reservation.accessinId,
      createdAt: journal.date ? `${journal.date}T12:00:00.000Z` : undefined,
    }];
  });
}

/**
 * Libro oficial del ejercicio: asientos vivos + liquidaciones de cuota
 * + caja LILA agrupada por día. No pisa lo ya imputado en journal_entries.
 */
export function buildOfficialJournalEntries({
  journalEntries = [],
  feePeriods = [],
  accessinCashMovements = [],
  cashMovements = [],
  reservations = [],
} = {}) {
  const posted = postedJournalEntries(journalEntries);
  const postedIds = new Set(posted.map((entry) => String(entry.id)));
  const extras = [];

  for (const period of resolveFeePeriods(feePeriods)) {
    const entry = buildFeePeriodJournalEntry(period);
    if (!entry) continue;
    if (postedIds.has(entry.id) || posted.some((row) => row.sourceId === period.id)) continue;
    extras.push(entry);
  }

  extras.push(...buildLilaCashJournalEntries(accessinCashMovements));
  extras.push(...buildLiveCashJournalEntries(cashMovements, posted));
  extras.push(...buildEventJournalEntries(reservations, posted));
  return [...posted, ...extras];
}

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const JOURNAL_KIND_LABELS = {
  liquidation: 'Liquidación',
  'lila-cash': 'Caja',
  'lila-bank': 'Bancos',
  dues: 'Cobro',
  pool: 'Pileta',
  event: 'Evento',
  cash: 'Caja',
  expense: 'Gasto',
  live: 'Vivo',
};

export function journalMonthKey(dateKey) {
  const raw = String(dateKey || '');
  if (!raw || raw === 'sin-fecha') return 'sin-fecha';
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : 'sin-fecha';
}

export function journalMonthLabel(monthKey) {
  if (!monthKey || monthKey === 'sin-fecha') return 'Sin fecha';
  const [year, month] = String(monthKey).split('-');
  const name = MONTHS_ES[Number(month) - 1];
  return name ? `${name} de ${year}` : monthKey;
}

export function journalDayNumber(dateKey) {
  if (!dateKey || dateKey === 'sin-fecha') return '—';
  const day = Number(String(dateKey).slice(8, 10));
  return Number.isFinite(day) && day > 0 ? String(day) : '—';
}

export function journalEntryKind(entry) {
  const id = String(entry?.id || '');
  const description = String(entry?.description || entry?.concept || '');
  if (id.startsWith('je-liq-') || /^Liquidación de cuotas/i.test(description)) return 'liquidation';
  if (entry?.origin === 'lila' || id.startsWith('je-lila-')) {
    return /banco/i.test(description) ? 'lila-bank' : 'lila-cash';
  }
  const source = entry?.sourceModule;
  if (source === 'pileta') return 'pool';
  if (source === 'eventos') return 'event';
  if (source === 'gastos') return 'expense';
  if (source === 'cuotas') return 'dues';
  if (source === 'caja') return 'cash';
  return 'live';
}

export function journalKindFamily(kind) {
  if (kind === 'liquidation') return 'liq';
  if (kind === 'lila-cash' || kind === 'lila-bank') return 'lila';
  return 'live';
}

export function journalMixChips(mix = {}) {
  const chips = [];
  if (mix.liq) {
    chips.push({
      family: 'liq',
      label: mix.liq === 1 ? '1 liquidación' : `${mix.liq} liquidaciones`,
    });
  }
  if (mix.lila) {
    chips.push({
      family: 'lila',
      label: mix.lila === 1 ? '1 caja' : `${mix.lila} caja`,
    });
  }
  if (mix.live) {
    chips.push({
      family: 'live',
      label: mix.live === 1 ? '1 vivo' : `${mix.live} vivos`,
    });
  }
  return chips;
}

export function journalDayFamily(mix = {}) {
  const families = ['liq', 'lila', 'live'].filter((key) => mix[key] > 0);
  return families.length === 1 ? families[0] : 'mix';
}

/** Meses del más nuevo al más viejo; cada mes trae los días ya agrupados. */
export function groupJournalByMonth(entries = []) {
  const months = [];
  const byMonth = new Map();
  for (const entry of entries || []) {
    const date = journalDateKey(entry) || 'sin-fecha';
    const month = journalMonthKey(date);
    let bucket = byMonth.get(month);
    if (!bucket) {
      bucket = {
        key: month,
        label: journalMonthLabel(month),
        days: [],
        mix: { liq: 0, lila: 0, live: 0 },
        count: 0,
      };
      byMonth.set(month, bucket);
      months.push(bucket);
    }
    const kind = journalEntryKind(entry);
    const family = journalKindFamily(kind);
    bucket.mix[family] += 1;
    bucket.count += 1;
    const lastDay = bucket.days[bucket.days.length - 1];
    if (!lastDay || lastDay.key !== date) {
      bucket.days.push({
        key: date,
        entries: [entry],
        mix: { liq: 0, lila: 0, live: 0 },
        count: 0,
      });
    } else {
      lastDay.entries.push(entry);
    }
    const day = bucket.days[bucket.days.length - 1];
    day.mix[family] += 1;
    day.count += 1;
  }
  return months;
}

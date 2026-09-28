import { todayISODateAR } from '../../lib/arDate';
import { duesAmountForMember } from '../members/dues';
import { normalizeLines } from './journal';
import { getAccountById } from './chartOfAccounts';

/** Último corte LILA. Desde esta fecha el club suma lo que se carga acá. */
export const LILA_HANDOFF_ISO = '2026-10-01';

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function monthPrefix(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function entryDate(entry) {
  return String(entry?.date || entry?.entry_date || entry?.postedAt || '').slice(0, 10);
}

/**
 * Snapshot financiero real para el tablero operativo.
 * Prioriza pagos de socios + asientos del mes; no inventa montos.
 */
export function buildOpsFinanceSnapshot({
  members = [],
  journalEntries = [],
  chartOfAccounts = [],
  getAccountBalance,
  today = new Date(),
} = {}) {
  const ym = monthPrefix(today);
  const day = dayKey(today);
  const activeMembers = members.filter((m) => m.status !== 'inactive');
  const alDia = activeMembers.filter((m) => (Number(m.outstandingBalance) || 0) <= 0).length;
  const debtors = activeMembers.filter((m) => (Number(m.outstandingBalance) || 0) > 0);
  const debtTotal = debtors.reduce((s, m) => s + (Number(m.outstandingBalance) || 0), 0);
  const expectedMonth = activeMembers.reduce((s, m) => s + duesAmountForMember(m), 0);
  const collectionRate = activeMembers.length
    ? Math.round((alDia / activeMembers.length) * 100)
    : 0;

  const paymentRows = [];
  activeMembers.forEach((m) => {
    (m.paymentHistory || []).forEach((p) => {
      const date = String(p.date || p.paidAt || '').slice(0, 10);
      if (!date || p.status === 'void' || p.status === 'cancelled') return;
      paymentRows.push({
        id: p.id || `${m.memberId}-${date}-${p.amount}`,
        date,
        label: `${m.name} · ${p.concept || 'Cuota social'}`,
        amount: Number(p.amount) || 0,
        source: 'payment',
      });
    });
  });

  const paymentsMonth = paymentRows.filter((p) => p.date.startsWith(ym));
  const paymentsToday = paymentRows.filter((p) => p.date === day);
  const duesCollectedMonth = paymentsMonth.reduce((s, p) => s + p.amount, 0);
  const duesCollectedToday = paymentsToday.reduce((s, p) => s + p.amount, 0);

  let journalIncomeMonth = 0;
  let journalExpenseMonth = 0;
  const journalIncomeRows = [];

  (journalEntries || []).forEach((entry) => {
    if (entry.status === 'draft' || entry.status === 'void') return;
    const date = entryDate(entry);
    if (!date.startsWith(ym)) return;
    const lines = chartOfAccounts.length
      ? normalizeLines(entry.lines || [], chartOfAccounts)
      : (entry.lines || []).map((l, i) => ({
        accountId: l.accountId || l.account,
        debit: Number(l.debit ?? (l.type === 'debit' ? l.amount : 0)) || 0,
        credit: Number(l.credit ?? (l.type === 'credit' ? l.amount : 0)) || 0,
        lineOrder: i + 1,
      }));

    lines.forEach((line) => {
      const acc = getAccountById(chartOfAccounts, line.accountId)
        || chartOfAccounts.find((a) => a.name === line.accountId);
      const type = acc?.accountType;
      if (type === 'income' && line.credit > 0) {
        journalIncomeMonth += line.credit;
        journalIncomeRows.push({
          id: `${entry.id}-${line.accountId}-c`,
          date,
          label: entry.description || entry.concept || acc?.name || 'Ingreso',
          amount: line.credit,
          source: 'journal',
        });
      }
      if (type === 'expense' && line.debit > 0) {
        journalExpenseMonth += line.debit;
      }
    });
  });

  const journalIncomeTodayRows = journalIncomeRows.filter((r) => r.date === day);
  const journalIncomeToday = journalIncomeTodayRows.reduce((s, r) => s + r.amount, 0);

  // Evitar doble conteo si el cobro generó pago + asiento de cuotas
  const collectedMonth = duesCollectedMonth > 0
    ? duesCollectedMonth + Math.max(0, journalIncomeMonth - duesCollectedMonth)
    : journalIncomeMonth;

  const collectedToday = duesCollectedToday > 0
    ? duesCollectedToday + Math.max(0, journalIncomeToday - duesCollectedToday)
    : journalIncomeToday;

  const cashToday = typeof getAccountBalance === 'function'
    ? (Number(getAccountBalance('Caja General')) || 0)
      + (Number(getAccountBalance('Caja Cantina')) || 0)
      + (Number(getAccountBalance('Banco Nación')) || 0)
    : 0;

  const sortByDateDesc = (a, b) => String(b.date).localeCompare(String(a.date));

  const todayIncomes = [...paymentsToday, ...journalIncomeTodayRows]
    .sort(sortByDateDesc)
    .slice(0, 8);

  const recentIncomes = [...paymentsMonth, ...journalIncomeRows]
    .sort(sortByDateDesc)
    .slice(0, 5);

  return {
    monthKey: ym,
    dayKey: day,
    collectionRate,
    alDia,
    activeMembers: activeMembers.length,
    debtors: debtors.length,
    debtTotal,
    expectedMonth,
    collectedMonth,
    collectedToday,
    duesCollectedMonth,
    duesCollectedToday,
    journalIncomeMonth,
    journalIncomeToday,
    journalExpenseMonth,
    cashToday,
    todayIncomes,
    recentIncomes,
    hasJournal: (journalEntries || []).length > 0,
    hasPayments: paymentRows.length > 0,
  };
}

function feeSheetTotal(monthlySnapshot = {}) {
  const sheets = monthlySnapshot.detailSheets || [];
  const hit = sheets.find((sheet) => /cuotas imputadas/i.test(`${sheet.key || ''} ${sheet.title || ''}`));
  return money(hit?.total);
}

function cobroLabel(row = {}) {
  const name = String(row.memberName || [row.lastName, row.firstName].filter(Boolean).join(', ') || '').trim();
  const nro = String(row.memberNumber || '').trim();
  if (name) return name;
  if (nro) return `Socio Nº ${nro}`;
  return row.receiptId || 'Cobro';
}

function latestCobranzas(cobranzas = [], { limit = 8, day } = {}) {
  const rows = (cobranzas || [])
    .filter((row) => row?.date && (Number(row.amount) || 0) > 0)
    .toSorted((a, b) => {
      const byDate = String(b.date).localeCompare(String(a.date));
      if (byDate) return byDate;
      return String(b.receiptId || '').localeCompare(String(a.receiptId || ''));
    });
  const target = day || rows[0]?.date || '';
  return rows
    .filter((row) => row.date === target)
    .slice(0, limit)
    .map((row) => ({
      id: row.id || `${row.memberNumber}-${row.receiptId}`,
      date: row.date,
      label: cobroLabel(row),
      amount: money(row.amount),
    }));
}

/**
 * KPIs del widget Contabilidad de LILA: liquidado / recaudado / caja.
 * Devuelve null si todavía no cargó el corte.
 */
export function lilaContabilidadFromSnapshots({
  monthlySnapshot = {},
  detailedSnapshot = {},
  cashSnapshot = {},
  cobranzas = [],
  day,
} = {}) {
  const liquidado = feeSheetTotal(monthlySnapshot);
  const recaudado = money(detailedSnapshot.totalFeeEntries || detailedSnapshot.sumPaid);
  const cash = money(cashSnapshot.closingBalance || cashSnapshot.cards?.total?.balance);
  if (!(liquidado > 0 || recaudado > 0 || cash > 0)) return null;

  const periodTo = monthlySnapshot.periodTo || cashSnapshot.asOf || detailedSnapshot.asOf || '';
  return {
    source: 'lila',
    liquidado,
    recaudado,
    cash,
    rate: liquidado > 0 ? Math.round((recaudado / liquidado) * 100) : 0,
    periodFrom: monthlySnapshot.periodFrom || '',
    periodTo,
    periodKey: String(monthlySnapshot.periodLabel || periodTo).slice(0, 7),
    lastIncomes: latestCobranzas(cobranzas, { day }),
  };
}

export function isoDateOf(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return todayISODateAR(date);
}

function cashAccountIds(chart = []) {
  return new Set(
    (chart || [])
      .filter((account) => account?.isCashAccount)
      .map((account) => account.id),
  );
}

function journalLinesOf(entry, chartOfAccounts = []) {
  if (chartOfAccounts.length) return normalizeLines(entry.lines || [], chartOfAccounts);
  return (entry.lines || []).map((line, index) => ({
    accountId: line.accountId || line.account,
    debit: Number(line.debit ?? (line.type === 'debit' ? line.amount : 0)) || 0,
    credit: Number(line.credit ?? (line.type === 'credit' ? line.amount : 0)) || 0,
    lineOrder: index + 1,
  }));
}

/**
 * Movimientos propios del club desde el empalme con LILA (1/10/2026).
 * No incluye el diario de prueba anterior a esa fecha.
 */
export function appFinanceSinceHandoff({
  members = [],
  journalEntries = [],
  chartOfAccounts = [],
  feePeriods = [],
  since = LILA_HANDOFF_ISO,
  today = todayISODateAR(),
} = {}) {
  const sinceIso = isoDateOf(since) || LILA_HANDOFF_ISO;
  const todayIso = isoDateOf(today) || todayISODateAR();
  const cashIds = cashAccountIds(chartOfAccounts);
  const payments = [];

  (members || []).forEach((member) => {
    (member.paymentHistory || []).forEach((payment) => {
      const date = String(payment.date || payment.paidAt || '').slice(0, 10);
      if (!date || date < sinceIso) return;
      if (payment.status === 'void' || payment.status === 'cancelled') return;
      payments.push({
        id: payment.id || `${member.memberId}-${date}-${payment.amount}`,
        date,
        label: `${member.name || 'Socio'} · ${payment.concept || 'Cuota social'}`,
        amount: money(payment.amount),
        source: 'app',
      });
    });
  });

  let income = 0;
  let expense = 0;
  let cashDelta = 0;
  const incomes = [];

  (journalEntries || []).forEach((entry) => {
    if (entry.status === 'draft' || entry.status === 'void') return;
    const date = entryDate(entry);
    if (!date || date < sinceIso) return;
    const lines = journalLinesOf(entry, chartOfAccounts);
    lines.forEach((line) => {
      const account = getAccountById(chartOfAccounts, line.accountId)
        || chartOfAccounts.find((row) => row.name === line.accountId);
      const type = account?.accountType;
      if (type === 'income' && line.credit > 0) {
        income += line.credit;
        incomes.push({
          id: `${entry.id}-${line.accountId}-c`,
          date,
          label: entry.description || entry.concept || account?.name || 'Ingreso',
          amount: money(line.credit),
          source: 'app',
        });
      }
      if (type === 'expense' && line.debit > 0) expense += line.debit;
      if (account?.isCashAccount || cashIds.has(line.accountId)) {
        cashDelta += (Number(line.debit) || 0) - (Number(line.credit) || 0);
      }
    });
  });

  const liquidated = (feePeriods || []).reduce((sum, period) => {
    if (period?.status !== 'processed') return sum;
    const year = Number(period.year);
    const month = Number(period.month);
    if (!year || !month) return sum;
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    if (start < sinceIso) return sum;
    return sum + (Number(period.amount) || Number(period.totalAmount) || 0);
  }, 0);

  const collected = payments.reduce((sum, row) => sum + row.amount, 0);
  const todayIncomes = [...payments, ...incomes]
    .filter((row) => row.date === todayIso)
    .toSorted((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    since: sinceIso,
    today: todayIso,
    collectedSince: money(collected),
    liquidatedSince: money(liquidated),
    incomeSince: money(income),
    expenseSince: money(expense),
    cashDelta: money(cashDelta),
    todayIncomes,
    hasActivity: collected > 0 || liquidated > 0 || income > 0 || expense > 0 || cashDelta !== 0,
  };
}

/**
 * Corte LILA + lo cargado en el club desde el 1/10/2026.
 */
export function composeClubFinance({
  lila = null,
  lilaCards = {},
  members = [],
  journalEntries = [],
  chartOfAccounts = [],
  feePeriods = [],
  today = todayISODateAR(),
  since = LILA_HANDOFF_ISO,
} = {}) {
  const app = appFinanceSinceHandoff({
    members,
    journalEntries,
    chartOfAccounts,
    feePeriods,
    since,
    today,
  });
  const liquidado = money((lila?.liquidado || 0) + app.liquidatedSince);
  const recaudado = money((lila?.recaudado || 0) + app.collectedSince);
  const cash = money((lila?.cash || 0) + app.cashDelta);
  const income = money((Number(lilaCards.totalIncome) || 0) + app.incomeSince);
  const expenses = money((Number(lilaCards.totalExpenses) || 0) + app.expenseSince);
  if (!(liquidado > 0 || recaudado > 0 || cash > 0 || income > 0 || app.hasActivity)) return null;

  return {
    source: app.hasActivity && lila ? 'lila+app' : (lila ? 'lila' : 'app'),
    liquidado,
    recaudado,
    cash,
    rate: liquidado > 0 ? Math.round((recaudado / liquidado) * 100) : 0,
    income,
    expenses,
    result: money(income - expenses),
    added: {
      recaudado: app.collectedSince,
      liquidado: app.liquidatedSince,
      cash: app.cashDelta,
      income: app.incomeSince,
      expenses: app.expenseSince,
    },
    lastIncomes: app.todayIncomes.length ? app.todayIncomes : (lila?.lastIncomes || []),
    periodFrom: lila?.periodFrom || '',
    periodTo: lila?.periodTo || '',
    periodKey: lila?.periodKey || '',
    since: app.since,
  };
}

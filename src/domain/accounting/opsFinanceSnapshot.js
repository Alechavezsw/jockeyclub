import { duesAmountForMember } from '../members/dues';
import { normalizeLines } from './journal';
import { getAccountById } from './chartOfAccounts';

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

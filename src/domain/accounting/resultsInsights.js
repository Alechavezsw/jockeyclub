import { getAccountById } from './chartOfAccounts';
import {
  journalDateKey,
  normalizeLines,
  postedJournalEntries,
} from './journal';

const MONTHS_SHORT = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

export function monthLabelAR(yyyyMm) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm || ''));
  if (!match) return yyyyMm || '—';
  const month = MONTHS_SHORT[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : yyyyMm;
}

function addAmount(map, key, amount) {
  if (!key || !amount) return;
  map.set(key, (map.get(key) || 0) + amount);
}

/**
 * Serie mensual, mix por cuenta y por origen a partir del diario oficial.
 */
export function buildResultsInsights(entries = [], chart = []) {
  const months = new Map();
  const incomeByAccount = new Map();
  const expenseByAccount = new Map();
  const incomeBySource = new Map();
  let asientos = 0;

  for (const entry of postedJournalEntries(entries)) {
    asientos += 1;
    const monthKey = journalDateKey(entry).slice(0, 7);
    const bucket = months.get(monthKey) || { income: 0, expense: 0 };
    const source = entry.sourceModule || 'manual';

    for (const line of normalizeLines(entry.lines || [], chart)) {
      const account = getAccountById(chart, line.accountId);
      if (!account) continue;
      if (account.accountType === 'income') {
        const amount = (Number(line.credit) || 0) - (Number(line.debit) || 0);
        if (amount) {
          bucket.income += amount;
          addAmount(incomeByAccount, account.name, amount);
          addAmount(incomeBySource, source, amount);
        }
      }
      if (account.accountType === 'expense') {
        const amount = (Number(line.debit) || 0) - (Number(line.credit) || 0);
        if (amount) {
          bucket.expense += amount;
          addAmount(expenseByAccount, account.name, amount);
        }
      }
    }
    if (monthKey) months.set(monthKey, bucket);
  }

  const series = [...months.entries()]
    .filter(([key]) => /^\d{4}-\d{2}$/.test(key))
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([month, values]) => ({
      month,
      label: monthLabelAR(month),
      income: values.income,
      expense: values.expense,
      result: values.income - values.expense,
    }));

  const toMix = (map) => [...map.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .toSorted((a, b) => b.amount - a.amount);

  const incomeMix = toMix(incomeByAccount);
  const expenseMix = toMix(expenseByAccount);
  const sourceMix = toMix(incomeBySource);
  const income = incomeMix.reduce((sum, row) => sum + row.amount, 0);
  const expense = expenseMix.reduce((sum, row) => sum + row.amount, 0);
  const result = income - expense;
  const margin = income > 0 ? result / income : 0;
  const coverage = expense > 0 ? income / expense : null;
  const monthCount = series.length;
  const avgMonthlyIncome = monthCount ? income / monthCount : 0;
  const avgMonthlyExpense = monthCount ? expense / monthCount : 0;
  const peakIncome = series.reduce((best, row) => (!best || row.income > best.income ? row : best), null);
  const bestMonth = series.reduce((best, row) => (!best || row.result > best.result ? row : best), null);
  const worstMonth = series.reduce((worst, row) => (!worst || row.result < worst.result ? row : worst), null);
  const lastMonthRow = series[series.length - 1] || null;
  const prevMonthRow = series[series.length - 2] || null;
  const lastDelta = lastMonthRow && prevMonthRow ? lastMonthRow.result - prevMonthRow.result : null;
  const topIncome = incomeMix[0] || null;
  const concentration = income > 0 && topIncome ? topIncome.amount / income : 0;
  const surplusMonths = series.filter((row) => row.result >= 0).length;
  const deficitMonths = monthCount - surplusMonths;

  return {
    asientos,
    income,
    expense,
    result,
    margin,
    coverage,
    series,
    incomeMix,
    expenseMix,
    sourceMix,
    firstMonth: series[0]?.month || '',
    lastMonth: lastMonthRow?.month || '',
    monthCount,
    avgMonthlyIncome,
    avgMonthlyExpense,
    peakIncome,
    bestMonth,
    worstMonth,
    lastMonthRow,
    prevMonthRow,
    lastDelta,
    topIncome,
    concentration,
    surplusMonths,
    deficitMonths,
  };
}

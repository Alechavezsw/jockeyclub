import { todayISODateAR } from '../../lib/arDate';
import { appMonthlyDebtForMember, formatMonthlyDebtsAsOf } from './appMonthlyDebts';
import { journalMonthLabel } from './officialJournal';
import { filterLiquidationCc } from './liquidationCc';

const EPS = 0.009;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function asIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return todayISODateAR(value);
  }
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayISODateAR();
}

export function liveLiquidationCcFromDebt(debt, periodKey) {
  if (!debt || !periodKey) return null;
  const months = debt.months || [];
  const selected = months.find((month) => month.periodKey === periodKey);
  const older = months.filter((month) => month.periodKey !== periodKey);
  const liquidation = roundMoney(selected?.capital);
  const surcharge = roundMoney(selected?.interest);
  const interests = roundMoney(older.reduce((sum, month) => sum + (Number(month.interest) || 0), 0));
  const previousBalance = roundMoney(older.reduce((sum, month) => sum + (Number(month.capital) || 0), 0));
  const others = roundMoney(debt.unallocated);
  if (![liquidation, surcharge, interests, previousBalance, others].some((amount) => Math.abs(amount) > EPS)) {
    return null;
  }
  return {
    id: `${debt.memberNumber}-${periodKey}`,
    memberNumber: debt.memberNumber,
    memberName: debt.memberName,
    firstName: debt.firstName,
    lastName: debt.lastName,
    documentNumber: debt.dni,
    previousBalance,
    liquidation,
    others,
    interests,
    withoutSurcharge: roundMoney(previousBalance + liquidation + others),
    surcharge,
    standing: debt.standing,
  };
}

export function buildLiveLiquidationCc(members = [], { today } = {}) {
  const asOf = asIsoDate(today);
  const debts = [];
  const periodSet = new Set();
  for (const member of members) {
    const debt = appMonthlyDebtForMember(member, { today: asOf });
    if (!debt) continue;
    debts.push(debt);
    for (const month of debt.months || []) {
      if (month.periodKey) periodSet.add(month.periodKey);
    }
  }
  const currentKey = asOf.slice(0, 7);
  if (currentKey) periodSet.add(currentKey);
  const periodKeys = [...periodSet]
    .toSorted((a, b) => b.localeCompare(a))
    .slice(0, 12);
  return {
    asOf,
    asOfLabel: formatMonthlyDebtsAsOf(asOf),
    periodKeys,
    periods: periodKeys.map((key) => ({
      key,
      label: journalMonthLabel(key),
    })),
    debts,
    sourceCount: members.length,
  };
}

function summarizeLiveLiquidationCc(items, book, periodKey) {
  const list = items || [];
  const add = (key) => roundMoney(list.reduce((sum, row) => sum + (Number(row[key]) || 0), 0));
  return {
    asOf: book.asOf,
    generatedAt: book.asOfLabel,
    periodKey,
    periodLabel: journalMonthLabel(periodKey),
    sourceCount: book.sourceCount,
    listedCount: list.length,
    withLiquidation: list.filter((row) => Math.abs(Number(row.liquidation) || 0) > EPS).length,
    withPrevious: list.filter((row) => Math.abs(Number(row.previousBalance) || 0) > EPS).length,
    previousBalance: add('previousBalance'),
    liquidation: add('liquidation'),
    others: add('others'),
    interests: add('interests'),
    withoutSurcharge: add('withoutSurcharge'),
    surcharge: add('surcharge'),
  };
}

export function liveLiquidationCcBook(book, periodKey) {
  const key = periodKey && book.periodKeys.includes(periodKey)
    ? periodKey
    : (book.periodKeys[0] || '');
  const items = [];
  for (const debt of book.debts || []) {
    const row = liveLiquidationCcFromDebt(debt, key);
    if (row) items.push(row);
  }
  items.sort((a, b) => {
    const liq = Math.abs(Number(b.liquidation) || 0) - Math.abs(Number(a.liquidation) || 0);
    if (liq) return liq;
    const prev = Math.abs(Number(b.previousBalance) || 0) - Math.abs(Number(a.previousBalance) || 0);
    if (prev) return prev;
    return String(a.memberNumber || '').localeCompare(String(b.memberNumber || ''), 'es', { numeric: true });
  });
  return {
    periodKey: key,
    items,
    summary: summarizeLiveLiquidationCc(items, book, key),
  };
}

export { filterLiquidationCc };

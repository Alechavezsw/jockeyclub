/** Deudas mes a mes / morosos Accessin-LILA. */

import { readSnapshot } from '../../data/snapshots';
import { memberNumberOf } from '../members/households';

const EMPTY_MONTHLY_DEBTS_SEED = Object.freeze({
  ACCESSIN_MONTHLY_DEBTS_AS_OF: '',
  ACCESSIN_MONTHLY_DEBTS_BY_NUMBER: {},
  ACCESSIN_MONTHLY_DEBTS_SNAPSHOT: {},
});

/** Snapshot `accessinMonthlyDebts`; vacío hasta que carga (ver data/snapshots). */
export function monthlyDebtsSeed() {
  return readSnapshot('accessinMonthlyDebts', EMPTY_MONTHLY_DEBTS_SEED);
}

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

export function lookupMonthlyDebt(memberNumber) {
  const key = padMember(memberNumber);
  if (!key) return null;
  return monthlyDebtsSeed().ACCESSIN_MONTHLY_DEBTS_BY_NUMBER[key] || null;
}

export function debtMonthOf(debtor, periodKey) {
  if (!periodKey || periodKey === 'all') return null;
  return (debtor?.months || []).find((row) => row.periodKey === periodKey) || null;
}

function monthHasDebt(row) {
  if (!row) return false;
  return (Number(row.capital) || 0) !== 0 || (Number(row.interest) || 0) !== 0;
}

export function withPeriodAmounts(debtor, periodKey) {
  if (!periodKey || periodKey === 'all' || !debtor) return debtor;
  const row = debtMonthOf(debtor, periodKey);
  if (!row) return null;
  const capital = Number(row.capital) || 0;
  const interest = Number(row.interest) || 0;
  return {
    ...debtor,
    capital,
    interest,
    totalDebt: Number(row.accumulated) || capital + interest,
    periodMonth: row,
  };
}

export function listMonthlyDebtors({
  byNumber = monthlyDebtsSeed().ACCESSIN_MONTHLY_DEBTS_BY_NUMBER,
  query = '',
  onlyWithDebt = true,
  periodKey = 'all',
} = {}) {
  const q = String(query || '').trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  return Object.values(byNumber || {})
    .filter((m) => {
      if (onlyWithDebt && !(Number(m.totalDebt) > 0)) return false;
      if (periodKey && periodKey !== 'all' && !monthHasDebt(debtMonthOf(m, periodKey))) return false;
      if (!q) return true;
      const hay = [
        m.memberName,
        m.firstName,
        m.lastName,
        m.memberNumber,
        m.dni,
        m.socialFee,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      if (hay.includes(q)) return true;
      if (qDigits && String(m.memberNumber || '').includes(qDigits)) return true;
      if (qDigits && String(m.dni || '').includes(qDigits)) return true;
      return false;
    })
    .map((m) => withPeriodAmounts(m, periodKey) || m)
    .toSorted((a, b) => (Number(b.totalDebt) || 0) - (Number(a.totalDebt) || 0)
      || String(a.memberNumber).localeCompare(String(b.memberNumber)));
}

export function monthlyDebtForMember(member) {
  return lookupMonthlyDebt(memberNumberOf(member) || member?.memberId);
}

/** Períodos únicos ordenados (para filtros). */
export function listDebtPeriods(byNumber = monthlyDebtsSeed().ACCESSIN_MONTHLY_DEBTS_BY_NUMBER) {
  const map = new Map();
  Object.values(byNumber || {}).forEach((m) => {
    (m.months || []).forEach((row) => {
      if (row.periodKey) map.set(row.periodKey, row.periodLabel || row.periodKey);
    });
  });
  return [...map.entries()]
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([periodKey, periodLabel]) => ({ periodKey, periodLabel }));
}

export function filterDebtorsByPeriod(debtors = [], periodKey = 'all') {
  if (!periodKey || periodKey === 'all') return debtors;
  return debtors
    .filter((m) => monthHasDebt(debtMonthOf(m, periodKey)))
    .map((m) => withPeriodAmounts(m, periodKey) || m);
}

export function debtMonthAmount(debtor, periodKey) {
  const hit = debtMonthOf(debtor, periodKey);
  return hit ? Number(hit.capital) || 0 : 0;
}

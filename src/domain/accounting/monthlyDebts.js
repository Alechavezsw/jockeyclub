/** Deudas mes a mes / morosos Accessin-LILA. */

import {
  ACCESSIN_MONTHLY_DEBTS_AS_OF,
  ACCESSIN_MONTHLY_DEBTS_BY_NUMBER,
  ACCESSIN_MONTHLY_DEBTS_SNAPSHOT,
} from '../../data/seed/accessinMonthlyDebts';
import { memberNumberOf } from '../members/households';

export {
  ACCESSIN_MONTHLY_DEBTS_AS_OF,
  ACCESSIN_MONTHLY_DEBTS_BY_NUMBER,
  ACCESSIN_MONTHLY_DEBTS_SNAPSHOT,
};

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

export function lookupMonthlyDebt(memberNumber) {
  const key = padMember(memberNumber);
  if (!key) return null;
  return ACCESSIN_MONTHLY_DEBTS_BY_NUMBER[key] || null;
}

export function listMonthlyDebtors({
  byNumber = ACCESSIN_MONTHLY_DEBTS_BY_NUMBER,
  query = '',
  onlyWithDebt = true,
} = {}) {
  const q = String(query || '').trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  return Object.values(byNumber || {})
    .filter((m) => {
      if (onlyWithDebt && !(Number(m.totalDebt) > 0)) return false;
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
    .toSorted((a, b) => (Number(b.totalDebt) || 0) - (Number(a.totalDebt) || 0)
      || String(a.memberNumber).localeCompare(String(b.memberNumber)));
}

export function monthlyDebtForMember(member) {
  return lookupMonthlyDebt(memberNumberOf(member) || member?.memberId);
}

/** Períodos únicos ordenados (para filtros). */
export function listDebtPeriods(byNumber = ACCESSIN_MONTHLY_DEBTS_BY_NUMBER) {
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
  return debtors.filter((m) => (m.months || []).some((row) => row.periodKey === periodKey));
}

export function debtMonthAmount(debtor, periodKey) {
  const hit = (debtor?.months || []).find((row) => row.periodKey === periodKey);
  return hit ? Number(hit.capital) || 0 : 0;
}

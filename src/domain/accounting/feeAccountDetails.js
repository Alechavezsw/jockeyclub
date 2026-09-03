/** Detalle de cuentas contables de cuotas (Accessin / LILA). */

import {
  ACCESSIN_FEE_ACCOUNT_DETAILS,
  ACCESSIN_FEE_ACCOUNT_DETAILS_AS_OF,
  ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT,
} from '../../data/seed/accessinFeeAccountDetails';

export {
  ACCESSIN_FEE_ACCOUNT_DETAILS,
  ACCESSIN_FEE_ACCOUNT_DETAILS_AS_OF,
  ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT,
};

export function periodKeyFromParts(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return '';
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function periodKeyFromPeriod(period) {
  if (!period) return '';
  if (period.periodKey) return period.periodKey;
  return periodKeyFromParts(period.year, period.month);
}

export function feeAccountDetailsForPeriod(periodOrKey, list = ACCESSIN_FEE_ACCOUNT_DETAILS) {
  const key = typeof periodOrKey === 'string'
    ? periodOrKey
    : periodKeyFromPeriod(periodOrKey);
  if (!key) return [];
  return (list || []).filter((a) => a.periodKey === key);
}

export function feeAccountDetailsSummary(accounts = []) {
  const list = accounts || [];
  return {
    accountCount: list.length,
    lineCount: list.reduce((s, a) => s + (a.lineCount || (a.lines || []).length || 0), 0),
    totalAmount: list.reduce((s, a) => s + (Number(a.total) || 0), 0),
  };
}

export function filterFeeAccountLines(lines = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return lines || [];
  return (lines || []).filter((l) => {
    const hay = [
      l.memberNumber,
      l.memberName,
      l.dni,
      l.type,
      l.description,
      l.collectedAtLabel,
      l.feeDateLabel,
    ].map((x) => String(x || '').toLowerCase()).join(' ');
    return hay.includes(q);
  });
}

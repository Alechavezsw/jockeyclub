/** Detalle de cuentas contables de cuotas (Accessin / LILA). */

import { readSnapshot } from '../../data/snapshots';

const EMPTY_FEE_ACCOUNT_DETAILS_SEED = Object.freeze({
  ACCESSIN_FEE_ACCOUNT_DETAILS: [],
  ACCESSIN_FEE_ACCOUNT_DETAILS_AS_OF: '',
  ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT: {},
});

/** Snapshot `accessinFeeAccountDetails`; vacío hasta que carga (ver data/snapshots). */
export function feeAccountDetailsSeed() {
  return readSnapshot('accessinFeeAccountDetails', EMPTY_FEE_ACCOUNT_DETAILS_SEED);
}

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

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function labelFromPeriodKey(key) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return key;
  return `${MONTHS_ES[m - 1] || m} del ${y}`;
}

function lineBelongsToFeeMonth(line, key) {
  const fee = String(line?.feeDate || '').slice(0, 7);
  if (fee === key) return true;
  const label = `${labelFromPeriodKey(key)}`.toLowerCase();
  return String(line?.description || '').toLowerCase().includes(label)
    || String(line?.feeDateLabel || '').toLowerCase().includes(label);
}

/** Recorta el export LILA a las cuotas de un mes (el archivo de sept. trae mayo, junio, etc.). */
export function sliceFeeAccountsByFeeMonth(list = feeAccountDetailsSeed().ACCESSIN_FEE_ACCOUNT_DETAILS, key) {
  if (!key) return [];
  return (list || []).flatMap((account) => {
    const lines = (account.lines || []).filter((line) => lineBelongsToFeeMonth(line, key));
    if (!lines.length) return [];
    const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    return [{
      ...account,
      id: `${account.id}-${key}`,
      periodKey: key,
      periodLabel: labelFromPeriodKey(key),
      lines,
      lineCount: lines.length,
      total,
      slicedFromExport: account.periodKey || null,
    }];
  });
}

export function feeAccountDetailsForPeriod(periodOrKey, list = feeAccountDetailsSeed().ACCESSIN_FEE_ACCOUNT_DETAILS) {
  const key = typeof periodOrKey === 'string'
    ? periodOrKey
    : periodKeyFromPeriod(periodOrKey);
  if (!key) return [];
  const byExport = (list || []).filter((account) => account.periodKey === key);
  if (byExport.length) return byExport;
  return sliceFeeAccountsByFeeMonth(list, key);
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

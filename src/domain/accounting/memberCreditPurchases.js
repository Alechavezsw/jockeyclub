/** Créditos comprados por socios (Accessin / LILA). */

import { readSnapshot } from '../../data/snapshots';

const EMPTY_CREDIT_PURCHASES_SEED = Object.freeze({
  ACCESSIN_CREDIT_PURCHASES: [],
  ACCESSIN_CREDIT_PURCHASES_AS_OF: '',
  ACCESSIN_CREDIT_PURCHASES_SNAPSHOT: {},
});

/** Snapshot `accessinMemberCreditPurchases`; vacío hasta que carga (ver data/snapshots). */
export function creditPurchasesSeed() {
  return readSnapshot('accessinMemberCreditPurchases', EMPTY_CREDIT_PURCHASES_SEED);
}

const HEADER = [
  'nro de socio',
  'nombre',
  'apellido',
  'documento',
  'fecha de compra',
  'combo',
  'cantidad de creditos',
  'medio de pago',
  'importe total',
  'estado',
  'fecha de cobro',
  'monto cobrado',
  'diferencia',
];

function cell(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function money(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  const raw = cell(value).replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return '';
  const utc = new Date(Math.round((n - 25569) * 86400 * 1000));
  if (Number.isNaN(utc.getTime())) return '';
  return utc.toISOString().slice(0, 10);
}

export function parseAccessinDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = cell(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(Number(slash[2])).padStart(2, '0')}-${String(Number(slash[1])).padStart(2, '0')}`;
  }
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(text)) {
    return excelSerialToIso(value);
  }
  return '';
}

function normalizeHeader(value) {
  return cell(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function findCreditPurchaseHeaderIndex(rows = []) {
  return (rows || []).findIndex((row) => {
    const first = normalizeHeader(row?.[0]);
    const combo = normalizeHeader(row?.[5]);
    return first === HEADER[0] && combo === 'combo';
  });
}

export function parseCreditPurchaseRow(row, index = 0) {
  const memberNumber = digits(row?.[0]);
  if (!memberNumber) return null;
  const firstName = cell(row?.[1]);
  const lastName = cell(row?.[2]);
  const totalAmount = money(row?.[8]);
  const collectedAmount = money(row?.[11]);
  const difference = row?.[12] === '' || row?.[12] == null
    ? Math.round((totalAmount - collectedAmount) * 100) / 100
    : money(row?.[12]);
  return {
    id: `cred-${memberNumber}-${index}`,
    memberNumber,
    firstName,
    lastName,
    memberName: [firstName, lastName].filter(Boolean).join(' '),
    documentNumber: digits(row?.[3]) || cell(row?.[3]),
    purchasedAt: parseAccessinDate(row?.[4]),
    combo: cell(row?.[5]),
    credits: Number(row?.[6]) || 0,
    paymentMethod: cell(row?.[7]),
    totalAmount,
    status: cell(row?.[9]),
    collectedAt: parseAccessinDate(row?.[10]),
    collectedAmount,
    difference,
    source: 'accessin',
  };
}

export function parseCreditPurchaseRows(rows = []) {
  const headerIdx = findCreditPurchaseHeaderIndex(rows);
  if (headerIdx < 0) return [];
  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const parsed = parseCreditPurchaseRow(rows[i], i);
    if (parsed) items.push(parsed);
  }
  return items;
}

export function creditPurchaseSummary(
  items = creditPurchasesSeed().ACCESSIN_CREDIT_PURCHASES,
  snapshot = creditPurchasesSeed().ACCESSIN_CREDIT_PURCHASES_SNAPSHOT,
) {
  const list = items || [];
  const uniqueMembers = new Set(list.map((row) => row.memberNumber).filter(Boolean));
  const totalAmount = list.reduce((sum, row) => sum + (Number(row.totalAmount) || 0), 0);
  const collectedAmount = list.reduce((sum, row) => sum + (Number(row.collectedAmount) || 0), 0);
  const credits = list.reduce((sum, row) => sum + (Number(row.credits) || 0), 0);
  const pending = list.filter((row) => Number(row.difference) > 0).length;
  return {
    asOf: snapshot?.asOf || creditPurchasesSeed().ACCESSIN_CREDIT_PURCHASES_AS_OF,
    count: list.length,
    uniqueMembers: uniqueMembers.size,
    totalAmount: Math.round(totalAmount * 100) / 100,
    collectedAmount: Math.round(collectedAmount * 100) / 100,
    difference: Math.round((totalAmount - collectedAmount) * 100) / 100,
    credits,
    pending,
  };
}

export function filterCreditPurchases(
  items = creditPurchasesSeed().ACCESSIN_CREDIT_PURCHASES,
  { query = '', status = '', paymentMethod = '' } = {},
) {
  const q = String(query || '').trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  const statusKey = String(status || '').trim().toLowerCase();
  const methodKey = String(paymentMethod || '').trim().toLowerCase();
  return (items || []).filter((row) => {
    if (statusKey && String(row.status || '').toLowerCase() !== statusKey) return false;
    if (methodKey && String(row.paymentMethod || '').toLowerCase() !== methodKey) return false;
    if (!q) return true;
    const hay = [row.memberName, row.firstName, row.lastName, row.memberNumber, row.documentNumber, row.combo, row.paymentMethod, row.status]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    if (hay.includes(q)) return true;
    if (qDigits && String(row.memberNumber || '').includes(qDigits)) return true;
    if (qDigits && String(row.documentNumber || '').includes(qDigits)) return true;
    return false;
  });
}

export function creditPurchasesForMember(memberNumber, items = creditPurchasesSeed().ACCESSIN_CREDIT_PURCHASES) {
  const key = digits(memberNumber);
  if (!key) return [];
  return (items || []).filter((row) => digits(row.memberNumber) === key);
}

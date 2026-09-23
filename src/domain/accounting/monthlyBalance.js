/** Balance Mensual Accessin / LILA. */

import { readSnapshot, requireSnapshots } from '../../data/snapshots';

const EMPTY_MONTHLY_BALANCE_SEED = Object.freeze({
  ACCESSIN_MONTHLY_BALANCE_AS_OF: '',
  ACCESSIN_MONTHLY_BALANCE_SECTIONS: [],
  ACCESSIN_MONTHLY_BALANCE_SNAPSHOT: {},
});

/** Snapshot `accessinMonthlyBalance`; vacío hasta que carga (ver data/snapshots). */
export function monthlyBalanceSeed() {
  return readSnapshot('accessinMonthlyBalance', EMPTY_MONTHLY_BALANCE_SEED);
}

const COLUMN_LABELS = {
  nro_de_socio: 'Socio',
  nombre: 'Nombre',
  apellido: 'Apellido',
  dni: 'DNI',
  tipo: 'Tipo',
  tipo_de_cuota: 'Cuota',
  concepto: 'Concepto',
  descripcion: 'Descripción',
  fecha: 'Fecha',
  monto: 'Monto',
  imputado: 'Imputado',
};

const MONEY_COLUMNS = new Set(['monto', 'imputado']);

function slugHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function monthlyBalanceCards(snapshot = monthlyBalanceSeed().ACCESSIN_MONTHLY_BALANCE_SNAPSHOT) {
  const data = snapshot || {};
  return {
    asOf: data.asOf || monthlyBalanceSeed().ACCESSIN_MONTHLY_BALANCE_AS_OF,
    periodFrom: data.periodFrom || '',
    periodTo: data.periodTo || '',
    periodLabel: data.periodLabel || '',
    generatedAt: data.generatedAt || '',
    fileName: data.fileName || '',
    sourceFolder: data.sourceFolder || '',
    complete: Boolean(data.complete),
    client: data.client || '',
    totalIncome: Number(data.totalIncome) || 0,
    totalIncomeCash: Number(data.totalIncomeCash) || 0,
    totalExpenses: Number(data.totalExpenses) || 0,
    totalExpensesCash: Number(data.totalExpensesCash) || 0,
    cashOnHand: Number(data.cashOnHand) || 0,
    closingCash: Number(data.closingCash) || 0,
  };
}

export function findMonthlyBalanceSection(sections = monthlyBalanceSeed().ACCESSIN_MONTHLY_BALANCE_SECTIONS, id) {
  if (!id) return null;
  return (sections || []).find((section) => section.id === id) || null;
}

export function resolveMonthlyBalanceDetail(details, key) {
  if (!key || !details) return null;
  return details[key] || null;
}

export function filterMonthlyBalanceDetailRows(rows = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  if (!q) return rows || [];
  return (rows || []).filter((row) => {
    const hay = Object.values(row)
      .map((value) => String(value ?? '').toLowerCase())
      .join(' ');
    if (hay.includes(q)) return true;
    if (qDigits && hay.replace(/\D/g, '').includes(qDigits)) return true;
    return false;
  });
}

export function monthlyBalanceDetailColumns(detail) {
  const headers = detail?.headers || [];
  return headers.flatMap((header) => {
    if (!header || header === '#') return [];
    const key = slugHeader(header);
    if (!key || key.startsWith('col_')) return [];
    return [{
      key,
      label: COLUMN_LABELS[key] || header,
      money: MONEY_COLUMNS.has(key),
    }];
  });
}

export function isMonthlyBalanceMoneyColumn(key) {
  return MONEY_COLUMNS.has(key);
}

/**
 * Detalle por hoja del balance (`accessinMonthlyBalanceDetails`, 1,5 MB). Se baja aparte,
 * solo cuando se abre una línea. Rechaza si no se pudo cargar.
 */
export async function loadMonthlyBalanceDetails() {
  const [data] = await requireSnapshots(['accessinMonthlyBalanceDetails']);
  return data.ACCESSIN_MONTHLY_BALANCE_DETAILS || {};
}

/** Detalle de Cta. Cte. Liquidación Accessin / LILA. */

import {
  ACCESSIN_LIQUIDATION_CC,
  ACCESSIN_LIQUIDATION_CC_AS_OF,
  ACCESSIN_LIQUIDATION_CC_SNAPSHOT,
} from '../../data/seed/accessinLiquidationCc';

export {
  ACCESSIN_LIQUIDATION_CC,
  ACCESSIN_LIQUIDATION_CC_AS_OF,
  ACCESSIN_LIQUIDATION_CC_SNAPSHOT,
};

function cell(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function money(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  const raw = cell(value).replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeHeader(value) {
  return cell(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function findLiquidationCcHeaderIndex(rows = []) {
  return (rows || []).findIndex((row) => normalizeHeader(row?.[0]) === 'nro de socio');
}

export function parseLiquidationCcRow(row, index = 0) {
  const memberNumber = cell(row?.[0]);
  if (!memberNumber || /^totales$/i.test(memberNumber)) return null;
  const firstName = cell(row?.[1]);
  const lastName = cell(row?.[2]);
  return {
    id: `liq-${memberNumber}-${index}`,
    memberNumber,
    firstName,
    lastName,
    memberName: [firstName, lastName].filter(Boolean).join(' '),
    documentNumber: cell(row?.[3]),
    previousBalance: money(row?.[4]),
    liquidation: money(row?.[5]),
    others: money(row?.[6]),
    interests: money(row?.[7]),
    withoutSurcharge: money(row?.[8]),
    surcharge: money(row?.[9]),
    surchargeAlt: money(row?.[10]),
  };
}

export function parseLiquidationCcRows(rows = []) {
  const headerIdx = findLiquidationCcHeaderIndex(rows);
  if (headerIdx < 0) return [];
  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const parsed = parseLiquidationCcRow(rows[i], i);
    if (parsed) items.push(parsed);
  }
  return items;
}

export function liquidationCcSummary(items = ACCESSIN_LIQUIDATION_CC, snapshot = ACCESSIN_LIQUIDATION_CC_SNAPSHOT) {
  const list = items || [];
  return {
    asOf: snapshot?.asOf || ACCESSIN_LIQUIDATION_CC_AS_OF,
    fileName: snapshot?.fileName || '',
    generatedAt: snapshot?.generatedAt || '',
    periodLabel: snapshot?.periodLabel || '',
    sourceCount: snapshot?.sourceCount || list.length,
    listedCount: snapshot?.listedCount ?? list.length,
    withLiquidation: snapshot?.withLiquidation ?? list.filter((row) => Math.abs(row.liquidation) > 0.009).length,
    withPrevious: snapshot?.withPrevious ?? list.filter((row) => Math.abs(row.previousBalance) > 0.009).length,
    previousBalance: Number(snapshot?.previousBalance) || 0,
    liquidation: Number(snapshot?.liquidation) || 0,
    others: Number(snapshot?.others) || 0,
    interests: Number(snapshot?.interests) || 0,
    withoutSurcharge: Number(snapshot?.withoutSurcharge) || 0,
    surcharge: Number(snapshot?.surcharge) || 0,
    surchargeAlt: Number(snapshot?.surchargeAlt) || 0,
  };
}

export function filterLiquidationCc(items = ACCESSIN_LIQUIDATION_CC, {
  query = '',
  onlyLiquidation = false,
} = {}) {
  const q = String(query || '').trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  return (items || []).filter((row) => {
    if (onlyLiquidation && !(Math.abs(Number(row.liquidation) || 0) > 0.009)) return false;
    if (!q) return true;
    const hay = [row.memberName, row.firstName, row.lastName, row.memberNumber, row.documentNumber]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    if (hay.includes(q)) return true;
    if (qDigits && String(row.memberNumber || '').includes(qDigits)) return true;
    if (qDigits && String(row.documentNumber || '').includes(qDigits)) return true;
    return false;
  });
}

/** Liquidación mensual de cuotas: detalle de gastos por categoría (Accessin / LILA). */

import { isMemberBillingActive } from '../members/dues';
import { isTitularMember } from '../members/households';
import {
  findTier,
  getActiveTiers,
  getTierDisplayName,
  parseCuotaCategories,
} from '../members/tiers';
import { periodLabel } from './feeBilling';
import { feePackForPeriod } from './feePackConcepts';

function fold(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function numericLabel(value) {
  const raw = String(value || '').trim();
  return /^\d+$/.test(raw) ? raw : '';
}

function moneyAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function memberCuotaCategoryNames(member, catalog = []) {
  const cats = parseCuotaCategories(member?.cuotaCategories || member?.meta?.cuotaCategories);
  if (cats.length) return cats;
  const fromTier = getTierDisplayName(member?.tier, catalog);
  if (fromTier && fromTier !== '—') return [fromTier];
  return [];
}

export function isLiquidationTitular(member) {
  return Boolean(member) && isMemberBillingActive(member) && isTitularMember(member);
}

/** Cuántos socios activos hay en cada categoría. Una persona puede contar en varias. */
export function holderCountsFromMembers(members = [], catalog = []) {
  if (!members?.length) return null;
  const counts = new Map();
  for (const member of members) {
    if (!isMemberBillingActive(member)) continue;
    const seen = new Set();
    for (const name of memberCuotaCategoryNames(member, catalog)) {
      const key = fold(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function conceptRows(concepts = [], counts = null) {
  return (concepts || []).map((row) => {
    const unit = Number(row.amount ?? row.unit) || 0;
    const key = fold(row.label || row.name);
    const holders = counts
      ? (counts.get(key) || 0)
      : (Number(row.holders) || 0);
    return {
      identifier: String(row.id ?? row.identifier ?? ''),
      name: row.label || row.name,
      holders,
      unit,
      total: holders * unit,
    };
  });
}

/**
 * Detalle de una liquidación con pack de Lila.
 * Si el período no está cerrado y hay padrón, los titulares salen del padrón
 * y el total es la suma de titulares × valor.
 */
export function liquidationFromPack(period, pack, { members = [], tierCatalog = [] } = {}) {
  const frozen = Array.isArray(period?.lines) && period.lines.length > 0;
  const counts = !frozen && period?.status !== 'processed'
    ? holderCountsFromMembers(members, tierCatalog)
    : null;
  const source = frozen
    ? period.lines.map((row) => ({
      id: row.identifier,
      label: row.name,
      holders: row.holders,
      amount: row.unit,
    }))
    : pack?.concepts;
  const rows = conceptRows(source, frozen ? null : counts);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return {
    period,
    label: periodLabel(period),
    title: pack?.title || `Liquidación - ${periodLabel(period)}`,
    rows,
    total,
    surcharges: pack?.surcharges || period?.surcharges || [],
  };
}

/** Precio más frecuente por tipo/descripción en el detalle de cuentas LILA. */
export function inferUnitPricesFromFeeAccounts(accounts = []) {
  const buckets = new Map();
  for (const account of accounts || []) {
    for (const line of account?.lines || []) {
      const name = String(line.type || line.description || '').trim();
      const billed = moneyAmount(line.billed ?? line.amount);
      if (!name || !billed) continue;
      const key = fold(name);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = new Map();
        buckets.set(key, bucket);
      }
      bucket.set(billed, (bucket.get(billed) || 0) + 1);
    }
  }
  const out = new Map();
  for (const [key, counts] of buckets) {
    let best = 0;
    let bestN = 0;
    for (const [amount, n] of counts) {
      if (n > bestN || (n === bestN && amount > best)) {
        best = amount;
        bestN = n;
      }
    }
    if (best > 0) out.set(key, best);
  }
  return out;
}

export function buildFeePeriodLiquidation(period, {
  members = [],
  tierCatalog = [],
  feeAccounts = [],
} = {}) {
  const catalog = getActiveTiers(tierCatalog?.length ? tierCatalog : undefined);
  const unitFromAccounts = inferUnitPricesFromFeeAccounts(feeAccounts);
  const groups = new Map();

  for (const member of members || []) {
    if (!isLiquidationTitular(member)) continue;
    const names = memberCuotaCategoryNames(member, catalog);
    const memberUnit = names.length === 1
      ? moneyAmount(member.monthlyDues || member.duesAmount)
      : 0;
    for (const name of names) {
      const key = fold(name);
      if (!key) continue;
      let group = groups.get(key);
      if (!group) {
        const tier = findTier(name, catalog);
        const labelName = tier?.name || name;
        const catalogUnit = moneyAmount(tier?.monthlyDues);
        group = {
          identifier: numericLabel(tier?.label),
          name: labelName,
          sortOrder: Number.isFinite(Number(tier?.sortOrder)) ? Number(tier.sortOrder) : 99,
          holders: 0,
          unit: catalogUnit || unitFromAccounts.get(key) || unitFromAccounts.get(fold(labelName)) || 0,
          unitHints: new Map(),
        };
        groups.set(key, group);
      }
      group.holders += 1;
      if (memberUnit > 0) {
        group.unitHints.set(memberUnit, (group.unitHints.get(memberUnit) || 0) + 1);
      }
    }
  }

  const rows = [...groups.values()]
    .toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'))
    .map((row) => {
      let unit = row.unit;
      if (!unit && row.unitHints.size) {
        let best = 0;
        let bestN = 0;
        for (const [amount, n] of row.unitHints) {
          if (n > bestN || (n === bestN && amount > best)) {
            best = amount;
            bestN = n;
          }
        }
        unit = best;
      }
      return {
        identifier: row.identifier,
        name: row.name,
        holders: row.holders,
        unit,
        total: row.holders * unit,
      };
    });

  const computedTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const official = Number(period?.amount);
  const total = Number.isFinite(official) && official > 0 ? official : computedTotal;

  return {
    period,
    label: periodLabel(period),
    title: `Liquidación - ${periodLabel(period)}`,
    rows,
    total,
    computedTotal,
    holderCount: rows.reduce((sum, row) => sum + row.holders, 0),
  };
}

/** Mismo total que la columna Monto de Períodos de cuotas. */
export function liquidationFromPeriod(period, { members = [], tierCatalog = [] } = {}) {
  const pack = feePackForPeriod(period);
  if (pack?.concepts || (period?.status === 'processed' && period?.lines?.length)) {
    return liquidationFromPack(period, pack, { members, tierCatalog });
  }
  return buildFeePeriodLiquidation(period, { members, tierCatalog });
}

/** Liquidado del mes calendario: el monto de esa fila, borrador incluido. */
export function liquidatedTotalForMonth(feePeriods = [], monthKey = '', context = {}) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  if (!year || !month) return null;
  const period = (feePeriods || []).find((row) => (
    Number(row.year) === year
    && Number(row.month) === month
    && row.status !== 'cancelled'
  ));
  if (!period || (period.status !== 'processed' && period.status !== 'draft')) return null;
  const total = Number(liquidationFromPeriod(period, context).total) || 0;
  return total > 0 ? Math.round(total * 100) / 100 : null;
}

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

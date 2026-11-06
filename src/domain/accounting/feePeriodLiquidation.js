/** Liquidación mensual de cuotas: detalle de gastos por categoría (Accessin / LILA). */

import { isDuesExemptMember, isMemberBillingActive } from '../members/dues';
import { isTitularMember } from '../members/households';
import {
  findTier,
  getActiveTiers,
  getTierAccessinCategoryId,
  parseCuotaCategories,
} from '../members/tiers';
import { periodLabel } from './feeBilling';
import { feePackForPeriod } from './feePackConcepts';
import { discountOnAmount, resolveDiscountRules } from './discountApplication';

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

/** Solo categorías Accessin asignadas (como LILA). Sin fallback al tier del padrón. */
export function memberCuotaCategoryNames(member, _catalog = []) {
  return parseCuotaCategories(member?.cuotaCategories || member?.meta?.cuotaCategories);
}

export function isLiquidationTitular(member) {
  return Boolean(member)
    && isMemberBillingActive(member)
    && isTitularMember(member)
    && !isDuesExemptMember(member);
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
    const name = row.label || row.name;
    const key = fold(name);
    const holders = counts
      ? (counts.get(key) || 0)
      : (Number(row.holders) || 0);
    const rawId = String(row.id ?? row.identifier ?? '').trim();
    const accessinId = /^\d+$/.test(rawId)
      ? rawId
      : (getTierAccessinCategoryId(row.tierId || name) || rawId);
    return {
      identifier: accessinId,
      name,
      holders,
      unit,
      total: holders * unit,
    };
  });
}

/** Misma fecha que los cargos de liquidación (día 10 del mes). */
function packImputationDay(period) {
  const year = Number(period?.year);
  const month = Number(period?.month);
  if (!year || !month) return '';
  return `${year}-${String(month).padStart(2, '0')}-10`;
}

function applyDiscountsToPackRows(rows, members, rules, on, catalog) {
  if (!rules?.length || !members?.length) return rows;
  return rows.map((row) => {
    const unit = Number(row.unit) || 0;
    let total = 0;
    let holders = 0;
    for (const member of members) {
      if (!isMemberBillingActive(member)) continue;
      const names = memberCuotaCategoryNames(member, catalog);
      if (!names.some((name) => fold(name) === fold(row.name))) continue;
      holders += 1;
      total += discountOnAmount(unit, rules, member, { on, categoryName: row.name }).net;
    }
    return { ...row, holders, total: Math.round(total * 100) / 100 };
  });
}

/**
 * Detalle de una liquidación con pack de cuotas.
 * Pack preparado: titulares × valor de las filas (Monto año = TOTAL detalle = LILA).
 * recountHolders=true solo al rearmar desde padrón (Actualizar padrón).
 */
export function liquidationFromPack(period, pack, {
  members = [],
  tierCatalog = [],
  discountRules,
  recountHolders = false,
} = {}) {
  const frozen = (period?.status === 'processed' || period?.status === 'pending')
    && Array.isArray(period?.lines)
    && period.lines.length > 0;
  const concepts = pack?.concepts || [];
  const packHasHolders = concepts.some((row) => Number(row.holders) > 0);
  const counts = !frozen
    && period?.status !== 'processed'
    && period?.status !== 'pending'
    && (recountHolders || !packHasHolders)
    && members?.length
    ? holderCountsFromMembers(members, tierCatalog)
    : null;
  const source = frozen
    ? period.lines.map((row) => ({
      id: row.identifier,
      label: row.name,
      holders: row.holders,
      amount: row.unit,
    }))
    : concepts;
  const baseRows = conceptRows(source, counts).map((row) => ({
    ...row,
    total: (Number(row.holders) || 0) * (Number(row.unit) || 0),
  }));
  // Descuentos extras / bonificaciones: bajan el total del pack (y las fichas vía charges).
  // Mes ya cerrado (pending/processed con lines) no se vuelve a descontar.
  const priced = !frozen
    ? applyDiscountsToPackRows(
      baseRows,
      members,
      resolveDiscountRules(discountRules),
      packImputationDay(period),
      tierCatalog,
    )
    : baseRows;
  // Borrador: no listar conceptos sin cobro (fundador, vitalicio, comisión, actividades $0).
  const rows = frozen ? priced : priced.filter((row) => Number(row.unit) > 0);
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
    })
    .filter((row) => Number(row.unit) > 0);

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
export function liquidationFromPeriod(period, { members = [], tierCatalog = [], discountRules } = {}) {
  const pack = feePackForPeriod(period);
  if (pack?.concepts || (period?.status === 'processed' && period?.lines?.length)) {
    return liquidationFromPack(period, pack, { members, tierCatalog, discountRules });
  }
  return buildFeePeriodLiquidation(period, { members, tierCatalog });
}

/** Suma titulares × valor de las filas del pack (mismo TOTAL CUOTAS que Generar / LILA). */
export function feeConceptRowsTotal(rows = []) {
  return (rows || []).reduce((sum, row) => {
    const holders = Number(row.holders) || 0;
    const unit = Number(row.unit ?? row.amount) || 0;
    if (!(unit > 0) || !(holders > 0)) return sum;
    return sum + (holders * unit);
  }, 0);
}

/**
 * Total para la tabla de períodos: idéntico al TOTAL del detalle Generar.
 * Prioridad: titulares × valor del pack preparado (misma grilla LILA).
 */
export function periodDisplayTotal(period, _context = {}) {
  if (!period || period.status === 'cancelled') return null;
  const official = Number(period.amount);
  if (period.status === 'processed' || period.status === 'pending') {
    // La grilla (titulares × valor) es la liquidación. El amount puede quedar
    // de un recuento de padrón distinto, como noviembre: 66.832.000 contra 63.763.000.
    const fromConcepts = feeConceptRowsTotal(period.pack?.concepts);
    if (fromConcepts > 0) return Math.round(fromConcepts * 100) / 100;
    const fromLines = feeConceptRowsTotal(period.lines);
    if (fromLines > 0) return Math.round(fromLines * 100) / 100;
    // Sin grilla no se inventa un recuento de padrón.
    if (Number.isFinite(official) && official > 0) {
      return Math.round(official * 100) / 100;
    }
    const prepared = Number(period.pack?.total);
    if (Number.isFinite(prepared) && prepared > 0) {
      return Math.round(prepared * 100) / 100;
    }
    return null;
  }
  if (period.status === 'draft') {
    const fromConcepts = feeConceptRowsTotal(period.pack?.concepts);
    if (fromConcepts > 0) return Math.round(fromConcepts * 100) / 100;
    const fromLines = feeConceptRowsTotal(period.lines);
    if (fromLines > 0) return Math.round(fromLines * 100) / 100;
    if (Number.isFinite(official) && official > 0) {
      return Math.round(official * 100) / 100;
    }
    const prepared = Number(period.pack?.total);
    if (Number.isFinite(prepared) && prepared > 0) {
      return Math.round(prepared * 100) / 100;
    }
    // Sin pack cargado: no estimar padrón en la grilla (evita montos inflados
    // con vitalicio/fundador/comisión). «Cargar borrador» / día 1 escriben concepts.
    return null;
  }
  return null;
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
  if (!period || (period.status !== 'processed' && period.status !== 'pending' && period.status !== 'draft')) {
    return null;
  }
  return periodDisplayTotal(period, context);
}

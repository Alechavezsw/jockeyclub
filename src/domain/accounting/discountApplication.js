/** Aplica un descuento extra sobre una cuota.
 * La vigencia se compara con la fecha de imputación del mes, inclusive.
 * El porcentaje y el importe se calculan sobre el valor de esa cuota y el neto no baja de cero.
 */

import { slugifyTierId } from '../members/tiers';

let runtimeRules = [];

export function setRuntimeDiscountRules(rules = []) {
  runtimeRules = Array.isArray(rules) ? rules.filter((row) => row && row.isActive !== false) : [];
}

export function getRuntimeDiscountRules() {
  return runtimeRules;
}

export function resolveDiscountRules(optionRules) {
  if (optionRules !== undefined) return optionRules || [];
  return runtimeRules;
}

function fold(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isoDay(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function memberKey(value) {
  return String(value || '').trim().replace(/^0+/, '');
}

function ruleNumbers(rule) {
  const listed = Array.isArray(rule?.memberIds)
    ? rule.memberIds
    : String(rule?.memberIds || '').split(/[,;]/);
  return new Set(
    [...listed, rule?.memberNumber]
      .map(memberKey)
      .filter(Boolean),
  );
}

function ruleCategories(rule) {
  const listed = Array.isArray(rule?.feeCategories)
    ? rule.feeCategories
    : String(rule?.feeCategories || rule?.appliedTo || '').split(',');
  return listed.map(fold).filter(Boolean);
}

export function ruleCoversDate(rule, on) {
  if (!rule || rule.isActive === false) return false;
  const day = isoDay(on);
  if (!day) return false;
  const from = isoDay(rule.validFrom);
  const to = isoDay(rule.validTo);
  if (from && from > day) return false;
  if (to && to < day) return false;
  return true;
}

export function ruleMatchesFee(rule, member, { categoryName = '', tierId = '' } = {}) {
  const category = rule?.category || 'members';
  const number = memberKey(member?.memberId || member?.memberNumber);
  if (category === 'general') return true;
  if (category === 'members' || category === 'member_fee') {
    if (!ruleNumbers(rule).has(number)) return false;
    if (category === 'members' || !categoryName) return true;
    const names = [
      ...(Array.isArray(member?.cuotaCategories) ? member.cuotaCategories : []),
      member?.tier,
    ].map(fold).filter(Boolean);
    const primary = names[0] || fold(categoryName);
    return fold(categoryName) === primary || slugifyTierId(categoryName) === slugifyTierId(primary);
  }
  if (category === 'fee_category') {
    const wanted = ruleCategories(rule);
    const line = fold(categoryName);
    const lineSlug = slugifyTierId(categoryName || tierId);
    return wanted.some((name) => name === line || slugifyTierId(name) === lineSlug);
  }
  if (category === 'family') {
    const wanted = fold(rule.familyGroup);
    if (!wanted) return false;
    const group = fold(
      member?.familyGroupName
      || member?.familyGroup
      || member?.meta?.familyGroupName
      || '',
    );
    return Boolean(group) && (group === wanted || group.includes(wanted) || wanted.includes(group));
  }
  return false;
}

function ruleValue(rule) {
  const value = Number(rule?.value ?? rule?.percentage ?? rule?.amount) || 0;
  if (rule?.valueType === 'amount') return { kind: 'amount', value };
  return { kind: 'percent', value };
}

/** Descuento de una cuota. Los porcentajes se suman y topan en 100. Después se resta el importe fijo. */
export function discountOnAmount(gross, rules = [], member, context = {}) {
  const base = Math.max(0, Math.round((Number(gross) || 0) * 100) / 100);
  if (!base) return { gross: 0, discount: 0, net: 0, applied: [] };
  let percent = 0;
  let fixed = 0;
  const applied = [];
  for (const rule of rules || []) {
    if (!ruleCoversDate(rule, context.on)) continue;
    if (!ruleMatchesFee(rule, member, context)) continue;
    const part = ruleValue(rule);
    if (part.value <= 0) continue;
    if (part.kind === 'amount') fixed += part.value;
    else percent += part.value;
    applied.push(rule);
  }
  percent = Math.min(100, Math.max(0, percent));
  const afterPercent = base * (1 - percent / 100);
  const net = Math.max(0, Math.round((afterPercent - fixed) * 100) / 100);
  return {
    gross: base,
    discount: Math.round((base - net) * 100) / 100,
    net,
    applied,
  };
}

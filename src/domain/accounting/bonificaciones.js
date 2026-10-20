/** Bonificaciones aplicadas: quién recibe un descuento extra sobre la cuota viva. */

import { duesAmountForMember } from '../members/dues';
import { memberNumberOf } from '../members/households';
import { ruleCoversDate, ruleMatchesFee } from './discountApplication';
import { formatMonthlyDebtsAsOf } from './appMonthlyDebts';
import { todayISODateAR } from '../../lib/arDate';

function memberKey(value) {
  return String(value || '').trim().replace(/\D/g, '').replace(/^0+/, '');
}

function listedMemberKeys(rule) {
  const listed = Array.isArray(rule?.memberIds)
    ? rule.memberIds
    : String(rule?.memberIds || '').split(/[,;]/);
  return [...new Set([...listed, rule?.memberNumber].map(memberKey).filter(Boolean))];
}

function isNamedRule(rule) {
  const category = rule?.category || 'members';
  return category === 'members' || category === 'member_fee';
}

function targetsForRule(rule, members, byNumber) {
  if (isNamedRule(rule)) {
    return listedMemberKeys(rule).map((id) => {
      const hit = byNumber.get(id);
      if (hit) return hit;
      return {
        memberId: id,
        name: rule.memberName || id,
        familyGroupName: rule.familyGroup || '',
        status: 'active',
      };
    });
  }
  return (members || []).filter((member) => {
    if (String(member?.status || 'active').toLowerCase() !== 'active') return false;
    return ruleMatchesFee(rule, member, {
      categoryName: Array.isArray(member?.cuotaCategories) ? member.cuotaCategories[0] : '',
      tierId: member?.tier || '',
    });
  });
}

export function formatBonificacionDate(iso) {
  const key = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return iso || '—';
  const [y, m, d] = key.split('-');
  return `${Number(d)}/${m}/${y}`;
}

export function listBonificaciones({
  query = '',
  status = 'all',
  items = [],
} = {}) {
  const q = String(query || '').trim().toLowerCase();
  const qDigits = String(query || '').replace(/\D/g, '');
  return (items || [])
    .filter((row) => {
      if (status === 'active' && !row.covering) return false;
      if (status === 'expired' && row.covering) return false;
      if (!q && !qDigits) return true;
      const hay = [
        row.memberName,
        row.memberNumber,
        row.documentNumber,
        row.familyGroup,
        row.concept,
        row.reason,
        row.appliedBy,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      if (q && hay.includes(q)) return true;
      if (qDigits && String(row.memberNumber || '').includes(qDigits)) return true;
      if (qDigits && String(row.documentNumber || '').includes(qDigits)) return true;
      return false;
    })
    .toSorted((a, b) => Number(b.covering === a.covering ? 0 : b.covering ? 1 : -1)
      || (Number(b.waived) || 0) - (Number(a.waived) || 0)
      || String(a.memberName).localeCompare(String(b.memberName), 'es'));
}

export function liveBonificacionesSummary(rows = [], { today = new Date(), uniqueWaived = 0 } = {}) {
  const covering = (rows || []).filter((row) => row.covering);
  const expired = (rows || []).filter((row) => !row.covering);
  const members = new Set(covering.map((row) => row.memberNumber).filter(Boolean));
  const asOf = todayISODateAR(today);
  return {
    asOf,
    asOfLabel: formatMonthlyDebtsAsOf(asOf),
    count: rows.length,
    coveringCount: covering.length,
    expiredCount: expired.length,
    uniqueMembers: members.size,
    waivedThisMonth: Math.round((Number(uniqueWaived) || 0) * 100) / 100,
  };
}

/**
 * Una fila por socio × regla. Las reglas nominadas se listan aunque estén vencidas.
 * Categoría / grupo / general solo entran si este mes bajan la cuota.
 */
export function buildLiveBonificaciones(rules = [], members = [], { today = new Date() } = {}) {
  const on = today instanceof Date && !Number.isNaN(today.getTime())
    ? today
    : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  const byNumber = new Map();
  for (const member of members || []) {
    const id = memberKey(memberNumberOf(member) || member.memberId);
    if (id) byNumber.set(id, member);
  }

  const coveringRules = (rules || []).filter((rule) => ruleCoversDate(rule, on));
  const uniqueWaived = new Map();
  for (const member of members || []) {
    if (String(member?.status || 'active').toLowerCase() !== 'active') continue;
    const gross = duesAmountForMember(member, on, { rules: [] });
    if (gross <= 0) continue;
    const net = duesAmountForMember(member, on, { rules: coveringRules });
    const cut = Math.max(0, gross - net);
    if (cut > 0) uniqueWaived.set(memberKey(memberNumberOf(member) || member.memberId), cut);
  }

  const rows = [];
  for (const rule of rules || []) {
    if (!rule || rule.isActive === false) continue;
    const covering = ruleCoversDate(rule, on);
    const named = isNamedRule(rule);
    const targets = targetsForRule(rule, members, byNumber);
    for (const member of targets) {
      const nro = memberKey(memberNumberOf(member) || member.memberId);
      const gross = duesAmountForMember(member, on, { rules: [] });
      const net = covering ? duesAmountForMember(member, on, { rules: [rule] }) : gross;
      const waived = Math.max(0, Math.round((gross - net) * 100) / 100);
      if (!named && waived <= 0) continue;
      rows.push({
        id: `${rule.id || 'rule'}-${nro || 's'}`,
        ruleId: rule.id,
        date: rule.validFrom || rule.date || '',
        validFrom: rule.validFrom || '',
        validTo: rule.validTo || '',
        memberNumber: nro || member.memberId || '',
        memberName: member.name || rule.memberName || '',
        familyGroup: member.familyGroupName || rule.familyGroup || '',
        documentNumber: member.documentNumber || '',
        concept: rule.description || rule.concept || rule.reason || '',
        reason: rule.description || '',
        appliedBy: rule.appliedBy || '',
        valueType: rule.valueType || (rule.percentage != null ? 'percent' : 'amount'),
        value: rule.value,
        percentage: rule.percentage ?? (rule.valueType === 'percent' ? rule.value : null),
        amount: rule.amount ?? (rule.valueType === 'amount' ? rule.value : 0),
        waived,
        covering,
        status: covering ? 'Vigente' : 'Vencida',
      });
    }
  }

  const listed = listBonificaciones({ items: rows });
  const summary = liveBonificacionesSummary(listed, {
    today: on,
    uniqueWaived: [...uniqueWaived.values()].reduce((sum, n) => sum + n, 0),
  });
  return { rows: listed, summary };
}

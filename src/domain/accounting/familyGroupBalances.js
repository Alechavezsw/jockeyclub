/** Saldos oficiales de grupo familiar Accessin/LILA. */

import { readSnapshot } from '../../data/snapshots';
import { memberNumberOf } from '../members/households';

const EMPTY_FAMILY_GROUP_BALANCES_SEED = Object.freeze({
  ACCESSIN_FAMILY_GROUP_BALANCES_AS_OF: '',
  ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME: {},
  ACCESSIN_FAMILY_GROUP_BALANCES_BY_NUMBER: {},
  ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT: {},
});

/** Snapshot `accessinFamilyGroupBalances`; vacío hasta que carga (ver data/snapshots). */
export function familyGroupBalancesSeed() {
  return readSnapshot('accessinFamilyGroupBalances', EMPTY_FAMILY_GROUP_BALANCES_SEED);
}

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

export function normalizeFamilyGroupKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^gf[\s.-]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lookupFamilyGroupBalance({
  name = '',
  memberNumber = '',
  memberName = '',
  byName = familyGroupBalancesSeed().ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME,
  byNumber = familyGroupBalancesSeed().ACCESSIN_FAMILY_GROUP_BALANCES_BY_NUMBER,
} = {}) {
  const nro = padMember(memberNumber);
  if (nro && byNumber[nro]) return byNumber[nro];

  const candidates = [];
  if (name) candidates.push(normalizeFamilyGroupKey(name));
  if (memberName) {
    const parts = String(memberName).trim().split(/\s+/).filter(Boolean);
    const first = parts[0] || '';
    const last = parts[parts.length - 1] || '';
    if (nro && first) candidates.push(normalizeFamilyGroupKey(`${first} ${nro}`));
    if (nro && last && last !== first) candidates.push(normalizeFamilyGroupKey(`${last} ${nro}`));
    if (first) candidates.push(normalizeFamilyGroupKey(first));
  }

  for (const key of candidates) {
    if (key && byName[key]) return byName[key];
  }
  return null;
}

export function familyGroupBalanceOf(member) {
  if (!member) return null;
  return lookupFamilyGroupBalance({
    name: member.familyGroupName,
    memberNumber: memberNumberOf(member) || member.memberId,
    memberName: member.name,
  });
}

function uniqueGroups(byName = familyGroupBalancesSeed().ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME) {
  const seen = new Set();
  const groups = [];
  Object.values(byName || {}).forEach((g) => {
    if (!g || seen.has(g.key)) return;
    seen.add(g.key);
    groups.push(g);
  });
  return groups;
}

export function listFamilyGroupBalances({
  query = '',
  onlyWithBalance = false,
  sign = 'all',
  byName = familyGroupBalancesSeed().ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME,
} = {}) {
  const q = normalizeFamilyGroupKey(query);
  const qRaw = String(query || '').trim().toLowerCase();
  const qDigits = String(query || '').replace(/\D/g, '');
  return uniqueGroups(byName)
    .filter((g) => {
      const total = Number(g.total) || 0;
      if (onlyWithBalance && total === 0) return false;
      if (sign === 'debt' && !(total > 0)) return false;
      if (sign === 'credit' && !(total < 0)) return false;
      if (!q && !qDigits) return true;
      if (q && g.key.includes(q)) return true;
      if (qRaw && String(g.name || '').toLowerCase().includes(qRaw)) return true;
      if (qDigits && String(g.memberNumber || '').includes(qDigits)) return true;
      return false;
    })
    .toSorted((a, b) => Math.abs(Number(b.total) || 0) - Math.abs(Number(a.total) || 0)
      || String(a.name).localeCompare(String(b.name), 'es'));
}

export function familyGroupBalancesSummary(
  snapshot = familyGroupBalancesSeed().ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT,
  byName = familyGroupBalancesSeed().ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME,
) {
  const groups = uniqueGroups(byName);
  const withBalance = groups.filter((g) => (Number(g.total) || 0) !== 0);
  const debt = withBalance.filter((g) => (Number(g.total) || 0) > 0);
  const credit = withBalance.filter((g) => (Number(g.total) || 0) < 0);
  const sum = (rows) => Math.round(rows.reduce((s, g) => s + (Number(g.total) || 0), 0) * 100) / 100;
  return {
    asOf: snapshot?.asOf || '',
    asOfLabel: snapshot?.asOfLabel || snapshot?.asOf || '',
    sourceFile: snapshot?.sourceFile || '',
    groupCount: snapshot?.groupCount ?? groups.length,
    withBalance: snapshot?.withBalance ?? withBalance.length,
    debtCount: debt.length,
    creditCount: credit.length,
    totalBalance: snapshot?.totalBalance ?? sum(groups),
    debtTotal: sum(debt),
    creditTotal: sum(credit),
  };
}

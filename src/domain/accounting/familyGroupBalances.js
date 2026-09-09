/** Saldos oficiales de grupo familiar Accessin/LILA. */

import {
  ACCESSIN_FAMILY_GROUP_BALANCES_AS_OF,
  ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME,
  ACCESSIN_FAMILY_GROUP_BALANCES_BY_NUMBER,
  ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT,
} from '../../data/seed/accessinFamilyGroupBalances';
import { memberNumberOf } from '../members/households';

export {
  ACCESSIN_FAMILY_GROUP_BALANCES_AS_OF,
  ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME,
  ACCESSIN_FAMILY_GROUP_BALANCES_BY_NUMBER,
  ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT,
};

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

export function normalizeFamilyGroupKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^gf[\s.\-]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lookupFamilyGroupBalance({
  name = '',
  memberNumber = '',
  memberName = '',
  byName = ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME,
  byNumber = ACCESSIN_FAMILY_GROUP_BALANCES_BY_NUMBER,
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

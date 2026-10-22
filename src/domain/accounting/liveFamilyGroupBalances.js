/** Saldo de grupo familiar: el que se muestra es el del socio titular. */

import { appMonthlyDebtForMember, formatMonthlyDebtsAsOf } from './appMonthlyDebts';
import {
  familyGroupMatchesQuery,
  isTitularMember,
  listFamilyGroups,
  memberNumberOf,
  resolveFamilyForDisplay,
} from '../members/households';
import { todayISODateAR } from '../../lib/arDate';

const EPS = 0.009;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function monthsOf(member, today) {
  const debt = appMonthlyDebtForMember(member, { today });
  return (debt?.months || []).map((month) => ({
    periodKey: month.periodKey,
    periodLabel: month.periodLabel,
    capital: roundMoney((Number(month.capital) || 0) + (Number(month.interest) || 0)),
  }));
}

export function liveFamilyBalanceForMember(member, allMembers = [], { today } = {}) {
  if (!member) return { isTitular: false, belongs: false, label: 'Sin socio', amount: null };
  const family = resolveFamilyForDisplay(member, allMembers);
  const people = family?.members || [];
  const belongs = people.length > 0 || Boolean(member.familyGroupName);
  if (!belongs) {
    return { isTitular: false, belongs: false, label: 'No pertenece a un grupo familiar', amount: null };
  }
  if (!isTitularMember(member)) {
    return { isTitular: false, belongs: true, label: 'No es titular de un grupo familiar', amount: null };
  }
  const amount = roundMoney(Number(member.outstandingBalance) || 0);
  const groupName = member.familyGroupName || family?.titular?.familyGroupName || '';
  return {
    isTitular: true,
    belongs: true,
    label: groupName || null,
    amount,
    months: monthsOf(member, today),
    source: 'live',
  };
}

export function buildLiveFamilyGroupBalances(members = [], {
  query = '',
  onlyWithBalance = false,
  sign = 'all',
  today = new Date(),
} = {}) {
  const asOfDate = today instanceof Date ? today : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  const asOf = todayISODateAR(Number.isNaN(asOfDate.getTime()) ? new Date() : asOfDate);
  const byNumber = new Map();
  for (const member of members || []) {
    const nro = memberNumberOf(member);
    if (nro) byNumber.set(nro, member);
  }

  const groups = listFamilyGroups(members).flatMap((group) => {
    const titular = group.titular;
    const liveTitular = byNumber.get(String(titular?.memberId || group.id).replace(/\D/g, '')) || titular;
    const people = group.members || [];
    const total = roundMoney(Number(liveTitular?.outstandingBalance) || 0);
    const row = {
      key: group.id,
      name: group.name,
      memberNumber: titular?.memberId || group.id,
      memberName: titular?.name || group.name,
      total,
      size: group.size || people.length,
      months: monthsOf(liveTitular, today),
    };
    if (onlyWithBalance && Math.abs(total) <= EPS) return [];
    if (sign === 'debt' && !(total > EPS)) return [];
    if (sign === 'credit' && !(total < -EPS)) return [];
    if (query && !familyGroupMatchesQuery(group, query) && !String(row.name || '').toLowerCase().includes(String(query).trim().toLowerCase())) {
      return [];
    }
    return [row];
  });

  groups.sort((a, b) => Math.abs(Number(b.total) || 0) - Math.abs(Number(a.total) || 0)
    || String(a.name).localeCompare(String(b.name), 'es'));

  const withBalance = groups.filter((g) => Math.abs(Number(g.total) || 0) > EPS);
  const debt = withBalance.filter((g) => (Number(g.total) || 0) > 0);
  const credit = withBalance.filter((g) => (Number(g.total) || 0) < 0);
  const sum = (rows) => roundMoney(rows.reduce((s, g) => s + (Number(g.total) || 0), 0));

  return {
    asOf,
    asOfLabel: formatMonthlyDebtsAsOf(asOf),
    groups,
    summary: {
      asOf,
      asOfLabel: formatMonthlyDebtsAsOf(asOf),
      groupCount: groups.length,
      withBalance: withBalance.length,
      debtCount: debt.length,
      creditCount: credit.length,
      totalBalance: sum(groups),
      debtTotal: sum(debt),
      creditTotal: sum(credit),
    },
  };
}

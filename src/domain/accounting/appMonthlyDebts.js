/**
 * Deudas mes a mes con la lógica viva del portal (no el snapshot LILA).
 *
 * Parte el saldo de cuota por cada 10 impago desde el último cobro.
 * Recargo 10 % (familiar e individual) y mora desde el día 11 (después del 10).
 * Lo que no entra en esas cuotas queda sin imputar (saldo previo / otros cargos).
 */

import { padMember } from './accountEntries';
import {
  duesAmountForMember,
  duesDueDay,
  duesPayableForMember,
  firstUnpaidDuesDate,
  isMemberBillingActive,
  isDuesExemptMember,
  monthsBehindOnDues,
  pinDuesDueDate,
} from '../members/dues';
import { duesNoticeCalendar, duesNoticeStagesForDay } from '../members/duesNotices';
import { memberNumberOf } from '../members/households';
import { getTierDisplayName } from '../members/tiers';

const MAX_MONTHS = 36;
const EPS = 0.009;

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function asIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value || '').slice(0, 10);
}

export function formatMonthlyDebtsAsOf(iso) {
  const stamp = asIsoDate(iso);
  const [y, m, d] = stamp.split('-').map(Number);
  if (!y || !m || !d) return stamp;
  return `${d} de ${MONTHS_ES[m - 1]?.toLowerCase() || ''} de ${y}`;
}

function periodFromDueOn(dueOn) {
  const stamp = asIsoDate(dueOn);
  const y = stamp.slice(0, 4);
  const month = Number(stamp.slice(5, 7));
  return {
    periodKey: stamp.slice(0, 7),
    periodLabel: `${MONTHS_ES[month - 1] || stamp} del ${y}`,
    dueOn: stamp,
  };
}

function shiftDue(iso, monthDelta) {
  const stamp = asIsoDate(iso);
  const d = new Date(`${stamp}T12:00:00`);
  if (Number.isNaN(d.getTime())) return stamp;
  d.setMonth(d.getMonth() + monthDelta);
  return pinDuesDueDate(d) || stamp;
}

function nextDueAfter(iso) {
  return shiftDue(iso, 1);
}

function prevDueBefore(iso) {
  return shiftDue(iso, -1);
}

function latestOccurredDue(todayIso) {
  const pinned = pinDuesDueDate(todayIso);
  if (pinned && pinned <= todayIso) return pinned;
  return prevDueBefore(todayIso);
}

function monthCharge(member, dueOn, { today, applyLate }) {
  const capital = Math.round(duesAmountForMember(member, dueOn));
  if (!applyLate) return { capital, interest: 0 };
  const payable = Math.round(duesPayableForMember(member, { paidOn: today, dueOn, on: dueOn }));
  return { capital, interest: Math.max(0, payable - capital) };
}

function indexEntriesByMember(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    const nro = padMember(entry?.memberNumber || entry?.memberId);
    if (!nro) continue;
    const list = map.get(nro);
    if (list) list.push(entry);
    else map.set(nro, [entry]);
  }
  return map;
}

function linesFromEntries(entries = []) {
  const rows = [];
  for (const entry of entries) {
    if (!entry || entry.isActive === false) continue;
    const value = Number(entry.value) || 0;
    rows.push({
      id: entry.id || null,
      type: entry.typeLabel || entry.type || '—',
      description: entry.description || '',
      date: entry.date || '',
      amount: Math.abs(value),
      owed: value,
    });
  }
  return rows.toSorted((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function memberDisplayName(member) {
  const joined = [member?.firstName, member?.lastName].filter(Boolean).join(' ').trim();
  return String(member?.name || joined || '').trim();
}

function standingLabel(member, { todayIso, monthsBehind }) {
  const balance = Number(member?.outstandingBalance) || 0;
  if (monthsBehind <= 0 && balance <= 0) return 'Al día';
  if (monthsBehind >= 2) return 'En mora';
  const stages = duesNoticeStagesForDay(todayIso, duesDueDay());
  if (monthsBehind === 1 && stages.includes('mora')) return 'En mora';
  if (monthsBehind === 1 && stages.includes('due')) return 'Vencida';
  if (balance > 0) return 'Con saldo';
  return 'Vencida';
}

function syntheticUnpaidAmount(member, firstUnpaid, monthsBehind, today) {
  let dueOn = firstUnpaid;
  let total = 0;
  const n = Math.min(Math.max(monthsBehind, 0), MAX_MONTHS);
  for (let i = 0; i < n; i += 1) {
    total += duesPayableForMember(member, { paidOn: today, dueOn, on: dueOn });
    dueOn = nextDueAfter(dueOn);
  }
  return Math.round(total);
}

function takeMonth(list, member, dueOn, leftover, { today, applyLate }) {
  const { capital: capitalBase, interest: interestBase } = monthCharge(member, dueOn, { today, applyLate });
  if (capitalBase <= 0 && interestBase <= 0) {
    return { leftover, status: 'zero' };
  }
  const capital = Math.min(capitalBase, leftover);
  let next = Math.round((leftover - capital) * 100) / 100;
  const interest = next > EPS ? Math.min(interestBase, next) : 0;
  next = Math.round((next - interest) * 100) / 100;
  if (capital > EPS || interest > EPS) {
    list.push({
      ...periodFromDueOn(dueOn),
      capital,
      interest,
    });
  }
  return { leftover: next, status: 'ok' };
}

function allocateMonths(member, { remaining, firstUnpaid, lastPaymentDate, todayIso, today }) {
  let leftover = remaining;
  const current = [];
  const older = [];

  let dueOn = firstUnpaid;
  for (let i = 0; i < MAX_MONTHS && leftover > EPS; i += 1) {
    if (!dueOn || dueOn > todayIso) break;
    const taken = takeMonth(current, member, dueOn, leftover, { today, applyLate: true });
    leftover = taken.leftover;
    if (taken.status === 'zero') break;
    dueOn = nextDueAfter(dueOn);
  }

  const lastPaidDue = pinDuesDueDate(lastPaymentDate);
  let olderDue = lastPaidDue
    ? prevDueBefore(lastPaidDue)
    : prevDueBefore(current[0]?.dueOn || latestOccurredDue(todayIso));

  for (let i = 0; i < MAX_MONTHS && leftover > EPS; i += 1) {
    if (!olderDue || current.length + older.length >= MAX_MONTHS) break;
    const taken = takeMonth(older, member, olderDue, leftover, { today, applyLate: false });
    leftover = taken.leftover;
    if (taken.status === 'zero') break;
    olderDue = prevDueBefore(olderDue);
  }

  const months = [...older.reverse(), ...current];
  let accumulated = 0;
  for (const row of months) {
    accumulated += (Number(row.capital) || 0) + (Number(row.interest) || 0);
    row.accumulated = accumulated;
  }

  return { months, unallocated: Math.max(0, Math.round(leftover * 100) / 100) };
}

export function appMonthlyDebtForMember(member, { today = new Date(), entries = [] } = {}) {
  if (!member) return null;
  const memberNumber = memberNumberOf(member);
  if (!memberNumber) return null;

  const todayIso = asIsoDate(today);
  const persisted = Number(member.outstandingBalance) || 0;
  const billingActive = isMemberBillingActive(member);
  const exempt = isDuesExemptMember(member);
  if (exempt) return null;
  const monthsBehind = monthsBehindOnDues({
    lastPaymentDate: member.lastPaymentDate,
    nextDueDate: member.nextDueDate,
    today,
  });

  if (persisted <= EPS) {
    if (!billingActive || monthsBehind <= 0) return null;
  }

  const firstUnpaid = firstUnpaidDuesDate({
    lastPaymentDate: member.lastPaymentDate,
    nextDueDate: member.nextDueDate,
    today,
  });

  let remaining = persisted;
  if (remaining <= EPS) {
    remaining = syntheticUnpaidAmount(member, firstUnpaid, monthsBehind, today);
    if (remaining <= EPS) return null;
  }

  const { months, unallocated } = allocateMonths(member, {
    remaining,
    firstUnpaid,
    lastPaymentDate: member.lastPaymentDate,
    todayIso,
    today,
  });

  const capital = months.reduce((sum, row) => sum + (Number(row.capital) || 0), 0);
  const interest = months.reduce((sum, row) => sum + (Number(row.interest) || 0), 0);
  const totalDebt = Math.round((capital + interest + unallocated) * 100) / 100;
  if (totalDebt <= EPS) return null;

  const cal = duesNoticeCalendar(duesDueDay());

  return {
    memberNumber,
    memberName: memberDisplayName(member),
    firstName: member.firstName || '',
    lastName: member.lastName || '',
    dni: member.documentNumber || member.dni || '',
    socialFee: getTierDisplayName(member.tier),
    sportsFee: '',
    status: member.status || 'active',
    standing: standingLabel(member, { todayIso, monthsBehind }),
    monthsBehind,
    dueDay: cal.dueDay,
    moraDay: cal.moraDay,
    totalDebt,
    capital,
    interest,
    unallocated,
    months,
    lines: linesFromEntries(entries),
    accessinId: member.memberId || memberNumber,
  };
}

export function buildAppMonthlyDebts(members = [], { today = new Date(), accountEntries = [] } = {}) {
  const entriesByMember = indexEntriesByMember(accountEntries);
  const byNumber = {};
  let monthRowCount = 0;
  let lineCount = 0;
  let totalDebt = 0;

  for (const member of members) {
    const nro = memberNumberOf(member);
    const row = appMonthlyDebtForMember(member, {
      today,
      entries: nro ? (entriesByMember.get(nro) || []) : [],
    });
    if (!row) continue;
    byNumber[row.memberNumber] = row;
    monthRowCount += (row.months || []).length;
    lineCount += (row.lines || []).length;
    totalDebt += Number(row.totalDebt) || 0;
  }

  const asOf = asIsoDate(today);
  return {
    asOf,
    asOfLabel: formatMonthlyDebtsAsOf(asOf),
    memberCount: Object.keys(byNumber).length,
    monthRowCount,
    lineCount,
    totalDebt: Math.round(totalDebt * 100) / 100,
    byNumber,
  };
}

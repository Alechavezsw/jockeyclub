/**
 * Deudas mes a mes con la lógica viva del portal (no el snapshot LILA).
 *
 * Parte el saldo de cuota por cada 10 impago desde el último cobro.
 * Recargo 10 % (familiar e individual) y mora desde el día 11 (después del 10).
 * Lo que no entra en esas cuotas queda sin imputar (saldo previo / otros cargos).
 */

import { money } from '../money';
import { padMember } from './accountEntries';
import {
  duesAmountForMember,
  duesDueDayForMember,
  duesPayableForMember,
  firstUnpaidDuesDate,
  isMemberBillingActive,
  isDuesExemptMember,
  lilaUnpaidCapital,
  monthsBehindOnDues,
  pinDuesDueDate,
  socialDuesStoredBalance,
} from '../members/dues';
import { duesMonthsPhrase } from '../members/duesImputations';
import { duesNoticeCalendar, duesNoticeStagesForDay } from '../members/duesNotices';
import { isFamilyDependent, memberNumberOf } from '../members/households';
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

function shiftDue(iso, monthDelta, member) {
  const stamp = asIsoDate(iso);
  const d = new Date(`${stamp}T12:00:00`);
  if (Number.isNaN(d.getTime())) return stamp;
  d.setMonth(d.getMonth() + monthDelta);
  return pinDuesDueDate(d, member) || stamp;
}

function nextDueAfter(iso, member) {
  return shiftDue(iso, 1, member);
}

function prevDueBefore(iso, member) {
  return shiftDue(iso, -1, member);
}

function latestOccurredDue(todayIso, member) {
  const pinned = pinDuesDueDate(todayIso, member);
  if (pinned && pinned <= todayIso) return pinned;
  return prevDueBefore(todayIso, member);
}

function monthCharge(member, dueOn, { today, applyLate }) {
  const capital = money(duesAmountForMember(member, dueOn));
  if (!applyLate) return { capital, interest: 0 };
  const payable = money(duesPayableForMember(member, { paidOn: today, dueOn, on: dueOn }));
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
  const stages = duesNoticeStagesForDay(todayIso, duesDueDayForMember(member));
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
    // Solo capital: el 10 % se calcula aparte al armar el desglose / al cobrar.
    total += duesAmountForMember(member, dueOn);
    dueOn = nextDueAfter(dueOn, member);
  }
  return money(total);
}

/**
 * El saldo de ficha es capital. Cada mes del desglose es cuota entera;
 * el 10 % de mora va encima y no come meses del saldo.
 * Nunca inventa un resto (ej. $ 26.000).
 */
function takeMonth(list, member, dueOn, leftover, { today }) {
  const { capital: capitalBase, interest: interestBase } = monthCharge(member, dueOn, {
    today,
    applyLate: true,
  });
  if (capitalBase <= EPS) {
    return { leftover, status: 'zero' };
  }
  if (leftover + EPS < capitalBase) {
    return { leftover, status: 'short' };
  }
  const capital = capitalBase;
  const interest = Math.max(0, interestBase);
  const next = money(leftover - capital);
  list.push({
    ...periodFromDueOn(dueOn),
    capital,
    interest,
  });
  return { leftover: next, status: 'ok' };
}

function allocateMonths(member, { remaining, firstUnpaid, lastPaymentDate, todayIso, today }) {
  let leftover = remaining;
  const current = [];
  const older = [];

  let dueOn = firstUnpaid;
  for (let i = 0; i < MAX_MONTHS && leftover > EPS; i += 1) {
    if (!dueOn || dueOn > todayIso) break;
    const taken = takeMonth(current, member, dueOn, leftover, { today });
    leftover = taken.leftover;
    if (taken.status === 'zero' || taken.status === 'short') break;
    dueOn = nextDueAfter(dueOn, member);
  }

  const lastPaidDue = pinDuesDueDate(lastPaymentDate, member);
  let olderDue = lastPaidDue
    ? prevDueBefore(lastPaidDue, member)
    : prevDueBefore(current[0]?.dueOn || latestOccurredDue(todayIso, member), member);

  for (let i = 0; i < MAX_MONTHS && leftover > EPS; i += 1) {
    if (!olderDue || current.length + older.length >= MAX_MONTHS) break;
    const taken = takeMonth(older, member, olderDue, leftover, { today });
    leftover = taken.leftover;
    if (taken.status === 'zero' || taken.status === 'short') break;
    olderDue = prevDueBefore(olderDue, member);
  }

  const months = [...older.reverse(), ...current];
  let accumulated = 0;
  for (const row of months) {
    accumulated += (Number(row.capital) || 0) + (Number(row.interest) || 0);
    row.accumulated = accumulated;
  }

  return { months, unallocated: Math.max(0, money(leftover)) };
}

export function appMonthlyDebtForMember(member, { today = new Date(), entries = [] } = {}) {
  if (!member) return null;
  const memberNumber = memberNumberOf(member);
  if (!memberNumber) return null;

  const todayIso = asIsoDate(today);
  // Misma fuente que molinete / mora: unpaidCapital LILA si hay; si no, outstanding.
  const lila = lilaUnpaidCapital(member);
  const persisted = socialDuesStoredBalance(member);
  const billingActive = isMemberBillingActive(member);
  const exempt = isDuesExemptMember(member);
  if (exempt) return null;
  const monthsBehind = monthsBehindOnDues({
    lastPaymentDate: member.lastPaymentDate,
    nextDueDate: member.nextDueDate,
    today,
    member,
  });

  if (persisted <= EPS) {
    // Corte LILA en 0 = al día; no inventar meses por nextDue viejo.
    if (lila != null) return null;
    if (!billingActive || monthsBehind <= 0) return null;
  }

  const firstUnpaid = firstUnpaidDuesDate({
    lastPaymentDate: member.lastPaymentDate,
    nextDueDate: member.nextDueDate,
    today,
    member,
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
  const totalDebt = money(capital + interest + unallocated);
  if (totalDebt <= EPS) return null;

  const cal = duesNoticeCalendar(duesDueDayForMember(member));

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

/**
 * Resumen único de cuota para toda la app (portal + admin).
 * Misma fuente que Consultar deuda / PDF: capital + 10 % + meses + sin imputar.
 */
export function memberDuesStandingSummary(member, { today = new Date(), entries = [] } = {}) {
  if (!member) {
    return {
      clear: true,
      kind: 'empty',
      standing: '—',
      title: '—',
      hint: null,
      totalDebt: 0,
      capital: 0,
      interest: 0,
      unallocated: 0,
      monthsBehind: 0,
      months: [],
      monthsPhrase: '',
      billing: false,
      debt: null,
    };
  }

  if (isDuesExemptMember(member)) {
    return {
      clear: true,
      kind: 'exempt',
      standing: 'Exento',
      title: 'Exento',
      hint: 'No abona cuota social',
      totalDebt: 0,
      capital: 0,
      interest: 0,
      unallocated: 0,
      monthsBehind: 0,
      months: [],
      monthsPhrase: '',
      billing: false,
      debt: null,
    };
  }

  if (isFamilyDependent(member)) {
    return {
      clear: true,
      kind: 'dependent',
      standing: 'Grupo familiar',
      title: 'Grupo familiar',
      hint: 'La cuenta la lleva el titular',
      totalDebt: 0,
      capital: 0,
      interest: 0,
      unallocated: 0,
      monthsBehind: 0,
      months: [],
      monthsPhrase: '',
      billing: false,
      debt: null,
    };
  }

  const stored = Number(member?.outstandingBalance) || 0;
  const credit = stored < -0.01 ? money(-stored) : 0;
  const debt = appMonthlyDebtForMember(member, { today, entries });
  if (!debt) {
    if (credit > 0.01) {
      return {
        clear: true,
        kind: 'credit',
        standing: 'Saldo a favor',
        title: 'Saldo a favor',
        hint: 'Se descuenta en el próximo cobro',
        totalDebt: 0,
        capital: 0,
        interest: 0,
        unallocated: 0,
        credit,
        monthsBehind: 0,
        months: [],
        monthsPhrase: '',
        billing: true,
        debt: null,
      };
    }
    return {
      clear: true,
      kind: 'clear',
      standing: 'Al día',
      title: 'Al día',
      hint: 'Sin deuda de cuota',
      totalDebt: 0,
      capital: 0,
      interest: 0,
      unallocated: 0,
      credit: 0,
      monthsBehind: 0,
      months: [],
      monthsPhrase: '',
      billing: true,
      debt: null,
    };
  }

  const monthsPhrase = duesMonthsPhrase((debt.months || []).map((row) => row.dueOn));

  return {
    clear: false,
    kind: 'debt',
    standing: debt.standing,
    title: debt.standing || 'Con deuda',
    hint: monthsPhrase || null,
    totalDebt: Number(debt.totalDebt) || 0,
    capital: Number(debt.capital) || 0,
    interest: Number(debt.interest) || 0,
    unallocated: Number(debt.unallocated) || 0,
    credit: 0,
    monthsBehind: Number(debt.monthsBehind) || 0,
    months: debt.months || [],
    monthsPhrase,
    billing: true,
    debt,
  };
}

/** Monto a mostrar: total con intereses, saldo a favor, o etiqueta Al día / exento. */
export function duesStandingDisplayAmount(summary, formatCurrency) {
  if (!summary) return 'Al día';
  if (summary.kind === 'credit' && Number(summary.credit) > 0.01) {
    if (typeof formatCurrency === 'function') return formatCurrency(summary.credit);
    return String(summary.credit);
  }
  if (summary.clear) return summary?.title || 'Al día';
  if (typeof formatCurrency === 'function') return formatCurrency(summary.totalDebt);
  return String(summary.totalDebt);
}

/** Texto secundario: meses + desglose capital/recargo. */
export function duesStandingDisplayHint(summary, formatCurrency, { compact = false } = {}) {
  if (!summary) return '';
  if (summary.kind === 'credit') {
    return compact ? 'A favor' : (summary.hint || 'Se descuenta en el próximo cobro');
  }
  if (summary.clear) return summary.hint || '';
  const parts = [];
  const monthsBehind = Number(summary.monthsBehind) || (summary.months || []).length || 0;
  if (compact) {
    if (monthsBehind > 0) {
      parts.push(monthsBehind === 1 ? '1 mes' : `${monthsBehind} meses`);
    }
  } else if (summary.monthsPhrase) {
    parts.push(summary.monthsPhrase);
  }
  if (Number(summary.interest) > 0 && typeof formatCurrency === 'function') {
    parts.push(`capital ${formatCurrency(summary.capital)} + recargo ${formatCurrency(summary.interest)}`);
  } else if (!compact && summary.hint) {
    return summary.hint;
  }
  if (Number(summary.unallocated) > 0 && typeof formatCurrency === 'function') {
    parts.push(`sin imputar ${formatCurrency(summary.unallocated)}`);
  }
  return parts.join(' · ') || summary.standing || '';
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
    totalDebt: money(totalDebt),
    byNumber,
  };
}

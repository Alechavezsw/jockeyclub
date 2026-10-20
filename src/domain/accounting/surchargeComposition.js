/** Recargos cobrados y adeudados con la cuota viva (10 % desde el día 11). */

import { padMember } from './accountEntries';
import { appMonthlyDebtForMember } from './appMonthlyDebts';
import {
  duesAmountForMember,
  duesPayableForMember,
  pinDuesDueDate,
} from '../members/dues';
import { DUES_LATE_RATE } from '../members/tiers';
import { memberNumberOf } from '../members/households';

const EPS = 0.009;
const RATE_PCT = Math.round(DUES_LATE_RATE * 10000) / 100;
const KIND_LABEL = `Recargo de Cuota (${RATE_PCT.toFixed(2)} %)`;

function asIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value || '').slice(0, 10);
}

function inRange(iso, from, to) {
  const d = String(iso || '').slice(0, 10);
  if (!d) return !from && !to;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function memberDisplayName(member) {
  const joined = [member?.firstName, member?.lastName].filter(Boolean).join(' ').trim();
  return String(member?.name || joined || '').trim();
}

function recargoOfPayment(member, paidOn, amount) {
  const dueOn = pinDuesDueDate(paidOn);
  if (!dueOn) return 0;
  const on = dueOn;
  const capital = roundMoney(duesAmountForMember(member, on));
  const payable = roundMoney(duesPayableForMember(member, { paidOn, dueOn, on }));
  const recargo = roundMoney(Math.max(0, payable - capital));
  if (recargo <= EPS) return 0;
  if (amount != null && Number.isFinite(Number(amount)) && Number(amount) + EPS < recargo) return 0;
  return recargo;
}

function paymentsOf(member) {
  const history = (member?.paymentHistory || []).filter((row) => row && row.status !== 'void' && row.status !== 'cancelled');
  if (history.length) return history;
  if (member?.lastPaymentDate) {
    return [{ date: member.lastPaymentDate, amount: null, id: `last-${memberNumberOf(member)}` }];
  }
  return [];
}

function collectedRows(member, { from, to }) {
  const nro = padMember(memberNumberOf(member));
  const name = memberDisplayName(member);
  const rows = [];
  for (const payment of paymentsOf(member)) {
    const date = asIsoDate(payment.date || payment.paidAt);
    if (!inRange(date, from, to)) continue;
    const amount = recargoOfPayment(member, date, payment.amount);
    if (amount <= EPS) continue;
    rows.push({
      id: payment.id || `cobrado-${nro}-${date}`,
      source: 'cobro',
      memberNumber: nro,
      memberName: name,
      date,
      type: KIND_LABEL,
      description: `Cuota ${date.slice(0, 7)}`,
      amount,
      status: 'cobrado',
      kind: 'porcentaje',
    });
  }
  return rows;
}

function owedRows(member, { from, to, today }) {
  const debt = appMonthlyDebtForMember(member, { today });
  if (!debt) return [];
  const nro = padMember(debt.memberNumber);
  const rows = [];
  for (const month of debt.months || []) {
    const amount = roundMoney(month.interest);
    if (amount <= EPS) continue;
    const date = month.dueOn || `${month.periodKey}-10`;
    if (!inRange(date, from, to)) continue;
    rows.push({
      id: `adeudado-${nro}-${month.periodKey}`,
      source: 'deuda',
      memberNumber: nro,
      memberName: debt.memberName,
      date,
      type: KIND_LABEL,
      description: month.periodLabel || month.periodKey,
      amount,
      status: 'adeudado',
      kind: 'porcentaje',
    });
  }
  return rows;
}

export function buildSurchargeComposition({
  members = [],
  memberNumber = '',
  from = '',
  to = '',
  today = new Date(),
} = {}) {
  const nro = padMember(memberNumber);
  const list = (members || []).filter((member) => {
    if (!nro) return true;
    return padMember(memberNumberOf(member)) === nro;
  });

  const rows = [];
  for (const member of list) {
    rows.push(...collectedRows(member, { from, to }));
    rows.push(...owedRows(member, { from, to, today }));
  }

  const sorted = rows.toSorted((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  const byKind = {};
  let total = 0;
  let collected = 0;
  let owed = 0;
  sorted.forEach((row) => {
    const amt = Number(row.amount) || 0;
    total += amt;
    if (row.status === 'cobrado') collected += amt;
    else owed += amt;
    if (!byKind[row.kind]) byKind[row.kind] = { kind: row.kind, label: row.type, amount: 0, count: 0 };
    byKind[row.kind].amount += amt;
    byKind[row.kind].count += 1;
  });

  return {
    memberNumber: nro,
    from,
    to,
    rows: sorted,
    byKind: Object.values(byKind),
    total: roundMoney(total),
    collected: roundMoney(collected),
    owed: roundMoney(owed),
  };
}

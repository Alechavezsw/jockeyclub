/** Saldos de cuentas corrientes aplicados al padrón. */

import { readSnapshot } from '../../data/snapshots';
import { isDuesExemptMember } from '../members/dues';
import { memberNumberOf } from '../members/households';

/**
 * Corte de Lila del 22 de octubre de 2026, cargado en public.members.
 * El total positivo es el del Excel de saldos.
 */
export const LILA_BALANCE_CUT = Object.freeze({
  asOf: '2026-10-22',
  filePositiveTotal: 346295200.69,
  omittedTotal: 0,
  omitted: Object.freeze([]),
  previousAsOf: '2026-10-20',
  previousWithBalance: 1097,
  previousTotal: 354715661.09,
});

const EMPTY_CURRENT_ACCOUNT_BALANCES_SEED = Object.freeze({
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF: '',
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER: {},
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT: {},
});

/** Snapshot `accessinCurrentAccountBalances`; vacío hasta que carga (ver data/snapshots). */
export function currentAccountBalancesSeed() {
  return readSnapshot('accessinCurrentAccountBalances', EMPTY_CURRENT_ACCOUNT_BALANCES_SEED);
}

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

/** Totales vivos del padrón. La fecha es la que más socios traen en currentAccountAsOf. */
export function summarizeCurrentAccountCut(members = []) {
  const counts = new Map();
  let withBalance = 0;
  let total = 0;
  for (const member of members) {
    const asOf = String(member?.currentAccountAsOf || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) counts.set(asOf, (counts.get(asOf) || 0) + 1);
    const balance = Number(member?.outstandingBalance) || 0;
    if (balance > 0) {
      withBalance += 1;
      total += balance;
    }
  }
  let asOf = '';
  let best = 0;
  for (const [date, count] of counts) {
    if (count > best) {
      best = count;
      asOf = date;
    }
  }
  return {
    asOf,
    members: members.length,
    withBalance,
    total: Math.round(total * 100) / 100,
  };
}

export function lookupCurrentAccountBalance(memberNumber) {
  const key = padMember(memberNumber);
  if (!key) return null;
  return currentAccountBalancesSeed().ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER[key] || null;
}

export function latestMemberPaymentDate(member) {
  const dates = [];
  if (member?.lastPaymentDate) dates.push(String(member.lastPaymentDate).slice(0, 10));
  for (const p of member?.paymentHistory || []) {
    const d = String(p?.date || p?.paidAt || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.push(d);
  }
  dates.sort();
  return dates[dates.length - 1] || null;
}

/** Saldo operativo del socio. El seed LILA solo entra si aún no hay saldo en el padrón. */
export function currentAccountBalanceOf(member) {
  if (member != null && member.outstandingBalance != null && member.outstandingBalance !== '') {
    const fromMember = Number(member.outstandingBalance);
    if (Number.isFinite(fromMember)) return fromMember;
  }
  const hit = lookupCurrentAccountBalance(memberNumberOf(member) || member?.memberId);
  return hit ? Number(hit.balance) || 0 : 0;
}

/**
 * Inicializa outstandingBalance con el snapshot LILA una sola vez por corte.
 * No pisa cobros posteriores (lastPaymentDate / paymentHistory).
 */
export function applyCurrentAccountBalances(members = [], {
  byNumber = currentAccountBalancesSeed().ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER,
  asOf = currentAccountBalancesSeed().ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF,
} = {}) {
  if (!members?.length || !byNumber || !Object.keys(byNumber).length) return members || [];

  return members.map((m) => {
    const nro = padMember(memberNumberOf(m) || m.memberId);
    const hit = nro ? byNumber[nro] : null;
    if (!hit) return m;
    if (isDuesExemptMember(m)) {
      if (m.currentAccountAsOf === asOf && !(Number(m.outstandingBalance) > 0)) return m;
      return { ...m, outstandingBalance: 0, currentAccountAsOf: asOf || m.currentAccountAsOf };
    }
    if (m.currentAccountAsOf === asOf) return m;

    const hasOperational = m.outstandingBalance != null
      && m.outstandingBalance !== ''
      && Number.isFinite(Number(m.outstandingBalance));
    if (hasOperational) {
      return { ...m, currentAccountAsOf: asOf };
    }

    const latestPay = latestMemberPaymentDate(m);
    if (latestPay && latestPay > asOf) {
      return { ...m, currentAccountAsOf: asOf };
    }

    const balance = Number(hit.balance) || 0;
    return {
      ...m,
      outstandingBalance: balance,
      unpaidCapital: Number(hit.unpaidCapital) || 0,
      unpaidSurcharges: Number(hit.unpaidSurcharges) || 0,
      unpaidInterest: Number(hit.unpaidInterest) || 0,
      unallocatedBalance: Number(hit.unallocated) || 0,
      currentAccountAsOf: asOf,
      accessinId: m.accessinId || hit.accessinId || null,
    };
  });
}

/** Socios cuyo saldo / corte / cobro cambió (para persistir en nube). */
export function diffMemberBalances(before = [], after = []) {
  const prevById = new Map(before.map((m) => [m.memberId, m]));
  return after.filter((m) => {
    const prev = prevById.get(m.memberId);
    if (!prev) return false;
    return (
      Number(prev.outstandingBalance || 0) !== Number(m.outstandingBalance || 0)
      || (prev.overdueSince || null) !== (m.overdueSince || null)
      || (prev.currentAccountAsOf || null) !== (m.currentAccountAsOf || null)
      || (prev.lastPaymentDate || null) !== (m.lastPaymentDate || null)
    );
  });
}

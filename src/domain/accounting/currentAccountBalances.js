/** Saldos de cuentas corrientes Accessin/LILA aplicados al padrón. */

import {
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF,
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER,
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT,
} from '../../data/seed/accessinCurrentAccountBalances';
import { memberNumberOf } from '../members/households';

export {
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF,
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER,
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT,
};

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

export function lookupCurrentAccountBalance(memberNumber) {
  const key = padMember(memberNumber);
  if (!key) return null;
  return ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER[key] || null;
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
  byNumber = ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER,
  asOf = ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF,
} = {}) {
  if (!members?.length || !byNumber || !Object.keys(byNumber).length) return members || [];

  return members.map((m) => {
    const nro = padMember(memberNumberOf(m) || m.memberId);
    const hit = nro ? byNumber[nro] : null;
    if (!hit) return m;
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

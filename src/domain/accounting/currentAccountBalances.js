/** Saldos de cuentas corrientes aplicados al padrón. */

import { readSnapshot } from '../../data/snapshots';
import { isDuesExemptMember } from '../members/dues';
import { memberNumberOf } from '../members/households';

/**
 * Corte de Lila cargado en public.members.
 * El total es la suma neta de saldos distintos de cero del Excel.
 */
export const LILA_BALANCE_CUT = Object.freeze({
  asOf: '2026-11-05',
  filePositiveTotal: 365780767.69,
  omittedTotal: 0,
  omitted: Object.freeze([]),
  previousAsOf: '2026-10-31',
  previousWithBalance: 1048,
  previousTotal: 344160500.69,
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
 * Inicializa outstandingBalance con el snapshot LILA una sola vez.
 * Ese corte queda como verdad de apertura: lo nuevo (liquidación / cobro)
 * solo suma o resta encima. Nunca pisa saldo operativo ni partes ya cargadas.
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
    // Ya marcado con este corte → no tocar (ni saldo ni capital/recargos).
    if (m.currentAccountAsOf === asOf) return m;

    const hasOperational = m.outstandingBalance != null
      && m.outstandingBalance !== ''
      && Number.isFinite(Number(m.outstandingBalance));
    // Hay saldo vivo (apertura o movimientos): solo sella la fecha del corte.
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

/**
 * Ajusta el desglose LILA vivo: liquidación suma capital; cobro resta capital
 * (y recargos de stock LILA si vienen en el pago). Nunca inventa el 10 % nuevo.
 */
export function applyDuesPartsDelta(member, { capital = 0, surcharges = 0 } = {}) {
  if (!member) return member;
  const capitalDelta = Number(capital) || 0;
  const surchargeDelta = Number(surcharges) || 0;
  if (!capitalDelta && !surchargeDelta) return member;

  const next = { ...member };
  if (capitalDelta) {
    const base = member.unpaidCapital != null && member.unpaidCapital !== ''
      ? Number(member.unpaidCapital) || 0
      : (Number(member.outstandingBalance) || 0);
    next.unpaidCapital = Math.round((Math.max(0, base + capitalDelta)) * 100) / 100;
  }
  if (surchargeDelta && (member.unpaidSurcharges != null || surchargeDelta < 0)) {
    const base = Number(member.unpaidSurcharges) || 0;
    next.unpaidSurcharges = Math.round((Math.max(0, base + surchargeDelta)) * 100) / 100;
  }
  return next;
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { appMonthlyDebtForMember } from '../domain/accounting/appMonthlyDebts';
import {
  formatMonthsBehind,
  isDuesExemptMember,
  socialDuesStoredBalance,
} from '../domain/members/dues';
import { collectionPreview } from '../domain/members/memberPayments';
import {
  getMemberPaymentHistory,
  summarizePaymentHistory,
} from '../domain/members/paymentHistory';
import { todayISODateAR } from '../lib/arDate';
import { isSupabaseConfigured } from '../lib/supabase';
import { repos } from '../data/bootstrap';

function standingFromRpc(raw) {
  if (!raw) return null;
  const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const outstanding = Number(row.outstanding);
  const monthsBehind = Number(row.monthsBehind ?? row.months_behind);
  if (!Number.isFinite(outstanding) && !Number.isFinite(monthsBehind)) return null;
  const surcharge = Number(row.surcharge);
  const payable = Number(row.payable);
  const dueDay = Number(row.dueDay ?? row.due_day);
  return {
    outstanding: Number.isFinite(outstanding) ? outstanding : 0,
    monthsBehind: Number.isFinite(monthsBehind) ? monthsBehind : 0,
    nextDue: row.nextDue || row.next_due || null,
    lastPaymentDate: row.lastPaymentDate || row.last_payment_date || null,
    overdueSince: row.overdueSince || row.overdue_since || null,
    surcharge: Number.isFinite(surcharge) ? surcharge : 0,
    payable: Number.isFinite(payable) ? payable : null,
    dueDay: Number.isFinite(dueDay) && dueDay > 0 ? dueDay : null,
  };
}

/**
 * Estado de cuota del socio logueado: pagos reales de la nube + persistencia en ficha.
 * Ficha en 0 sin obligaciones nuevas → no atrasado por monthsBehind / nextDue / historial.
 */
export function useMemberDuesStanding(member) {
  const [remoteHistory, setRemoteHistory] = useState(() => (
    Array.isArray(member?.paymentHistory) ? member.paymentHistory : []
  ));
  const [remoteFicha, setRemoteFicha] = useState(null);
  const [persisted, setPersisted] = useState(null);
  const [loading, setLoading] = useState(false);
  const syncedFor = useRef('');
  const seedLen = member?.paymentHistory?.length || 0;
  const seedId = member?.paymentHistory?.[0]?.id;
  const memberKey = member?.id || member?.memberId || '';

  // Cambio rápido de socio: limpiar señales del anterior para no mezclar mora/saldo.
  useEffect(() => {
    setRemoteHistory(Array.isArray(member?.paymentHistory) ? member.paymentHistory : []);
    setRemoteFicha(null);
    setPersisted(null);
    syncedFor.current = '';
    setLoading(false);
  }, [memberKey]);

  useEffect(() => {
    const seed = member?.paymentHistory;
    if (Array.isArray(seed) && seed.length) {
      setRemoteHistory((prev) => (prev.length ? prev : seed));
    }
  }, [member?.id, seedLen, seedId]);

  useEffect(() => {
    let alive = true;
    if (!isSupabaseConfigured) return undefined;
    const number = member?.memberId && member.memberId !== 'session' ? member.memberId : null;
    const knownId = member?.id || null;
    if (!knownId && !number) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);

    (async () => {
      try {
        const dbId = knownId || await repos.findMemberDbIdByNumber(number);
        if (!alive) return;
        const [rows, ficha] = await Promise.all([
          dbId ? repos.listMemberPayments(dbId) : Promise.resolve([]),
          dbId ? repos.getMember(dbId, { withPayments: false }) : Promise.resolve(null),
        ]);
        if (!alive) return;
        if (rows.length) setRemoteHistory(rows);
        if (ficha) setRemoteFicha(ficha);
      } catch {
        /* se conserva lo que ya se ve */
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [member?.id, member?.memberId, member?.joinDate]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const key = member?.id || member?.memberId;
    if (!key || key === 'session') return undefined;
    if (syncedFor.current === key) return undefined;
    syncedFor.current = key;
    let alive = true;
    repos.syncOwnDuesStanding()
      .then((saved) => {
        const standing = standingFromRpc(saved);
        if (alive && standing) setPersisted(standing);
      })
      .catch(() => {
        if (alive) syncedFor.current = '';
      });
    return () => { alive = false; };
  }, [member?.id, member?.memberId]);

  const today = useMemo(() => new Date(`${todayISODateAR()}T12:00:00`), []);
  const memberForHistory = useMemo(() => {
    if (!member) return member;
    const base = remoteFicha ? { ...member, ...remoteFicha } : member;
    if (isDuesExemptMember(base)) {
      return {
        ...base,
        paymentHistory: remoteHistory.length ? remoteHistory : (base.paymentHistory || []),
        outstandingBalance: 0,
        duesOpenPeriods: [],
      };
    }
    if (isSupabaseConfigured) {
      const rpcOutstanding = persisted?.outstanding != null
        ? Number(persisted.outstanding)
        : null;
      return {
        ...base,
        paymentHistory: remoteHistory.length ? remoteHistory : (base.paymentHistory || []),
        lastPaymentDate: persisted?.lastPaymentDate || base.lastPaymentDate,
        nextDueDate: persisted?.nextDue || base.nextDueDate,
        // RPC solo pisa si viene; no perder duesOpenPeriods de la ficha remota.
        outstandingBalance: rpcOutstanding != null ? rpcOutstanding : base.outstandingBalance,
      };
    }
    return base;
  }, [member, remoteHistory, persisted, remoteFicha]);

  const history = useMemo(
    () => getMemberPaymentHistory(memberForHistory, {
      today,
      allowDemo: !isSupabaseConfigured,
    }),
    [memberForHistory, today]
  );
  const summary = useMemo(() => {
    const fromHistory = summarizePaymentHistory(history, memberForHistory, { today });
    if (isDuesExemptMember(memberForHistory)) return fromHistory;

    const memberForDebt = {
      ...memberForHistory,
      lastPaymentDate: persisted?.lastPaymentDate || fromHistory.lastDuesDate || memberForHistory?.lastPaymentDate,
      nextDueDate: persisted?.nextDue || fromHistory.nextDue || memberForHistory?.nextDueDate,
    };
    // Misma cifra que Consultar deuda / acceso: ficha + períodos abiertos.
    const stored = socialDuesStoredBalance(memberForDebt);
    const debt = stored > 0.01
      ? appMonthlyDebtForMember({ ...memberForDebt, outstandingBalance: stored }, { today })
      : null;
    const preview = collectionPreview(
      stored > 0.01 ? { ...memberForDebt, outstandingBalance: stored } : memberForDebt,
      today,
    );

    // Ficha en 0 sin obligaciones: no arrastrar monthsBehind del RPC ni del historial.
    const monthsBehind = stored > 0.01
      ? Math.max(
        Number(debt?.monthsBehind) || 0,
        Number(persisted?.monthsBehind) || 0,
        fromHistory.monthsBehind || 0,
      )
      : 0;
    const outstanding = stored;
    const owes = Boolean(debt) || outstanding > 0.01;
    const surcharge = debt
      ? (Number(debt.interest) || 0)
      : (owes ? (Number(preview.surcharge) || 0) : 0);
    const quota = debt
      ? ((Number(debt.capital) || 0) + (Number(debt.unallocated) || 0))
      : (owes ? (Number(preview.quota) || outstanding) : 0);
    const nextAmount = debt
      ? (Number(debt.totalDebt) || 0)
      : (owes
        ? (Number(preview.cash) > 0.01 ? Number(preview.cash) : outstanding)
        : (Number(preview.cash) > 0.01 ? Number(preview.cash) : 0));
    const nextDue = owes
      ? ([persisted?.nextDue, fromHistory.nextDue].filter(Boolean).sort()[0] || fromHistory.nextDue)
      : (persisted?.nextDue || memberForHistory?.nextDueDate || fromHistory.nextDue || null);
    const chargeDue = owes
      ? (debt?.months?.[debt.months.length - 1]?.dueOn || preview.periods?.[0]?.dueOn || nextDue)
      : nextDue;
    return {
      ...fromHistory,
      outstanding,
      monthsBehind,
      nextDue,
      chargeDue,
      quota,
      lastDuesDate: persisted?.lastPaymentDate || fromHistory.lastDuesDate,
      nextAmount,
      surcharge,
      dueDay: persisted?.dueDay || fromHistory.dueDay,
      debtMonths: debt?.months || [],
      unallocated: Number(debt?.unallocated) || 0,
      standing: debt?.standing || (owes ? 'Con saldo' : 'Al día'),
    };
  }, [history, memberForHistory, today, persisted]);

  const hasLocalSignal = Boolean(
    history.length
    || persisted
    || memberForHistory?.lastPaymentDate
    || socialDuesStoredBalance(memberForHistory || {}) > 0.01
    || memberForHistory?.nextDueDate
  );
  const pending = Boolean(isSupabaseConfigured && loading && !hasLocalSignal);

  return {
    summary,
    history,
    member: memberForHistory,
    loading,
    pending,
    lateLabel: formatMonthsBehind(summary.monthsBehind),
    behind: !pending
      && !isDuesExemptMember(memberForHistory)
      && ((summary.monthsBehind || 0) > 0 || (summary.outstanding || 0) > 0.01),
  };
}

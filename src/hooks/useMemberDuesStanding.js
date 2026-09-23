import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMonthsBehind } from '../domain/members/dues';
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
  return {
    outstanding: Number.isFinite(outstanding) ? outstanding : 0,
    monthsBehind: Number.isFinite(monthsBehind) ? monthsBehind : 0,
    nextDue: row.nextDue || row.next_due || null,
    lastPaymentDate: row.lastPaymentDate || row.last_payment_date || null,
    overdueSince: row.overdueSince || row.overdue_since || null,
  };
}

/**
 * Estado de cuota del socio logueado: pagos reales de la nube + persistencia en ficha.
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
        const rows = dbId ? await repos.listMemberPayments(dbId) : [];
        if (!alive) return;
        if (rows.length) setRemoteHistory(rows);
      } catch {
        /* se conserva lo que ya se ve */
      } finally {
        if (alive) setLoading(false);
      }
    })();

    if (number && (!member?.joinDate || !knownId)) {
      repos.getMemberByNumber(number, { withPayments: false })
        .then((ficha) => {
          if (!alive || !ficha) return;
          setRemoteFicha(ficha);
        })
        .catch(() => {});
    }

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
    if (isSupabaseConfigured) {
      return {
        ...base,
        paymentHistory: remoteHistory.length ? remoteHistory : (base.paymentHistory || []),
        lastPaymentDate: persisted?.lastPaymentDate || base.lastPaymentDate,
        nextDueDate: persisted?.nextDue || base.nextDueDate,
        outstandingBalance: persisted?.outstanding != null
          ? Number(persisted.outstanding)
          : base.outstandingBalance,
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
    if (history.length > 0 || !persisted) return fromHistory;
    const outstanding = Number(persisted.outstanding) || 0;
    const monthsBehind = Number(persisted.monthsBehind) || 0;
    return {
      ...fromHistory,
      outstanding,
      monthsBehind,
      nextDue: persisted.nextDue || fromHistory.nextDue,
      lastDuesDate: persisted.lastPaymentDate || fromHistory.lastDuesDate,
      nextAmount: outstanding > 0 ? outstanding : fromHistory.nextAmount,
    };
  }, [history, memberForHistory, today, persisted]);

  const hasLocalSignal = Boolean(
    history.length
    || persisted
    || memberForHistory?.lastPaymentDate
    || (Number(memberForHistory?.outstandingBalance) || 0) > 0
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
    behind: !pending && ((summary.monthsBehind || 0) > 0 || (summary.outstanding || 0) > 0),
  };
}

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../domain/accounting/chartOfAccounts';
import {
  DEFAULT_CASH_REGISTERS,
  openCashSession,
  closeCashSession,
  buildCashMovementEntry,
  getOpenSession,
} from '../domain/accounting/cash';
import {
  createExpenseDraft,
  approveExpense,
  rejectExpense,
  payExpense,
} from '../domain/accounting/expenses';
import {
  DEFAULT_ALERTS,
  createAlert,
  syncZondaAlert,
  acknowledgeAlert,
} from '../domain/alerts/alerts';
import {
  DEFAULT_CLUB_EVENTS,
  createClubEvent,
  registerForEvent,
  countRegistrations,
} from '../domain/events/clubEvents';
import { buildPostedEntry, normalizeLines } from '../domain/accounting/journal';

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Migra asientos legacy {account,type,amount} a líneas con accountId. */
function migrateJournalEntries(entries, chart) {
  return entries.map((entry) => {
    if (entry.lines?.[0]?.accountId) {
      return { status: entry.status || 'posted', ...entry };
    }
    return {
      ...entry,
      status: entry.status || 'posted',
      concept: entry.concept || entry.description,
      lines: normalizeLines(entry.lines || [], chart),
    };
  });
}

export default function useErpStore({ setJournalEntries, isZondaActive }) {
  const [chartOfAccounts, setChartOfAccounts] = useState(() =>
    load('jockey-chart-of-accounts', DEFAULT_CHART_OF_ACCOUNTS)
  );
  const [cashRegisters] = useState(() =>
    load('jockey-cash-registers', DEFAULT_CASH_REGISTERS)
  );
  const [cashSessions, setCashSessions] = useState(() => load('jockey-cash-sessions', []));
  const [cashMovements, setCashMovements] = useState(() => load('jockey-cash-movements', []));
  const [expenses, setExpenses] = useState(() => load('jockey-expenses', []));
  const [alerts, setAlerts] = useState(() => load('jockey-alerts', DEFAULT_ALERTS));
  const [alertAcks, setAlertAcks] = useState(() => load('jockey-alert-acks', []));
  const [clubEvents, setClubEvents] = useState(() => load('jockey-club-events', DEFAULT_CLUB_EVENTS));
  const [eventRegistrations, setEventRegistrations] = useState(() =>
    load('jockey-event-registrations', [])
  );

  // Migración one-shot de asientos legacy
  useEffect(() => {
    setJournalEntries((prev) => {
      const migrated = migrateJournalEntries(prev, chartOfAccounts);
      const changed = JSON.stringify(prev) !== JSON.stringify(migrated);
      return changed ? migrated : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => persist('jockey-chart-of-accounts', chartOfAccounts), [chartOfAccounts]);
  useEffect(() => persist('jockey-cash-registers', cashRegisters), [cashRegisters]);
  useEffect(() => persist('jockey-cash-sessions', cashSessions), [cashSessions]);
  useEffect(() => persist('jockey-cash-movements', cashMovements), [cashMovements]);
  useEffect(() => persist('jockey-expenses', expenses), [expenses]);
  useEffect(() => persist('jockey-alerts', alerts), [alerts]);
  useEffect(() => persist('jockey-alert-acks', alertAcks), [alertAcks]);
  useEffect(() => persist('jockey-club-events', clubEvents), [clubEvents]);
  useEffect(() => persist('jockey-event-registrations', eventRegistrations), [eventRegistrations]);

  useEffect(() => {
    setAlerts((prev) => syncZondaAlert(prev, isZondaActive));
  }, [isZondaActive]);

  const addPostedEntry = useCallback(
    (entryInput) => {
      const entry =
        entryInput.lines?.[0]?.accountId != null
          ? { status: 'posted', ...entryInput, concept: entryInput.concept || entryInput.description }
          : buildPostedEntry({ ...entryInput, chart: chartOfAccounts });
      setJournalEntries((prev) => [entry, ...prev]);
      return entry;
    },
    [chartOfAccounts, setJournalEntries]
  );

  const openRegister = useCallback(
    (cashRegisterId, openingBalance) => {
      if (getOpenSession(cashSessions, cashRegisterId)) {
        throw new Error('Ya hay una sesión abierta en esta caja.');
      }
      const session = openCashSession({ cashRegisterId, openingBalance });
      setCashSessions((prev) => [session, ...prev]);
      return session;
    },
    [cashSessions]
  );

  const closeRegister = useCallback(
    (sessionId, countedBalance) => {
      setCashSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return closeCashSession(s, { countedBalance, movements: cashMovements });
        })
      );
    },
    [cashMovements]
  );

  const addCashMovement = useCallback(
    ({ cashRegisterId, movementType, amount, concept, relatedAccountId, memberId }) => {
      const session = getOpenSession(cashSessions, cashRegisterId);
      if (!session) throw new Error('Debe abrir la caja antes de registrar movimientos.');
      const register = cashRegisters.find((r) => r.id === cashRegisterId);
      if (!register) throw new Error('Caja no encontrada.');

      const entry = buildCashMovementEntry({
        date: new Date().toISOString().slice(0, 10),
        concept,
        cashAccountId: register.accountId,
        relatedAccountId,
        amount,
        movementType,
        chart: chartOfAccounts,
      });

      const movement = {
        id: `cm-${Date.now()}`,
        cashSessionId: session.id,
        movementType,
        amount: Number(amount),
        concept: concept.trim(),
        relatedAccountId,
        memberId: memberId || null,
        journalEntryId: entry.id,
        createdAt: new Date().toISOString(),
      };

      setCashMovements((prev) => [movement, ...prev]);
      setJournalEntries((prev) => [entry, ...prev]);
      return movement;
    },
    [cashSessions, cashRegisters, chartOfAccounts, setJournalEntries]
  );

  const submitExpense = useCallback((payload) => {
    const expense = createExpenseDraft(payload);
    setExpenses((prev) => [expense, ...prev]);
    return expense;
  }, []);

  const setExpenseApproved = useCallback((expenseId) => {
    setExpenses((prev) => prev.map((e) => (e.id === expenseId ? approveExpense(e) : e)));
  }, []);

  const setExpenseRejected = useCallback((expenseId, reason) => {
    setExpenses((prev) => prev.map((e) => (e.id === expenseId ? rejectExpense(e, reason) : e)));
  }, []);

  const setExpensePaid = useCallback(
    (expenseId) => {
      setExpenses((prev) => {
        const target = prev.find((e) => e.id === expenseId);
        if (!target) return prev;
        const { expense, journalEntry } = payExpense(target, chartOfAccounts);
        setJournalEntries((entries) => [journalEntry, ...entries]);
        return prev.map((e) => (e.id === expenseId ? expense : e));
      });
    },
    [chartOfAccounts, setJournalEntries]
  );

  const publishAlert = useCallback((payload) => {
    const alert = createAlert(payload);
    setAlerts((prev) => [alert, ...prev]);
    return alert;
  }, []);

  const deactivateAlert = useCallback((alertId) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId ? { ...a, isActive: false, endsAt: new Date().toISOString() } : a
      )
    );
  }, []);

  const ackAlert = useCallback((alertId, profileId = 'local-user') => {
    setAlertAcks((prev) => acknowledgeAlert(prev, alertId, profileId));
  }, []);

  const addClubEvent = useCallback((payload) => {
    const event = createClubEvent(payload);
    setClubEvents((prev) => [event, ...prev]);
    return event;
  }, []);

  const registerMemberToEvent = useCallback(
    ({ eventId, memberId, guestsCount, guestName }) => {
      const event = clubEvents.find((e) => e.id === eventId);
      if (!event) throw new Error('Evento no encontrado.');
      if (event.capacity) {
        const used = countRegistrations(eventRegistrations, eventId);
        if (used + (Number(guestsCount) || 1) > event.capacity) {
          throw new Error('No hay cupos disponibles para este evento.');
        }
      }
      const { registration, journalEntry } = registerForEvent({
        event,
        memberId,
        guestsCount,
        guestName,
        chart: chartOfAccounts,
      });
      setEventRegistrations((prev) => [registration, ...prev]);
      if (journalEntry) setJournalEntries((prev) => [journalEntry, ...prev]);
      return registration;
    },
    [clubEvents, eventRegistrations, chartOfAccounts, setJournalEntries]
  );

  return {
    chartOfAccounts,
    setChartOfAccounts,
    cashRegisters,
    cashSessions,
    cashMovements,
    expenses,
    alerts,
    alertAcks,
    clubEvents,
    eventRegistrations,
    addPostedEntry,
    openRegister,
    closeRegister,
    addCashMovement,
    submitExpense,
    setExpenseApproved,
    setExpenseRejected,
    setExpensePaid,
    publishAlert,
    deactivateAlert,
    ackAlert,
    addClubEvent,
    registerMemberToEvent,
  };
}

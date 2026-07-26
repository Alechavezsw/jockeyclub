import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../domain/accounting/chartOfAccounts';
import {
  DEFAULT_CASH_REGISTERS,
  openCashSession,
  closeCashSession,
  buildCashMovementEntry,
  buildCashTransferEntry,
  getOpenSession,
} from '../domain/accounting/cash';
import {
  createExpenseDraft,
  approveExpense,
  rejectExpense,
  payExpense,
} from '../domain/accounting/expenses';
import {
  DEFAULT_SUPPLIERS,
  setSupplierStatus,
} from '../domain/accounting/suppliers';
import {
  DEFAULT_UNIDENTIFIED_COLLECTIONS,
  DEFAULT_GALICIA_DEBITS,
  DEFAULT_FIXED_EXPENSES,
  DEFAULT_FIXED_DISCOUNTS,
  DEFAULT_PAYMENT_ORDERS,
} from '../domain/accounting/treasury';
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
import {
  DEFAULT_CONCESSIONS,
  DEFAULT_CANON_PAYMENTS,
  defaultChecklist,
  upsertConcession as upsertConcessionDomain,
  renewConcession,
  createCanonPayment,
  buildCanonJournalEntry,
  setChecklistItem,
  addConcessionDocument,
  removeConcessionDocument,
  syncConcessionAlerts,
} from '../domain/concessions/concessions';
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
  const [suppliers, setSuppliers] = useState(() => load('jockey-suppliers', DEFAULT_SUPPLIERS));
  const [unidentifiedCollections, setUnidentifiedCollections] = useState(() =>
    load('jockey-unidentified-collections', DEFAULT_UNIDENTIFIED_COLLECTIONS)
  );
  const [galiciaDebits, setGaliciaDebits] = useState(() =>
    load('jockey-galicia-debits', DEFAULT_GALICIA_DEBITS)
  );
  const [fixedExpenses, setFixedExpenses] = useState(() =>
    load('jockey-fixed-expenses', DEFAULT_FIXED_EXPENSES)
  );
  const [fixedDiscounts, setFixedDiscounts] = useState(() =>
    load('jockey-fixed-discounts', DEFAULT_FIXED_DISCOUNTS)
  );
  const [paymentOrders, setPaymentOrders] = useState(() =>
    load('jockey-payment-orders', DEFAULT_PAYMENT_ORDERS)
  );
  const [alerts, setAlerts] = useState(() => load('jockey-alerts', DEFAULT_ALERTS));
  const [alertAcks, setAlertAcks] = useState(() => load('jockey-alert-acks', []));
  const [clubEvents, setClubEvents] = useState(() => load('jockey-club-events', DEFAULT_CLUB_EVENTS));
  const [eventRegistrations, setEventRegistrations] = useState(() =>
    load('jockey-event-registrations', [])
  );
  const [concessions, setConcessions] = useState(() => {
    const loaded = load('jockey-concessions', null);
    if (!loaded) return DEFAULT_CONCESSIONS;
    return loaded.map((c) => {
      const seed = DEFAULT_CONCESSIONS.find((d) => d.id === c.id);
      return {
        ...(seed || {}),
        ...c,
        checklist: c.checklist || seed?.checklist || defaultChecklist(),
        documents: c.documents?.length ? c.documents : (seed?.documents || []),
        renewalHistory: c.renewalHistory || seed?.renewalHistory || [],
        spaceId: c.spaceId || seed?.spaceId || '',
        portalCode: c.portalCode || seed?.portalCode || '',
      };
    });
  });
  const [canonPayments, setCanonPayments] = useState(() =>
    load('jockey-canon-payments', DEFAULT_CANON_PAYMENTS)
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
  useEffect(() => persist('jockey-suppliers', suppliers), [suppliers]);
  useEffect(() => persist('jockey-unidentified-collections', unidentifiedCollections), [unidentifiedCollections]);
  useEffect(() => persist('jockey-galicia-debits', galiciaDebits), [galiciaDebits]);
  useEffect(() => persist('jockey-fixed-expenses', fixedExpenses), [fixedExpenses]);
  useEffect(() => persist('jockey-fixed-discounts', fixedDiscounts), [fixedDiscounts]);
  useEffect(() => persist('jockey-payment-orders', paymentOrders), [paymentOrders]);
  useEffect(() => persist('jockey-alerts', alerts), [alerts]);
  useEffect(() => persist('jockey-alert-acks', alertAcks), [alertAcks]);
  useEffect(() => persist('jockey-club-events', clubEvents), [clubEvents]);
  useEffect(() => persist('jockey-event-registrations', eventRegistrations), [eventRegistrations]);
  useEffect(() => persist('jockey-concessions', concessions), [concessions]);
  useEffect(() => persist('jockey-canon-payments', canonPayments), [canonPayments]);

  useEffect(() => {
    setAlerts((prev) => syncZondaAlert(prev, isZondaActive));
  }, [isZondaActive]);

  useEffect(() => {
    setAlerts((prev) => syncConcessionAlerts(prev, concessions));
  }, [concessions]);

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

  /** Traspaso entre cajas/bancos. Requiere caja origen abierta. */
  const transferCash = useCallback(
    ({ fromRegisterId, toAccountId, amount, concept }) => {
      const fromRegister = cashRegisters.find((r) => r.id === fromRegisterId);
      if (!fromRegister) throw new Error('Caja origen no encontrada.');
      const fromSession = getOpenSession(cashSessions, fromRegisterId);
      if (!fromSession) throw new Error('Abra la caja origen antes de traspasar.');
      if (!toAccountId) throw new Error('Seleccione destino del traspaso.');
      if (toAccountId === fromRegister.accountId) {
        throw new Error('El destino no puede ser la misma cuenta de origen.');
      }

      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error('Importe inválido.');

      const entry = buildCashTransferEntry({
        date: new Date().toISOString().slice(0, 10),
        concept: concept?.trim() || `Traspaso desde ${fromRegister.name}`,
        fromAccountId: fromRegister.accountId,
        toAccountId,
        amount: amt,
        chart: chartOfAccounts,
      });

      const stamp = Date.now();
      const conceptText = concept?.trim() || entry.description;
      const outMove = {
        id: `cm-${stamp}-out`,
        cashSessionId: fromSession.id,
        movementType: 'transfer_out',
        amount: amt,
        concept: conceptText,
        relatedAccountId: toAccountId,
        memberId: null,
        journalEntryId: entry.id,
        createdAt: new Date().toISOString(),
      };

      const destRegister = cashRegisters.find((r) => r.accountId === toAccountId);
      const destSession = destRegister ? getOpenSession(cashSessions, destRegister.id) : null;
      const moves = [outMove];
      if (destSession) {
        moves.unshift({
          id: `cm-${stamp}-in`,
          cashSessionId: destSession.id,
          movementType: 'transfer_in',
          amount: amt,
          concept: conceptText,
          relatedAccountId: fromRegister.accountId,
          memberId: null,
          journalEntryId: entry.id,
          createdAt: new Date().toISOString(),
        });
      }

      setCashMovements((prev) => [...moves, ...prev]);
      setJournalEntries((prev) => [entry, ...prev]);
      return { entry, movements: moves };
    },
    [cashRegisters, cashSessions, chartOfAccounts, setJournalEntries]
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

  const upsertConcession = useCallback((concession) => {
    setConcessions((prev) => upsertConcessionDomain(prev, concession));
  }, []);

  const renewConcessionContract = useCallback((concessionId, options = {}) => {
    const months = typeof options === 'number' ? options : (options.months ?? 12);
    const rest = typeof options === 'number' ? {} : options;
    setConcessions((prev) =>
      prev.map((c) => (c.id === concessionId ? renewConcession(c, { months, ...rest }) : c))
    );
  }, []);

  const setConcessionStatus = useCallback((concessionId, statusManual) => {
    setConcessions((prev) =>
      prev.map((c) => (c.id === concessionId ? { ...c, statusManual } : c))
    );
  }, []);

  const toggleConcessionChecklist = useCallback((concessionId, itemId, done) => {
    setConcessions((prev) =>
      prev.map((c) => (c.id === concessionId ? setChecklistItem(c, itemId, done) : c))
    );
  }, []);

  const addDocToConcession = useCallback((concessionId, doc) => {
    setConcessions((prev) =>
      prev.map((c) => (c.id === concessionId ? addConcessionDocument(c, doc) : c))
    );
  }, []);

  const removeDocFromConcession = useCallback((concessionId, docId) => {
    setConcessions((prev) =>
      prev.map((c) => (c.id === concessionId ? removeConcessionDocument(c, docId) : c))
    );
  }, []);

  const recordCanonPayment = useCallback(
    (payload) => {
      const concession = concessions.find((c) => c.id === payload.concessionId);
      if (!concession) throw new Error('Concesión no encontrada.');
      const payment = createCanonPayment(payload);
      const entry = buildCanonJournalEntry(payment, concession, chartOfAccounts);
      const withReceipt = {
        ...payment,
        receipt: `CAN-${String(Date.now()).slice(-8)}`,
        journalEntryId: entry.id,
      };
      setCanonPayments((prev) => [withReceipt, ...prev]);
      setJournalEntries((prev) => [entry, ...prev]);
      return withReceipt;
    },
    [concessions, chartOfAccounts]
  );

  const addClubEvent = useCallback((payload) => {
    const event = createClubEvent(payload);
    setClubEvents((prev) => [event, ...prev]);
    return event;
  }, []);

  const upsertSupplier = useCallback((supplier) => {
    setSuppliers((prev) => {
      const idx = prev.findIndex((s) => s.id === supplier.id);
      if (idx === -1) return [supplier, ...prev];
      const next = [...prev];
      next[idx] = supplier;
      return next;
    });
    return supplier;
  }, []);

  const toggleSupplierStatus = useCallback((supplierId, status) => {
    setSuppliers((prev) => prev.map((s) => (
      s.id === supplierId ? setSupplierStatus(s, status) : s
    )));
  }, []);

  const upsertUnidentifiedCollection = useCallback((item) => {
    setUnidentifiedCollections((prev) => {
      const idx = prev.findIndex((x) => x.id === item.id);
      if (idx === -1) return [item, ...prev];
      const next = [...prev];
      next[idx] = item;
      return next;
    });
  }, []);

  const upsertGaliciaDebit = useCallback((item) => {
    setGaliciaDebits((prev) => {
      const idx = prev.findIndex((x) => x.id === item.id);
      if (idx === -1) return [item, ...prev];
      const next = [...prev];
      next[idx] = item;
      return next;
    });
  }, []);

  const addFixedExpense = useCallback((item) => {
    setFixedExpenses((prev) => [item, ...prev]);
  }, []);

  const toggleFixedExpense = useCallback((id) => {
    setFixedExpenses((prev) => prev.map((x) => (x.id === id ? { ...x, active: !x.active } : x)));
  }, []);

  const addFixedDiscount = useCallback((item) => {
    setFixedDiscounts((prev) => [item, ...prev]);
  }, []);

  const toggleFixedDiscount = useCallback((id) => {
    setFixedDiscounts((prev) => prev.map((x) => (x.id === id ? { ...x, active: !x.active } : x)));
  }, []);

  const upsertPaymentOrder = useCallback((item) => {
    setPaymentOrders((prev) => {
      const idx = prev.findIndex((x) => x.id === item.id);
      if (idx === -1) return [item, ...prev];
      const next = [...prev];
      next[idx] = item;
      return next;
    });
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
    suppliers,
    unidentifiedCollections,
    galiciaDebits,
    fixedExpenses,
    fixedDiscounts,
    paymentOrders,
    alerts,
    alertAcks,
    clubEvents,
    eventRegistrations,
    concessions,
    canonPayments,
    addPostedEntry,
    openRegister,
    closeRegister,
    addCashMovement,
    transferCash,
    submitExpense,
    setExpenseApproved,
    setExpenseRejected,
    setExpensePaid,
    upsertSupplier,
    toggleSupplierStatus,
    upsertUnidentifiedCollection,
    upsertGaliciaDebit,
    addFixedExpense,
    toggleFixedExpense,
    addFixedDiscount,
    toggleFixedDiscount,
    upsertPaymentOrder,
    publishAlert,
    deactivateAlert,
    ackAlert,
    addClubEvent,
    registerMemberToEvent,
    upsertConcession,
    renewConcessionContract,
    setConcessionStatus,
    toggleConcessionChecklist,
    addDocToConcession,
    removeDocFromConcession,
    recordCanonPayment,
  };
}

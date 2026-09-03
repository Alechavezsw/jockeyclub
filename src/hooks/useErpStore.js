import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import * as repos from '../data/repos';
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
  ACCESSIN_CASH_MOVEMENTS,
  ACCESSIN_CASH_REGISTERS,
  ACCESSIN_CHEQUES,
} from '../domain/accounting/cashLedger';
import { ACCESSIN_COBRANZAS } from '../domain/accounting/cobranzas';
import { ACCESSIN_SUPPLIER_PAYMENTS } from '../domain/accounting/supplierPaymentsReport';
import {
  ACCESSIN_BANK_ACCOUNTS,
  applyBankAccountEntry,
  resolveBankAccounts,
  softDeleteBankAccount,
  upsertBankAccount,
} from '../domain/accounting/bankAccounts';
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
  DEFAULT_RETENCIONES,
} from '../domain/accounting/retenciones';
import {
  DEFAULT_UNIDENTIFIED_COLLECTIONS,
  DEFAULT_GALICIA_DEBITS,
  DEFAULT_FIXED_EXPENSES,
  DEFAULT_FIXED_DISCOUNTS,
  DEFAULT_PAYMENT_ORDERS,
  buildUnidentifiedMatchEntry,
  buildGaliciaSettledEntry,
  buildPaymentOrderPaidEntry,
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
  enableMemberEventAccess,
  enableGuestEventAccess,
  revokeEventRegistration as revokeEventRegistrationDomain,
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

const cloud = () => isSupabaseConfigured;

function load(key, fallback) {
  if (cloud()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key, value) {
  if (cloud()) return;
  localStorage.setItem(key, JSON.stringify(value));
}

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

export default function useErpStore({ setJournalEntries, isZondaActive, userId }) {
  const [chartOfAccounts, setChartOfAccounts] = useState(() =>
    load('jockey-chart-of-accounts', DEFAULT_CHART_OF_ACCOUNTS)
  );
  const [cashRegisters, setCashRegisters] = useState(() => {
    const loaded = load('jockey-cash-registers-v2', null);
    if (Array.isArray(loaded) && loaded.length >= 3) return loaded;
    return ACCESSIN_CASH_REGISTERS.length ? ACCESSIN_CASH_REGISTERS : DEFAULT_CASH_REGISTERS;
  });
  const [cashSessions, setCashSessions] = useState(() => load('jockey-cash-sessions', []));
  const [cashMovements, setCashMovements] = useState(() => load('jockey-cash-movements', []));
  const [accessinCashMovements, setAccessinCashMovements] = useState(() => {
    const loaded = load('jockey-accessin-cash-movements-v1', null);
    if (Array.isArray(loaded) && loaded.length >= 500) return loaded;
    return ACCESSIN_CASH_MOVEMENTS;
  });
  const [accessinCheques, setAccessinCheques] = useState(() => {
    const loaded = load('jockey-accessin-cheques-v1', null);
    if (Array.isArray(loaded)) return loaded;
    return ACCESSIN_CHEQUES;
  });
  const [accessinCobranzas, setAccessinCobranzas] = useState(() => {
    const loaded = load('jockey-accessin-cobranzas-v1', null);
    if (Array.isArray(loaded) && loaded.length >= 200) return loaded;
    return ACCESSIN_COBRANZAS;
  });
  const [accessinSupplierPayments, setAccessinSupplierPayments] = useState(() => {
    const loaded = load('jockey-accessin-supplier-payments-v1', null);
    if (Array.isArray(loaded)) return loaded;
    return ACCESSIN_SUPPLIER_PAYMENTS;
  });
  const [accessinBankAccounts, setAccessinBankAccounts] = useState(() =>
    resolveBankAccounts(load('jockey-accessin-bank-accounts-v1', null))
  );
  const [expenses, setExpenses] = useState(() => load('jockey-expenses', []));
  const [suppliers, setSuppliers] = useState(() => {
    const loaded = load('jockey-suppliers-v3', null);
    if (Array.isArray(loaded) && loaded.length >= 50) return loaded;
    return DEFAULT_SUPPLIERS;
  });
  const [retenciones, setRetenciones] = useState(() => load('jockey-retenciones-v1', DEFAULT_RETENCIONES));
  const [supplierPaymentImports, setSupplierPaymentImports] = useState(() =>
    load('jockey-supplier-payment-imports-v1', [])
  );
  const [expenseImports, setExpenseImports] = useState(() => load('jockey-expense-imports-v1', []));
  const [supplierEntries, setSupplierEntries] = useState(() => load('jockey-supplier-entries-v1', []));
  const [otherIncomes, setOtherIncomes] = useState(() => load('jockey-other-incomes-v1', []));
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

  const applyErpHydration = useCallback((erp) => {
    if (!erp) return;
    if (Array.isArray(erp.chartOfAccounts)) setChartOfAccounts(erp.chartOfAccounts);
    if (Array.isArray(erp.cashRegisters)) {
      if (erp.cashRegisters.length >= 3) setCashRegisters(erp.cashRegisters);
      else if (ACCESSIN_CASH_REGISTERS.length) setCashRegisters(ACCESSIN_CASH_REGISTERS);
    }
    if (Array.isArray(erp.cashSessions)) setCashSessions(erp.cashSessions);
    if (Array.isArray(erp.cashMovements)) setCashMovements(erp.cashMovements);
    if (Array.isArray(erp.accessinCashMovements) && erp.accessinCashMovements.length >= 500) {
      setAccessinCashMovements(erp.accessinCashMovements);
    } else if (ACCESSIN_CASH_MOVEMENTS.length) {
      setAccessinCashMovements(ACCESSIN_CASH_MOVEMENTS);
    }
    if (Array.isArray(erp.accessinCheques)) setAccessinCheques(erp.accessinCheques);
    else setAccessinCheques(ACCESSIN_CHEQUES);
    if (Array.isArray(erp.accessinCobranzas) && erp.accessinCobranzas.length >= 200) {
      setAccessinCobranzas(erp.accessinCobranzas);
    } else if (ACCESSIN_COBRANZAS.length) {
      setAccessinCobranzas(ACCESSIN_COBRANZAS);
    }
    if (Array.isArray(erp.accessinSupplierPayments)) {
      setAccessinSupplierPayments(erp.accessinSupplierPayments);
    } else {
      setAccessinSupplierPayments(ACCESSIN_SUPPLIER_PAYMENTS);
    }
    if (Array.isArray(erp.accessinBankAccounts) && erp.accessinBankAccounts.length) {
      setAccessinBankAccounts(erp.accessinBankAccounts);
    } else {
      setAccessinBankAccounts(ACCESSIN_BANK_ACCOUNTS);
    }
    if (Array.isArray(erp.expenses)) setExpenses(erp.expenses);
    if (Array.isArray(erp.suppliers)) {
      // Preferir nube cuando ya tiene el padrón Accessin; si no, seed local.
      if (erp.suppliers.length >= 200) setSuppliers(erp.suppliers);
      else if (DEFAULT_SUPPLIERS.length) setSuppliers(DEFAULT_SUPPLIERS);
    }
    if (Array.isArray(erp.retenciones)) setRetenciones(erp.retenciones);
    if (Array.isArray(erp.supplierPaymentImports)) setSupplierPaymentImports(erp.supplierPaymentImports);
    if (Array.isArray(erp.expenseImports)) setExpenseImports(erp.expenseImports);
    if (Array.isArray(erp.supplierEntries)) setSupplierEntries(erp.supplierEntries);
    if (Array.isArray(erp.otherIncomes)) setOtherIncomes(erp.otherIncomes);
    if (Array.isArray(erp.unidentifiedCollections)) setUnidentifiedCollections(erp.unidentifiedCollections);
    if (Array.isArray(erp.galiciaDebits)) setGaliciaDebits(erp.galiciaDebits);
    if (Array.isArray(erp.fixedExpenses)) setFixedExpenses(erp.fixedExpenses);
    if (Array.isArray(erp.fixedDiscounts)) setFixedDiscounts(erp.fixedDiscounts);
    if (Array.isArray(erp.paymentOrders)) setPaymentOrders(erp.paymentOrders);
    if (Array.isArray(erp.alerts)) setAlerts(erp.alerts);
    if (Array.isArray(erp.alertAcks)) setAlertAcks(erp.alertAcks);
    if (Array.isArray(erp.clubEvents)) setClubEvents(erp.clubEvents);
    if (Array.isArray(erp.eventRegistrations)) setEventRegistrations(erp.eventRegistrations);
    if (Array.isArray(erp.concessions)) setConcessions(erp.concessions);
    if (Array.isArray(erp.canonPayments)) setCanonPayments(erp.canonPayments);
  }, []);

  useEffect(() => {
    if (cloud()) return undefined;
    setJournalEntries((prev) => {
      const migrated = migrateJournalEntries(prev, chartOfAccounts);
      const changed = JSON.stringify(prev) !== JSON.stringify(migrated);
      return changed ? migrated : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => persist('jockey-chart-of-accounts', chartOfAccounts), [chartOfAccounts]);
  useEffect(() => persist('jockey-cash-registers-v2', cashRegisters), [cashRegisters]);
  useEffect(() => persist('jockey-cash-sessions', cashSessions), [cashSessions]);
  useEffect(() => persist('jockey-cash-movements', cashMovements), [cashMovements]);
  useEffect(() => persist('jockey-accessin-cash-movements-v1', accessinCashMovements), [accessinCashMovements]);
  useEffect(() => persist('jockey-accessin-cheques-v1', accessinCheques), [accessinCheques]);
  useEffect(() => persist('jockey-accessin-cobranzas-v1', accessinCobranzas), [accessinCobranzas]);
  useEffect(() => persist('jockey-accessin-supplier-payments-v1', accessinSupplierPayments), [accessinSupplierPayments]);
  useEffect(() => persist('jockey-accessin-bank-accounts-v1', accessinBankAccounts), [accessinBankAccounts]);
  useEffect(() => persist('jockey-expenses', expenses), [expenses]);
  useEffect(() => persist('jockey-suppliers-v3', suppliers), [suppliers]);
  useEffect(() => persist('jockey-retenciones-v1', retenciones), [retenciones]);
  useEffect(() => persist('jockey-supplier-payment-imports-v1', supplierPaymentImports), [supplierPaymentImports]);
  useEffect(() => persist('jockey-expense-imports-v1', expenseImports), [expenseImports]);
  useEffect(() => persist('jockey-supplier-entries-v1', supplierEntries), [supplierEntries]);
  useEffect(() => persist('jockey-other-incomes-v1', otherIncomes), [otherIncomes]);
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
    if (cloud()) {
      repos.setSetting('zonda', { active: Boolean(isZondaActive) }, userId).catch(() => {});
    }
  }, [isZondaActive, userId]);

  useEffect(() => {
    setAlerts((prev) => syncConcessionAlerts(prev, concessions));
  }, [concessions]);

  const addPostedEntry = useCallback(
    async (entryInput) => {
      const entry =
        entryInput.lines?.[0]?.accountId != null
          ? { status: 'posted', ...entryInput, concept: entryInput.concept || entryInput.description }
          : buildPostedEntry({ ...entryInput, chart: chartOfAccounts });
      if (cloud()) {
        const saved = await repos.insertJournalEntry(entry, { createdBy: userId });
        setJournalEntries((prev) => [saved, ...prev]);
        return saved;
      }
      setJournalEntries((prev) => [entry, ...prev]);
      return entry;
    },
    [chartOfAccounts, setJournalEntries, userId]
  );

  const openRegister = useCallback(
    async (cashRegisterId, openingBalance) => {
      if (getOpenSession(cashSessions, cashRegisterId)) {
        throw new Error('Ya hay una sesión abierta en esta caja.');
      }
      const session = openCashSession({ cashRegisterId, openingBalance });
      if (cloud()) {
        if (!userId) throw new Error('Sesión de usuario requerida para abrir caja.');
        const saved = await repos.insertCashSession({ ...session, openedBy: userId });
        setCashSessions((prev) => [saved, ...prev]);
        return saved;
      }
      setCashSessions((prev) => [session, ...prev]);
      return session;
    },
    [cashSessions, userId]
  );

  const closeRegister = useCallback(
    async (sessionId, countedBalance) => {
      const current = cashSessions.find((s) => s.id === sessionId);
      if (!current) return;
      const closed = closeCashSession(current, { countedBalance, movements: cashMovements });
      if (cloud()) {
        const saved = await repos.updateCashSession(sessionId, {
          status: closed.status,
          countedBalance: closed.countedBalance,
          closedAt: closed.closedAt || new Date().toISOString(),
          closedBy: userId,
        });
        setCashSessions((prev) => prev.map((s) => (s.id === sessionId ? saved : s)));
        return;
      }
      setCashSessions((prev) => prev.map((s) => (s.id === sessionId ? closed : s)));
    },
    [cashMovements, cashSessions, userId]
  );

  const addCashMovement = useCallback(
    async ({ cashRegisterId, movementType, amount, concept, relatedAccountId, memberId }) => {
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

      if (cloud()) {
        const savedEntry = await repos.insertJournalEntry(entry, { createdBy: userId });
        const movement = await repos.insertCashMovement({
          cashSessionId: session.id,
          movementType,
          amount: Number(amount),
          concept: concept.trim(),
          relatedAccountId,
          memberDbId: null,
          journalEntryId: savedEntry.id,
          createdBy: userId,
        });
        setCashMovements((prev) => [movement, ...prev]);
        setJournalEntries((prev) => [savedEntry, ...prev]);
        return movement;
      }

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
    [cashSessions, cashRegisters, chartOfAccounts, setJournalEntries, userId]
  );

  const transferCash = useCallback(
    async ({ fromRegisterId, toAccountId, amount, concept }) => {
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

      if (cloud()) {
        const savedEntry = await repos.insertJournalEntry(entry, { createdBy: userId });
        const outMove = await repos.insertCashMovement({
          cashSessionId: fromSession.id,
          movementType: 'transfer_out',
          amount: amt,
          concept: concept?.trim() || savedEntry.concept,
          relatedAccountId: toAccountId,
          journalEntryId: savedEntry.id,
          createdBy: userId,
        });
        setCashMovements((prev) => [outMove, ...prev]);
        setJournalEntries((prev) => [savedEntry, ...prev]);
        return { entry: savedEntry, movements: [outMove] };
      }

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
      setCashMovements((prev) => [outMove, ...prev]);
      setJournalEntries((prev) => [entry, ...prev]);
      return { entry, movements: [outMove] };
    },
    [cashRegisters, cashSessions, chartOfAccounts, setJournalEntries, userId]
  );

  const submitExpense = useCallback(async (payload) => {
    const expense = createExpenseDraft(payload);
    if (cloud()) {
      const saved = await repos.upsertExpense(expense);
      setExpenses((prev) => [saved, ...prev]);
      return saved;
    }
    setExpenses((prev) => [expense, ...prev]);
    return expense;
  }, []);

  const setExpenseApproved = useCallback(async (expenseId) => {
    setExpenses((prev) => {
      const next = prev.map((e) => (e.id === expenseId ? approveExpense(e) : e));
      const target = next.find((e) => e.id === expenseId);
      if (cloud() && target) repos.upsertExpense(target).catch(() => {});
      return next;
    });
  }, []);

  const setExpenseRejected = useCallback(async (expenseId, reason) => {
    setExpenses((prev) => {
      const next = prev.map((e) => (e.id === expenseId ? rejectExpense(e, reason) : e));
      const target = next.find((e) => e.id === expenseId);
      if (cloud() && target) repos.upsertExpense(target).catch(() => {});
      return next;
    });
  }, []);

  const setExpensePaid = useCallback(
    async (expenseId) => {
      const target = expenses.find((e) => e.id === expenseId);
      if (!target) return;
      const { expense, journalEntry } = payExpense(target, chartOfAccounts);
      if (cloud()) {
        const savedEntry = await repos.insertJournalEntry(journalEntry, { createdBy: userId });
        const savedExp = await repos.upsertExpense({ ...expense, journalEntryId: savedEntry.id });
        setExpenses((prev) => prev.map((e) => (e.id === expenseId ? savedExp : e)));
        setJournalEntries((entries) => [savedEntry, ...entries]);
        return;
      }
      setExpenses((prev) => prev.map((e) => (e.id === expenseId ? expense : e)));
      setJournalEntries((entries) => [journalEntry, ...entries]);
    },
    [chartOfAccounts, expenses, setJournalEntries, userId]
  );

  const publishAlert = useCallback(async (payload) => {
    const alert = createAlert(payload);
    if (cloud()) {
      const saved = await repos.upsertAlert(alert);
      setAlerts((prev) => [saved, ...prev]);
      return saved;
    }
    setAlerts((prev) => [alert, ...prev]);
    return alert;
  }, []);

  const deactivateAlert = useCallback(async (alertId) => {
    const patch = { isActive: false, endsAt: new Date().toISOString() };
    setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, ...patch } : a)));
    if (cloud()) {
      const current = alerts.find((a) => a.id === alertId);
      if (current) await repos.upsertAlert({ ...current, ...patch });
    }
  }, [alerts]);

  const ackAlert = useCallback(async (alertId, profileId = 'local-user') => {
    setAlertAcks((prev) => acknowledgeAlert(prev, alertId, profileId));
    if (cloud() && profileId && String(profileId).includes('-')) {
      await repos.ackAlert(alertId, profileId);
    }
  }, []);

  const upsertConcession = useCallback(async (concession) => {
    if (cloud()) {
      const saved = await repos.upsertConcession(concession);
      setConcessions((prev) => {
        const withoutTemp = prev.filter((c) => c.id !== concession.id && c.id !== saved.id);
        const idx = withoutTemp.findIndex((c) => c.id === saved.id);
        if (idx === -1) return [saved, ...withoutTemp];
        const next = [...withoutTemp];
        next[idx] = saved;
        return next;
      });
      return saved;
    }
    const list = upsertConcessionDomain([], concession);
    const local = list[0] || concession;
    setConcessions((prev) => upsertConcessionDomain(prev, local));
    return local;
  }, []);

  const renewConcessionContract = useCallback((concessionId, options = {}) => {
    const months = typeof options === 'number' ? options : (options.months ?? 12);
    const rest = typeof options === 'number' ? {} : options;
    setConcessions((prev) => {
      const next = prev.map((c) => (c.id === concessionId ? renewConcession(c, { months, ...rest }) : c));
      const target = next.find((c) => c.id === concessionId);
      if (cloud() && target) repos.upsertConcession(target).catch(() => {});
      return next;
    });
  }, []);

  const setConcessionStatus = useCallback((concessionId, statusManual) => {
    setConcessions((prev) => {
      const next = prev.map((c) => (c.id === concessionId ? { ...c, statusManual, status: statusManual } : c));
      const target = next.find((c) => c.id === concessionId);
      if (cloud() && target) repos.upsertConcession(target).catch(() => {});
      return next;
    });
  }, []);

  const toggleConcessionChecklist = useCallback((concessionId, itemId, done) => {
    setConcessions((prev) => {
      const next = prev.map((c) => (c.id === concessionId ? setChecklistItem(c, itemId, done) : c));
      const target = next.find((c) => c.id === concessionId);
      if (cloud() && target) repos.upsertConcession(target).catch(() => {});
      return next;
    });
  }, []);

  const addDocToConcession = useCallback(async (concessionId, doc, baseConcession = null) => {
    // baseConcession evita carrera tras el alta (el state aún no hidrató el id nuevo)
    let current =
      (baseConcession && String(baseConcession.id) === String(concessionId) ? baseConcession : null)
      || concessions.find((c) => String(c.id) === String(concessionId));

    if (!current && cloud()) {
      const list = await repos.listConcessions();
      current = (list || []).find((c) => String(c.id) === String(concessionId)) || null;
      if (list) setConcessions(list);
    }
    if (!current) throw new Error('Concesión no encontrada.');

    const updated = addConcessionDocument(current, doc);
    if (cloud()) {
      const saved = await repos.upsertConcession(updated);
      setConcessions((prev) => {
        const exists = prev.some((c) => c.id === concessionId || c.id === saved.id);
        if (!exists) return [saved, ...prev];
        return prev.map((c) => (c.id === concessionId || c.id === saved.id ? saved : c));
      });
      return saved;
    }
    setConcessions((prev) => prev.map((c) => (c.id === concessionId ? updated : c)));
    return updated;
  }, [concessions]);

  const removeDocFromConcession = useCallback(async (concessionId, docId) => {
    const current = concessions.find((c) => c.id === concessionId);
    if (!current) return;
    const updated = removeConcessionDocument(current, docId);
    if (cloud()) {
      const saved = await repos.upsertConcession(updated);
      setConcessions((prev) => prev.map((c) => (c.id === concessionId || c.id === saved.id ? saved : c)));
      return;
    }
    setConcessions((prev) => prev.map((c) => (c.id === concessionId ? updated : c)));
  }, [concessions]);

  const recordCanonPayment = useCallback(
    async (payload) => {
      const concession = concessions.find((c) => c.id === payload.concessionId);
      if (!concession) throw new Error('Concesión no encontrada.');
      const payment = createCanonPayment(payload);
      const entry = buildCanonJournalEntry(payment, concession, chartOfAccounts);
      if (cloud()) {
        const savedEntry = await repos.insertJournalEntry(entry, { createdBy: userId });
        const withReceipt = {
          ...payment,
          receipt: `CAN-${String(Date.now()).slice(-8)}`,
          journalEntryId: savedEntry.id,
        };
        const savedPay = await repos.insertCanonPayment(withReceipt);
        setCanonPayments((prev) => [savedPay, ...prev]);
        setJournalEntries((prev) => [savedEntry, ...prev]);
        return savedPay;
      }
      const withReceipt = {
        ...payment,
        receipt: `CAN-${String(Date.now()).slice(-8)}`,
        journalEntryId: entry.id,
      };
      setCanonPayments((prev) => [withReceipt, ...prev]);
      setJournalEntries((prev) => [entry, ...prev]);
      return withReceipt;
    },
    [concessions, chartOfAccounts, setJournalEntries, userId]
  );

  const addClubEvent = useCallback(async (payload) => {
    const event = createClubEvent(payload);
    if (cloud()) {
      const saved = await repos.upsertClubEvent(event);
      setClubEvents((prev) => [saved, ...prev]);
      return saved;
    }
    setClubEvents((prev) => [event, ...prev]);
    return event;
  }, []);

  const upsertSupplier = useCallback(async (supplier) => {
    if (cloud()) {
      const saved = await repos.upsertSupplier(supplier);
      setSuppliers((prev) => {
        const idx = prev.findIndex((s) => s.id === saved.id);
        if (idx === -1) return [saved, ...prev];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      return saved;
    }
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
    setSuppliers((prev) => {
      const next = prev.map((s) => (s.id === supplierId ? setSupplierStatus(s, status) : s));
      const target = next.find((s) => s.id === supplierId);
      if (cloud() && target) repos.upsertSupplier(target).catch(() => {});
      return next;
    });
  }, []);

  const upsertRetencion = useCallback(async (item) => {
    if (cloud()) {
      const saved = await repos.upsertRetencion(item);
      setRetenciones((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx === -1) return [saved, ...prev];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      return saved;
    }
    setRetenciones((prev) => {
      const idx = prev.findIndex((r) => r.id === item.id);
      if (idx === -1) return [item, ...prev];
      const next = [...prev];
      next[idx] = item;
      return next;
    });
    return item;
  }, []);

  const importSupplierPayments = useCallback(async ({ batch, payments }) => {
    const savedPayments = [];
    for (const payment of payments || []) {
      if (cloud()) {
        try {
          const saved = await repos.upsertPaymentOrder(payment);
          savedPayments.push(saved);
        } catch {
          savedPayments.push(payment);
        }
      } else {
        savedPayments.push(payment);
      }
    }

    setPaymentOrders((prev) => [...savedPayments, ...prev]);

    // Aplicar pagos al saldo Accessin de proveedores emparejados.
    setSuppliers((prev) => {
      const next = prev.map((s) => {
        const paid = savedPayments
          .filter((p) => p.supplierId === s.id || String(p.payee || '').toLowerCase() === String(s.legalName || s.name || '').toLowerCase())
          .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        if (!paid) return s;
        const opening = (Number(s.openingBalance) || 0) - paid;
        const updated = { ...s, openingBalance: opening, updatedAt: new Date().toISOString() };
        if (cloud()) repos.upsertSupplier(updated).catch(() => {});
        return updated;
      });
      return next;
    });

    let savedBatch = {
      ...batch,
      paymentIds: savedPayments.map((p) => p.id),
    };
    if (cloud()) {
      try {
        savedBatch = await repos.upsertSupplierPaymentImport(savedBatch);
      } catch {
        /* historial local si falla nube */
      }
    }
    setSupplierPaymentImports((prev) => [savedBatch, ...prev]);
    return savedBatch;
  }, []);

  const importExpenses = useCallback(async ({ batch, expenses: imported }) => {
    const savedExpenses = [];
    for (const expense of imported || []) {
      if (cloud()) {
        try {
          const saved = await repos.upsertExpense(expense);
          savedExpenses.push(saved);
        } catch {
          savedExpenses.push(expense);
        }
      } else {
        savedExpenses.push(expense);
      }
    }
    setExpenses((prev) => [...savedExpenses, ...prev]);

    let savedBatch = {
      ...batch,
      expenseIds: savedExpenses.map((e) => e.id),
    };
    if (cloud()) {
      try {
        savedBatch = await repos.upsertExpenseImport(savedBatch);
      } catch {
        /* historial local */
      }
    }
    setExpenseImports((prev) => [savedBatch, ...prev]);
    return savedBatch;
  }, []);

  const createSupplierEntry = useCallback(async (entry) => {
    let savedEntry = entry;
    let payment = null;

    if (entry.type === 'pago') {
      const stamp = new Date();
      payment = {
        id: `po-ent-${stamp.getTime()}`,
        number: `OP-ENT-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`,
        date: entry.date || stamp.toISOString().slice(0, 10),
        payee: entry.supplierName,
        concept: entry.concept || entry.typeLabel || 'Pago',
        amount: Number(entry.amount) || 0,
        status: 'paid',
        paymentMethod: 'transferencia',
        supplierId: entry.supplierId || null,
        accessinCode: entry.accessinCode || '',
        invoiceNumber: entry.invoiceNumber || '',
        entryId: entry.id,
        createdAt: stamp.toISOString(),
      };
      savedEntry = { ...entry, paymentOrderId: payment.id };
    }

    if (cloud()) {
      try {
        savedEntry = await repos.upsertSupplierEntry(savedEntry);
      } catch {
        /* local fallback */
      }
      if (payment) {
        try {
          payment = await repos.upsertPaymentOrder(payment);
          savedEntry = { ...savedEntry, paymentOrderId: payment.id };
        } catch {
          /* keep local payment */
        }
      }
    }

    if (payment) {
      setPaymentOrders((prev) => [payment, ...prev]);
    }

    setSuppliers((prev) => {
      const delta = Number(savedEntry.balanceDelta) || 0;
      if (!delta || !savedEntry.supplierId) return prev;
      return prev.map((s) => {
        if (s.id !== savedEntry.supplierId) return s;
        const opening = (Number(s.openingBalance) || 0) + delta;
        const updated = { ...s, openingBalance: opening, updatedAt: new Date().toISOString() };
        if (cloud()) repos.upsertSupplier(updated).catch(() => {});
        return updated;
      });
    });

    setSupplierEntries((prev) => [savedEntry, ...prev]);
    return savedEntry;
  }, []);

  const createOtherIncomeRecord = useCallback(async (item) => {
    let saved = item;
    if (cloud()) {
      try {
        saved = await repos.upsertOtherIncome(item);
      } catch {
        /* local fallback */
      }
    }
    setOtherIncomes((prev) => [saved, ...prev]);
    return saved;
  }, []);

  const upsertAccessinBankAccount = useCallback((input) => {
    setAccessinBankAccounts((prev) => upsertBankAccount(prev, input));
  }, []);

  const deleteAccessinBankAccount = useCallback((id) => {
    setAccessinBankAccounts((prev) => softDeleteBankAccount(prev, id));
  }, []);

  const addAccessinBankAccountEntry = useCallback((accountId, entry) => {
    let result;
    setAccessinBankAccounts((prev) => {
      result = applyBankAccountEntry(prev, accountId, entry);
      return result.accounts;
    });
    if (result?.movement) {
      setAccessinCashMovements((prev) => [result.movement, ...prev]);
    }
    return result?.movement;
  }, []);

  const upsertUnidentifiedCollection = useCallback((item) => {
    const run = async () => {
      let nextItem = item;
      if (item.status === 'matched' && !item.journalEntryId) {
        try {
          const entry = buildUnidentifiedMatchEntry(item, chartOfAccounts);
          if (entry) {
            const savedEntry = await addPostedEntry(entry);
            nextItem = { ...item, journalEntryId: savedEntry?.id || entry.id };
          }
        } catch {
          /* no bloquear la identificación si el asiento falla */
        }
      }
      setUnidentifiedCollections((prev) => {
        const idx = prev.findIndex((x) => x.id === nextItem.id || x.id === item.id);
        if (idx === -1) return [nextItem, ...prev];
        const next = [...prev];
        next[idx] = nextItem;
        return next;
      });
      if (cloud()) {
        repos.upsertUnidentifiedCollection(nextItem).then((saved) => {
          setUnidentifiedCollections((prev) => {
            const withoutTemp = prev.filter((x) => x.id !== item.id && x.id !== nextItem.id && x.id !== saved.id);
            return [saved, ...withoutTemp];
          });
        }).catch(() => {});
      }
    };
    void run();
  }, [chartOfAccounts, addPostedEntry]);

  const upsertGaliciaDebit = useCallback((item) => {
    const run = async () => {
      let nextItem = item;
      if (item.status === 'settled' && !item.journalEntryId) {
        try {
          const entry = buildGaliciaSettledEntry(item, chartOfAccounts);
          if (entry) {
            const savedEntry = await addPostedEntry(entry);
            nextItem = { ...item, journalEntryId: savedEntry?.id || entry.id };
          }
        } catch {
          /* best-effort */
        }
      }
      setGaliciaDebits((prev) => {
        const idx = prev.findIndex((x) => x.id === nextItem.id || x.id === item.id);
        if (idx === -1) return [nextItem, ...prev];
        const next = [...prev];
        next[idx] = nextItem;
        return next;
      });
      if (cloud()) {
        repos.upsertGaliciaDebit(nextItem).then((saved) => {
          setGaliciaDebits((prev) => {
            const withoutTemp = prev.filter((x) => x.id !== item.id && x.id !== nextItem.id && x.id !== saved.id);
            return [saved, ...withoutTemp];
          });
        }).catch(() => {});
      }
    };
    void run();
  }, [chartOfAccounts, addPostedEntry]);

  const addFixedExpense = useCallback((item) => {
    setFixedExpenses((prev) => [item, ...prev]);
    if (cloud()) {
      repos.upsertFixedExpense(item).then((saved) => {
        setFixedExpenses((prev) => {
          const withoutTemp = prev.filter((x) => x.id !== item.id && x.id !== saved.id);
          return [saved, ...withoutTemp];
        });
      }).catch(() => {});
    }
  }, []);

  const toggleFixedExpense = useCallback((id) => {
    setFixedExpenses((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, active: !x.active } : x));
      const target = next.find((x) => x.id === id);
      if (cloud() && target) repos.upsertFixedExpense(target).catch(() => {});
      return next;
    });
  }, []);

  const addFixedDiscount = useCallback((item) => {
    setFixedDiscounts((prev) => [item, ...prev]);
    if (cloud()) {
      repos.upsertFixedDiscount(item).then((saved) => {
        setFixedDiscounts((prev) => {
          const withoutTemp = prev.filter((x) => x.id !== item.id && x.id !== saved.id);
          return [saved, ...withoutTemp];
        });
      }).catch(() => {});
    }
  }, []);

  const toggleFixedDiscount = useCallback((id) => {
    setFixedDiscounts((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, active: !x.active } : x));
      const target = next.find((x) => x.id === id);
      if (cloud() && target) repos.upsertFixedDiscount(target).catch(() => {});
      return next;
    });
  }, []);

  const upsertPaymentOrder = useCallback((item) => {
    const run = async () => {
      let nextItem = item;
      if (item.status === 'paid' && !item.journalEntryId) {
        try {
          const entry = buildPaymentOrderPaidEntry(item, chartOfAccounts);
          if (entry) {
            const savedEntry = await addPostedEntry(entry);
            nextItem = { ...item, journalEntryId: savedEntry?.id || entry.id };
          }
        } catch {
          /* best-effort */
        }
      }
      setPaymentOrders((prev) => {
        const idx = prev.findIndex((x) => x.id === nextItem.id || x.id === item.id);
        if (idx === -1) return [nextItem, ...prev];
        const next = [...prev];
        next[idx] = nextItem;
        return next;
      });
      if (cloud()) {
        repos.upsertPaymentOrder(nextItem).then((saved) => {
          setPaymentOrders((prev) => {
            const withoutTemp = prev.filter((x) => x.id !== item.id && x.id !== nextItem.id && x.id !== saved.id);
            return [saved, ...withoutTemp];
          });
        }).catch(() => {});
      }
    };
    void run();
  }, [chartOfAccounts, addPostedEntry]);

  const upsertChartAccount = useCallback(async (account) => {
    if (cloud()) {
      const saved = await repos.upsertChartAccount(account);
      setChartOfAccounts((prev) => {
        const without = prev.filter((a) => a.id !== account.id && a.id !== saved.id && a.code !== saved.code);
        return [...without, saved].sort((x, y) => String(x.code).localeCompare(String(y.code), 'es'));
      });
      return saved;
    }
    setChartOfAccounts((prev) => {
      const without = prev.filter((a) => a.id !== account.id && a.code !== account.code);
      return [...without, account].sort((x, y) => String(x.code).localeCompare(String(y.code), 'es'));
    });
    return account;
  }, []);

  const registerMemberToEvent = useCallback(
    async ({ eventId, memberId, guestsCount, guestName, paymentMethod = 'efectivo', kind = 'member', members = [] }) => {
      const event = clubEvents.find((e) => e.id === eventId);
      if (!event) throw new Error('Evento no encontrado.');
      const member = (members || []).find((m) => m.memberId === memberId)
        || { memberId, name: '', status: 'active' };

      let result;
      if (kind === 'guest') {
        result = enableGuestEventAccess({
          event,
          host: member,
          guestName,
          registrations: eventRegistrations,
          paymentMethod,
          chart: chartOfAccounts,
        });
      } else {
        if (Number(guestsCount) > 1) {
          if (event.capacity) {
            const used = countRegistrations(eventRegistrations, eventId);
            if (used + (Number(guestsCount) || 1) > event.capacity) {
              throw new Error('No hay cupos disponibles para este evento.');
            }
          }
          result = registerForEvent({
            event,
            memberId: member.memberId,
            memberName: member.name,
            guestsCount,
            guestName,
            kind: 'member',
            paymentMethod,
            chart: chartOfAccounts,
          });
        } else {
          result = enableMemberEventAccess({
            event,
            member,
            registrations: eventRegistrations,
            paymentMethod,
            chart: chartOfAccounts,
          });
        }
      }

      const { registration, journalEntry } = result;
      setEventRegistrations((prev) => [registration, ...prev]);
      if (journalEntry) {
        if (cloud()) {
          const saved = await repos.insertJournalEntry(journalEntry, { createdBy: userId });
          setJournalEntries((prev) => [saved, ...prev]);
        } else {
          setJournalEntries((prev) => [journalEntry, ...prev]);
        }
      }
      return registration;
    },
    [clubEvents, eventRegistrations, chartOfAccounts, setJournalEntries, userId]
  );

  const revokeEventRegistration = useCallback((registrationId) => {
    setEventRegistrations((prev) => revokeEventRegistrationDomain(prev, registrationId));
  }, []);

  return {
    chartOfAccounts,
    setChartOfAccounts,
    upsertChartAccount,
    cashRegisters,
    cashSessions,
    cashMovements,
    accessinCashMovements,
    accessinCheques,
    accessinCobranzas,
    accessinSupplierPayments,
    accessinBankAccounts,
    expenses,
    suppliers,
    retenciones,
    supplierPaymentImports,
    expenseImports,
    supplierEntries,
    otherIncomes,
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
    applyErpHydration,
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
    upsertRetencion,
    importSupplierPayments,
    importExpenses,
    createSupplierEntry,
    createOtherIncomeRecord,
    upsertAccessinBankAccount,
    deleteAccessinBankAccount,
    addAccessinBankAccountEntry,
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
    revokeEventRegistration,
    upsertConcession,
    renewConcessionContract,
    setConcessionStatus,
    toggleConcessionChecklist,
    addDocToConcession,
    removeDocFromConcession,
    recordCanonPayment,
  };
}

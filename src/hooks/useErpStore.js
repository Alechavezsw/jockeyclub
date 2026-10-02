import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import * as repos from '../data/repos';
import { DEFAULT_CHART_OF_ACCOUNTS, resolveAccountId } from '../domain/accounting/chartOfAccounts';
import {
  DEFAULT_CASH_REGISTERS,
  openCashSession,
  closeCashSession,
  buildCashMovementEntry,
  buildCashTransferEntry,
  getOpenSession,
  pickGeneralCashRegister,
} from '../domain/accounting/cash';
import { loadSnapshots } from '../data/snapshots';
import { cashMovementsSeed, cashSeed, chequesSeed, mergeAccessinCashMovements } from '../domain/accounting/cashLedger';
import { cobranzasSeed } from '../domain/accounting/cobranzas';
import { seedDiscounts } from '../domain/accounting/discountsSeed';
import { suppliersSeed } from '../domain/accounting/suppliersSeed';
import { supplierPaymentsSeed } from '../domain/accounting/supplierPaymentsReport';
import {
  applyBankAccountEntry,
  applySnapshotBankBalances,
  bankAccountsSeed,
  resolveBankAccounts,
  softDeleteBankAccount,
  upsertBankAccount,
} from '../domain/accounting/bankAccounts';
import {
  cancelInterestRun as cancelInterestRunDomain,
  softDeleteInterestGenerator,
  upsertInterestGenerator,
} from '../domain/accounting/interestGenerators';
import {
  resolveDiscounts,
  softDeleteDiscount,
  upsertDiscount,
} from '../domain/accounting/discounts';
import {
  resolveFeeExpenses,
  softDeleteFeeExpense,
  upsertFeeExpense,
} from '../domain/accounting/feeExpenses';
import { feePeriodNeedsClosure, periodLabel, resolveFeePeriods } from '../domain/accounting/feeBilling';
import {
  createFeeChartAccount,
  ledgerLinesFromCharges,
  periodLedgerLines,
  periodMonthKey,
  resolveFeeChartAccounts,
  softDeleteFeeChartAccount,
  upsertFeeChartAccount,
} from '../domain/accounting/feeChartAccounts';
import {
  softDeleteAccountEntry,
  upsertAccountEntry,
} from '../domain/accounting/accountEntries';
import { prependAccountingReport } from '../domain/accounting/accountingReports';
import {
  createExpenseDraft,
  approveExpense,
  rejectExpense,
  payExpense,
} from '../domain/accounting/expenses';
import { setSupplierStatus } from '../domain/accounting/suppliers';
import { matchSupplierByName } from '../domain/accounting/supplierPaymentImport';
import { retencionesSeed } from '../domain/accounting/retenciones';
import { memberPaymentOrderDeleteEffect } from '../domain/accounting/memberPaymentOrders';
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
  mergeAlertAcknowledgements,
} from '../domain/alerts/alerts';
import {
  DEFAULT_CLUB_EVENTS,
  withoutDemoEventData,
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
  if (cloud()) return Array.isArray(fallback) ? [] : (fallback ?? null);
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

const ALERT_ACKS_KEY = 'jockey-alert-acks';
const PROFILE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function loadAlertAcks() {
  try {
    const raw = localStorage.getItem(ALERT_ACKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistAlertAcks(value) {
  try {
    localStorage.setItem(ALERT_ACKS_KEY, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
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

/**
 * Snapshots de LILA/Accessin que el store usa de respaldo cuando la base (o localStorage)
 * no trae datos. No viajan en el build: se piden después del login al registro de
 * data/snapshots, y las políticas del bucket deciden si la sesión puede leerlos.
 */
const ERP_SNAPSHOTS = [
  'accessinBankAccounts',
  'accessinBonificaciones',
  'accessinCashMovements',
  'accessinCashSnapshot',
  'accessinCheques',
  'accessinCobranzas',
  'accessinRetenciones',
  'accessinSupplierPayments',
  'accessinSuppliers',
];

const DEFAULT_CASH_REGISTER_IDS = new Set(DEFAULT_CASH_REGISTERS.map((r) => r.id));

/** Cajas de demo, o ninguna. Las cajas reales de la base no se pisan con el corte de Lila. */
function isFallbackCashRegisters(list) {
  if (!Array.isArray(list) || !list.length) return true;
  return list.every((r) => DEFAULT_CASH_REGISTER_IDS.has(r?.id));
}

export default function useErpStore({
  setJournalEntries,
  isZondaActive,
  userId,
  canLoadSeeds = false,
}) {
  const [chartOfAccounts, setChartOfAccounts] = useState(() =>
    load('jockey-chart-of-accounts', DEFAULT_CHART_OF_ACCOUNTS)
  );
  // Los respaldos de snapshots arrancan vacíos: los completa el efecto que los pide.
  const [cashRegisters, setCashRegisters] = useState(() => {
    const loaded = load('jockey-cash-registers-v2', null);
    if (Array.isArray(loaded) && loaded.length >= 3) return loaded;
    const seed = cashSeed().ACCESSIN_CASH_REGISTERS;
    return seed.length ? seed : DEFAULT_CASH_REGISTERS;
  });
  const [cashSessions, setCashSessions] = useState(() => load('jockey-cash-sessions', []));
  const [cashMovements, setCashMovements] = useState(() => load('jockey-cash-movements', []));
  const [accessinCashMovements, setAccessinCashMovements] = useState(() => {
    const loaded = load('jockey-accessin-cash-movements-v1', null);
    if (Array.isArray(loaded) && loaded.length >= 500) return loaded;
    return cashMovementsSeed().ACCESSIN_CASH_MOVEMENTS;
  });
  const [accessinCheques, setAccessinCheques] = useState(() => {
    const loaded = load('jockey-accessin-cheques-v1', null);
    if (Array.isArray(loaded)) return loaded;
    return chequesSeed().ACCESSIN_CHEQUES;
  });
  const [accessinCobranzas, setAccessinCobranzas] = useState(() => {
    const loaded = load('jockey-accessin-cobranzas-v1', null);
    if (Array.isArray(loaded) && loaded.length >= 200) return loaded;
    return cobranzasSeed().ACCESSIN_COBRANZAS;
  });
  const [accessinSupplierPayments, setAccessinSupplierPayments] = useState(() => {
    const loaded = load('jockey-accessin-supplier-payments-v1', null);
    if (Array.isArray(loaded)) return loaded;
    return supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS;
  });
  const [accessinBankAccounts, setAccessinBankAccounts] = useState(() =>
    resolveBankAccounts(load('jockey-accessin-bank-accounts-v1', null))
  );
  const [interestGenerators, setInterestGenerators] = useState(() =>
    load('jockey-interest-generators-v1', [])
  );
  const [interestRuns, setInterestRuns] = useState(() =>
    load('jockey-interest-runs-v1', [])
  );
  const [discounts, setDiscounts] = useState(() =>
    resolveDiscounts(load('jockey-discounts-v1', null))
  );

  const [feeExpenses, setFeeExpenses] = useState(() =>
    resolveFeeExpenses(load('jockey-fee-expenses-v1', null))
  );
  const [feePeriods, setFeePeriods] = useState(() =>
    resolveFeePeriods(load('jockey-fee-periods-v2', null) || load('jockey-fee-periods-v1', null))
  );
  const [memberCollectionImports, setMemberCollectionImports] = useState(() =>
    load('jockey-member-collection-imports-v1', [])
  );
  const [feeChartAccounts, setFeeChartAccounts] = useState(() =>
    resolveFeeChartAccounts(load('jockey-fee-chart-accounts-v1', null))
  );
  const [memberAccountEntries, setMemberAccountEntries] = useState(() =>
    load('jockey-member-account-entries-v1', [])
  );
  const [accountingReports, setAccountingReports] = useState(() =>
    load('jockey-accounting-reports-v1', [])
  );
  const [expenses, setExpenses] = useState(() => load('jockey-expenses', []));
  const [suppliers, setSuppliers] = useState(() => {
    if (cloud()) return [];
    const loaded = load('jockey-suppliers-v3', null);
    if (Array.isArray(loaded) && loaded.length >= 50) return loaded;
    return suppliersSeed().ACCESSIN_SUPPLIERS;
  });
  const [retenciones, setRetenciones] = useState(() =>
    load('jockey-retenciones-v1', retencionesSeed().ACCESSIN_RETENCIONES)
  );
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
  const [alertAcks, setAlertAcks] = useState(() => loadAlertAcks());
  const [clubEvents, setClubEvents] = useState(() => {
    const loaded = load('jockey-club-events', DEFAULT_CLUB_EVENTS);
    return withoutDemoEventData(loaded, []).events;
  });
  const [eventRegistrations, setEventRegistrations] = useState(() => {
    const loaded = load('jockey-event-registrations', []);
    return withoutDemoEventData([], loaded).registrations;
  });
  const [concessions, setConcessions] = useState(() => {
    if (cloud()) return [];
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
  const concessionsRef = useRef(concessions);
  concessionsRef.current = concessions;
  const [canonPayments, setCanonPayments] = useState(() =>
    load('jockey-canon-payments', DEFAULT_CANON_PAYMENTS)
  );

  // Respaldos de snapshots: se piden con la sesión operativa y solo completan lo que la
  // base (o localStorage) no trajo. La hidratación puede llegar antes o después.
  useEffect(() => {
    if (!canLoadSeeds) return undefined;
    let cancelled = false;
    void loadSnapshots(ERP_SNAPSHOTS).then(() => {
      if (cancelled) return;
      const registers = cashSeed().ACCESSIN_CASH_REGISTERS;
      if (registers.length) {
        setCashRegisters((cur) => (isFallbackCashRegisters(cur) ? registers : cur));
      }
      const movements = cashMovementsSeed().ACCESSIN_CASH_MOVEMENTS;
      const recent = cashSeed().ACCESSIN_CASH_SNAPSHOT?.recentMovements || [];
      if (movements.length || recent.length) {
        setAccessinCashMovements((cur) => mergeAccessinCashMovements(
          mergeAccessinCashMovements(cur, movements),
          recent,
        ));
      }
      const cheques = chequesSeed().ACCESSIN_CHEQUES;
      if (cheques.length) setAccessinCheques((cur) => (cur?.length ? cur : cheques));
      const cobranzas = cobranzasSeed().ACCESSIN_COBRANZAS;
      if (cobranzas.length) setAccessinCobranzas((cur) => (cur?.length >= 200 ? cur : cobranzas));
      const payments = supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS;
      if (payments.length) setAccessinSupplierPayments((cur) => (cur?.length ? cur : payments));
      const banks = bankAccountsSeed().ACCESSIN_BANK_ACCOUNTS;
      if (banks.length) setAccessinBankAccounts((cur) => applySnapshotBankBalances(cur, banks));
      const retencionesList = retencionesSeed().ACCESSIN_RETENCIONES;
      if (retencionesList.length) setRetenciones((cur) => (cur?.length ? cur : retencionesList));
      const suppliersList = suppliersSeed().ACCESSIN_SUPPLIERS;
      if (suppliersList.length) setSuppliers((cur) => (cur?.length >= 50 ? cur : suppliersList));
      setDiscounts((cur) => resolveDiscounts(cur?.length ? cur : null, seedDiscounts()));
    });
    return () => { cancelled = true; };
  }, [canLoadSeeds]);

  const applyErpHydration = useCallback((erp) => {
    if (!erp) return;
    if (Array.isArray(erp.chartOfAccounts)) setChartOfAccounts(erp.chartOfAccounts);
    // Sin datos en la base se usa el snapshot si ya cargó; si todavía no, lo completa el
    // efecto de los respaldos.
    if (Array.isArray(erp.cashRegisters) && erp.cashRegisters.length) {
      setCashRegisters(erp.cashRegisters);
    } else {
      const seedRegisters = cashSeed().ACCESSIN_CASH_REGISTERS;
      if (seedRegisters.length) setCashRegisters(seedRegisters);
    }
    if (Array.isArray(erp.cashSessions)) setCashSessions(erp.cashSessions);
    if (Array.isArray(erp.cashMovements)) setCashMovements(erp.cashMovements);
    if (Array.isArray(erp.accessinCashMovements) && erp.accessinCashMovements.length >= 500) {
      const snap = cashMovementsSeed().ACCESSIN_CASH_MOVEMENTS;
      const recent = cashSeed().ACCESSIN_CASH_SNAPSHOT?.recentMovements || [];
      setAccessinCashMovements(mergeAccessinCashMovements(
        mergeAccessinCashMovements(erp.accessinCashMovements, snap),
        recent,
      ));
    } else {
      const seed = cashMovementsSeed().ACCESSIN_CASH_MOVEMENTS;
      const recent = cashSeed().ACCESSIN_CASH_SNAPSHOT?.recentMovements || [];
      if (seed.length || recent.length) {
        setAccessinCashMovements((cur) => mergeAccessinCashMovements(
          mergeAccessinCashMovements(cur, seed),
          recent,
        ));
      }
    }
    if (Array.isArray(erp.accessinCheques)) setAccessinCheques(erp.accessinCheques);
    else setAccessinCheques(chequesSeed().ACCESSIN_CHEQUES);
    if (Array.isArray(erp.accessinCobranzas) && erp.accessinCobranzas.length >= 200) {
      setAccessinCobranzas(erp.accessinCobranzas);
    } else {
      const seed = cobranzasSeed().ACCESSIN_COBRANZAS;
      if (seed.length) setAccessinCobranzas((cur) => (cur?.length >= 200 ? cur : seed));
    }
    if (Array.isArray(erp.accessinSupplierPayments)) {
      setAccessinSupplierPayments(erp.accessinSupplierPayments);
    } else {
      setAccessinSupplierPayments(supplierPaymentsSeed().ACCESSIN_SUPPLIER_PAYMENTS);
    }
    if (Array.isArray(erp.accessinBankAccounts) && erp.accessinBankAccounts.length) {
      setAccessinBankAccounts(applySnapshotBankBalances(
        erp.accessinBankAccounts,
        bankAccountsSeed().ACCESSIN_BANK_ACCOUNTS
      ));
    } else {
      const seedBanks = bankAccountsSeed().ACCESSIN_BANK_ACCOUNTS;
      if (seedBanks.length) {
        setAccessinBankAccounts((cur) => applySnapshotBankBalances(cur, seedBanks));
      }
    }
    if (Array.isArray(erp.interestGenerators)) setInterestGenerators(erp.interestGenerators);
    if (Array.isArray(erp.interestRuns)) setInterestRuns(erp.interestRuns);
    setDiscounts(resolveDiscounts(
      Array.isArray(erp.discounts) && erp.discounts.length ? erp.discounts : null,
      seedDiscounts(),
    ));
    if (Array.isArray(erp.feeExpenses) && erp.feeExpenses.length) {
      setFeeExpenses(resolveFeeExpenses(erp.feeExpenses));
    } else {
      setFeeExpenses(resolveFeeExpenses(null));
    }
    if (Array.isArray(erp.feePeriods) && erp.feePeriods.length) {
      setFeePeriods(resolveFeePeriods(erp.feePeriods));
    } else {
      setFeePeriods(resolveFeePeriods(null));
    }
    if (Array.isArray(erp.memberCollectionImports)) {
      setMemberCollectionImports(erp.memberCollectionImports);
    }
    if (Array.isArray(erp.feeChartAccounts) && erp.feeChartAccounts.length) {
      setFeeChartAccounts(resolveFeeChartAccounts(erp.feeChartAccounts));
    } else {
      setFeeChartAccounts(resolveFeeChartAccounts(null));
    }
    if (Array.isArray(erp.memberAccountEntries)) {
      setMemberAccountEntries(erp.memberAccountEntries);
    }
    if (Array.isArray(erp.accountingReports)) {
      setAccountingReports(erp.accountingReports);
    }
    if (Array.isArray(erp.expenses)) setExpenses(erp.expenses);
    if (Array.isArray(erp.suppliers)) {
      // Preferir nube cuando ya tiene el padrón Accessin; si no, seed local.
      if (erp.suppliers.length >= 200) setSuppliers(erp.suppliers);
      else {
        const seed = suppliersSeed().ACCESSIN_SUPPLIERS;
        if (seed.length) setSuppliers((cur) => (cur?.length >= 200 ? cur : seed));
      }
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
    if (Array.isArray(erp.concessions)) {
      concessionsRef.current = erp.concessions;
      setConcessions(erp.concessions);
    }
    if (Array.isArray(erp.alerts)) {
      setAlerts(syncConcessionAlerts(erp.alerts, concessionsRef.current));
    } else if (Array.isArray(erp.concessions)) {
      setAlerts((prev) => syncConcessionAlerts(prev, erp.concessions));
    }
    if (Array.isArray(erp.alertAcks)) {
      setAlertAcks((prev) => mergeAlertAcknowledgements(prev, erp.alertAcks));
    }
    if (Array.isArray(erp.clubEvents)) {
      setClubEvents(withoutDemoEventData(erp.clubEvents, []).events);
    }
    if (Array.isArray(erp.eventRegistrations)) {
      setEventRegistrations(withoutDemoEventData([], erp.eventRegistrations).registrations);
    }
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
  useEffect(() => persist('jockey-interest-generators-v1', interestGenerators), [interestGenerators]);
  useEffect(() => persist('jockey-interest-runs-v1', interestRuns), [interestRuns]);
  useEffect(() => persist('jockey-discounts-v1', discounts), [discounts]);
  useEffect(() => {
    setFeePeriods((current) => resolveFeePeriods(current));
  }, []);
  useEffect(() => persist('jockey-fee-expenses-v1', feeExpenses), [feeExpenses]);
  useEffect(() => persist('jockey-fee-periods-v2', resolveFeePeriods(feePeriods)), [feePeriods]);
  useEffect(() => persist('jockey-member-collection-imports-v1', memberCollectionImports), [memberCollectionImports]);
  useEffect(() => persist('jockey-fee-chart-accounts-v1', feeChartAccounts), [feeChartAccounts]);
  useEffect(() => persist('jockey-member-account-entries-v1', memberAccountEntries), [memberAccountEntries]);
  useEffect(() => persist('jockey-accounting-reports-v1', accountingReports), [accountingReports]);
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
  useEffect(() => persistAlertAcks(alertAcks), [alertAcks]);
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

  const recordPoolCanon = useCallback(
    async ({ amount, concept, memberDbId, date }) => {
      const fee = Number(amount);
      if (!fee || fee <= 0) throw new Error('Importe de canon inválido.');
      const description = String(concept || 'Canon pileta').trim();
      const when = date || new Date().toISOString().slice(0, 10);
      if (cloud()) {
        return repos.recordPoolCanon({
          amount: fee,
          concept: description,
          memberDbId: memberDbId || null,
          date: when,
        });
      }
      const incomeAccountId = resolveAccountId(chartOfAccounts, 'Reservas e Instalaciones');
      if (!incomeAccountId) throw new Error('Falta la cuenta Reservas e Instalaciones en el plan.');
      const register = pickGeneralCashRegister(cashRegisters, chartOfAccounts);
      if (!register) throw new Error('No hay Caja General configurada.');
      const session = getOpenSession(cashSessions, register.id);
      if (!session) throw new Error('Abrí la Caja General para cobrar el canon de pileta.');
      const entry = buildPostedEntry({
        date: when,
        description,
        lines: [
          { accountId: register.accountId, debit: fee, credit: 0 },
          { accountId: incomeAccountId, debit: 0, credit: fee },
        ],
        sourceModule: 'pileta',
        chart: chartOfAccounts,
      });
      const movement = {
        id: `cm-${Date.now()}`,
        cashSessionId: session.id,
        movementType: 'income',
        amount: fee,
        concept: entry.description,
        relatedAccountId: incomeAccountId,
        memberId: memberDbId || null,
        journalEntryId: entry.id,
        createdAt: new Date().toISOString(),
      };
      setCashMovements((prev) => [movement, ...prev]);
      setJournalEntries((prev) => [entry, ...prev]);
      return { journalEntry: entry, movement };
    },
    [cashRegisters, cashSessions, chartOfAccounts, setJournalEntries, userId]
  );

  const openPoolDayCash = useCallback(async () => {
    if (!cloud()) {
      const register = pickGeneralCashRegister(cashRegisters, chartOfAccounts);
      if (!register) throw new Error('No hay Caja General configurada.');
      const existing = getOpenSession(cashSessions, register.id);
      if (existing) return { ...existing, openedNow: false };
      const session = openCashSession({
        cashRegisterId: register.id,
        openingBalance: 0,
        openedBy: userId || 'admin-local',
      });
      const next = { ...session, notes: 'Abierta al habilitar pileta' };
      setCashSessions((prev) => [next, ...prev]);
      return { ...next, openedNow: true };
    }
    const session = await repos.openPoolDayCash();
    setCashSessions((prev) => (
      prev.some((row) => row.id === session.id) ? prev : [session, ...prev]
    ));
    return session;
  }, [cashRegisters, cashSessions, chartOfAccounts, userId]);

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
    const matched = payload?.supplierId
      ? null
      : matchSupplierByName(suppliers, payload?.vendorName);
    const expense = createExpenseDraft({
      ...payload,
      supplierId: payload?.supplierId || matched?.id || null,
    });
    if (cloud()) {
      const saved = await repos.upsertExpense(expense);
      setExpenses((prev) => [saved, ...prev]);
      return saved;
    }
    setExpenses((prev) => [expense, ...prev]);
    return expense;
  }, [suppliers]);

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

  const ackAlert = useCallback(async (alertOrId, profileId = 'local-user') => {
    const alert = typeof alertOrId === 'object' && alertOrId ? alertOrId : null;
    const alertId = alert ? alert.id : alertOrId;
    const alertCode = alert ? alert.code : null;
    if (!alertId) return;
    setAlertAcks((prev) => acknowledgeAlert(prev, alertId, profileId, alertCode, { alert }));
    if (cloud() && PROFILE_UUID_RE.test(String(profileId))) {
      try {
        await repos.ackAlert(alertId, profileId);
      } catch {
        /* local ack already persisted */
      }
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
        paymentMethod: entry.paymentMethod || 'transferencia',
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
          payment = await repos.upsertPaymentOrder({ ...payment, entryId: savedEntry.id });
          savedEntry = { ...savedEntry, paymentOrderId: payment.id };
          savedEntry = await repos.upsertSupplierEntry(savedEntry);
        } catch {
          /* keep local payment */
        }
      }
    }

    if (payment) {
      const linked = { ...payment, entryId: savedEntry.id };
      if (!savedEntry.paymentOrderId && linked.id) {
        savedEntry = { ...savedEntry, paymentOrderId: linked.id };
      }
      payment = linked;
      setPaymentOrders((prev) => [payment, ...prev]);
    }

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

  const upsertInterestGeneratorRecord = useCallback(async (input) => {
    if (cloud()) {
      const saved = await repos.upsertInterestGenerator(input);
      setInterestGenerators((prev) => upsertInterestGenerator(prev, saved));
      return saved;
    }
    setInterestGenerators((prev) => upsertInterestGenerator(prev, input));
    return input;
  }, []);

  const deleteInterestGeneratorRecord = useCallback(async (id) => {
    if (cloud()) await repos.deactivateInterestGenerator(id);
    setInterestGenerators((prev) => softDeleteInterestGenerator(prev, id));
  }, []);

  const recordInterestRun = useCallback(async (result) => {
    if (!result?.run) return null;
    if (cloud()) await repos.saveInterestRun(result.run);
    setInterestRuns((prev) => [result.run, ...(prev || [])]);
    return result;
  }, []);

  const cancelInterestRunRecord = useCallback(async (runId) => {
    if (cloud()) await repos.cancelInterestRunRecord(runId);
    let cancelled = null;
    setInterestRuns((prev) => {
      const current = (prev || []).find((r) => r.id === runId) || null;
      cancelled = current;
      return cancelInterestRunDomain(prev, runId);
    });
    return cancelled;
  }, []);

  const upsertDiscountRecord = useCallback((input) => {
    setDiscounts((prev) => upsertDiscount(prev, input));
  }, []);

  const deleteDiscountRecord = useCallback((id) => {
    setDiscounts((prev) => softDeleteDiscount(prev, id));
  }, []);

  const upsertFeeExpenseRecord = useCallback((input) => {
    setFeeExpenses((prev) => upsertFeeExpense(prev, input));
  }, []);

  const deleteFeeExpenseRecord = useCallback((id) => {
    setFeeExpenses((prev) => softDeleteFeeExpense(prev, id));
  }, []);

  const setFeePeriodsList = useCallback((next) => {
    setFeePeriods(Array.isArray(next) ? next : []);
  }, []);

  const persistFeePeriod = useCallback(async (period) => {
    if (!period) return null;
    if (!cloud() || !feePeriodNeedsClosure(period)) return period;
    await repos.upsertFeePeriodClosure(period);
    return period;
  }, []);

  const applyMemberBalanceDeltas = useCallback(async (deltas) => {
    if (!cloud()) return;
    await repos.applyMemberBalanceDeltas(deltas);
  }, []);

  useEffect(() => {
    if (!cloud() || !userId) return undefined;
    let cancelled = false;
    Promise.all([repos.listInterestGenerators(), repos.listInterestRuns()])
      .then(([generators, runs]) => {
        if (cancelled) return;
        setInterestGenerators(generators || []);
        setInterestRuns(runs || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!cloud() || !userId) return undefined;
    let cancelled = false;
    repos.listFeeLedgerAccounts()
      .then((rows) => {
        if (cancelled || !rows?.length) return;
        setFeeChartAccounts(resolveFeeChartAccounts(rows));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!cloud() || !userId) return undefined;
    let cancelled = false;
    repos.listFeePeriodClosures()
      .then((rows) => {
        if (cancelled || !rows?.length) return;
        setFeePeriods((cur) => resolveFeePeriods([...(cur || []), ...rows]));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const importMemberCollections = useCallback(async (built) => {
    const batch = built?.batch;
    if (!batch) return null;
    setMemberCollectionImports((prev) => [batch, ...(prev || [])]);
    return batch;
  }, []);

  const deleteMemberCollectionImport = useCallback((id) => {
    setMemberCollectionImports((prev) => (prev || []).map((b) => (
      b.id === id ? { ...b, status: 'deleted' } : b
    )));
  }, []);

  const upsertFeeChartAccountRecord = useCallback(async (input) => {
    const existing = feeChartAccounts.find((account) => account.id === input.id) || null;
    const draft = createFeeChartAccount({
      ...existing,
      ...input,
      id: existing?.id || input.id,
      createdAt: existing?.createdAt,
      source: existing?.source || input.source,
      balance: input.balance == null || input.balance === '' ? existing?.balance : input.balance,
    });
    const saved = cloud() ? await repos.upsertFeeLedgerAccount(draft) : draft;
    setFeeChartAccounts((prev) => upsertFeeChartAccount(prev, saved));
    return saved;
  }, [feeChartAccounts]);

  const deleteFeeChartAccountRecord = useCallback(async (id) => {
    if (cloud()) await repos.deactivateFeeLedgerAccount(id);
    setFeeChartAccounts((prev) => softDeleteFeeChartAccount(prev, id));
  }, []);

  const ledgerBackfillRef = useRef({ ids: null, done: false, running: false });

  const ensureProcessedFeeLedger = useCallback(async (members = []) => {
    const state = ledgerBackfillRef.current;
    if (state.done || state.running) return;
    if (!cloud() || !members?.length || !feeChartAccounts?.length || !feePeriods?.length) return;
    if (!state.ids) {
      state.ids = new Set(
        feePeriods.filter((period) => period.status === 'processed').map((period) => period.id),
      );
    }
    state.running = true;
    try {
      const months = new Set(await repos.listFeeLedgerMonths());
      const missing = feePeriods.filter((period) => (
        state.ids.has(period.id) && !months.has(periodMonthKey(period))
      ));
      const lines = missing.flatMap((period) => (
        feeChartAccounts.flatMap((account) => periodLedgerLines(account, members, period))
      ));
      if (lines.length) await repos.insertFeeLedgerLines(lines);
      state.done = true;
    } catch {
      state.running = false;
    }
  }, [feePeriods, feeChartAccounts]);

  const postFeeLedgerCharges = useCallback(async ({ charges = [], period, members = [] } = {}) => {
    const built = ledgerLinesFromCharges(
      feeChartAccounts,
      members,
      charges,
      { ...period, label: periodLabel(period) },
    );
    if (!built.lines.length) return built;
    if (cloud()) await repos.postFeeLedgerLines(built.lines);
    setFeeChartAccounts((prev) => prev.map((account) => {
      const add = built.deltas.get(account.id) || 0;
      if (!add) return account;
      return {
        ...account,
        balance: Math.round((Number(account.balance) + add) * 100) / 100,
      };
    }));
    return built;
  }, [feeChartAccounts]);

  const upsertMemberAccountEntryRecord = useCallback((input) => {
    setMemberAccountEntries((prev) => upsertAccountEntry(prev, input));
  }, []);

  const deleteMemberAccountEntryRecord = useCallback((id) => {
    setMemberAccountEntries((prev) => softDeleteAccountEntry(prev, id));
  }, []);

  const recordAccountingReport = useCallback((record) => {
    setAccountingReports((prev) => prependAccountingReport(prev, record));
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

  const archivePaymentOrderRecord = useCallback(async (order) => {
    const effect = memberPaymentOrderDeleteEffect(order);
    if (cloud()) {
      await repos.archivePaymentOrder(order.id);
      if (effect.reversesBalance) {
        await repos.applyMemberBalanceDeltas([{
          memberId: effect.memberNumber,
          amount: effect.amount,
        }]);
      }
    }
    setPaymentOrders((prev) => prev.filter((row) => row.id !== order.id));
    return effect;
  }, []);

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
    interestGenerators,
    interestRuns,
    discounts,
    feeExpenses,
    feePeriods,
    memberCollectionImports,
    feeChartAccounts,
    memberAccountEntries,
    accountingReports,
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
    recordPoolCanon,
    openPoolDayCash,
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
    upsertInterestGeneratorRecord,
    deleteInterestGeneratorRecord,
    recordInterestRun,
    cancelInterestRunRecord,
    upsertDiscountRecord,
    deleteDiscountRecord,
    upsertFeeExpenseRecord,
    deleteFeeExpenseRecord,
    setFeePeriodsList,
    persistFeePeriod,
    applyMemberBalanceDeltas,
    importMemberCollections,
    deleteMemberCollectionImport,
    upsertFeeChartAccountRecord,
    deleteFeeChartAccountRecord,
    postFeeLedgerCharges,
    ensureProcessedFeeLedger,
    upsertMemberAccountEntryRecord,
    deleteMemberAccountEntryRecord,
    recordAccountingReport,
    upsertUnidentifiedCollection,
    upsertGaliciaDebit,
    addFixedExpense,
    toggleFixedExpense,
    addFixedDiscount,
    toggleFixedDiscount,
    upsertPaymentOrder,
    archivePaymentOrderRecord,
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

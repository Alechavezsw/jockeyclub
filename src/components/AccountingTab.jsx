import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen, Plus, DollarSign, PieChart, ShieldAlert, CheckCircle2, Trash2, Printer, Search,
  TrendingUp, Book, ListTree, Wallet, Receipt, Truck, HelpCircle, Building2, Repeat, Percent,
  Scale, FileSpreadsheet, Banknote, FileText, Ticket, CalendarDays, ChevronDown,
} from 'lucide-react';
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  getPostableAccounts,
  getAccountById,
  resolveAccountId,
} from '../domain/accounting/chartOfAccounts';
import {
  formatCurrency,
  getAccountBalance as domainAccountBalance,
  buildPostedEntry,
  isBalanced as linesAreBalanced,
  filterJournalEntries,
  journalOrdinalMap,
  journalDateKey,
  summarizeJournalBook,
  sumDebits,
  sumCredits,
  normalizeLines,
  buildMayorLedger,
} from '../domain/accounting/journal';
import ChartOfAccountsPanel from './erp/ChartOfAccountsPanel';
import CashRegistersPanel from './erp/CashRegistersPanel';
import ExpensesPanel from './erp/ExpensesPanel';
import SuppliersPanel from './erp/SuppliersPanel';
import RetencionesPanel from './erp/RetencionesPanel';
import OtherIncomePanel from './erp/OtherIncomePanel';
import InterestGeneratorPanel from './erp/InterestGeneratorPanel';
import DiscountsBonusesPanel from './erp/DiscountsBonusesPanel';
import {
  UnidentifiedCollectionsPanel,
  GaliciaDebitsPanel,
  FixedExpensesPanel,
  FixedDiscountsPanel,
  BalancesPanel,
  PaymentOrdersPanel,
} from './erp/TreasuryPanels';
import AccountingReportsPanel from './erp/AccountingReportsPanel';
import MemberCreditPurchasesPanel from './erp/MemberCreditPurchasesPanel';
import MonthlyBalancePanel from './erp/MonthlyBalancePanel';
import LiquidationCcPanel from './erp/LiquidationCcPanel';
import ResultsChartsPanel from './erp/ResultsChartsPanel';
import { allowedAccountingSubtabsForRoles } from '../domain/auth/roles';
import { useAuth } from '../context/AuthContext';
import { formatISODateLongAR, todayISODateAR } from '../lib/arDate';

const SOURCE_MODULE_LABELS = {
  manual: 'Manual',
  eventos: 'Eventos',
  pileta: 'Pileta',
  caja: 'Caja',
  gastos: 'Gastos',
  concesiones: 'Concesiones',
  cuotas: 'Cuotas',
};

const TREASURY_TABS = new Set([
  'cash', 'expenses', 'suppliers', 'retenciones', 'other_incomes', 'interest_generators',
  'unidentified', 'galicia', 'fixed_expenses', 'fixed_discounts', 'balances', 'payment_orders',
  'credit_purchases',
]);

const BALANCE_TABS = new Set(['balance', 'balance_monthly', 'balance_liquidation', 'balance_patrimonial']);

const BALANCE_HUB_TABS = [
  { key: 'balance', icon: CalendarDays, label: 'Mensual' },
  { key: 'balance_liquidation', icon: FileSpreadsheet, label: 'Cta. cte.' },
  { key: 'balance_patrimonial', icon: Scale, label: 'Patrimonial' },
];

const ACCOUNTING_HUBS = {
  treasury: { tabs: TREASURY_TABS, fallback: 'cash' },
  balance: { tabs: BALANCE_TABS, fallback: 'balance' },
};

function buildAccountingNavGroups(accountingTabs) {
  return [
    {
      id: 'books',
      label: 'Libros',
      tabs: [
        { key: 'diary', icon: BookOpen, label: 'Libro Diario', short: 'Diario' },
        { key: 'mayor', icon: Book, label: 'Libro Mayor', short: 'Mayor' },
        { key: 'create', icon: Plus, label: 'Crear Asiento Legal', short: 'Nuevo asiento', accent: 'create' },
      ],
    },
    {
      id: 'reports',
      label: 'Informes',
      tabs: [
        ...(accountingTabs.some((k) => BALANCE_TABS.has(k))
          ? [{ key: 'balance', icon: PieChart, label: 'Balance', short: 'Balance', hub: 'balance' }]
          : []),
        { key: 'results', icon: DollarSign, label: 'Estado de Resultados', short: 'Resultados' },
        { key: 'charts', icon: TrendingUp, label: 'Reportes y gráficos', short: 'Gráficos', accent: 'charts' },
        { key: 'acct_reports', icon: FileText, label: 'Reportes', short: 'Reportes' },
      ],
    },
    {
      id: 'treasury',
      label: 'Operación',
      tabs: accountingTabs.some((k) => TREASURY_TABS.has(k))
        ? [{ key: 'cash', icon: Wallet, label: 'Tesorería', short: 'Tesorería', hub: 'treasury' }]
        : [],
    },
    {
      id: 'catalog',
      label: 'Catálogo',
      tabs: [
        { key: 'plan', icon: ListTree, label: 'Plan de Cuentas', short: 'Plan' },
      ],
    },
  ]
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter((t) => t.hub || accountingTabs.includes(t.key)),
    }))
    .filter((group) => group.tabs.length > 0);
}

function isNavTabActive(tab, subTab) {
  return tab.hub ? ACCOUNTING_HUBS[tab.hub].tabs.has(subTab) : subTab === tab.key;
}

function resolveNavTabKey(tab, subTab) {
  if (!tab.hub) return tab.key;
  return ACCOUNTING_HUBS[tab.hub].tabs.has(subTab)
    ? subTab
    : ACCOUNTING_HUBS[tab.hub].fallback;
}

const TREASURY_HUB_TABS = [
  { key: 'cash', icon: Wallet, label: 'Cajas' },
  { key: 'expenses', icon: Receipt, label: 'Gastos' },
  { key: 'suppliers', icon: Truck, label: 'Proveedores' },
  { key: 'retenciones', icon: Percent, label: 'Retenciones' },
  { key: 'other_incomes', icon: Banknote, label: 'Otros ingresos' },
  { key: 'interest_generators', icon: Percent, label: 'Intereses' },
  { key: 'unidentified', icon: HelpCircle, label: 'Sin identificar' },
  { key: 'galicia', icon: Building2, label: 'Galicia' },
  { key: 'fixed_discounts', icon: Percent, label: 'Descuentos' },
  { key: 'fixed_expenses', icon: Repeat, label: 'Gastos fijos' },
  { key: 'balances', icon: Scale, label: 'Saldos' },
  { key: 'payment_orders', icon: FileSpreadsheet, label: 'Órdenes' },
  { key: 'credit_purchases', icon: Ticket, label: 'Créditos socios' },
];

function lineAccountName(line, chart) {
  if (line.account) return line.account;
  return getAccountById(chart, line.accountId)?.name || line.accountId || '—';
}

function lineSide(line) {
  if (line.type) return line.type;
  return (Number(line.credit) || 0) > 0 ? 'credit' : 'debit';
}

function lineAmount(line) {
  if (line.amount != null && line.amount !== '') return Number(line.amount) || 0;
  return Number(line.debit) || Number(line.credit) || 0;
}

function JournalEntryLeaf({ entry, ordinal, chart }) {
  const lines = normalizeLines(entry.lines || [], chart);
  const debit = sumDebits(lines);
  const credit = sumCredits(lines);
  const squared = linesAreBalanced(lines);
  const source = SOURCE_MODULE_LABELS[entry.sourceModule] || entry.sourceModule;
  const dateKey = journalDateKey(entry);

  return (
    <article className={['jd-leaf', squared ? '' : 'is-unbalanced'].filter(Boolean).join(' ')}>
      <header className="jd-leaf-head">
        <strong className="jd-leaf-no">Asiento {ordinal ?? '—'}</strong>
        <time dateTime={dateKey}>{formatISODateLongAR(dateKey)}</time>
        {entry.sourceModule && entry.sourceModule !== 'manual' ? (
          <span className="jd-leaf-source">{source}</span>
        ) : null}
        {!squared ? <span className="jd-leaf-warn">Desbalanceado</span> : null}
      </header>
      <p className="jd-leaf-glosa">{entry.description || entry.concept || 'Sin glosa'}</p>
      <div className="jd-leaf-grid jd-leaf-grid--head">
        <div>Cuenta</div>
        <div>Debe</div>
        <div>Haber</div>
      </div>
      {(entry.lines || []).map((line, lIndex) => {
        const isCredit = lineSide(line) === 'credit';
        const amt = lineAmount(line);
        return (
          <div
            key={`${entry.id}-${lIndex}`}
            className={['jd-leaf-grid', isCredit ? 'is-credit' : ''].filter(Boolean).join(' ')}
          >
            <div>{isCredit ? `a ${lineAccountName(line, chart)}` : lineAccountName(line, chart)}</div>
            <div>{!isCredit ? formatCurrency(amt) : '—'}</div>
            <div>{isCredit ? formatCurrency(amt) : '—'}</div>
          </div>
        );
      })}
      <div className="jd-leaf-grid jd-leaf-grid--total">
        <div>Totales</div>
        <div>{formatCurrency(debit)}</div>
        <div>{formatCurrency(credit)}</div>
      </div>
    </article>
  );
}

function accountsByTypeFromChart(chart) {
  const postable = getPostableAccounts(chart);
  const names = (type) => postable.filter((a) => a.accountType === type).map((a) => a.name);
  return {
    activos: names('asset'),
    pasivos: names('liability'),
    patrimonioNeto: names('equity'),
    ingresos: names('income'),
    gastos: names('expense'),
  };
}

export default function AccountingTab({
  journalEntries,
  addJournalEntry,
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS,
  setChartOfAccounts,
  upsertChartAccount,
  cashRegisters = [],
  cashSessions = [],
  cashMovements = [],
  accessinCashMovements = [],
  accessinCheques = [],
  accessinCobranzas = [],
  accessinSupplierPayments = [],
  accessinBankAccounts = [],
  upsertBankAccount,
  deleteBankAccount,
  addBankAccountEntry,
  openRegister,
  closeRegister,
  addCashMovement,
  transferCash,
  expenses = [],
  submitExpense,
  setExpenseApproved,
  setExpenseRejected,
  setExpensePaid,
  suppliers = [],
  upsertSupplier,
  toggleSupplierStatus,
  paymentImports = [],
  onImportSupplierPayments,
  expenseImports = [],
  onImportExpenses,
  onCreateSupplierEntry,
  otherIncomes = [],
  onCreateOtherIncome,
  interestGenerators = [],
  interestRuns = [],
  onUpsertInterestGenerator,
  onDeleteInterestGenerator,
  onRecordInterestRun,
  onCancelInterestRun,
  setMembers,
  retenciones = [],
  upsertRetencion,
  members = [],
  unidentifiedCollections = [],
  upsertUnidentifiedCollection,
  galiciaDebits = [],
  upsertGaliciaDebit,
  fixedExpenses = [],
  addFixedExpense,
  toggleFixedExpense,
  fixedDiscounts = [],
  addFixedDiscount,
  toggleFixedDiscount,
  discounts = [],
  onUpsertDiscount,
  onDeleteDiscount,
  feeExpenses = [],
  onUpsertFeeExpense,
  onDeleteFeeExpense,
  paymentOrders = [],
  upsertPaymentOrder,
  accountingReports = [],
  onRecordAccountingReport,
  initialSubTab = null,
}) {
  const { role, roles } = useAuth();
  const accountingTabs = allowedAccountingSubtabsForRoles(roles?.length ? roles : (role || 'admin'));
  const [searchParams, setSearchParams] = useSearchParams();
  const subFromUrl = searchParams.get('sub');
  const importFromUrl = searchParams.get('import');
  const [subTab, setSubTabState] = useState(() =>
    (initialSubTab && accountingTabs.includes(initialSubTab)
      ? initialSubTab
      : subFromUrl && accountingTabs.includes(subFromUrl)
        ? subFromUrl
        : accountingTabs[0] || 'diary')
  );

  const setSubTab = (key, opts = {}) => {
    setSubTabState(key);
    const next = new URLSearchParams(searchParams);
    if (key && key !== (accountingTabs[0] || 'diary')) {
      next.set('sub', key);
    } else {
      next.delete('sub');
    }
    if (opts.import) next.set('import', String(opts.import));
    else next.delete('import');
    setSearchParams(next, { replace: true });
  };

  const postableAccounts = useMemo(() => getPostableAccounts(chartOfAccounts), [chartOfAccounts]);
  const ALL_ACCOUNTS = useMemo(() => postableAccounts.map((a) => a.name), [postableAccounts]);
  const ACCOUNT_PLAN = useMemo(() => accountsByTypeFromChart(chartOfAccounts), [chartOfAccounts]);

  useEffect(() => {
    const tabs = allowedAccountingSubtabsForRoles(roles?.length ? roles : (role || 'admin'));
    if (!tabs.includes(subTab)) setSubTabState(tabs[0] || 'diary');
  }, [role, roles, subTab]);

  useEffect(() => {
    const tabs = allowedAccountingSubtabsForRoles(roles?.length ? roles : (role || 'admin'));
    if (subFromUrl && tabs.includes(subFromUrl) && subFromUrl !== subTab) {
      setSubTabState(subFromUrl);
    }
  }, [subFromUrl, role, roles, subTab]);
  const defaultDebitAccount = postableAccounts.find((a) => a.isCashAccount)?.name
    || postableAccounts[0]?.name
    || 'Caja General';
  const defaultCreditAccount = postableAccounts.find((a) => a.accountType === 'income')?.name
    || postableAccounts[1]?.name
    || 'Cuotas Sociales';

  // Estado para el formulario de nuevo asiento contable
  const [date, setDate] = useState(() => todayISODateAR());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState(() => [
    { account: 'Caja General', type: 'debit', amount: '' },
    { account: 'Cuotas Sociales', type: 'credit', amount: '' },
  ]);
  const [formSuccess, setFormSuccess] = useState(false);
  const [formError, setFormError] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [openDiaryDay, setOpenDiaryDay] = useState(null);
  const [openMayorDay, setOpenMayorDay] = useState(null);

  const [selectedMayorAccount, setSelectedMayorAccount] = useState('Caja General');

  useEffect(() => {
    if (ALL_ACCOUNTS.length && !ALL_ACCOUNTS.includes(selectedMayorAccount)) {
      setSelectedMayorAccount(ALL_ACCOUNTS[0]);
    }
  }, [ALL_ACCOUNTS, selectedMayorAccount]);

  const totalDebit = lines
    .filter((l) => l.type === 'debit')
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);

  const totalCredit = lines
    .filter((l) => l.type === 'credit')
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);

  const isBalanced = linesAreBalanced(lines);
  const imbalanceDiff = Math.abs(totalDebit - totalCredit);

  const addLine = () => {
    setLines((curr) => [...curr, { account: defaultDebitAccount, type: 'debit', amount: '' }]);
  };

  const removeLine = (index) => {
    if (lines.length <= 2) return;
    setLines((curr) => curr.filter((_, i) => i !== index));
  };

  const updateLine = (index, field, value) => {
    setLines((curr) => curr.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  };

  const handleSaveEntry = (e) => {
    e.preventDefault();
    if (!isBalanced) {
      setFormError('El asiento está desbalanceado. La suma de los débitos debe ser igual a los créditos.');
      return;
    }

    try {
      const newEntry = buildPostedEntry({
        date,
        description,
        lines,
        sourceModule: 'manual',
        chart: chartOfAccounts,
      });
      addJournalEntry(newEntry);
      setFormSuccess(true);
      setFormError('');
      setDescription('');
      setDate(todayISODateAR());
      setLines([
        { account: defaultDebitAccount, type: 'debit', amount: '' },
        { account: defaultCreditAccount, type: 'credit', amount: '' },
      ]);
      setTimeout(() => {
        setFormSuccess(false);
        setSubTab('diary');
      }, 2000);
    } catch (err) {
      setFormError(err.message || 'No se pudo guardar el asiento.');
    }
  };

  const getAccountBalance = (accountName) => {
    const accountId = resolveAccountId(chartOfAccounts, accountName);
    if (!accountId) return 0;
    return domainAccountBalance(accountId, journalEntries, chartOfAccounts);
  };

  const getCategoryTotal = (accountsArray) => accountsArray.reduce((sum, acc) => sum + getAccountBalance(acc), 0);

  const totalActivos = getCategoryTotal(ACCOUNT_PLAN.activos);
  const totalPasivos = getCategoryTotal(ACCOUNT_PLAN.pasivos);
  const totalPatrimonioNetoBase = getCategoryTotal(ACCOUNT_PLAN.patrimonioNeto);
  const totalIngresos = getCategoryTotal(ACCOUNT_PLAN.ingresos);
  const totalGastos = getCategoryTotal(ACCOUNT_PLAN.gastos);
  const utilidadNeta = totalIngresos - totalGastos;
  const totalPatrimonioNetoTotal = totalPatrimonioNetoBase + utilidadNeta;
  const pasivoMasPatrimonio = totalPasivos + totalPatrimonioNetoTotal;
  const balanceDiff = Math.abs(totalActivos - pasivoMasPatrimonio);
  const isBalanceSquared = balanceDiff < 0.5;
  const equationDenom = Math.max(totalActivos, pasivoMasPatrimonio, 1);
  const activoBarPct = Math.min(100, (totalActivos / equationDenom) * 100);
  const pasivoBarPct = Math.min(100, (pasivoMasPatrimonio / equationDenom) * 100);

  const filteredJournalEntries = useMemo(
    () => filterJournalEntries(journalEntries, {
      search: searchTerm,
      from: filterStartDate,
      to: filterEndDate,
      chart: chartOfAccounts,
    }),
    [journalEntries, searchTerm, filterStartDate, filterEndDate, chartOfAccounts]
  );
  const journalOrdinals = useMemo(() => journalOrdinalMap(journalEntries), [journalEntries]);
  const diarySummary = useMemo(
    () => summarizeJournalBook(filteredJournalEntries, chartOfAccounts),
    [filteredJournalEntries, chartOfAccounts]
  );
  const diaryGroups = useMemo(() => {
    const groups = [];
    for (const entry of filteredJournalEntries) {
      const key = journalDateKey(entry) || 'sin-fecha';
      const last = groups[groups.length - 1];
      if (!last || last.key !== key) groups.push({ key, entries: [entry] });
      else last.entries.push(entry);
    }
    return groups;
  }, [filteredJournalEntries]);
  const diaryGroupKeys = diaryGroups.map((group) => group.key).join('|');

  useEffect(() => {
    const keys = diaryGroupKeys ? diaryGroupKeys.split('|') : [];
    setOpenDiaryDay((current) => (
      current && keys.includes(current) ? current : (keys[0] || null)
    ));
  }, [diaryGroupKeys]);
  const diaryPeriod = useMemo(() => {
    if (filteredJournalEntries.length === 0) return '';
    const newest = journalDateKey(filteredJournalEntries[0]);
    const oldest = journalDateKey(filteredJournalEntries[filteredJournalEntries.length - 1]);
    if (oldest && newest && oldest !== newest) {
      return `${formatISODateLongAR(oldest)} — ${formatISODateLongAR(newest)}`;
    }
    return formatISODateLongAR(newest || oldest);
  }, [filteredJournalEntries]);

  const mayorAccountId = resolveAccountId(chartOfAccounts, selectedMayorAccount);
  const mayorReport = useMemo(
    () => buildMayorLedger(mayorAccountId, journalEntries, chartOfAccounts),
    [mayorAccountId, journalEntries, chartOfAccounts]
  );
  const mayorGroups = useMemo(() => {
    const groups = [];
    for (const line of mayorReport.lines) {
      const key = line.date || 'sin-fecha';
      const last = groups[groups.length - 1];
      if (!last || last.key !== key) groups.push({ key, lines: [line] });
      else last.lines.push(line);
    }
    return groups;
  }, [mayorReport.lines]);
  const mayorGroupKeys = `${selectedMayorAccount}|${mayorGroups.map((group) => group.key).join('|')}`;

  useEffect(() => {
    const keys = mayorGroupKeys.split('|').slice(1).filter(Boolean);
    setOpenMayorDay((current) => (
      current && keys.includes(current) ? current : (keys[keys.length - 1] || null)
    ));
  }, [mayorGroupKeys]);

  const acctNavGroups = useMemo(
    () => buildAccountingNavGroups(accountingTabs),
    [accountingTabs],
  );
  const activeNavGroup = acctNavGroups.find((group) =>
    group.tabs.some((tab) => isNavTabActive(tab, subTab)),
  ) || acctNavGroups[0];
  const showAcctExport = subTab !== 'create'
    && subTab !== 'plan'
    && !TREASURY_TABS.has(subTab)
    && subTab !== 'balance'
    && subTab !== 'balance_monthly'
    && subTab !== 'balance_liquidation';

  const journalExportPayload = subTab === 'diary' ? filteredJournalEntries : journalEntries;

  const handlePrint = () => {
    void import('../domain/accounting/exportJournalPdf')
      .then(({ exportJournalPdf }) => exportJournalPdf(journalExportPayload, {
        formatCurrency,
        chart: chartOfAccounts,
      }))
      .catch(() => window.print());
  };

  const handleExportExcel = () => {
    void import('../domain/accounting/exportJournalExcel')
      .then(({ exportJournalExcel }) => exportJournalExcel(journalExportPayload, {
        chart: chartOfAccounts,
      }));
  };

  return (
    <div className="fade-in acct-books">
      {/* Membrete Oficial del Club para Impresiones */}
      <div className="print-header">
        <h2 style={{ fontFamily: 'Times New Roman, serif', letterSpacing: '0.1em', fontSize: '20pt', margin: '0 0 5px 0' }}>JOCKEY CLUB SAN JUAN</h2>
        <h4 style={{ fontFamily: 'Times New Roman, serif', fontSize: '12pt', fontWeight: 'normal', margin: '0 0 15px 0', textTransform: 'uppercase' }}>
          Sede Rivadavia - Portal ERP Contable Institucional
        </h4>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9pt', borderTop: '1px solid #000', paddingTop: '5px' }}>
          <span>Fecha de Emisión: {new Date().toLocaleDateString('es-AR')}</span>
          <span>Ejercicio Económico Oficial 2026</span>
        </div>
      </div>

      {accountingTabs.length > 1 && (
        <nav className="acct-subnav" aria-label="Secciones de contabilidad">
          <div className="acct-subnav-index">
            <div className="acct-subnav-families" role="tablist" aria-label="Familias contables">
              {acctNavGroups.map((group) => {
                const isFamilyActive = group.id === activeNavGroup?.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    role="tab"
                    aria-selected={isFamilyActive}
                    className={['acct-subnav-family', isFamilyActive ? 'is-active' : ''].filter(Boolean).join(' ')}
                    onClick={() => {
                      if (isFamilyActive) return;
                      const first = group.tabs[0];
                      if (first) setSubTab(resolveNavTabKey(first, subTab));
                    }}
                  >
                    {group.label}
                  </button>
                );
              })}
            </div>
            {showAcctExport ? (
              <div className="acct-subnav-export">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="acct-subnav-print"
                  title="Descargar libro diario en PDF"
                >
                  <Printer size={14} aria-hidden="true" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="acct-subnav-print"
                  title="Descargar libro diario en Excel"
                >
                  <FileSpreadsheet size={14} aria-hidden="true" />
                  <span>Excel</span>
                </button>
              </div>
            ) : null}
          </div>

          {activeNavGroup && activeNavGroup.tabs.length > 1 ? (
            <div className="acct-subnav-pages" role="tablist" aria-label={activeNavGroup.label}>
              {activeNavGroup.tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = isNavTabActive(tab, subTab);
                return (
                  <button
                    key={tab.key + (tab.hub ? '-hub' : '')}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-current={isActive ? 'page' : undefined}
                    title={tab.label}
                    onClick={() => setSubTab(resolveNavTabKey(tab, subTab))}
                    className={[
                      'acct-subnav-item',
                      isActive ? 'is-active' : '',
                      tab.accent === 'create' ? 'is-create' : '',
                      tab.accent === 'charts' ? 'is-charts' : '',
                      tab.hub ? 'is-hub' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <Icon size={14} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
                    <span className="acct-subnav-item-full">{tab.label}</span>
                    <span className="acct-subnav-item-short">{tab.short}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </nav>
      )}

      {accountingTabs.length === 1 && (
        <div className="acct-cashier-bar" role="status">
          <Wallet size={16} aria-hidden="true" />
          <div>
            <strong>Caja</strong>
            <span>Operación de tesorería del turno</span>
          </div>
        </div>
      )}

      {TREASURY_TABS.has(subTab) && accountingTabs.length > 1 && (
        <nav className="acct-treasury-hub" aria-label="Módulos de tesorería">
          {TREASURY_HUB_TABS.filter((t) => accountingTabs.includes(t.key)).map((tab) => {
            const Icon = tab.icon;
            const isActive = subTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className={`acct-treasury-hub-item${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setSubTab(tab.key)}
              >
                <Icon size={14} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      )}

      {BALANCE_TABS.has(subTab) && accountingTabs.length > 1 && (
        <nav className="acct-treasury-hub" aria-label="Informes de balance">
          {BALANCE_HUB_TABS.filter((t) => accountingTabs.includes(t.key)).map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === 'balance'
              ? (subTab === 'balance' || subTab === 'balance_monthly')
              : subTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className={`acct-treasury-hub-item${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setSubTab(tab.key)}
              >
                <Icon size={14} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      )}

      {subTab === 'diary' && (
        <div className="fade-in mb-folio">
          <header className="mb-folio-head">
            <div>
              <p className="mb-folio-kicker">Libro diario</p>
              <h3 className="mb-folio-title">Asientos oficiales</h3>
              <p className="mb-folio-meta">
                {diaryPeriod || 'Sin movimientos en el recorte'}
                {' · '}Partida doble, del más reciente al más antiguo. Los anulados no se muestran.
              </p>
            </div>
          </header>

          <dl className="mb-folio-kpis">
            <div className="mb-folio-kpi is-net">
              <dt>Asientos</dt>
              <dd>{diarySummary.count}</dd>
              <p>Numerados desde el más antiguo</p>
            </div>
            <div className="mb-folio-kpi">
              <dt>Debe</dt>
              <dd>{formatCurrency(diarySummary.debit)}</dd>
              <p>Suma del recorte visible</p>
            </div>
            <div className="mb-folio-kpi">
              <dt>Haber</dt>
              <dd>{formatCurrency(diarySummary.credit)}</dd>
              <p>Tiene que igualar al debe</p>
            </div>
            <div className={['mb-folio-kpi', diarySummary.squared ? 'is-net' : diarySummary.count ? 'is-out' : ''].filter(Boolean).join(' ')}>
              <dt>Cuadre</dt>
              <dd>{diarySummary.count === 0 ? '—' : diarySummary.squared ? 'Cuadrado' : `${diarySummary.unbalanced}`}</dd>
              <p>{diarySummary.squared ? 'Debe = Haber en todos' : diarySummary.count ? 'Asientos desbalanceados' : 'Sin asientos para cuadrar'}</p>
            </div>
          </dl>

          <div className="jd-toolbar">
            <div className="jd-toolbar-search">
              <label className="form-label" htmlFor="acct-diary-search">Buscar</label>
              <div className="acct-search-field">
                <Search size={14} aria-hidden="true" />
                <input
                  id="acct-diary-search"
                  type="search"
                  placeholder="Glosa, cuenta, n.º de asiento o importe…"
                  className="form-input"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="acct-diary-from">Desde</label>
              <input
                id="acct-diary-from"
                type="date"
                className="form-input"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="acct-diary-to">Hasta</label>
              <input
                id="acct-diary-to"
                type="date"
                className="form-input"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => { setSearchTerm(''); setFilterStartDate(''); setFilterEndDate(''); }}
              className="btn btn-secondary btn-sm"
            >
              Limpiar
            </button>
          </div>

          {filteredJournalEntries.length === 0 ? (
            <div className="jd-empty">
              <ShieldAlert size={28} aria-hidden="true" />
              <p>No hay asientos con esos filtros. Probá otra fecha o registrá un asiento.</p>
            </div>
          ) : (
            diaryGroups.map((group) => {
              const open = openDiaryDay === group.key;
              const count = group.entries.length;
              return (
                <section key={group.key} className={['jd-day', open ? 'is-open' : ''].filter(Boolean).join(' ')}>
                  <button
                    type="button"
                    className="jd-day-toggle"
                    aria-expanded={open}
                    onClick={() => {
                      setOpenDiaryDay((current) => (current === group.key ? null : group.key));
                    }}
                  >
                    <span>
                      {group.key === 'sin-fecha' ? 'Sin fecha' : formatISODateLongAR(group.key)}
                      <em>
                        {count === 1 ? '1 asiento' : `${count} asientos`}
                      </em>
                    </span>
                    <ChevronDown size={16} className="jd-day-chevron" aria-hidden="true" />
                  </button>
                  {open ? (
                    <div className="jd-day-body">
                      {group.entries.map((entry) => (
                        <JournalEntryLeaf
                          key={entry.id}
                          entry={entry}
                          ordinal={journalOrdinals.get(entry.id)}
                          chart={chartOfAccounts}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      )}

      {subTab === 'mayor' && (
        <div className="fade-in mb-folio">
          <header className="mb-folio-head">
            <div>
              <p className="mb-folio-kicker">Libro mayor</p>
              <h3 className="mb-folio-title">{selectedMayorAccount || 'Cuenta'}</h3>
              <p className="mb-folio-meta">
                Saldo según la naturaleza de la cuenta, del más antiguo al más reciente. Solo asientos oficiales.
              </p>
            </div>
          </header>

          <dl className="mb-folio-kpis is-split">
            <div className="mb-folio-kpi">
              <dt>Movimientos</dt>
              <dd>{mayorReport.lines.length}</dd>
              <p>Líneas imputadas a esta cuenta</p>
            </div>
            <div className={['mb-folio-kpi', mayorReport.finalBalance >= 0 ? 'is-net' : 'is-out'].filter(Boolean).join(' ')}>
              <dt>Saldo</dt>
              <dd>{formatCurrency(mayorReport.finalBalance)}</dd>
              <p>{mayorReport.account?.accountType === 'income' || mayorReport.account?.accountType === 'liability' || mayorReport.account?.accountType === 'equity' ? 'Naturaleza acreedora' : 'Naturaleza deudora'}</p>
            </div>
          </dl>

          <div className="jd-toolbar">
            <div className="jd-toolbar-search">
              <label className="form-label" htmlFor="acct-mayor-account">Cuenta</label>
              <select
                id="acct-mayor-account"
                className="form-input"
                value={selectedMayorAccount}
                onChange={(e) => setSelectedMayorAccount(e.target.value)}
              >
                {ALL_ACCOUNTS.map((acc) => (
                  <option key={acc} value={acc}>{acc}</option>
                ))}
              </select>
            </div>
          </div>

          {mayorGroups.length === 0 ? (
            <div className="jd-empty">
              <p>No hay movimientos en {selectedMayorAccount}.</p>
            </div>
          ) : (
            mayorGroups.map((group) => {
              const open = openMayorDay === group.key;
              const count = group.lines.length;
              const closeBalance = group.lines[group.lines.length - 1]?.balance ?? 0;
              return (
                <section key={group.key} className={['jd-day', open ? 'is-open' : ''].filter(Boolean).join(' ')}>
                  <button
                    type="button"
                    className="jd-day-toggle"
                    aria-expanded={open}
                    onClick={() => {
                      setOpenMayorDay((current) => (current === group.key ? null : group.key));
                    }}
                  >
                    <span>
                      {group.key === 'sin-fecha' ? 'Sin fecha' : formatISODateLongAR(group.key)}
                      <em>
                        {count === 1 ? '1 movimiento' : `${count} movimientos`}
                        {' · '}
                        {formatCurrency(closeBalance)}
                      </em>
                    </span>
                    <ChevronDown size={16} className="jd-day-chevron" aria-hidden="true" />
                  </button>
                  {open ? (
                    <div className="jd-day-body">
                      <div className="table-responsive">
                        <table className="admin-table mb-folio-table">
                          <thead>
                            <tr>
                              <th>Glosa</th>
                              <th style={{ textAlign: 'right' }}>Debe</th>
                              <th style={{ textAlign: 'right' }}>Haber</th>
                              <th style={{ textAlign: 'right' }}>Saldo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.lines.map((line) => (
                              <tr key={line.id}>
                                <td>{line.description}</td>
                                <td style={{ textAlign: 'right' }}>{line.debit > 0 ? formatCurrency(line.debit) : '—'}</td>
                                <td style={{ textAlign: 'right' }}>{line.credit > 0 ? formatCurrency(line.credit) : '—'}</td>
                                <td style={{
                                  textAlign: 'right',
                                  fontWeight: 700,
                                  color: line.balance >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)',
                                }}>
                                  {formatCurrency(line.balance)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      )}

      {subTab === 'create' && (
        <div className="fade-in mb-folio">
          <header className="mb-folio-head">
            <div>
              <p className="mb-folio-kicker">Nuevo asiento</p>
              <h3 className="mb-folio-title">Partida doble</h3>
              <p className="mb-folio-meta">
                Fecha en calendario argentino. El asiento no se guarda si el debe no iguala al haber.
              </p>
            </div>
          </header>

          {formSuccess ? (
            <div className="jd-empty">
              <CheckCircle2 size={36} aria-hidden="true" />
              <p>Asiento registrado en el libro diario.</p>
            </div>
          ) : (
            <form onSubmit={handleSaveEntry} className="jd-form">
              <div className="jd-form-meta responsive-form-grid">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Fecha</label>
                  <input
                    type="date"
                    className="form-input"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Glosa</label>
                  <input
                    type="text"
                    placeholder="Cobro de cuota, socio…"
                    className="form-input"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Detalle de Partidas Dinámicas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 40px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-gold)', fontWeight: '600' }} className="entry-form-row">
                  <div>Cuenta Contable</div>
                  <div>Tipo Movimiento</div>
                  <div>Importe ARS</div>
                  <div></div>
                </div>

                {lines.map((line, index) => (
                  <div key={index} className="entry-form-row fade-in">
                    <div>
                      <select
                        className="form-input"
                        value={line.account}
                        onChange={(e) => updateLine(index, 'account', e.target.value)}
                        style={{ padding: '0.55rem' }}
                      >
                        {ALL_ACCOUNTS.map(acc => (
                          <option key={acc} value={acc} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                            {acc}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <select
                        className="form-input"
                        value={line.type}
                        onChange={(e) => updateLine(index, 'type', e.target.value)}
                        style={{ padding: '0.55rem' }}
                      >
                        <option value="debit" style={{ background: 'var(--bg-secondary)' }}>Debe (Débito)</option>
                        <option value="credit" style={{ background: 'var(--bg-secondary)' }}>Haber (Crédito)</option>
                      </select>
                    </div>
                    <div>
                      <input
                        type="number"
                        placeholder="Importe"
                        className="form-input"
                        value={line.amount}
                        onChange={(e) => updateLine(index, 'amount', e.target.value)}
                        style={{ padding: '0.55rem' }}
                        min="0.01"
                        step="0.01"
                        required
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        className="btn btn-danger btn-sm"
                        style={{ padding: '0.55rem', display: 'flex', width: '100%', justifyContent: 'center' }}
                        disabled={lines.length <= 2}
                        title="Eliminar Línea"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <button
                  type="button"
                  onClick={addLine}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <Plus size={14} /> Añadir Cuenta / Línea
                </button>
              </div>

              {formError ? (
                <p className="mb-folio-status is-error">{formError}</p>
              ) : null}

              <div className={['jd-balance', isBalanced ? 'is-ok' : 'is-off'].join(' ')}>
                <div>
                  <span>Debe {formatCurrency(totalDebit)}</span>
                  <span>Haber {formatCurrency(totalCredit)}</span>
                </div>
                <strong>
                  {isBalanced ? 'Cuadrado' : `Faltan ${formatCurrency(imbalanceDiff)}`}
                </strong>
              </div>

              <div className="jd-form-actions">
                <button
                  type="submit"
                  className="btn btn-tan"
                  disabled={!isBalanced}
                >
                  <BookOpen size={16} /> Guardar asiento
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {subTab === 'balance' && (
        <MonthlyBalancePanel />
      )}

      {/* SUB-TAB 4: BALANCE PATRIMONIAL (diario) */}
      {subTab === 'balance_patrimonial' && (
        <div className="glass-card fade-in" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h4 className="serif-font" style={{ fontSize: '1.35rem' }}>Balance General de Situación Patrimonial</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>Actualizado dinámicamente según Libro Diario</p>
            </div>
            <div style={{ fontSize: '0.8rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', padding: '0.35rem 0.75rem', borderRadius: '20px' }}>
              Ecuación: Activo = Pasivo + Patrimonio Neto
            </div>
          </div>

          <div className="table-responsive">
            <table className="balance-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Conceptos y Cuentas Contables</th>
                  <th style={{ textAlign: 'right' }}>Saldos Parciales</th>
                  <th style={{ textAlign: 'right' }}>Total Cuentas</th>
                </tr>
              </thead>
              <tbody>
                {/* 1. ACTIVOS */}
                <tr className="balance-row-category">
                  <td>ACTIVO (Bienes y Derechos)</td>
                  <td></td>
                  <td></td>
                </tr>
                {ACCOUNT_PLAN.activos.map(acc => (
                  <tr key={acc} className="balance-row-account">
                    <td>{acc}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(getAccountBalance(acc))}</td>
                    <td></td>
                  </tr>
                ))}
                <tr className="balance-row-subtotal">
                  <td style={{ paddingLeft: '1rem' }}>Total Activos Corrientes y No Corrientes</td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontWeight: '700' }}>{formatCurrency(totalActivos)}</td>
                </tr>

                {/* 2. PASIVOS */}
                <tr className="balance-row-category">
                  <td>PASIVO (Obligaciones y Deudas)</td>
                  <td></td>
                  <td></td>
                </tr>
                {ACCOUNT_PLAN.pasivos.map(acc => (
                  <tr key={acc} className="balance-row-account">
                    <td>{acc}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(getAccountBalance(acc))}</td>
                    <td></td>
                  </tr>
                ))}
                <tr className="balance-row-subtotal">
                  <td style={{ paddingLeft: '1rem' }}>Total Pasivos de Corto y Largo Plazo</td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontWeight: '700' }}>{formatCurrency(totalPasivos)}</td>
                </tr>

                {/* 3. PATRIMONIO NETO */}
                <tr className="balance-row-category">
                  <td>PATRIMONIO NETO (Recursos Propios)</td>
                  <td></td>
                  <td></td>
                </tr>
                {ACCOUNT_PLAN.patrimonioNeto.map(acc => (
                  <tr key={acc} className="balance-row-account">
                    <td>{acc}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(getAccountBalance(acc))}</td>
                    <td></td>
                  </tr>
                ))}
                {/* Mostrar Utilidad del Período de manera dinámica */}
                <tr className="balance-row-account" style={{ fontStyle: 'italic' }}>
                  <td>Utilidad Neta del Ejercicio Actual</td>
                  <td style={{ textAlign: 'right', color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)' }}>
                    {formatCurrency(utilidadNeta)}
                  </td>
                  <td></td>
                </tr>
                <tr className="balance-row-subtotal">
                  <td style={{ paddingLeft: '1rem' }}>Total Patrimonio Neto Consolidado</td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontWeight: '700' }}>{formatCurrency(totalPatrimonioNetoTotal)}</td>
                </tr>

                {/* FILA DE CIERRE GLOBAL */}
                <tr className="balance-row-total">
                  <td>TOTAL DE ACTIVOS</td>
                  <td></td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totalActivos)}</td>
                </tr>
                <tr className="balance-row-total">
                  <td>TOTAL DE PASIVO + PATRIMONIO NETO</td>
                  <td></td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(pasivoMasPatrimonio)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Banner de Verificación de Cuadre Contable */}
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            background: isBalanceSquared ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.08)',
            color: isBalanceSquared ? 'var(--emerald-accent)' : 'var(--danger-accent)',
            padding: '1rem',
            borderRadius: '8px',
            border: `1px solid ${isBalanceSquared ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.35)'}`,
            fontSize: '0.9rem',
            marginTop: '1.5rem',
            fontWeight: '600',
          }}>
            {isBalanceSquared ? <CheckCircle2 size={18} style={{ flexShrink: 0 }} /> : <ShieldAlert size={18} style={{ flexShrink: 0 }} />}
            <div>
              {isBalanceSquared ? (
                <span>El Balance se encuentra cuadrado. Activos = Pasivos + PN ({formatCurrency(totalActivos)}).</span>
              ) : (
                <span>
                  Descuadre de {formatCurrency(balanceDiff)}: Activos {formatCurrency(totalActivos)} ≠ Pasivo+PN {formatCurrency(pasivoMasPatrimonio)}.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {subTab === 'results' && (
        <div className="fade-in mb-folio">
          <header className="mb-folio-head">
            <div>
              <p className="mb-folio-kicker">Estado de resultados</p>
              <h3 className="mb-folio-title">{utilidadNeta >= 0 ? 'Superávit' : 'Déficit'}</h3>
              <p className="mb-folio-meta">
                Ingresos {formatCurrency(totalIngresos)} · Egresos {formatCurrency(totalGastos)} · margen {totalIngresos > 0 ? `${Math.round((utilidadNeta / totalIngresos) * 100)}%` : '—'}
              </p>
            </div>
          </header>

          <div className="table-responsive">
            <table className="balance-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Estructura de Resultados</th>
                  <th style={{ textAlign: 'right' }}>Importes Parciales</th>
                  <th style={{ textAlign: 'right' }}>Importe Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {/* INGRESOS */}
                <tr className="balance-row-category">
                  <td>INGRESOS OPERATIVOS (Ganancias)</td>
                  <td></td>
                  <td></td>
                </tr>
                {ACCOUNT_PLAN.ingresos.map(acc => (
                  <tr key={acc} className="balance-row-account">
                    <td>{acc}</td>
                    <td style={{ textAlign: 'right', color: 'var(--emerald-accent)' }}>+{formatCurrency(getAccountBalance(acc))}</td>
                    <td></td>
                  </tr>
                ))}
                <tr className="balance-row-subtotal">
                  <td style={{ paddingLeft: '1rem' }}>Ingresos Brutos Operacionales</td>
                  <td></td>
                  <td style={{ textAlign: 'right', color: 'var(--emerald-accent)', fontWeight: '700' }}>
                    {formatCurrency(totalIngresos)}
                  </td>
                </tr>

                {/* GASTOS */}
                <tr className="balance-row-category">
                  <td>GASTOS OPERATIVOS (Egresos)</td>
                  <td></td>
                  <td></td>
                </tr>
                {ACCOUNT_PLAN.gastos.map(acc => (
                  <tr key={acc} className="balance-row-account">
                    <td>{acc}</td>
                    <td style={{ textAlign: 'right', color: 'var(--danger-accent)' }}>-{formatCurrency(getAccountBalance(acc))}</td>
                    <td></td>
                  </tr>
                ))}
                <tr className="balance-row-subtotal">
                  <td style={{ paddingLeft: '1rem' }}>Egresos Brutos de Operación y Mantenimiento</td>
                  <td></td>
                  <td style={{ textAlign: 'right', color: 'var(--danger-accent)', fontWeight: '700' }}>
                    -{formatCurrency(totalGastos)}
                  </td>
                </tr>

                {/* RESULTADO NETO */}
                <tr className="balance-row-total" style={{ background: utilidadNeta >= 0 ? 'rgba(16, 185, 129, 0.04)' : 'rgba(239, 68, 68, 0.04)' }}>
                  <td style={{ textTransform: 'uppercase' }}>Utilidad Neta (Superávit / Déficit del Ejercicio)</td>
                  <td></td>
                  <td style={{ 
                    textAlign: 'right', 
                    color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)',
                    fontWeight: '800',
                    fontSize: '1.1rem'
                  }}>
                    {formatCurrency(utilidadNeta)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'acct_reports' && (
        <AccountingReportsPanel
          members={members}
          reports={accountingReports}
          onRecordReport={onRecordAccountingReport}
          journalEntries={journalEntries}
          chartOfAccounts={chartOfAccounts}
        />
      )}

      {subTab === 'charts' && (
        <ResultsChartsPanel
          journalEntries={journalEntries}
          chartOfAccounts={chartOfAccounts}
          accountPlan={ACCOUNT_PLAN}
          getAccountBalance={getAccountBalance}
          totals={{
            ingresos: totalIngresos,
            gastos: totalGastos,
            resultado: utilidadNeta,
            activos: totalActivos,
            pasivos: totalPasivos,
            patrimonio: totalPatrimonioNetoTotal,
            pasivoPn: pasivoMasPatrimonio,
            squared: isBalanceSquared,
            balanceDiff,
            activoBarPct,
            pasivoBarPct,
          }}
          onOpenAccount={(name) => {
            setSelectedMayorAccount(name);
            setSubTab('mayor');
          }}
        />
      )}

      {subTab === 'plan' && (setChartOfAccounts || upsertChartAccount) && (
        <ChartOfAccountsPanel
          chartOfAccounts={chartOfAccounts}
          setChartOfAccounts={setChartOfAccounts}
          upsertChartAccount={upsertChartAccount}
          journalEntries={journalEntries}
        />
      )}

      {subTab === 'cash' && openRegister && (
        <CashRegistersPanel
          cashRegisters={cashRegisters}
          cashSessions={cashSessions}
          cashMovements={cashMovements}
          accessinCashMovements={accessinCashMovements}
          accessinCheques={accessinCheques}
          accessinCobranzas={accessinCobranzas}
          accessinSupplierPayments={accessinSupplierPayments}
          accessinBankAccounts={accessinBankAccounts}
          upsertBankAccount={upsertBankAccount}
          deleteBankAccount={deleteBankAccount}
          addBankAccountEntry={addBankAccountEntry}
          chartOfAccounts={chartOfAccounts}
          members={members}
          openRegister={openRegister}
          closeRegister={closeRegister}
          addCashMovement={addCashMovement}
          transferCash={transferCash}
          onNavigate={setSubTab}
        />
      )}

      {subTab === 'expenses' && submitExpense && (
        <ExpensesPanel
          expenses={expenses}
          chartOfAccounts={chartOfAccounts}
          suppliers={suppliers}
          submitExpense={submitExpense}
          setExpenseApproved={setExpenseApproved}
          setExpenseRejected={setExpenseRejected}
          setExpensePaid={setExpensePaid}
          expenseImports={expenseImports}
          onImportExpenses={onImportExpenses}
          initialView={importFromUrl === 'gastos' ? 'import' : 'list'}
        />
      )}

      {subTab === 'suppliers' && upsertSupplier && (
        <SuppliersPanel
          suppliers={suppliers}
          upsertSupplier={upsertSupplier}
          toggleSupplierStatus={toggleSupplierStatus}
          expenses={expenses}
          paymentImports={paymentImports}
          onImportSupplierPayments={onImportSupplierPayments}
          onCreateSupplierEntry={onCreateSupplierEntry}
          onNavigate={setSubTab}
        />
      )}

      {subTab === 'retenciones' && upsertRetencion && (
        <RetencionesPanel
          retenciones={retenciones}
          upsertRetencion={upsertRetencion}
          suppliers={suppliers}
        />
      )}

      {subTab === 'other_incomes' && onCreateOtherIncome && (
        <OtherIncomePanel
          items={otherIncomes}
          onCreate={onCreateOtherIncome}
        />
      )}

      {subTab === 'interest_generators' && onUpsertInterestGenerator && (
        <InterestGeneratorPanel
          generators={interestGenerators}
          runs={interestRuns}
          members={members}
          onUpsertGenerator={onUpsertInterestGenerator}
          onDeleteGenerator={onDeleteInterestGenerator}
          onRunGenerator={(result) => {
            onRecordInterestRun?.(result);
            if (typeof setMembers === 'function' && result?.memberBalancePatches?.length) {
              const deltaById = new Map();
              result.memberBalancePatches.forEach((p) => {
                deltaById.set(
                  String(p.memberId),
                  (deltaById.get(String(p.memberId)) || 0) + (Number(p.delta) || 0)
                );
              });
              setMembers((prev) => (prev || []).map((m) => {
                const delta = deltaById.get(String(m.memberId));
                if (!delta) return m;
                return {
                  ...m,
                  outstandingBalance: Math.round(((Number(m.outstandingBalance) || 0) + delta) * 100) / 100,
                };
              }));
            }
          }}
          onCancelRun={(runId) => {
            const run = (interestRuns || []).find((r) => r.id === runId);
            onCancelInterestRun?.(runId);
            if (typeof setMembers === 'function' && run?.status === 'completed' && run?.entries?.length) {
              const deltaById = new Map();
              run.entries.forEach((e) => {
                deltaById.set(
                  String(e.memberId),
                  (deltaById.get(String(e.memberId)) || 0) - (Number(e.amount) || 0)
                );
              });
              setMembers((prev) => (prev || []).map((m) => {
                const delta = deltaById.get(String(m.memberId));
                if (!delta) return m;
                return {
                  ...m,
                  outstandingBalance: Math.max(
                    0,
                    Math.round(((Number(m.outstandingBalance) || 0) + delta) * 100) / 100
                  ),
                };
              }));
            }
          }}
        />
      )}

      {subTab === 'unidentified' && upsertUnidentifiedCollection && (
        <UnidentifiedCollectionsPanel
          items={unidentifiedCollections}
          members={members}
          onAdd={upsertUnidentifiedCollection}
          onMatch={upsertUnidentifiedCollection}
          onReject={upsertUnidentifiedCollection}
        />
      )}

      {subTab === 'galicia' && upsertGaliciaDebit && (
        <GaliciaDebitsPanel
          items={galiciaDebits}
          members={members}
          onAdd={upsertGaliciaDebit}
          onSetStatus={upsertGaliciaDebit}
        />
      )}

      {subTab === 'fixed_expenses' && addFixedExpense && (
        <FixedExpensesPanel
          items={fixedExpenses}
          onAdd={addFixedExpense}
          onToggle={toggleFixedExpense}
        />
      )}

      {subTab === 'fixed_discounts' && onUpsertDiscount && (
        <DiscountsBonusesPanel
          items={discounts}
          feeExpenses={feeExpenses}
          fixedExpenses={fixedExpenses}
          members={members}
          onUpsert={onUpsertDiscount}
          onDelete={onDeleteDiscount}
          onUpsertFeeExpense={onUpsertFeeExpense}
          onDeleteFeeExpense={onDeleteFeeExpense}
          onGoExpenses={() => setSubTab('fixed_expenses')}
        />
      )}

      {subTab === 'fixed_discounts' && !onUpsertDiscount && addFixedDiscount && (
        <FixedDiscountsPanel
          items={fixedDiscounts}
          onAdd={addFixedDiscount}
          onToggle={toggleFixedDiscount}
        />
      )}

      {subTab === 'balances' && (
        <BalancesPanel members={members} getAccountBalance={getAccountBalance} />
      )}

      {subTab === 'payment_orders' && upsertPaymentOrder && (
        <PaymentOrdersPanel
          items={paymentOrders}
          suppliers={suppliers}
          onAdd={upsertPaymentOrder}
          onSetStatus={upsertPaymentOrder}
        />
      )}

      {subTab === 'credit_purchases' && (
        <MemberCreditPurchasesPanel members={members} />
      )}

      {subTab === 'balance_monthly' && (
        <MonthlyBalancePanel />
      )}

      {subTab === 'balance_liquidation' && (
        <LiquidationCcPanel />
      )}
    </div>
  );
}

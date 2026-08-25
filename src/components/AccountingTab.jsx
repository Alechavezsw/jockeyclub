import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen, Plus, DollarSign, PieChart, ShieldAlert, CheckCircle2, Trash2, Printer, Search,
  TrendingUp, Book, ListTree, Wallet, Receipt, Truck, HelpCircle, Building2, Repeat, Percent,
  Scale, FileSpreadsheet,
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
  normalizeLines,
} from '../domain/accounting/journal';
import ChartOfAccountsPanel from './erp/ChartOfAccountsPanel';
import CashRegistersPanel from './erp/CashRegistersPanel';
import ExpensesPanel from './erp/ExpensesPanel';
import SuppliersPanel from './erp/SuppliersPanel';
import {
  UnidentifiedCollectionsPanel,
  GaliciaDebitsPanel,
  FixedExpensesPanel,
  FixedDiscountsPanel,
  BalancesPanel,
  PaymentOrdersPanel,
} from './erp/TreasuryPanels';
import { allowedAccountingSubtabs } from '../domain/auth/roles';
import { useAuth } from '../context/AuthContext';

const TREASURY_TABS = new Set([
  'cash', 'expenses', 'suppliers',
  'unidentified', 'galicia', 'fixed_expenses', 'fixed_discounts', 'balances', 'payment_orders',
]);

const TREASURY_HUB_TABS = [
  { key: 'cash', icon: Wallet, label: 'Cajas' },
  { key: 'expenses', icon: Receipt, label: 'Gastos' },
  { key: 'suppliers', icon: Truck, label: 'Proveedores' },
  { key: 'unidentified', icon: HelpCircle, label: 'Sin identificar' },
  { key: 'galicia', icon: Building2, label: 'Galicia' },
  { key: 'fixed_expenses', icon: Repeat, label: 'Gastos fijos' },
  { key: 'fixed_discounts', icon: Percent, label: 'Descuentos' },
  { key: 'balances', icon: Scale, label: 'Saldos' },
  { key: 'payment_orders', icon: FileSpreadsheet, label: 'Órdenes' },
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
  paymentOrders = [],
  upsertPaymentOrder,
  initialSubTab = null,
}) {
  const { role } = useAuth();
  const accountingTabs = allowedAccountingSubtabs(role || 'admin');
  const [searchParams, setSearchParams] = useSearchParams();
  const subFromUrl = searchParams.get('sub');
  const [subTab, setSubTabState] = useState(() =>
    (initialSubTab && accountingTabs.includes(initialSubTab)
      ? initialSubTab
      : subFromUrl && accountingTabs.includes(subFromUrl)
        ? subFromUrl
        : accountingTabs[0] || 'diary')
  );

  const setSubTab = (key) => {
    setSubTabState(key);
    const next = new URLSearchParams(searchParams);
    if (key && key !== (accountingTabs[0] || 'diary')) {
      next.set('sub', key);
    } else {
      next.delete('sub');
    }
    setSearchParams(next, { replace: true });
  };

  const postableAccounts = useMemo(() => getPostableAccounts(chartOfAccounts), [chartOfAccounts]);
  const ALL_ACCOUNTS = useMemo(() => postableAccounts.map((a) => a.name), [postableAccounts]);
  const ACCOUNT_PLAN = useMemo(() => accountsByTypeFromChart(chartOfAccounts), [chartOfAccounts]);

  useEffect(() => {
    const tabs = allowedAccountingSubtabs(role || 'admin');
    if (!tabs.includes(subTab)) setSubTabState(tabs[0] || 'diary');
  }, [role, subTab]);

  useEffect(() => {
    const tabs = allowedAccountingSubtabs(role || 'admin');
    if (subFromUrl && tabs.includes(subFromUrl) && subFromUrl !== subTab) {
      setSubTabState(subFromUrl);
    }
  }, [subFromUrl, role, subTab]);
  // Estado para el formulario de nuevo asiento contable
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([
    { account: 'Caja General', type: 'debit', amount: '' },
    { account: 'Cuotas Sociales', type: 'credit', amount: '' }
  ]);
  const [formSuccess, setFormSuccess] = useState(false);
  const [formError, setFormError] = useState('');

  // Estados para búsqueda y filtrado
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Estado para Libro Mayor
  const [selectedMayorAccount, setSelectedMayorAccount] = useState('Caja General');

  // Estado para interactividad de gráficos SVG
  const [hoveredExpenseSegment, setHoveredExpenseSegment] = useState(null);

  // Dinámicamente calcular totales de Debe y Haber del formulario activo
  const totalDebit = lines
    .filter(l => l.type === 'debit')
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);

  const totalCredit = lines
    .filter(l => l.type === 'credit')
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);

  const isBalanced = totalDebit === totalCredit && totalDebit > 0;
  const imbalanceDiff = Math.abs(totalDebit - totalCredit);

  // Manejar adición de una fila de cuenta en el formulario
  const addLine = () => {
    setLines([...lines, { account: 'Caja General', type: 'debit', amount: '' }]);
  };

  // Eliminar una fila de cuenta en el formulario
  const removeLine = (index) => {
    if (lines.length <= 2) return; // Mínimo 2 líneas para partida doble
    setLines(lines.filter((_, i) => i !== index));
  };

  // Actualizar una fila específica del formulario
  const updateLine = (index, field, value) => {
    setLines(lines.map((line, i) => {
      if (i === index) {
        return { ...line, [field]: value };
      }
      return line;
    }));
  };

  // Guardar asiento legal (partida doble validada + cuenta del plan)
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
      setLines([
        { account: 'Caja General', type: 'debit', amount: '' },
        { account: 'Cuotas Sociales', type: 'credit', amount: '' }
      ]);
      setTimeout(() => {
        setFormSuccess(false);
        setSubTab('diary');
      }, 2000);
    } catch (err) {
      setFormError(err.message || 'No se pudo guardar el asiento.');
    }
  };

  // --- CÁLCULO DINÁMICO DE BALANCES (soporta asientos legacy y accountId) ---
  const getAccountBalance = (accountName) => {
    const accountId = resolveAccountId(chartOfAccounts, accountName);
    if (!accountId) return 0;
    return domainAccountBalance(accountId, journalEntries, chartOfAccounts);
  };

  // Dinamizar sumatoria de categorías
  const getCategoryTotal = (accountsArray) => {
    return accountsArray.reduce((sum, acc) => sum + getAccountBalance(acc), 0);
  };

  // Sumas contables desde el plan de cuentas vivo
  const totalActivos = getCategoryTotal(ACCOUNT_PLAN.activos);
  const totalPasivos = getCategoryTotal(ACCOUNT_PLAN.pasivos);
  const totalPatrimonioNetoBase = getCategoryTotal(ACCOUNT_PLAN.patrimonioNeto);
  
  const totalIngresos = getCategoryTotal(ACCOUNT_PLAN.ingresos);
  const totalGastos = getCategoryTotal(ACCOUNT_PLAN.gastos);
  const utilidadNeta = totalIngresos - totalGastos;

  // El Patrimonio Neto Total incluye el capital social inicial más la utilidad del período actual
  const totalPatrimonioNetoTotal = totalPatrimonioNetoBase + utilidadNeta;
  const pasivoMasPatrimonio = totalPasivos + totalPatrimonioNetoTotal;
  const balanceDiff = Math.abs(totalActivos - pasivoMasPatrimonio);
  const isBalanceSquared = balanceDiff < 0.5;
  const equationDenom = Math.max(totalActivos, pasivoMasPatrimonio, 1);
  const activoBarPct = Math.min(100, (totalActivos / equationDenom) * 100);
  const pasivoBarPct = Math.min(100, (pasivoMasPatrimonio / equationDenom) * 100);

  // --- FILTRO DE LIBRO DIARIO ---
  const filteredJournalEntries = journalEntries.filter(entry => {
    const concept = (entry.description || entry.concept || '').toLowerCase();
    const matchesSearch =
      concept.includes(searchTerm.toLowerCase()) ||
      entry.lines.some((l) => lineAccountName(l, chartOfAccounts).toLowerCase().includes(searchTerm.toLowerCase()));

    const entryDateStr = entry.date;
    const matchesStart = filterStartDate ? entryDateStr >= filterStartDate : true;
    const matchesEnd = filterEndDate ? entryDateStr <= filterEndDate : true;

    return matchesSearch && matchesStart && matchesEnd;
  });

  // --- CÁLCULOS DE LIBRO MAYOR ---
  const getMayorReport = (accountName) => {
    let runningBalance = 0;
    const ledgerLines = [];
    const accountId = resolveAccountId(chartOfAccounts, accountName);
    const isAssetOrExpense = ACCOUNT_PLAN.activos.includes(accountName) || ACCOUNT_PLAN.gastos.includes(accountName);

    const chronologicalEntries = [...journalEntries].reverse();

    chronologicalEntries.forEach((entry) => {
      normalizeLines(entry.lines || [], chartOfAccounts).forEach((line) => {
        if (line.accountId !== accountId) return;
        const debitVal = line.debit;
        const creditVal = line.credit;
        if (isAssetOrExpense) {
          runningBalance += debitVal - creditVal;
        } else {
          runningBalance += creditVal - debitVal;
        }
        ledgerLines.push({
          id: entry.id,
          date: entry.date,
          description: entry.description || entry.concept,
          debit: debitVal,
          credit: creditVal,
          balance: runningBalance,
        });
      });
    });

    return {
      lines: ledgerLines.reverse(),
      finalBalance: runningBalance,
    };
  };

  const mayorReport = getMayorReport(selectedMayorAccount);

  // --- EJECUTAR IMPRESIÓN ---
  const handlePrint = () => {
    void import('../domain/accounting/exportJournalPdf')
      .then(({ exportJournalPdf }) => exportJournalPdf(journalEntries, {
        formatCurrency,
        chart: chartOfAccounts,
      }))
      .catch(() => window.print());
  };

  return (
    <div className="fade-in">
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

      {/* Subnav contable — distinta del rail del panel (segmentada, no chips dorados) */}
      {accountingTabs.length > 1 && (
        <nav className="acct-subnav" aria-label="Secciones de contabilidad">
          <div className="acct-subnav-track">
            {[
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
                  { key: 'balance', icon: PieChart, label: 'Balance General', short: 'Balance' },
                  { key: 'results', icon: DollarSign, label: 'Estado de Resultados', short: 'Resultados' },
                  { key: 'charts', icon: TrendingUp, label: 'Reportes y gráficos', short: 'Gráficos', accent: 'charts' },
                ],
              },
              {
                id: 'treasury',
                label: 'Operación',
                tabs: accountingTabs.some((k) => TREASURY_TABS.has(k))
                  ? [{ key: 'cash', icon: Wallet, label: 'Tesorería', short: 'Tesorería', hub: true }]
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
              .filter((group) => group.tabs.length > 0)
              .map((group) => (
                <div key={group.id} className="acct-subnav-group" role="group" aria-label={group.label}>
                  <span className="acct-subnav-group-label">{group.label}</span>
                  <div className="acct-subnav-segment" role="tablist" aria-label={group.label}>
                    {group.tabs.map((tab) => {
                      const Icon = tab.icon;
                      const isActive = tab.hub ? TREASURY_TABS.has(subTab) : subTab === tab.key;
                      return (
                        <button
                          key={tab.key + (tab.hub ? '-hub' : '')}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          aria-current={isActive ? 'page' : undefined}
                          title={tab.label}
                          onClick={() => setSubTab(tab.hub ? (TREASURY_TABS.has(subTab) ? subTab : 'cash') : tab.key)}
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
                </div>
              ))}
          </div>

          {subTab !== 'create' && subTab !== 'plan' && !TREASURY_TABS.has(subTab) && (
            <button
              type="button"
              onClick={handlePrint}
              className="acct-subnav-print"
              title="Imprimir reporte en formato oficial"
            >
              <Printer size={14} aria-hidden="true" />
              <span>Exportar</span>
            </button>
          )}
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

      {/* SUB-TAB 1: LIBRO DIARIO CON BUSCADOR Y FILTROS */}
      {subTab === 'diary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} className="fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h4 className="serif-font" style={{ fontSize: '1.25rem' }}>Asientos Contables Oficiales</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Libro Diario cronológico balanceado</p>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Código de Comercio Argentino</span>
          </div>

          {/* Panel de Filtros */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', background: 'rgba(255, 255, 255, 0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-glass)', alignItems: 'flex-end' }}>
            <div style={{ flex: '2', minWidth: '220px' }}>
              <label className="form-label" style={{ fontSize: '0.72rem', color: 'var(--text-gold)' }}>Buscar por Cuenta o Concepto</label>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="text"
                  placeholder="Ej: Caja, Banco, Cuotas..."
                  className="form-input"
                  style={{ paddingLeft: '2.2rem', fontSize: '0.85rem' }}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div style={{ flex: '1', minWidth: '130px' }}>
              <label className="form-label" style={{ fontSize: '0.72rem' }}>Fecha Desde</label>
              <input 
                type="date"
                className="form-input"
                style={{ fontSize: '0.85rem', padding: '0.65rem' }}
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
              />
            </div>

            <div style={{ flex: '1', minWidth: '130px' }}>
              <label className="form-label" style={{ fontSize: '0.72rem' }}>Fecha Hasta</label>
              <input 
                type="date"
                className="form-input"
                style={{ fontSize: '0.85rem', padding: '0.65rem' }}
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
              />
            </div>

            <button
              onClick={() => { setSearchTerm(''); setFilterStartDate(''); setFilterEndDate(''); }}
              className="btn btn-secondary btn-sm"
              style={{ height: '38px', padding: '0 1rem' }}
            >
              Limpiar
            </button>
          </div>

          {filteredJournalEntries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem' }} className="glass-panel">
              <ShieldAlert size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
              <p style={{ color: 'var(--text-secondary)' }}>No se encontraron asientos contables con los filtros seleccionados.</p>
            </div>
          ) : (
            filteredJournalEntries.map((entry) => (
              <div key={entry.id} className="ledger-entry-card">
                {/* Cabecera del Asiento */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                  <strong style={{ color: 'var(--primary-gold)' }}>ASIENTO N° {journalEntries.length - journalEntries.findIndex(e => e.id === entry.id)}</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>{entry.date}</span>
                </div>

                {/* Glosa o Explicación */}
                <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.75rem', fontStyle: 'italic' }}>
                  "{entry.description || entry.concept}"
                  {entry.sourceModule && entry.sourceModule !== 'manual' ? (
                    <span style={{ fontStyle: 'normal', marginLeft: 8, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      [{entry.sourceModule}]
                    </span>
                  ) : null}
                </p>

                {/* Tabla de Cuentas */}
                <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                  {/* Fila Encabezado */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-gold)', fontWeight: '600', paddingBottom: '0.25rem' }}>
                    <div>Detalle de Cuentas</div>
                    <div style={{ textAlign: 'right' }}>Debe (Débito)</div>
                    <div style={{ textAlign: 'right' }}>Haber (Crédito)</div>
                  </div>

                  {/* Filas de Cuentas */}
                  {entry.lines.map((line, lIndex) => {
                    const isCredit = lineSide(line) === 'credit';
                    const amt = lineAmount(line);
                    return (
                      <div 
                        key={lIndex} 
                        style={{ 
                          display: 'grid', 
                          gridTemplateColumns: '1.5fr 1fr 1fr', 
                          fontSize: '0.9rem', 
                          padding: '0.25rem 0',
                          borderBottom: '1px solid rgba(255,255,255,0.02)'
                        }}
                      >
                        <div style={{ paddingLeft: isCredit ? '2rem' : '0', color: isCredit ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                          {isCredit ? 'a ' : ''}{lineAccountName(line, chartOfAccounts)}
                        </div>
                        <div style={{ textAlign: 'right', color: 'var(--text-primary)' }}>
                          {!isCredit ? formatCurrency(amt) : '-'}
                        </div>
                        <div style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {isCredit ? formatCurrency(amt) : '-'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* SUB-TAB 2: LIBRO MAYOR INTERACTIVO */}
      {subTab === 'mayor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} className="fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 className="serif-font" style={{ fontSize: '1.25rem' }}>Libro Mayor Oficial</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Evolución analítica e historial por cuenta individual</p>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-gold)', fontWeight: '600' }}>Balance de Sumas y Saldos</span>
          </div>

          {/* Selector de Cuenta Mayor */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <label className="form-label" style={{ margin: 0, fontSize: '0.85rem' }}>Seleccionar Cuenta Contable:</label>
              <select
                className="form-input"
                style={{ width: '220px', padding: '0.55rem' }}
                value={selectedMayorAccount}
                onChange={(e) => setSelectedMayorAccount(e.target.value)}
              >
                {ALL_ACCOUNTS.map(acc => (
                  <option key={acc} value={acc} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                    {acc}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Saldo Neto Acumulado:</span>
              <span style={{ 
                fontSize: '1.4rem', 
                fontWeight: '700', 
                color: mayorReport.finalBalance >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)'
              }}>
                {formatCurrency(mayorReport.finalBalance)}
              </span>
            </div>
          </div>

          {/* Tabla de Movimientos del Mayor */}
          <div className="glass-card" style={{ padding: '1rem' }}>
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto o Glosa</th>
                    <th style={{ textAlign: 'right' }}>Debe (Débito)</th>
                    <th style={{ textAlign: 'right' }}>Haber (Crédito)</th>
                    <th style={{ textAlign: 'right' }}>Saldo Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {mayorReport.lines.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No hay movimientos registrados en la cuenta "{selectedMayorAccount}" para el período actual.
                      </td>
                    </tr>
                  ) : (
                    mayorReport.lines.map((line, idx) => (
                      <tr key={idx}>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{line.date}</td>
                        <td style={{ fontSize: '0.9rem' }}>{line.description}</td>
                        <td style={{ textAlign: 'right', color: line.debit > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {line.debit > 0 ? formatCurrency(line.debit) : '-'}
                        </td>
                        <td style={{ textAlign: 'right', color: line.credit > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                          {line.credit > 0 ? formatCurrency(line.credit) : '-'}
                        </td>
                        <td style={{ 
                          textAlign: 'right', 
                          fontWeight: '600',
                          color: line.balance >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)' 
                        }}>
                          {formatCurrency(line.balance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: CREAR ASIENTO LEGAL POR PARTIDA DOBLE */}
      {subTab === 'create' && (
        <div className="glass-card fade-in" style={{ padding: '1.5rem', background: 'rgba(255, 255, 255, 0.01)' }}>
          <h4 className="serif-font" style={{ fontSize: '1.25rem', marginBottom: '1rem', color: 'var(--text-gold)' }}>Registrar Asiento Legal por Partida Doble</h4>
          
          {formSuccess ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
              <CheckCircle2 size={48} style={{ color: 'var(--emerald-accent)' }} />
              <div>
                <h4 className="serif-font" style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}>Asiento Guardado con Éxito</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  La transacción ha sido registrada en el Libro Diario y se ha actualizado el Balance de Situación General.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveEntry} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '1rem' }} className="responsive-form-grid">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Fecha de Operación</label>
                  <input
                    type="date"
                    className="form-input"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Glosa / Concepto del Asiento</label>
                  <input
                    type="text"
                    placeholder="Ej: Registro Cobro Cuota Mensual Socio X"
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
                        min="1"
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

              {formError && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-accent)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.85rem' }}>
                  <ShieldAlert size={16} style={{ flexShrink: 0 }} />
                  <span>{formError}</span>
                </div>
              )}

              {/* Panel de Validación de Balances en Tiempo Real */}
              <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', background: isBalanced ? 'rgba(16, 185, 129, 0.04)' : 'rgba(239, 68, 68, 0.04)', borderColor: isBalanced ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Estado del Balance de Partida Doble</span>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '1rem', fontWeight: '600' }}>
                    <span>Debe: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(totalDebit)}</strong></span>
                    <span>Haber: <strong style={{ color: 'var(--text-secondary)' }}>{formatCurrency(totalCredit)}</strong></span>
                  </div>
                </div>

                {isBalanced ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--emerald-accent)', fontWeight: '600', fontSize: '0.9rem' }}>
                    <CheckCircle2 size={16} /> ¡Asiento Balanceado!
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning-accent)', fontWeight: '600', fontSize: '0.9rem' }}>
                    <ShieldAlert size={16} /> Desbalanceado por: {formatCurrency(imbalanceDiff)}
                  </div>
                )}
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border-glass)' }} />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ padding: '0.65rem 1.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  disabled={!isBalanced}
                >
                  <BookOpen size={16} /> Guardar Asiento Diario
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* SUB-TAB 4: BALANCE GENERAL */}
      {subTab === 'balance' && (
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

      {/* SUB-TAB 5: ESTADO DE RESULTADOS */}
      {subTab === 'results' && (
        <div className="glass-card fade-in" style={{ padding: '1.5rem' }}>
          <div>
            <h4 className="serif-font" style={{ fontSize: '1.35rem', marginBottom: '0.25rem' }}>Estado de Resultados (Pérdidas y Ganancias)</h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Resumen acumulado del ejercicio económico del Jockey Club
            </p>
          </div>

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

      {/* SUB-TAB 6: REPORTES Y GRÁFICOS CONTABLES DE GESTIÓN */}
      {subTab === 'charts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} className="fade-in">
          {/* Tarjetas KPI de Gestión Financiera */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderLeft: '4px solid var(--emerald-accent)', padding: '1rem 1.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingresos Totales</span>
              <strong style={{ fontSize: '1.35rem', color: 'var(--emerald-accent)' }}>{formatCurrency(totalIngresos)}</strong>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Facturación por Cuotas, Gourmet y Golf</div>
            </div>
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderLeft: '4px solid var(--danger-accent)', padding: '1rem 1.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Egresos Operacionales</span>
              <strong style={{ fontSize: '1.35rem', color: 'var(--danger-accent)' }}>{formatCurrency(totalGastos)}</strong>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Mantenimiento, Sueldos y Activos Equinos</div>
            </div>
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderLeft: '4px solid var(--primary-gold)', padding: '1rem 1.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Superávit del Ejercicio</span>
              <strong style={{ fontSize: '1.35rem', color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)' }}>
                {formatCurrency(utilidadNeta)}
              </strong>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Margen Neto: {totalIngresos > 0 ? `${Math.round((utilidadNeta/totalIngresos)*100)}%` : '0%'}</div>
            </div>
          </div>

          {/* Gráfico de Ecuación Contable */}
          <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h5 className="serif-font" style={{ fontSize: '1.05rem', margin: 0 }}>Ecuación Patrimonial de Gestión</h5>
              <span style={{ fontSize: '0.75rem', color: isBalanceSquared ? 'var(--emerald-accent)' : 'var(--danger-accent)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                {isBalanceSquared ? <><CheckCircle2 size={12} /> Balance consolidado</> : <><ShieldAlert size={12} /> Descuadre {formatCurrency(balanceDiff)}</>}
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
              El principio de partida doble exige que los <strong>Activos</strong> sean idénticos a los <strong>Pasivos + Patrimonio Neto</strong>.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              {/* Barra de progreso proporcional */}
              <div style={{ height: '24px', width: '100%', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-glass)', display: 'flex', overflow: 'hidden' }}>
                <div style={{ 
                  width: `${activoBarPct}%`, 
                  minWidth: totalActivos > 0 ? '12%' : 0,
                  background: 'linear-gradient(90deg, var(--emerald-accent) 0%, #0d9488 100%)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  fontSize: '0.72rem',
                  color: '#060e0a',
                  fontWeight: 'bold',
                  textShadow: '0 1px 2px rgba(255,255,255,0.2)'
                }}>
                  ACTIVO: {formatCurrency(totalActivos)}
                </div>
                <div style={{ 
                  width: `${pasivoBarPct}%`, 
                  minWidth: pasivoMasPatrimonio > 0 ? '12%' : 0,
                  background: 'linear-gradient(90deg, #b45309 0%, var(--primary-gold) 100%)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  fontSize: '0.72rem',
                  color: '#060e0a',
                  fontWeight: 'bold',
                  textShadow: '0 1px 2px rgba(255,255,255,0.2)'
                }}>
                  PASIVO + PN: {formatCurrency(pasivoMasPatrimonio)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }} className="responsive-form-grid">
            
            {/* COMPARATIVO DE FLUJOS (BARRAS SVG) */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '300px' }}>
              <h5 className="serif-font" style={{ fontSize: '1.1rem', color: 'var(--text-gold)', margin: 0 }}>Rendimiento: Ingresos vs Egresos</h5>
              
              {totalIngresos === 0 && totalGastos === 0 ? (
                <p style={{ margin: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Sin transacciones registradas</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', margin: 'auto 0', width: '100%' }}>
                  <div style={{ display: 'flex', gap: '2rem', height: '180px', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--border-glass)' }}>
                    
                    {/* Barra Ingresos */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--emerald-accent)' }}>
                        {formatCurrency(totalIngresos)}
                      </span>
                      <div style={{ 
                        width: '55px', 
                        height: `${Math.max(10, Math.min(130, (totalIngresos / Math.max(totalIngresos, totalGastos)) * 130))}px`, 
                        background: 'linear-gradient(to top, #065f46 0%, var(--emerald-accent) 100%)', 
                        borderRadius: '6px 6px 0 0',
                        boxShadow: 'var(--shadow-emerald-glow)',
                        transition: 'height 0.8s ease'
                      }} />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '600' }}>Ingresos</span>
                    </div>

                    {/* Barra Egresos */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--danger-accent)' }}>
                        {formatCurrency(totalGastos)}
                      </span>
                      <div style={{ 
                        width: '55px', 
                        height: `${Math.max(10, Math.min(130, (totalGastos / Math.max(totalIngresos, totalGastos)) * 130))}px`, 
                        background: 'linear-gradient(to top, #991b1b 0%, var(--danger-accent) 100%)', 
                        borderRadius: '6px 6px 0 0',
                        transition: 'height 0.8s ease'
                      }} />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '600' }}>Egresos</span>
                    </div>
                  </div>
                  
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Flujo Operativo Acumulado:</span>
                    <strong style={{ color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)' }}>
                      {utilidadNeta >= 0 ? 'Rentabilidad Positiva (Superávit)' : 'Déficit Financiero'}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            {/* DISTRIBUCIÓN DE EGRESOS (DONUT SVG) */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '300px' }}>
              <h5 className="serif-font" style={{ fontSize: '1.1rem', color: 'var(--text-gold)', margin: 0 }}>Distribución de Egresos por Cuenta</h5>

              {totalGastos === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: 'auto', gap: '0.5rem', color: 'var(--text-muted)' }}>
                  <ShieldAlert size={28} />
                  <p style={{ fontSize: '0.85rem' }}>Registre gastos operacionales en el Libro Diario</p>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', justifyContent: 'center', margin: 'auto 0', flexWrap: 'wrap' }}>
                  {/* SVG Donut */}
                  <div style={{ position: 'relative', width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg viewBox="0 0 100 100" width="120" height="120">
                      <circle cx="50" cy="50" r="38" stroke="rgba(255,255,255,0.015)" strokeWidth="12" fill="transparent" />
                      
                      {(() => {
                        let accumulatedFraction = 0;
                        const colors = ['#f59e0b', 'var(--primary-gold)', '#ec4899'];
                        
                        return ACCOUNT_PLAN.gastos.map((gAccount, idx) => {
                          const bal = getAccountBalance(gAccount);
                          const fraction = totalGastos > 0 ? bal / totalGastos : 0;
                          if (fraction === 0) return null;

                          const currentAccum = accumulatedFraction;
                          accumulatedFraction += fraction;
                          
                          const strokeColor = colors[idx % colors.length];
                          const isHovered = hoveredExpenseSegment === gAccount;

                          return (
                            <circle 
                              key={gAccount}
                              cx="50"
                              cy="50"
                              r="38"
                              stroke={strokeColor}
                              strokeWidth={isHovered ? 15 : 11}
                              fill="transparent"
                              strokeDasharray={`${fraction * 238.76} 238.76`}
                              strokeLinecap="round"
                              transform={`rotate(${-90 + currentAccum * 360} 50 50)`}
                              style={{ 
                                transition: 'stroke-width 0.2s ease, stroke-dashoffset 0.5s ease',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={() => setHoveredExpenseSegment(gAccount)}
                              onMouseLeave={() => setHoveredExpenseSegment(null)}
                            />
                          );
                        });
                      })()}
                    </svg>

                    {/* Donut Center text */}
                    <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', width: '80px' }}>
                      {hoveredExpenseSegment ? (
                        <>
                          <span style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--text-strong)', lineHeight: 1 }}>
                            {Math.round((getAccountBalance(hoveredExpenseSegment) / totalGastos) * 100)}%
                          </span>
                          <span style={{ fontSize: '0.52rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '0.15rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '65px' }}>
                            {hoveredExpenseSegment}
                          </span>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: '0.9rem', fontWeight: '800', color: 'var(--text-strong)', lineHeight: 1 }}>
                            {formatCurrency(totalGastos)}
                          </span>
                          <span style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Egresos</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Leyenda */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flexGrow: 1, minWidth: '150px' }}>
                    {(() => {
                      const colors = ['#f59e0b', 'var(--primary-gold)', '#ec4899'];
                      return ACCOUNT_PLAN.gastos.map((gAccount, idx) => {
                        const bal = getAccountBalance(gAccount);
                        const pct = totalGastos > 0 ? Math.round((bal / totalGastos) * 100) : 0;
                        const isHovered = hoveredExpenseSegment === gAccount;

                        return (
                          <div 
                            key={gAccount}
                            style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'space-between', 
                              fontSize: '0.78rem',
                              padding: '0.15rem 0.35rem',
                              borderRadius: '4px',
                              background: isHovered ? 'rgba(255,255,255,0.03)' : 'transparent',
                              transition: 'background 0.2s ease'
                            }}
                            onMouseEnter={() => setHoveredExpenseSegment(gAccount)}
                            onMouseLeave={() => setHoveredExpenseSegment(null)}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', maxWidth: '70%' }}>
                              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: colors[idx % colors.length], display: 'inline-block', flexShrink: 0 }} />
                              <span style={{ color: isHovered ? 'var(--text-strong)' : 'var(--text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                {gAccount}
                              </span>
                            </div>
                            <strong style={{ color: isHovered ? 'var(--primary-gold)' : 'var(--text-strong)', flexShrink: 0 }}>
                              {pct}%
                            </strong>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
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
          chartOfAccounts={chartOfAccounts}
          openRegister={openRegister}
          closeRegister={closeRegister}
          addCashMovement={addCashMovement}
          transferCash={transferCash}
        />
      )}

      {subTab === 'expenses' && submitExpense && (
        <ExpensesPanel
          expenses={expenses}
          chartOfAccounts={chartOfAccounts}
          submitExpense={submitExpense}
          setExpenseApproved={setExpenseApproved}
          setExpenseRejected={setExpenseRejected}
          setExpensePaid={setExpensePaid}
        />
      )}

      {subTab === 'suppliers' && upsertSupplier && (
        <SuppliersPanel
          suppliers={suppliers}
          upsertSupplier={upsertSupplier}
          toggleSupplierStatus={toggleSupplierStatus}
          expenses={expenses}
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

      {subTab === 'fixed_discounts' && addFixedDiscount && (
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
    </div>
  );
}

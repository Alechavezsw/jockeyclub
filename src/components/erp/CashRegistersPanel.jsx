import { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  LockOpen,
  Lock,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ClipboardCheck,
  Plus,
  RefreshCw,
  Eye,
  Printer,
  Trash2,
  Search,
  Landmark,
  Banknote,
  FolderOpen,
  CircleDollarSign,
} from 'lucide-react';
import { accountLabel } from '../../domain/accounting/chartOfAccounts';
import {
  getOpenSession,
  sessionExpectedBalance,
  counterpartAccountsForMovement,
  closedSessions,
  isLiquidAccount,
} from '../../domain/accounting/cash';
import {
  ACCESSIN_CASH_AS_OF,
  ACCESSIN_CASH_SNAPSHOT,
  ACCESSIN_CHEQUES,
  ACCESSIN_CHEQUES_AS_OF,
  accessinCashBalanceCards,
  enrichCashMovementsWithMembers,
  filterAccessinCashMovements,
  filterAccessinCheques,
  formatAccessinCashDate,
  recalculateAccessinCashTotal,
} from '../../domain/accounting/cashLedger';
import { formatCurrency } from '../../domain/accounting/journal';
import CashCobranzasSection from './CashCobranzasSection';
import CashBankAccountsSection from './CashBankAccountsSection';
import CashEfectivoRegistroSection from './CashEfectivoRegistroSection';
import CashSupplierPaymentsSection from './CashSupplierPaymentsSection';
import { ACCESSIN_COBRANZAS } from '../../domain/accounting/cobranzas';
import { ACCESSIN_SUPPLIER_PAYMENTS } from '../../domain/accounting/supplierPaymentsReport';
import { ACCESSIN_BANK_ACCOUNTS } from '../../domain/accounting/bankAccounts';

const PANEL_TABS = [
  { id: 'ledger', label: 'Saldo y movimientos' },
  { id: 'cobranzas', label: 'Cobranzas' },
  { id: 'supplier_payments', label: 'Pago a proveedores' },
  { id: 'moves', label: 'Operación' },
  { id: 'transfers', label: 'Traspasos' },
  { id: 'closures', label: 'Cierres' },
];

const DEFAULT_RELATED = {
  income: 'coa-4.1.01',
  expense: 'coa-5.1.04',
};

function moveTypeLabel(type) {
  if (type === 'income') return 'Ingreso';
  if (type === 'expense') return 'Egreso';
  if (type === 'transfer_in') return 'Traspaso entrada';
  if (type === 'transfer_out') return 'Traspaso salida';
  return type;
}

function moveTypeColor(type) {
  if (type === 'income' || type === 'transfer_in') return 'var(--emerald-accent)';
  if (type === 'expense' || type === 'transfer_out') return '#f59e0b';
  return 'var(--text-secondary)';
}

function CashBalanceIcon({ kind }) {
  if (kind === 'cash') return <Banknote size={22} />;
  if (kind === 'checks') return <FolderOpen size={22} />;
  if (kind === 'bank') return <Landmark size={22} />;
  return <CircleDollarSign size={22} />;
}

function formatCashAmount(value, { withArs = false } = {}) {
  const base = formatCurrency(value);
  return withArs ? `${base} (ARS)` : base;
}

export default function CashRegistersPanel({
  cashRegisters,
  cashSessions,
  cashMovements,
  accessinCashMovements = [],
  accessinCheques = ACCESSIN_CHEQUES,
  accessinCobranzas = ACCESSIN_COBRANZAS,
  accessinSupplierPayments = ACCESSIN_SUPPLIER_PAYMENTS,
  accessinBankAccounts = ACCESSIN_BANK_ACCOUNTS,
  upsertBankAccount,
  deleteBankAccount,
  addBankAccountEntry,
  chartOfAccounts,
  members = [],
  openRegister,
  closeRegister,
  addCashMovement,
  transferCash,
  onNavigate,
}) {
  const [selectedRegisterId, setSelectedRegisterId] = useState(cashRegisters[0]?.id || '');
  const [panelTab, setPanelTab] = useState('ledger');
  const [openingBalance, setOpeningBalance] = useState('50000');
  const [countedBalance, setCountedBalance] = useState('');
  const [moveForm, setMoveForm] = useState({
    movementType: 'income',
    amount: '',
    concept: '',
    relatedAccountId: DEFAULT_RELATED.income,
  });
  const [transferForm, setTransferForm] = useState({
    toAccountId: 'coa-1.1.03',
    amount: '',
    concept: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState({
    view: 'movements', // movements | cheques | efectivo_registro | bank_accounts
    walletKind: null,
    query: '',
    showAll: false,
  });
  const [recalcTotal, setRecalcTotal] = useState(null);

  const selectedRegister = cashRegisters.find((r) => r.id === selectedRegisterId);
  const openSession = useMemo(
    () => getOpenSession(cashSessions, selectedRegisterId),
    [cashSessions, selectedRegisterId]
  );

  const expected = openSession ? sessionExpectedBalance(openSession, cashMovements) : 0;
  const sessionMoves = cashMovements.filter((m) => openSession && m.cashSessionId === openSession.id);

  const enrichedLedger = useMemo(
    () => enrichCashMovementsWithMembers(accessinCashMovements, members),
    [accessinCashMovements, members]
  );

  const balanceCards = useMemo(() => {
    const cards = accessinCashBalanceCards(
      ACCESSIN_CASH_SNAPSHOT,
      enrichedLedger,
      accessinCheques,
      accessinBankAccounts
    );
    if (recalcTotal == null) return cards;
    return cards.map((c) => (c.id === 'total' ? { ...c, value: recalcTotal } : c));
  }, [enrichedLedger, accessinCheques, accessinBankAccounts, recalcTotal]);

  const chequeRows = useMemo(
    () => filterAccessinCheques(accessinCheques, {
      status: 'in_portfolio',
      query: ledgerFilter.query,
    }),
    [accessinCheques, ledgerFilter.query]
  );

  const ledgerRows = useMemo(() => {
    const limit = ledgerFilter.showAll ? null : 25;
    return filterAccessinCashMovements(enrichedLedger, {
      walletKind: ledgerFilter.walletKind,
      query: ledgerFilter.query,
      limit,
    });
  }, [enrichedLedger, ledgerFilter]);

  const relatedAccounts = useMemo(
    () =>
      counterpartAccountsForMovement(
        chartOfAccounts,
        moveForm.movementType,
        selectedRegister?.accountId
      ),
    [chartOfAccounts, moveForm.movementType, selectedRegister?.accountId]
  );

  const transferDestinations = useMemo(() => {
    const exclude = selectedRegister?.accountId;
    return (chartOfAccounts || []).filter(
      (a) => a.isPostable && isLiquidAccount(a) && a.id !== exclude
    );
  }, [chartOfAccounts, selectedRegister?.accountId]);

  const historyClosed = useMemo(
    () =>
      closedSessions(cashSessions).filter(
        (s) => !selectedRegisterId || s.cashRegisterId === selectedRegisterId
      ),
    [cashSessions, selectedRegisterId]
  );

  useEffect(() => {
    if (!relatedAccounts.length) return;
    const stillValid = relatedAccounts.some((a) => a.id === moveForm.relatedAccountId);
    if (!stillValid) {
      const fallback =
        relatedAccounts.find((a) => a.id === DEFAULT_RELATED[moveForm.movementType]) ||
        relatedAccounts[0];
      setMoveForm((f) => ({ ...f, relatedAccountId: fallback.id }));
    }
  }, [relatedAccounts, moveForm.movementType, moveForm.relatedAccountId]);

  useEffect(() => {
    if (!transferDestinations.length) return;
    const stillValid = transferDestinations.some((a) => a.id === transferForm.toAccountId);
    if (!stillValid) {
      setTransferForm((f) => ({ ...f, toAccountId: transferDestinations[0].id }));
    }
  }, [transferDestinations, transferForm.toAccountId]);

  const run = (fn) => {
    setError('');
    setMessage('');
    try {
      fn();
    } catch (err) {
      setError(err.message || 'Error en caja');
    }
  };

  const fieldGrid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '0.75rem',
    alignItems: 'end',
  };

  return (
    <div className="fade-in cash-lila-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h4 className="serif-font" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wallet size={18} /> Cajas
            <span className="suppliers-accessin-badge">Accessin · {formatAccessinCashDate(ACCESSIN_CASH_AS_OF)}</span>
          </h4>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Movimientos reales ({enrichedLedger.length}) · período {formatAccessinCashDate(ACCESSIN_CASH_SNAPSHOT.periodFrom)} → {formatAccessinCashDate(ACCESSIN_CASH_SNAPSHOT.periodTo)}.
          </p>
        </div>
        <div className="cash-lila-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const total = recalculateAccessinCashTotal(ACCESSIN_CASH_SNAPSHOT, enrichedLedger);
              setRecalcTotal(total);
              setMessage(`Balances recalculados · Total ${formatCurrency(total)}`);
              setPanelTab('ledger');
            }}
          >
            <RefreshCw size={14} /> Recalcular balances
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => (typeof onNavigate === 'function' ? onNavigate('other_incomes') : null)}
          >
            <Plus size={14} /> Entradas
          </button>
        </div>
      </div>

      <div className="cash-panel-tabs">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`cash-panel-tab${panelTab === tab.id ? ' is-active' : ''}`}
            onClick={() => setPanelTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</div>}
      {message && <div style={{ color: 'var(--emerald-accent)', fontSize: '0.9rem' }}>{message}</div>}

      {panelTab === 'ledger' && ledgerFilter.view === 'efectivo_registro' ? (
        <CashEfectivoRegistroSection
          movements={accessinCashMovements}
          cobranzas={accessinCobranzas}
          members={members}
          onBack={() => setLedgerFilter((f) => ({
            ...f,
            view: 'movements',
            walletKind: null,
            showAll: false,
            query: '',
          }))}
        />
      ) : null}

      {panelTab === 'ledger' && ledgerFilter.view === 'bank_accounts' ? (
        <CashBankAccountsSection
          accounts={accessinBankAccounts}
          movements={accessinCashMovements}
          members={members}
          onUpsert={(input) => {
            if (!upsertBankAccount) throw new Error('No se puede guardar la cuenta.');
            upsertBankAccount(input);
          }}
          onDelete={(id) => {
            if (!deleteBankAccount) throw new Error('No se puede eliminar la cuenta.');
            deleteBankAccount(id);
          }}
          onAddEntry={(accountId, entry) => {
            if (!addBankAccountEntry) throw new Error('No se puede registrar la entrada.');
            addBankAccountEntry(accountId, entry);
          }}
          onBack={() => setLedgerFilter((f) => ({
            ...f,
            view: 'movements',
            walletKind: null,
            showAll: false,
            query: '',
          }))}
        />
      ) : null}

      {panelTab === 'ledger' && ledgerFilter.view !== 'efectivo_registro' && ledgerFilter.view !== 'bank_accounts' && (
        <>
          <div className="cash-lila-balance-block">
            <div className="cash-lila-cards cash-lila-cards--lila">
              {balanceCards.filter((c) => c.id !== 'total').map((card) => (
                <div
                  key={card.id}
                  className={`cash-lila-card cash-lila-card--icon${card.muted ? ' is-muted' : ''}`}
                >
                  <div className="cash-lila-card-icon" aria-hidden>
                    <CashBalanceIcon kind={card.icon} />
                  </div>
                  <div className="cash-lila-card-main">
                    <div className={`cash-lila-card-value${card.muted ? ' is-muted' : ''}`}>
                      {formatCashAmount(card.value, { withArs: Boolean(card.currencyHint) })}
                    </div>
                    <div className="cash-lila-card-label">{card.label}</div>
                    {card.caption ? (
                      <div className="cash-lila-card-caption">{card.caption}</div>
                    ) : null}
                    {card.actionLabel ? (
                      <button
                        type="button"
                        className="cash-lila-card-btn"
                        onClick={() => setLedgerFilter((f) => ({
                          ...f,
                          view: card.filter?.view || 'movements',
                          walletKind: card.filter?.walletKind || null,
                          showAll: false,
                          query: '',
                        }))}
                      >
                        {card.actionLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {balanceCards.filter((c) => c.id === 'total').map((card) => (
              <div key={card.id} className="cash-lila-card cash-lila-card--icon cash-lila-card--total">
                <div className="cash-lila-card-icon" aria-hidden>
                  <CashBalanceIcon kind="total" />
                </div>
                <div className="cash-lila-card-main">
                  <div className="cash-lila-card-value is-total">
                    {formatCashAmount(card.value)}
                  </div>
                  <div className="cash-lila-card-label">{card.label}</div>
                  {card.caption ? (
                    <div className="cash-lila-card-caption">{card.caption}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.65rem' }}>
              <h5 className="cash-lila-section-title" style={{ margin: 0 }}>
                {ledgerFilter.view === 'cheques'
                  ? `Cheques en cartera · ${formatAccessinCashDate(ACCESSIN_CHEQUES_AS_OF)}`
                  : ledgerFilter.showAll
                    ? 'Movimientos de caja'
                    : 'Últimos movimientos de caja'}
              </h5>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {(ledgerFilter.walletKind || ledgerFilter.view === 'cheques') ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setLedgerFilter((f) => ({
                      ...f,
                      view: 'movements',
                      walletKind: null,
                      showAll: false,
                    }))}
                  >
                    Volver a movimientos
                  </button>
                ) : null}
                <label className="cash-lila-search">
                  <Search size={14} />
                  <input
                    className="form-input"
                    placeholder={ledgerFilter.view === 'cheques' ? 'Buscar n°, banco, librador…' : 'Buscar socio, tipo, #'}
                    value={ledgerFilter.query}
                    onChange={(e) => setLedgerFilter((f) => ({ ...f, query: e.target.value }))}
                  />
                </label>
              </div>
            </div>

            {ledgerFilter.view === 'cheques' ? (
              <div className="table-responsive">
                <table className="admin-table cash-lila-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>N° cheque</th>
                      <th>Banco</th>
                      <th>Sucursal</th>
                      <th>Librador</th>
                      <th>Quién entrega</th>
                      <th>Entrada</th>
                      <th>Vencimiento</th>
                      <th>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chequeRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ color: 'var(--text-muted)' }}>
                          Sin cheques en cartera al {formatAccessinCashDate(ACCESSIN_CHEQUES_AS_OF)} (Accessin/LILA).
                        </td>
                      </tr>
                    ) : (
                      chequeRows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.accessinId}</td>
                          <td>{row.checkNumber || '—'}</td>
                          <td>{row.bankName || '—'}</td>
                          <td>{row.bankBranch || '—'}</td>
                          <td>{row.drawer || '—'}</td>
                          <td>{row.deliveredBy || '—'}</td>
                          <td>{formatAccessinCashDate(row.enteredAt)}</td>
                          <td>{formatAccessinCashDate(row.dueAt)}</td>
                          <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>
                            {formatCurrency(row.amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <div className="table-responsive">
                  <table className="admin-table cash-lila-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Descripción</th>
                        <th>Socio</th>
                        <th>Grupo familiar</th>
                        <th>Monto</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ color: 'var(--text-muted)' }}>
                            No hay movimientos con este filtro.
                          </td>
                        </tr>
                      ) : (
                        ledgerRows.map((row) => (
                          <tr key={row.id}>
                            <td>{row.accessinId}</td>
                            <td>{formatAccessinCashDate(row.date)}</td>
                            <td>{row.typeLabel}</td>
                            <td>{row.description || '—'}</td>
                            <td>{row.memberName || '—'}</td>
                            <td>{row.familyGroup || '—'}</td>
                            <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>
                              {formatCashAmount(row.amount, { withArs: true })}
                            </td>
                            <td>
                              <div className="cash-lila-row-actions">
                                <button type="button" className="cash-lila-icon-btn is-print" title="Recibo" aria-label="Recibo">
                                  <Printer size={13} />
                                </button>
                                <button type="button" className="cash-lila-icon-btn is-view" title="Ver" aria-label="Ver">
                                  <Eye size={13} />
                                </button>
                                <button type="button" className="cash-lila-icon-btn is-del" title="Eliminar" aria-label="Eliminar" disabled>
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {!ledgerFilter.showAll ? (
                  <button
                    type="button"
                    className="cash-lila-see-all"
                    onClick={() => setLedgerFilter((f) => ({ ...f, showAll: true }))}
                  >
                    Ver todos los movimientos de caja
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: '0.65rem' }}
                    onClick={() => setLedgerFilter((f) => ({ ...f, showAll: false }))}
                  >
                    Ver solo últimos 25
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {panelTab === 'cobranzas' && (
        <CashCobranzasSection items={accessinCobranzas} />
      )}

      {panelTab === 'supplier_payments' && (
        <CashSupplierPaymentsSection items={accessinSupplierPayments} />
      )}

      {panelTab !== 'ledger' && panelTab !== 'cobranzas' && panelTab !== 'supplier_payments' && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {cashRegisters.map((reg) => {
            const open = getOpenSession(cashSessions, reg.id);
            const bal = open ? sessionExpectedBalance(open, cashMovements) : null;
            return (
              <button
                key={reg.id}
                type="button"
                className="btn btn-sm"
                style={{
                  border: selectedRegisterId === reg.id ? '1px solid var(--text-gold)' : '1px solid var(--border-glass)',
                  background: selectedRegisterId === reg.id ? 'rgba(212,175,55,0.12)' : 'transparent',
                }}
                onClick={() => setSelectedRegisterId(reg.id)}
              >
                {reg.name}
                {open ? ` · ${formatCurrency(bal)}` : ' · cerrada'}
              </button>
            );
          })}
        </div>
      )}

      {!openSession && panelTab !== 'closures' && panelTab !== 'ledger' && panelTab !== 'cobranzas' && panelTab !== 'supplier_payments' ? (
        <div
          style={{
            border: '1px solid var(--border-glass)',
            borderRadius: 12,
            padding: '1rem',
            ...fieldGrid,
          }}
        >
          <div>
            <label className="form-label">Saldo de apertura</label>
            <input
              className="form-input"
              type="number"
              min="0"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
          </div>
          <div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() =>
                run(() => {
                  openRegister(selectedRegisterId, openingBalance);
                  setMessage('Caja abierta correctamente.');
                  setPanelTab('moves');
                })
              }
            >
              <LockOpen size={16} /> Abrir caja
            </button>
          </div>
        </div>
      ) : null}

      {openSession && panelTab !== 'ledger' && panelTab !== 'cobranzas' && panelTab !== 'supplier_payments' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <div className="glass-card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Apertura</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{formatCurrency(openSession.openingBalance)}</div>
          </div>
          <div className="glass-card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Saldo esperado</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-gold)' }}>{formatCurrency(expected)}</div>
          </div>
          <div className="glass-card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Movimientos sesión</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{sessionMoves.length}</div>
          </div>
        </div>
      )}

      {panelTab === 'moves' && openSession && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => {
                addCashMovement({
                  cashRegisterId: selectedRegisterId,
                  ...moveForm,
                  amount: moveForm.amount,
                });
                setMoveForm((f) => ({ ...f, amount: '', concept: '' }));
                setMessage('Movimiento registrado y asiento generado.');
              });
            }}
            style={{
              border: '1px solid var(--border-glass)',
              borderRadius: 12,
              padding: '1rem',
              ...fieldGrid,
            }}
          >
            <div>
              <label className="form-label">Tipo</label>
              <select
                className="form-input"
                value={moveForm.movementType}
                onChange={(e) => setMoveForm({ ...moveForm, movementType: e.target.value })}
              >
                <option value="income">Ingreso</option>
                <option value="expense">Egreso</option>
              </select>
            </div>
            <div>
              <label className="form-label">Importe</label>
              <input
                className="form-input"
                type="number"
                min="1"
                required
                value={moveForm.amount}
                onChange={(e) => setMoveForm({ ...moveForm, amount: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label">
                {moveForm.movementType === 'income'
                  ? 'Ingresos y pasivos (cobros / débitos).'
                  : 'Cuenta contrapartida'}
              </label>
              <select
                className="form-input"
                value={moveForm.relatedAccountId}
                onChange={(e) => setMoveForm({ ...moveForm, relatedAccountId: e.target.value })}
              >
                {relatedAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{accountLabel(a)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Concepto</label>
              <input
                className="form-input"
                required
                value={moveForm.concept}
                onChange={(e) => setMoveForm({ ...moveForm, concept: e.target.value })}
              />
            </div>
            <div>
              <button type="submit" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {moveForm.movementType === 'income' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                Registrar
              </button>
            </div>
          </form>

          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Concepto</th>
                  <th>Importe</th>
                  <th>Hora</th>
                </tr>
              </thead>
              <tbody>
                {sessionMoves.length === 0 ? (
                  <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>Sin movimientos en esta sesión.</td></tr>
                ) : (
                  sessionMoves.map((m) => (
                    <tr key={m.id}>
                      <td style={{ color: moveTypeColor(m.movementType) }}>{moveTypeLabel(m.movementType)}</td>
                      <td>{m.concept}</td>
                      <td>{formatCurrency(m.amount)}</td>
                      <td>{m.createdAt ? new Date(m.createdAt).toLocaleTimeString('es-AR') : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <div>
              <label className="form-label">Saldo contado</label>
              <input
                className="form-input"
                type="number"
                value={countedBalance}
                onChange={(e) => setCountedBalance(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() =>
                run(() => {
                  closeRegister(selectedRegisterId, countedBalance);
                  setCountedBalance('');
                  setMessage('Caja cerrada.');
                })
              }
            >
              <Lock size={16} /> Cerrar caja
            </button>
          </div>
        </>
      )}

      {panelTab === 'transfers' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => {
              transferCash({
                fromRegisterId: selectedRegisterId,
                toAccountId: transferForm.toAccountId,
                amount: transferForm.amount,
                concept: transferForm.concept,
              });
              setTransferForm((f) => ({ ...f, amount: '', concept: '' }));
              setMessage('Traspaso registrado.');
            });
          }}
          style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', ...fieldGrid }}
        >
          <div>
            <label className="form-label">Destino</label>
            <select
              className="form-input"
              value={transferForm.toAccountId}
              onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })}
            >
              {transferDestinations.map((a) => (
                <option key={a.id} value={a.id}>{accountLabel(a)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Importe</label>
            <input
              className="form-input"
              type="number"
              min="1"
              required
              value={transferForm.amount}
              onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Concepto</label>
            <input
              className="form-input"
              value={transferForm.concept}
              onChange={(e) => setTransferForm({ ...transferForm, concept: e.target.value })}
            />
          </div>
          <div>
            <button type="submit" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ArrowLeftRight size={14} /> Traspasar
            </button>
          </div>
        </form>
      )}

      {panelTab === 'closures' && (
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Caja</th>
                <th>Cierre</th>
                <th>Esperado</th>
                <th>Contado</th>
                <th>Dif.</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {historyClosed.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                    <ClipboardCheck size={14} style={{ marginRight: 6 }} />
                    Sin cierres registrados.
                  </td>
                </tr>
              ) : (
                historyClosed.map((s) => {
                  const reg = cashRegisters.find((r) => r.id === s.cashRegisterId);
                  return (
                    <tr key={s.id}>
                      <td>{reg?.name || s.cashRegisterId}</td>
                      <td>{s.closedAt ? new Date(s.closedAt).toLocaleString('es-AR') : '—'}</td>
                      <td>{formatCurrency(s.expectedBalance)}</td>
                      <td>{formatCurrency(s.countedBalance)}</td>
                      <td style={{ color: Math.abs(s.difference || 0) > 0.01 ? '#f59e0b' : 'var(--emerald-accent)' }}>
                        {formatCurrency(s.difference)}
                      </td>
                      <td>{s.status}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

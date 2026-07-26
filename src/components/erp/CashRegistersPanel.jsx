import { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  LockOpen,
  Lock,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ClipboardCheck,
} from 'lucide-react';
import { accountLabel } from '../../domain/accounting/chartOfAccounts';
import {
  getOpenSession,
  sessionExpectedBalance,
  counterpartAccountsForMovement,
  closedSessions,
  isLiquidAccount,
} from '../../domain/accounting/cash';
import { formatCurrency } from '../../domain/accounting/journal';

const PANEL_TABS = [
  { id: 'moves', label: 'Movimientos' },
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

export default function CashRegistersPanel({
  cashRegisters,
  cashSessions,
  cashMovements,
  chartOfAccounts,
  openRegister,
  closeRegister,
  addCashMovement,
  transferCash,
}) {
  const [selectedRegisterId, setSelectedRegisterId] = useState(cashRegisters[0]?.id || '');
  const [panelTab, setPanelTab] = useState('moves');
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

  const selectedRegister = cashRegisters.find((r) => r.id === selectedRegisterId);
  const openSession = useMemo(
    () => getOpenSession(cashSessions, selectedRegisterId),
    [cashSessions, selectedRegisterId]
  );

  const expected = openSession ? sessionExpectedBalance(openSession, cashMovements) : 0;
  const sessionMoves = cashMovements.filter((m) => openSession && m.cashSessionId === openSession.id);

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
      setError(err.message || 'Error operativo de caja');
    }
  };

  const fieldGrid = {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    alignItems: 'end',
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Wallet size={18} /> Cajas y Arqueos
        </h4>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Apertura, movimientos, traspasos y cierres con impacto en asientos contables.
        </p>
      </div>

      <div className="cash-register-grid">
        {cashRegisters.map((reg) => {
          const open = getOpenSession(cashSessions, reg.id);
          const bal = open ? sessionExpectedBalance(open, cashMovements) : null;
          const selected = selectedRegisterId === reg.id;
          return (
            <button
              key={reg.id}
              type="button"
              className={`cash-register-card${selected ? ' is-selected' : ''}${open ? ' is-open' : ''}`}
              onClick={() => setSelectedRegisterId(reg.id)}
            >
              <div className="cash-register-card__top">
                <span className="cash-register-card__code">{reg.code}</span>
                <span className={`cash-register-card__badge${open ? ' is-open' : ''}`}>
                  {open ? 'Abierta' : 'Cerrada'}
                </span>
              </div>
              <strong className="cash-register-card__name">{reg.name}</strong>
              <span className="cash-register-card__meta">{reg.location || 'Sede Rivadavia'}</span>
              <span className="cash-register-card__balance">
                {open ? formatCurrency(bal) : 'Sin sesión'}
              </span>
            </button>
          );
        })}
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

      {!openSession && panelTab !== 'closures' ? (
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

      {openSession && (
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
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Movimientos</div>
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
                onChange={(e) => {
                  const movementType = e.target.value;
                  const nextAccounts = counterpartAccountsForMovement(
                    chartOfAccounts,
                    movementType,
                    selectedRegister?.accountId
                  );
                  const nextRelated =
                    nextAccounts.find((a) => a.id === DEFAULT_RELATED[movementType])?.id ||
                    nextAccounts[0]?.id ||
                    '';
                  setMoveForm({ ...moveForm, movementType, relatedAccountId: nextRelated });
                }}
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
              <label className="form-label">Cuenta contrapartida</label>
              <select
                className="form-input"
                value={moveForm.relatedAccountId}
                onChange={(e) => setMoveForm({ ...moveForm, relatedAccountId: e.target.value })}
                required
              >
                {relatedAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountLabel(a)}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {moveForm.movementType === 'income'
                  ? 'Ingresos y pasivos (cobros / débitos).'
                  : 'Gastos y pasivos (pagos).'}
              </p>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Concepto</label>
              <input
                className="form-input"
                required
                value={moveForm.concept}
                onChange={(e) => setMoveForm({ ...moveForm, concept: e.target.value })}
                placeholder="Cobro cuota / pago proveedor..."
              />
            </div>
            <div>
              <button type="submit" className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {moveForm.movementType === 'income' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                Registrar movimiento
              </button>
            </div>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h5 style={{ color: 'var(--text-gold)' }}>Movimientos de la sesión</h5>
            {sessionMoves.length === 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Sin movimientos aún.</p>
            )}
            {sessionMoves.map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '0.75rem',
                  padding: '0.65rem 0.85rem',
                  border: '1px solid var(--border-glass)',
                  borderRadius: 10,
                  fontSize: '0.85rem',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong style={{ color: moveTypeColor(m.movementType) }}>{moveTypeLabel(m.movementType)}</strong>
                  <div>{m.concept}</div>
                </div>
                <strong style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatCurrency(m.amount)}</strong>
              </div>
            ))}
          </div>
        </>
      )}

      {panelTab === 'transfers' && openSession && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!transferCash) {
              setError('Traspasos no disponibles.');
              return;
            }
            run(() => {
              transferCash({
                fromRegisterId: selectedRegisterId,
                toAccountId: transferForm.toAccountId,
                amount: transferForm.amount,
                concept: transferForm.concept,
              });
              setTransferForm((f) => ({ ...f, amount: '', concept: '' }));
              setMessage('Traspaso registrado. Asiento y movimientos actualizados.');
            });
          }}
          style={{
            border: '1px solid var(--border-glass)',
            borderRadius: 12,
            padding: '1rem',
            ...fieldGrid,
          }}
        >
          <div style={{ gridColumn: '1 / -1', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Mueve fondos desde <strong>{selectedRegister?.name}</strong> hacia otra caja o banco.
            Si la caja destino está abierta, el ingreso queda en su sesión.
          </div>
          <div>
            <label className="form-label">Destino</label>
            <select
              className="form-input"
              value={transferForm.toAccountId}
              onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })}
              required
            >
              {transferDestinations.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
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
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Concepto</label>
            <input
              className="form-input"
              value={transferForm.concept}
              onChange={(e) => setTransferForm({ ...transferForm, concept: e.target.value })}
              placeholder="Depósito a banco / remesa a cantina..."
            />
          </div>
          <div>
            <button type="submit" className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ArrowLeftRight size={14} /> Registrar traspaso
            </button>
          </div>
        </form>
      )}

      {panelTab === 'closures' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {openSession && (
            <div
              style={{
                border: '1px solid var(--border-glass)',
                borderRadius: 12,
                padding: '1rem',
                ...fieldGrid,
              }}
            >
              <div>
                <label className="form-label">Arqueo — efectivo contado</label>
                <input
                  className="form-input"
                  type="number"
                  value={countedBalance}
                  onChange={(e) => setCountedBalance(e.target.value)}
                  placeholder={String(expected)}
                />
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Esperado: {formatCurrency(expected)}. Vacío = cierra con ese saldo.
                </p>
              </div>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() =>
                    run(() => {
                      const counted = countedBalance === '' ? expected : countedBalance;
                      closeRegister(openSession.id, counted);
                      setCountedBalance('');
                      setMessage('Caja cerrada. Revise el historial si hubo diferencia.');
                    })
                  }
                >
                  <Lock size={16} /> Cerrar / Arquear
                </button>
              </div>
            </div>
          )}

          <div>
            <h5 style={{ marginBottom: '0.5rem', color: 'var(--text-gold)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ClipboardCheck size={16} /> Historial de cierres
            </h5>
            {historyClosed.length === 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Aún no hay cierres para esta caja.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {historyClosed.map((s) => {
                const reg = cashRegisters.find((r) => r.id === s.cashRegisterId);
                const ok = s.status === 'closed';
                return (
                  <div
                    key={s.id}
                    style={{
                      fontSize: '0.82rem',
                      padding: '0.7rem 0.85rem',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid var(--border-glass)',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                      gap: '0.5rem',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong>{reg?.name}</strong>
                      <div style={{ color: 'var(--text-muted)' }}>
                        {s.closedAt
                          ? new Date(s.closedAt).toLocaleString('es-AR')
                          : new Date(s.openedAt).toLocaleString('es-AR')}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Esperado</div>
                      {formatCurrency(s.expectedBalance ?? 0)}
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Contado</div>
                      {formatCurrency(s.countedBalance ?? 0)}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ color: ok ? 'var(--emerald-accent)' : '#ef4444', fontWeight: 600 }}>
                        {ok ? 'OK' : `Diff ${formatCurrency(s.difference ?? 0)}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

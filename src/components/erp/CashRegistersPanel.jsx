import { useMemo, useState } from 'react';
import { Wallet, LockOpen, Lock, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { getPostableAccounts, accountLabel } from '../../domain/accounting/chartOfAccounts';
import { getOpenSession, sessionExpectedBalance } from '../../domain/accounting/cash';
import { formatCurrency } from '../../domain/accounting/journal';

export default function CashRegistersPanel({
  cashRegisters,
  cashSessions,
  cashMovements,
  chartOfAccounts,
  openRegister,
  closeRegister,
  addCashMovement,
}) {
  const [selectedRegisterId, setSelectedRegisterId] = useState(cashRegisters[0]?.id || '');
  const [openingBalance, setOpeningBalance] = useState('50000');
  const [countedBalance, setCountedBalance] = useState('');
  const [moveForm, setMoveForm] = useState({
    movementType: 'income',
    amount: '',
    concept: '',
    relatedAccountId: 'coa-4.1.01',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const openSession = useMemo(
    () => getOpenSession(cashSessions, selectedRegisterId),
    [cashSessions, selectedRegisterId]
  );

  const expected = openSession ? sessionExpectedBalance(openSession, cashMovements) : 0;
  const sessionMoves = cashMovements.filter((m) => openSession && m.cashSessionId === openSession.id);
  const relatedAccounts = getPostableAccounts(chartOfAccounts).filter((a) => !a.isCashAccount);

  const run = (fn) => {
    setError('');
    setMessage('');
    try {
      fn();
    } catch (err) {
      setError(err.message || 'Error operativo de caja');
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Wallet size={18} /> Cajas y Arqueos
        </h4>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Apertura, movimientos e impacto automático en asientos contables.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {cashRegisters.map((reg) => {
          const open = getOpenSession(cashSessions, reg.id);
          return (
            <button
              key={reg.id}
              type="button"
              className={`filter-btn ${selectedRegisterId === reg.id ? 'active' : ''}`}
              onClick={() => setSelectedRegisterId(reg.id)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 180 }}
            >
              <span style={{ fontWeight: 600 }}>{reg.name}</span>
              <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>
                {reg.code} · {open ? 'ABIERTA' : 'Cerrada'}
              </span>
            </button>
          );
        })}
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</div>}
      {message && <div style={{ color: 'var(--emerald-accent)', fontSize: '0.9rem' }}>{message}</div>}

      {!openSession ? (
        <div style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label className="form-label">Saldo de apertura</label>
            <input className="form-input" type="number" min="0" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() =>
              run(() => {
                openRegister(selectedRegisterId, openingBalance);
                setMessage('Caja abierta correctamente.');
              })
            }
          >
            <LockOpen size={16} /> Abrir caja
          </button>
        </div>
      ) : (
        <>
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
            style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
          >
            <div>
              <label className="form-label">Tipo</label>
              <select className="form-input" value={moveForm.movementType} onChange={(e) => setMoveForm({ ...moveForm, movementType: e.target.value })}>
                <option value="income">Ingreso</option>
                <option value="expense">Egreso</option>
              </select>
            </div>
            <div>
              <label className="form-label">Importe</label>
              <input className="form-input" type="number" min="1" required value={moveForm.amount} onChange={(e) => setMoveForm({ ...moveForm, amount: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Cuenta contrapartida</label>
              <select className="form-input" value={moveForm.relatedAccountId} onChange={(e) => setMoveForm({ ...moveForm, relatedAccountId: e.target.value })}>
                {relatedAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{accountLabel(a)}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Concepto</label>
              <input className="form-input" required value={moveForm.concept} onChange={(e) => setMoveForm({ ...moveForm, concept: e.target.value })} placeholder="Cobro cuota / pago proveedor..." />
            </div>
            <div>
              <button type="submit" className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {moveForm.movementType === 'income' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                Registrar movimiento
              </button>
            </div>
          </form>

          <div style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <div>
              <label className="form-label">Arqueo — efectivo contado</label>
              <input className="form-input" type="number" value={countedBalance} onChange={(e) => setCountedBalance(e.target.value)} placeholder={String(expected)} />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() =>
                run(() => {
                  closeRegister(openSession.id, countedBalance === '' ? expected : countedBalance);
                  setCountedBalance('');
                  setMessage('Caja cerrada. Revise diferencia si hubo discrepancia.');
                })
              }
            >
              <Lock size={16} /> Cerrar / Arquear
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h5 style={{ color: 'var(--text-gold)' }}>Movimientos de la sesión</h5>
            {sessionMoves.length === 0 && <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Sin movimientos aún.</p>}
            {sessionMoves.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.65rem 0.85rem', border: '1px solid var(--border-glass)', borderRadius: 10, fontSize: '0.85rem' }}>
                <div>
                  <strong style={{ textTransform: 'uppercase', color: m.movementType === 'income' ? 'var(--emerald-accent)' : '#f59e0b' }}>{m.movementType}</strong>
                  <div>{m.concept}</div>
                </div>
                <strong>{formatCurrency(m.amount)}</strong>
              </div>
            ))}
          </div>
        </>
      )}

      <div>
        <h5 style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Historial de sesiones</h5>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {cashSessions.slice(0, 8).map((s) => {
            const reg = cashRegisters.find((r) => r.id === s.cashRegisterId);
            return (
              <div key={s.id} style={{ fontSize: '0.8rem', padding: '0.55rem 0.75rem', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>{reg?.name} · {new Date(s.openedAt).toLocaleString('es-AR')}</span>
                <span style={{ color: s.status === 'open' ? 'var(--emerald-accent)' : s.status === 'discrepancy' ? '#ef4444' : 'var(--text-muted)' }}>
                  {s.status === 'open' ? 'Abierta' : s.status === 'discrepancy' ? `Cerrada (diff ${formatCurrency(s.difference)})` : 'Cerrada OK'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

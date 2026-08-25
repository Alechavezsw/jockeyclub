import { useMemo, useState } from 'react';
import {
  HelpCircle, Building2, Repeat, Percent, Scale, FileSpreadsheet,
  Plus, Check, X,
} from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  UNIDENTIFIED_STATUS,
  DEBIT_STATUS,
  PAYMENT_ORDER_STATUS,
  createUnidentifiedCollection,
  matchUnidentifiedCollection,
  rejectUnidentifiedCollection,
  createGaliciaDebit,
  setGaliciaDebitStatus,
  createFixedExpense,
  createFixedDiscount,
  createPaymentOrder,
  setPaymentOrderStatus,
} from '../../domain/accounting/treasury';

function PanelShell({ icon: Icon, title, subtitle, children, actions }) {
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h4 className="serif-font" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon size={18} /> {title}
          </h4>
          {subtitle && <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div className="glass-card" style={{ padding: '0.8rem 1rem' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

/** 1) Cobranzas sin identificar */
export function UnidentifiedCollectionsPanel({ items = [], members = [], onAdd, onMatch, onReject }) {
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', bankRef: '', originLabel: 'Transferencia', note: '' });
  const [matchMap, setMatchMap] = useState({});
  const [error, setError] = useState('');

  const pending = items.filter((i) => i.status === 'pending');
  const pendingTotal = pending.reduce((s, i) => s + (i.amount || 0), 0);

  const submit = (e) => {
    e.preventDefault();
    setError('');
    try {
      onAdd(createUnidentifiedCollection(form));
      setForm((f) => ({ ...f, amount: '', bankRef: '', note: '' }));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <PanelShell
      icon={HelpCircle}
      title="Cobranzas sin identificar"
      subtitle="Pagos bancarios o MP que aún no están asociados a un socio."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
        <MiniStat label="Pendientes" value={pending.length} color="#f59e0b" />
        <MiniStat label="Monto a identificar" value={formatCurrency(pendingTotal)} color="#f59e0b" />
      </div>

      <form onSubmit={submit} style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', border: '1px solid var(--border-glass)', borderRadius: 12, padding: '0.9rem' }}>
        <div><label className="form-label">Fecha</label><input type="date" className="form-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        <div><label className="form-label">Importe</label><input type="number" min="1" required className="form-input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
        <div><label className="form-label">Referencia</label><input className="form-input" value={form.bankRef} onChange={(e) => setForm({ ...form, bankRef: e.target.value })} /></div>
        <div><label className="form-label">Origen</label><input className="form-input" value={form.originLabel} onChange={(e) => setForm({ ...form, originLabel: e.target.value })} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label className="form-label">Nota</label><input className="form-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
        <div><button type="submit" className="btn btn-primary btn-sm"><Plus size={14} /> Registrar cobranza</button></div>
      </form>
      {error && <p style={{ color: '#ef4444', margin: 0 }}>{error}</p>}

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr><th>Fecha</th><th>Origen</th><th>Ref.</th><th>Importe</th><th>Estado</th><th>Identificar</th></tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                  No hay cobranzas guardadas. Las altas se sincronizan con la base (no se pierden al refrescar).
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.date}</td>
                <td>
                  <strong>{item.originLabel}</strong>
                  {item.note && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.note}</div>}
                </td>
                <td>{item.bankRef}</td>
                <td style={{ fontWeight: 700 }}>{formatCurrency(item.amount)}</td>
                <td>{UNIDENTIFIED_STATUS[item.status] || item.status}</td>
                <td>
                  {item.status === 'pending' ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select
                        className="form-input"
                        style={{ minWidth: 160, padding: '0.35rem 0.5rem' }}
                        value={matchMap[item.id] || ''}
                        onChange={(e) => setMatchMap((m) => ({ ...m, [item.id]: e.target.value }))}
                      >
                        <option value="">Socio…</option>
                        {members.map((m) => <option key={m.memberId} value={m.memberId}>{m.name}</option>)}
                      </select>
                      <button type="button" className="btn btn-sm" style={{ color: 'var(--emerald-accent)' }} onClick={() => { try { onMatch(matchUnidentifiedCollection(item, matchMap[item.id])); } catch (err) { setError(err.message); } }}>
                        <Check size={13} />
                      </button>
                      <button type="button" className="btn btn-sm" style={{ color: '#fca5a5' }} onClick={() => onReject(rejectUnidentifiedCollection(item, 'No identificable'))}>
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {item.matchedMemberId || '—'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}

/** 2) Débitos automáticos Galicia */
export function GaliciaDebitsPanel({ items = [], members = [], onAdd, onSetStatus }) {
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const totals = useMemo(() => ({
    scheduled: items.filter((i) => i.status === 'scheduled').length,
    sent: items.filter((i) => i.status === 'sent').length,
    amount: items.filter((i) => i.status !== 'rejected').reduce((s, i) => s + i.amount, 0),
  }), [items]);

  const submit = (e) => {
    e.preventDefault();
    setError('');
    const member = members.find((m) => m.memberId === memberId);
    try {
      onAdd(createGaliciaDebit({
        memberId,
        memberName: member?.name || '',
        amount,
        cbuMask: '****Galicia',
      }));
      setMemberId('');
      setAmount('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <PanelShell
      icon={Building2}
      title="Débitos Aut. Galicia"
      subtitle="Adhesiones y lote de débitos automáticos del período."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
        <MiniStat label="Programados" value={totals.scheduled} />
        <MiniStat label="Enviados" value={totals.sent} color="#818cf8" />
        <MiniStat label="Importe lote" value={formatCurrency(totals.amount)} />
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ minWidth: 220 }}>
          <label className="form-label">Socio</label>
          <select className="form-input" value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
            <option value="">Seleccionar…</option>
            {members.map((m) => <option key={m.memberId} value={m.memberId}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Importe</label>
          <input type="number" min="1" className="form-input" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary btn-sm"><Plus size={14} /> Agregar al lote</button>
      </form>
      {error && <p style={{ color: '#ef4444', margin: 0 }}>{error}</p>}

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr><th>Período</th><th>Socio</th><th>CBU</th><th>Importe</th><th>Estado</th><th>Gestión</th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.period}</td>
                <td><strong>{item.memberName}</strong><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.memberId}</div></td>
                <td>{item.cbuMask}</td>
                <td style={{ fontWeight: 700 }}>{formatCurrency(item.amount)}</td>
                <td>{DEBIT_STATUS[item.status]}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {item.status === 'scheduled' && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSetStatus(setGaliciaDebitStatus(item, 'sent'))}>Enviar</button>
                  )}
                  {item.status === 'sent' && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSetStatus(setGaliciaDebitStatus(item, 'settled'))}>Acreditar</button>
                  )}
                  {item.status !== 'rejected' && item.status !== 'settled' && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => onSetStatus(setGaliciaDebitStatus(item, 'rejected'))}>Rechazar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}

/** 3) Gastos fijos */
export function FixedExpensesPanel({ items = [], onAdd, onToggle }) {
  const [form, setForm] = useState({ name: '', vendorName: '', amount: '', dayOfMonth: 10, accountHint: 'Servicios e Insumos' });
  const [error, setError] = useState('');
  const monthly = items.filter((i) => i.active).reduce((s, i) => s + i.amount, 0);

  const submit = (e) => {
    e.preventDefault();
    setError('');
    try {
      onAdd(createFixedExpense(form));
      setForm({ name: '', vendorName: '', amount: '', dayOfMonth: 10, accountHint: 'Servicios e Insumos' });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <PanelShell icon={Repeat} title="Gastos Fijos" subtitle="Erogaciones recurrentes mensuales del club.">
      <MiniStat label="Carga mensual activa" value={formatCurrency(monthly)} color="#f59e0b" />
      <form onSubmit={submit} style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', border: '1px solid var(--border-glass)', borderRadius: 12, padding: '0.9rem' }}>
        <div><label className="form-label">Nombre</label><input className="form-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="form-label">Proveedor</label><input className="form-input" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} /></div>
        <div><label className="form-label">Importe</label><input type="number" min="1" required className="form-input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
        <div><label className="form-label">Día de mes</label><input type="number" min="1" max="28" className="form-input" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })} /></div>
        <div><label className="form-label">Cuenta</label><input className="form-input" value={form.accountHint} onChange={(e) => setForm({ ...form, accountHint: e.target.value })} /></div>
        <div style={{ alignSelf: 'end' }}><button type="submit" className="btn btn-primary btn-sm"><Plus size={14} /> Alta</button></div>
      </form>
      {error && <p style={{ color: '#ef4444', margin: 0 }}>{error}</p>}
      <div className="table-responsive">
        <table className="admin-table">
          <thead><tr><th>Concepto</th><th>Proveedor</th><th>Día</th><th>Importe</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.accountHint}</div></td>
                <td>{item.vendorName || '—'}</td>
                <td>{item.dayOfMonth}</td>
                <td style={{ fontWeight: 700 }}>{formatCurrency(item.amount)}</td>
                <td>{item.active ? 'Activo' : 'Pausado'}</td>
                <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => onToggle(item.id)}>{item.active ? 'Pausar' : 'Activar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}

/** 4) Descuentos fijos */
export function FixedDiscountsPanel({ items = [], onAdd, onToggle }) {
  const [form, setForm] = useState({ name: '', percent: '', appliesTo: 'general' });
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    setError('');
    try {
      onAdd(createFixedDiscount(form));
      setForm({ name: '', percent: '', appliesTo: 'general' });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <PanelShell icon={Percent} title="Descuentos Fijos" subtitle="Bonificaciones estructurales sobre cuotas sociales.">
      <form onSubmit={submit} style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', border: '1px solid var(--border-glass)', borderRadius: 12, padding: '0.9rem' }}>
        <div><label className="form-label">Nombre</label><input className="form-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="form-label">%</label><input type="number" min="0" max="100" required className="form-input" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} /></div>
        <div>
          <label className="form-label">Aplica a</label>
          <select className="form-input" value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}>
            <option value="general">General</option>
            <option value="grupo_familiar">Grupo familiar</option>
            <option value="vitalicio">Vitalicio</option>
            <option value="staff">Staff</option>
          </select>
        </div>
        <div style={{ alignSelf: 'end' }}><button type="submit" className="btn btn-primary btn-sm"><Plus size={14} /> Alta</button></div>
      </form>
      {error && <p style={{ color: '#ef4444', margin: 0 }}>{error}</p>}
      <div className="table-responsive">
        <table className="admin-table">
          <thead><tr><th>Descuento</th><th>%</th><th>Alcance</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td>{item.percent}%</td>
                <td>{item.appliesTo}</td>
                <td>{item.active ? 'Activo' : 'Inactivo'}</td>
                <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => onToggle(item.id)}>{item.active ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}

/** 5) Saldos */
export function BalancesPanel({ members = [], getAccountBalance }) {
  const memberDebt = members.reduce((s, m) => s + (Number(m.outstandingBalance) || 0), 0);
  const cash = (getAccountBalance?.('Caja General') || 0)
    + (getAccountBalance?.('Caja Cantina') || 0)
    + (getAccountBalance?.('Banco Nación') || 0);
  const providers = getAccountBalance?.('Proveedores Hípicos') || 0;
  const duesIncome = getAccountBalance?.('Cuotas Sociales') || 0;

  const topDebtors = [...members]
    .filter((m) => (m.outstandingBalance || 0) > 0)
    .sort((a, b) => b.outstandingBalance - a.outstandingBalance)
    .slice(0, 8);

  return (
    <PanelShell icon={Scale} title="Saldos" subtitle="Posición de caja, deuda social y pasivos de proveedores.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem' }}>
        <MiniStat label="Caja + bancos" value={formatCurrency(cash)} color="var(--emerald-accent)" />
        <MiniStat label="Deuda de socios" value={formatCurrency(memberDebt)} color="#ef4444" />
        <MiniStat label="Proveedores (cuenta)" value={formatCurrency(Math.abs(providers))} color="#f59e0b" />
        <MiniStat label="Cuotas acreditadas" value={formatCurrency(duesIncome)} />
      </div>
      <div className="table-responsive">
        <table className="admin-table">
          <thead><tr><th>Mayores deudores</th><th>Categoría</th><th>Saldo</th><th>Vencimiento</th></tr></thead>
          <tbody>
            {topDebtors.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>No hay saldos pendientes.</td></tr>}
            {topDebtors.map((m) => (
              <tr key={m.memberId}>
                <td><strong>{m.name}</strong></td>
                <td style={{ textTransform: 'capitalize' }}>{m.tier}</td>
                <td style={{ fontWeight: 700, color: '#ef4444' }}>{formatCurrency(m.outstandingBalance)}</td>
                <td>{m.nextDueDate || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}

/** 6) Órdenes de pago */
export function PaymentOrdersPanel({ items = [], suppliers = [], onAdd, onSetStatus }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    payee: '',
    concept: '',
    amount: '',
    paymentMethod: 'transferencia',
  });
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    setError('');
    try {
      onAdd(createPaymentOrder(form));
      setForm((f) => ({ ...f, payee: '', concept: '', amount: '' }));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <PanelShell icon={FileSpreadsheet} title="Órdenes de pago" subtitle="Autorización y seguimiento de pagos a proveedores.">
      <form onSubmit={submit} style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', border: '1px solid var(--border-glass)', borderRadius: 12, padding: '0.9rem' }}>
        <div><label className="form-label">Fecha</label><input type="date" className="form-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        <div>
          <label className="form-label">Beneficiario</label>
          <input className="form-input" list="suppliers-payee" required value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} />
          <datalist id="suppliers-payee">
            {suppliers.filter((s) => s.status === 'active').map((s) => (
              <option key={s.id} value={s.legalName} />
            ))}
          </datalist>
        </div>
        <div><label className="form-label">Importe</label><input type="number" min="1" required className="form-input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
        <div>
          <label className="form-label">Medio</label>
          <select className="form-input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
            <option value="efectivo">Efectivo</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}><label className="form-label">Concepto</label><input className="form-input" value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></div>
        <div><button type="submit" className="btn btn-primary btn-sm"><Plus size={14} /> Crear OP</button></div>
      </form>
      {error && <p style={{ color: '#ef4444', margin: 0 }}>{error}</p>}

      <div className="table-responsive">
        <table className="admin-table">
          <thead><tr><th>N°</th><th>Fecha</th><th>Beneficiario</th><th>Concepto</th><th>Importe</th><th>Estado</th><th>Gestión</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.number}</strong></td>
                <td>{item.date}</td>
                <td>{item.payee}</td>
                <td>{item.concept || '—'}</td>
                <td style={{ fontWeight: 700 }}>{formatCurrency(item.amount)}</td>
                <td>{PAYMENT_ORDER_STATUS[item.status]}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {item.status === 'draft' && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSetStatus(setPaymentOrderStatus(item, 'approved'))}>Aprobar</button>
                  )}
                  {item.status === 'approved' && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSetStatus(setPaymentOrderStatus(item, 'paid'))}>Marcar paga</button>
                  )}
                  {item.status !== 'paid' && item.status !== 'cancelled' && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => onSetStatus(setPaymentOrderStatus(item, 'cancelled'))}>Anular</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}

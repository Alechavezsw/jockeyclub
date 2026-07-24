import { useState } from 'react';
import { Receipt, Check, X, Banknote } from 'lucide-react';
import { getPostableAccounts, accountLabel } from '../../domain/accounting/chartOfAccounts';
import { EXPENSE_STATUS_LABELS } from '../../domain/accounting/expenses';
import { formatCurrency } from '../../domain/accounting/journal';

export default function ExpensesPanel({
  expenses,
  chartOfAccounts,
  submitExpense,
  setExpenseApproved,
  setExpenseRejected,
  setExpensePaid,
}) {
  const expenseAccounts = getPostableAccounts(chartOfAccounts).filter((a) => a.accountType === 'expense');
  const paymentAccounts = getPostableAccounts(chartOfAccounts).filter(
    (a) => a.accountType === 'asset' && (a.isCashAccount || a.code.startsWith('1.1'))
  );

  const [form, setForm] = useState({
    expenseDate: new Date().toISOString().slice(0, 10),
    vendorName: '',
    categoryAccountId: expenseAccounts[0]?.id || '',
    paymentAccountId: paymentAccounts[0]?.id || '',
    amount: '',
    concept: '',
    invoiceNumber: '',
  });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const onSubmit = (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    try {
      if (!form.concept.trim() || !form.amount) throw new Error('Concepto e importe son obligatorios.');
      submitExpense(form);
      setOk('Gasto enviado a aprobación.');
      setForm((f) => ({ ...f, amount: '', concept: '', vendorName: '', invoiceNumber: '' }));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Receipt size={18} /> Gastos y Aprobaciones
        </h4>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Flujo: solicitud → aprobación → pago con asiento automático.
        </p>
      </div>

      <form onSubmit={onSubmit} style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div>
          <label className="form-label">Fecha</label>
          <input type="date" className="form-input" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Proveedor</label>
          <input className="form-input" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} placeholder="Razón social" />
        </div>
        <div>
          <label className="form-label">N° comprobante</label>
          <input className="form-input" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Importe</label>
          <input type="number" min="1" className="form-input" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Cuenta de gasto</label>
          <select className="form-input" value={form.categoryAccountId} onChange={(e) => setForm({ ...form, categoryAccountId: e.target.value })}>
            {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Pagar con</label>
          <select className="form-input" value={form.paymentAccountId} onChange={(e) => setForm({ ...form, paymentAccountId: e.target.value })}>
            {paymentAccounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Concepto</label>
          <input className="form-input" required value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} placeholder="Detalle del gasto" />
        </div>
        <div>
          <button type="submit" className="btn btn-primary btn-sm">Solicitar gasto</button>
        </div>
      </form>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {ok && <p style={{ color: 'var(--emerald-accent)' }}>{ok}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {expenses.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No hay gastos registrados.</p>}
        {expenses.map((exp) => {
          const cat = chartOfAccounts.find((a) => a.id === exp.categoryAccountId);
          return (
            <div key={exp.id} style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '0.9rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{exp.concept}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {exp.expenseDate} · {cat ? accountLabel(cat) : '—'}
                    {exp.vendorName ? ` · ${exp.vendorName}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700 }}>{formatCurrency(exp.amount)}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-gold)' }}>{EXPENSE_STATUS_LABELS[exp.status] || exp.status}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                {exp.status === 'pending_approval' && (
                  <>
                    <button type="button" className="btn btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(16,185,129,0.15)', border: '1px solid var(--emerald-accent)' }} onClick={() => setExpenseApproved(exp.id)}>
                      <Check size={14} /> Aprobar
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setExpenseRejected(exp.id, 'Rechazado por tesorería')}>
                      <X size={14} /> Rechazar
                    </button>
                  </>
                )}
                {exp.status === 'approved' && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => {
                      try {
                        setExpensePaid(exp.id);
                      } catch (err) {
                        setError(err.message);
                      }
                    }}
                  >
                    <Banknote size={14} /> Registrar pago + asiento
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

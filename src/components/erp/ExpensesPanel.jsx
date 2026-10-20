import { useEffect, useMemo, useState } from 'react';
import { Receipt, Check, X, Banknote, Upload } from 'lucide-react';
import { getPostableAccounts, accountLabel } from '../../domain/accounting/chartOfAccounts';
import {
  EXPENSE_STATUS_LABELS,
  buildLiveExpenses,
  expensePaymentAccounts,
} from '../../domain/accounting/expenses';
import { IVA_ALIQUOTS } from '../../domain/accounting/impuestos';
import { formatCurrency } from '../../domain/accounting/journal';
import { formatISODateLongAR, todayISODateAR } from '../../lib/arDate';
import ExpenseImportPanel from './ExpenseImportPanel';

export default function ExpensesPanel({
  expenses,
  chartOfAccounts,
  suppliers = [],
  submitExpense,
  setExpenseApproved,
  setExpenseRejected,
  setExpensePaid,
  expenseImports = [],
  onImportExpenses,
  initialView = 'list',
  perfilFiscal = null,
}) {
  const expenseAccounts = getPostableAccounts(chartOfAccounts).filter((a) => a.accountType === 'expense');
  const paymentAccounts = expensePaymentAccounts(chartOfAccounts);
  const live = useMemo(() => buildLiveExpenses({ expenses }), [expenses]);

  const [view, setView] = useState(initialView === 'import' ? 'import' : 'list');
  const [statusFilter, setStatusFilter] = useState(null);
  const [form, setForm] = useState(() => ({
    expenseDate: todayISODateAR(),
    vendorName: '',
    categoryAccountId: expenseAccounts[0]?.id || '',
    paymentAccountId: paymentAccounts[0]?.id || '',
    amount: '',
    concept: '',
    invoiceNumber: '',
    ivaAliquotId: '',
    fiscalCondition: perfilFiscal?.condition || '',
  }));
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (initialView === 'import') setView('import');
  }, [initialView]);

  const onSubmit = (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    try {
      if (!form.concept.trim() || !form.amount) throw new Error('Concepto e importe son obligatorios.');
      submitExpense({ ...form, fiscalCondition: perfilFiscal?.condition || form.fiscalCondition || '' });
      setOk('Gasto enviado a aprobación.');
      setForm((f) => ({ ...f, amount: '', concept: '', vendorName: '', invoiceNumber: '', ivaAliquotId: '' }));
    } catch (err) {
      setError(err.message);
    }
  };

  if (view === 'import') {
    return (
      <ExpenseImportPanel
        suppliers={suppliers}
        expenseAccounts={expenseAccounts}
        paymentAccountId={paymentAccounts[0]?.id || ''}
        defaultCategoryAccountId={expenseAccounts[0]?.id || ''}
        imports={expenseImports}
        onBack={() => setView('list')}
        onImportBatch={onImportExpenses}
      />
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Receipt size={18} /> Gastos
            <span className="suppliers-accessin-badge">{formatISODateLongAR(live.asOf)}</span>
          </h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0' }}>
            Solicitud → aprobación → pago. Al pagar se asienta y baja caja o banco.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setView('import')}
        >
          <Upload size={14} /> Importar gastos
        </button>
      </div>

      <form onSubmit={onSubmit} style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div>
          <label className="form-label">Fecha</label>
          <input type="date" className="form-input" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Proveedor</label>
          <input
            className="form-input"
            list="expense-suppliers"
            value={form.vendorName}
            onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
            placeholder="Razón social o nombre"
          />
          <datalist id="expense-suppliers">
            {suppliers
              .filter((s) => s.status !== 'inactive')
              .map((s) => {
                const name = s.legalName || s.name || '';
                const code = s.accessinCode ? `#${s.accessinCode} · ` : '';
                return <option key={s.id} value={name} label={`${code}${name}`} />;
              })}
          </datalist>
        </div>
        <div>
          <label className="form-label">N° comprobante</label>
          <input className="form-input" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Importe</label>
          <input type="number" min="1" className="form-input" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        {perfilFiscal?.condition === 'responsable_inscripto' ? (
          <div>
            <label className="form-label">IVA incluido</label>
            <select className="form-input" value={form.ivaAliquotId} onChange={(e) => setForm({ ...form, ivaAliquotId: e.target.value })}>
              <option value="">Sin discriminar</option>
              {IVA_ALIQUOTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
        ) : null}
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

      <div className="cash-lila-cards">
        {live.cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`cash-lila-card${card.emphasize ? ' is-total' : ''}${statusFilter && card.filter === statusFilter ? ' is-total' : ''}`}
            onClick={() => setStatusFilter((current) => (
              card.filter && current === card.filter ? null : card.filter
            ))}
            style={{ textAlign: 'left', cursor: card.filter ? 'pointer' : 'default' }}
          >
            <div className="cash-lila-card-label">{card.label}</div>
            <div className="cash-lila-card-value">{formatCurrency(card.value)}</div>
            <div className="cash-lila-card-caption">{card.caption}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {live.rows.length === 0 && (
          <p style={{ color: 'var(--text-secondary)' }}>
            No hay gastos cargados. El que solicites acá queda pendiente, se aprueba y al pagar entra al diario y a Cajas.
          </p>
        )}
        {live.rows.filter((exp) => {
          if (!statusFilter) return true;
          if (statusFilter === 'pending_approval') {
            return exp.status === 'pending_approval' || exp.status === 'draft';
          }
          return exp.status === statusFilter;
        }).map((exp) => {
          const cat = chartOfAccounts.find((a) => a.id === exp.categoryAccountId);
          return (
            <div key={exp.id} style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '0.9rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{exp.concept}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {formatISODateLongAR(exp.expenseDate)} · {cat ? accountLabel(cat) : '—'}
                    {exp.vendorName ? ` · ${exp.vendorName}` : ''}
                    {exp.invoiceNumber ? ` · Comp. ${exp.invoiceNumber}` : ''}
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
                    className="btn btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(var(--primary-gold-rgb),0.15)', border: '1px solid var(--primary-gold)' }}
                    onClick={() => setExpensePaid(exp.id)}
                  >
                    <Banknote size={14} /> Registrar pago
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

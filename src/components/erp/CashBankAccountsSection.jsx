import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, BookOpen, X } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import {
  BANK_CURRENCY_OPTIONS,
  filterBankAccounts,
  movementsForBankAccount,
} from '../../domain/accounting/bankAccounts';
import { formatAccessinCashDate, enrichCashMovementsWithMembers } from '../../domain/accounting/cashLedger';
import { formatCurrency } from '../../domain/accounting/journal';

function emptyForm() {
  return {
    id: '',
    bankName: '',
    subtitle: '',
    cbu: '',
    balance: '',
    currency: 'ARS',
  };
}

function emptyEntryForm(accountId = '') {
  return {
    accountId,
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    description: '',
  };
}

export default function CashBankAccountsSection({
  accounts = [],
  movements = [],
  members = [],
  onUpsert,
  onDelete,
  onAddEntry,
  onBack,
}) {
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState(emptyEntryForm);
  const [error, setError] = useState('');
  const [ccAccount, setCcAccount] = useState(null);

  const rows = useMemo(() => filterBankAccounts(accounts, query), [accounts, query]);

  const ccRows = useMemo(() => {
    if (!ccAccount) return [];
    return enrichCashMovementsWithMembers(
      movementsForBankAccount(movements, ccAccount),
      members
    );
  }, [ccAccount, movements, members]);

  const openCreate = () => {
    setError('');
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (account) => {
    setError('');
    setForm({
      id: account.id,
      bankName: account.bankName || '',
      subtitle: account.subtitle || '',
      cbu: account.cbu || '',
      balance: String(account.balance ?? ''),
      currency: account.currency || 'ARS',
    });
    setFormOpen(true);
  };

  const openEntry = (account = null) => {
    setError('');
    setEntryForm(emptyEntryForm(account?.id || rows[0]?.id || ''));
    setEntryOpen(true);
  };

  const submitForm = () => {
    setError('');
    try {
      onUpsert?.({
        ...form,
        balance: form.balance === '' ? 0 : Number(form.balance),
      });
      setFormOpen(false);
    } catch (err) {
      setError(err.message || 'No se pudo guardar la cuenta.');
    }
  };

  const submitEntry = () => {
    setError('');
    try {
      onAddEntry?.(entryForm.accountId, {
        amount: Number(entryForm.amount),
        description: entryForm.description,
        date: entryForm.date,
      });
      setEntryOpen(false);
    } catch (err) {
      setError(err.message || 'No se pudo registrar la entrada.');
    }
  };

  if (ccAccount) {
    return (
      <div className="cash-bank-accounts fade-in">
        <div className="cash-bank-accounts-head">
          <div>
            <h5 className="cash-lila-section-title" style={{ margin: 0 }}>
              Cuenta corriente · {ccAccount.bankName}
            </h5>
            <p className="cash-efectivo-registro-meta">
              {ccAccount.subtitle ? `${ccAccount.subtitle} · ` : ''}
              Saldo {formatCurrency(ccAccount.balance)} · {ccRows.length} movimientos
            </p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCcAccount(null)}>
            Volver a cuentas
          </button>
        </div>

        <div className="table-responsive">
          <table className="admin-table cash-lila-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Descripción</th>
                <th>Socio</th>
                <th>Monto</th>
              </tr>
            </thead>
            <tbody>
              {ccRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                    Sin movimientos para esta cuenta en el export.
                  </td>
                </tr>
              ) : (
                ccRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.accessinId}</td>
                    <td>{formatAccessinCashDate(row.date)}</td>
                    <td>{row.typeLabel}</td>
                    <td>{row.description || '—'}</td>
                    <td>{row.memberName || row.memberNumber || '—'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>
                      {formatCurrency(row.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="cash-bank-accounts fade-in">
      <div className="cash-bank-accounts-head">
        <h5 className="cash-lila-section-title" style={{ margin: 0 }}>Cuentas bancarias</h5>
        <div className="cash-bank-accounts-actions">
          <button type="button" className="btn cash-lila-purple-btn" onClick={openCreate}>
            <Plus size={14} /> Cuentas
          </button>
          <button
            type="button"
            className="btn cash-lila-purple-btn"
            onClick={() => openEntry()}
            disabled={!rows.length}
          >
            <Plus size={14} /> Entradas
          </button>
        </div>
      </div>

      <div className="cash-efectivo-registro-toolbar">
        <p className="cash-efectivo-registro-meta" style={{ margin: 0 }}>
          Encontrados {rows.length} en total
        </p>
        <label className="cash-lila-search">
          <Search size={14} />
          <input
            className="form-input"
            placeholder="Buscar banco, CBU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {error && !formOpen && !entryOpen ? (
        <div style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</div>
      ) : null}

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Banco</th>
              <th>CBU</th>
              <th>Saldo</th>
              <th>Tipo de moneda</th>
              <th>Funciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                  No hay cuentas bancarias.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.accessinId}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.bankName}</div>
                    {row.subtitle ? (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{row.subtitle}</div>
                    ) : null}
                  </td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem' }}>
                    {row.cbu || '—'}
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>
                    {formatCurrency(row.balance)}
                  </td>
                  <td>{row.currencyLabel || 'Pesos argentinos'}</td>
                  <td>
                    <div className="cash-lila-row-actions">
                      <button
                        type="button"
                        className="cash-lila-icon-btn is-cc"
                        title="Cuenta corriente"
                        aria-label="Cuenta corriente"
                        onClick={() => setCcAccount(row)}
                      >
                        <BookOpen size={13} />
                        <span>CC</span>
                      </button>
                      <button
                        type="button"
                        className="cash-lila-icon-btn is-edit"
                        title="Editar"
                        aria-label="Editar"
                        onClick={() => openEdit(row)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="cash-lila-icon-btn is-del"
                        title="Eliminar"
                        aria-label="Eliminar"
                        onClick={() => {
                          if (window.confirm(`¿Eliminar ${row.bankName}?`)) {
                            try {
                              onDelete?.(row.id);
                            } catch (err) {
                              setError(err.message || 'No se pudo eliminar.');
                            }
                          }
                        }}
                      >
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

      <div className="cash-efectivo-registro-foot">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Volver
        </button>
      </div>

      <ModalDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        labelledBy="bank-account-form-title"
        contentStyle={{ maxWidth: 520, width: '100%' }}
      >
        <div className="cash-payment-detail">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <h3 id="bank-account-form-title" style={{ margin: 0 }}>
              {form.id ? 'Editar cuenta bancaria' : 'Nueva cuenta bancaria'}
            </h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFormOpen(false)} aria-label="Cerrar">
              <X size={14} />
            </button>
          </div>
          {error ? <div style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</div> : null}
          <label className="cash-payment-detail-label">Banco</label>
          <input
            className="form-input"
            value={form.bankName}
            onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
          />
          <label className="cash-payment-detail-label">Subtítulo / nota</label>
          <input
            className="form-input"
            value={form.subtitle}
            onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
            placeholder="Ej. SERVICIOS Y PRESTACIONES"
          />
          <label className="cash-payment-detail-label">CBU</label>
          <input
            className="form-input"
            value={form.cbu}
            onChange={(e) => setForm((f) => ({ ...f, cbu: e.target.value.replace(/\D/g, '').slice(0, 22) }))}
            inputMode="numeric"
            maxLength={22}
          />
          <label className="cash-payment-detail-label">Saldo</label>
          <input
            className="form-input"
            value={form.balance}
            onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value }))}
            inputMode="decimal"
          />
          <label className="cash-payment-detail-label">Moneda</label>
          <select
            className="form-input"
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
          >
            {BANK_CURRENCY_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <div className="cash-payment-detail-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={submitForm}>Guardar</button>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        labelledBy="bank-entry-form-title"
        contentStyle={{ maxWidth: 480, width: '100%' }}
      >
        <div className="cash-payment-detail">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <h3 id="bank-entry-form-title" style={{ margin: 0 }}>Entrada bancaria</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEntryOpen(false)} aria-label="Cerrar">
              <X size={14} />
            </button>
          </div>
          {error ? <div style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</div> : null}
          <label className="cash-payment-detail-label">Cuenta</label>
          <select
            className="form-input"
            value={entryForm.accountId}
            onChange={(e) => setEntryForm((f) => ({ ...f, accountId: e.target.value }))}
          >
            {rows.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName} · {formatCurrency(a.balance)}
              </option>
            ))}
          </select>
          <label className="cash-payment-detail-label">Fecha</label>
          <input
            className="form-input"
            type="date"
            value={entryForm.date}
            onChange={(e) => setEntryForm((f) => ({ ...f, date: e.target.value }))}
          />
          <label className="cash-payment-detail-label">Monto (+ ingreso / − egreso)</label>
          <input
            className="form-input"
            value={entryForm.amount}
            onChange={(e) => setEntryForm((f) => ({ ...f, amount: e.target.value }))}
            inputMode="decimal"
          />
          <label className="cash-payment-detail-label">Descripción</label>
          <input
            className="form-input"
            value={entryForm.description}
            onChange={(e) => setEntryForm((f) => ({ ...f, description: e.target.value }))}
          />
          <div className="cash-payment-detail-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEntryOpen(false)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={submitEntry}>Registrar</button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}

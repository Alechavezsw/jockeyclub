import { useState } from 'react';
import { ListTree, Plus, Search } from 'lucide-react';
import { ACCOUNT_TYPES, accountLabel } from '../../domain/accounting/chartOfAccounts';
import { formatCurrency, getAccountBalance } from '../../domain/accounting/journal';

export default function ChartOfAccountsPanel({
  chartOfAccounts,
  setChartOfAccounts,
  upsertChartAccount,
  journalEntries,
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    accountType: 'expense',
    parentId: '',
    isCashAccount: false,
  });
  const [error, setError] = useState('');

  const filtered = chartOfAccounts.filter((a) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    const matchesType = typeFilter === 'all' || a.accountType === typeFilter;
    return matchesSearch && matchesType;
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.code.trim() || !form.name.trim()) {
      setError('Código y nombre son obligatorios.');
      return;
    }
    if (chartOfAccounts.some((a) => a.code === form.code.trim())) {
      setError('Ya existe una cuenta con ese código.');
      return;
    }
    const parent = chartOfAccounts.find((a) => a.id === form.parentId);
    const account = {
      id: `coa-${form.code.trim()}`,
      code: form.code.trim(),
      name: form.name.trim(),
      accountType: form.accountType,
      parentId: form.parentId || null,
      level: parent ? parent.level + 1 : 1,
      isPostable: true,
      isCashAccount: form.isCashAccount,
      isActive: true,
    };
    setSaving(true);
    try {
      if (typeof upsertChartAccount === 'function') {
        await upsertChartAccount(account);
      } else if (typeof setChartOfAccounts === 'function') {
        setChartOfAccounts((prev) => [...prev, account].sort((x, y) => x.code.localeCompare(y.code, 'es')));
      }
      setShowForm(false);
      setForm({ code: '', name: '', accountType: 'expense', parentId: '', isCashAccount: false });
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la cuenta.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ListTree size={18} /> Plan de Cuentas
          </h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Estructura jerárquica oficial. Solo cuentas imputables reciben asientos.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Plus size={14} /> Nueva cuenta
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div>
            <label className="form-label">Código</label>
            <input className="form-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="5.1.06" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="form-label">Nombre</label>
            <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Seguros del Club" />
          </div>
          <div>
            <label className="form-label">Tipo</label>
            <select className="form-input" value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })}>
              {Object.entries(ACCOUNT_TYPES).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Cuenta padre</label>
            <select className="form-input" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">— Sin padre —</option>
              {chartOfAccounts.filter((a) => !a.isPostable || a.level < 3).map((a) => (
                <option key={a.id} value={a.id}>{accountLabel(a)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'end', gap: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={form.isCashAccount} onChange={(e) => setForm({ ...form, isCashAccount: e.target.checked })} />
              Es cuenta de caja
            </label>
          </div>
          {error && <p style={{ color: '#ef4444', gridColumn: '1 / -1', fontSize: '0.85rem' }}>{error}</p>}
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cuenta'}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 2, minWidth: '200px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: '2.2rem' }} placeholder="Buscar código o nombre..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="form-input" style={{ maxWidth: 200 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">Todos los rubros</option>
          {Object.entries(ACCOUNT_TYPES).map(([key, meta]) => (
            <option key={key} value={key}>{meta.label}</option>
          ))}
        </select>
      </div>

      <div style={{ border: '1px solid var(--border-glass)', borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.04)', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem' }}>Código</th>
              <th style={{ padding: '0.75rem' }}>Cuenta</th>
              <th style={{ padding: '0.75rem' }}>Tipo</th>
              <th style={{ padding: '0.75rem' }}>Imputable</th>
              <th style={{ padding: '0.75rem', textAlign: 'right' }}>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((account) => (
              <tr key={account.id} style={{ borderTop: '1px solid var(--border-glass)' }}>
                <td style={{ padding: '0.65rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-gold)', paddingLeft: `${0.75 + (account.level - 1) * 0.75}rem` }}>
                  {account.code}
                </td>
                <td style={{ padding: '0.65rem 0.75rem', fontWeight: account.isPostable ? 400 : 600 }}>{account.name}</td>
                <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-secondary)' }}>{ACCOUNT_TYPES[account.accountType]?.label}</td>
                <td style={{ padding: '0.65rem 0.75rem' }}>{account.isPostable ? 'Sí' : 'No'}</td>
                <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>
                  {account.isPostable ? formatCurrency(getAccountBalance(account.id, journalEntries, chartOfAccounts)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, Pencil, Plus, Search, Trash2,
} from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { DATITA_CUOTA_CATEGORY_NAMES } from '../../domain/members/tiers';
import {
  buildFeeAccountLedgerLines,
  createFeeChartAccount,
  filterFeeAccountLedger,
  formatFeeLedgerDate,
} from '../../domain/accounting/feeChartAccounts';

const PAGE_SIZE = 20;

const EMPTY_FORM = {
  name: '',
  description: '',
  feeCategories: '',
  balance: '',
};

function formatLilaMoney(n) {
  const v = Number(n) || 0;
  return `$ ${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FeeChartAccountsPanel({
  accounts = [],
  onUpsert,
  onDelete,
  onBack,
  formatCurrency: formatCurrencyProp,
}) {
  const fmt = formatCurrencyProp || formatCurrency;
  const [view, setView] = useState('list'); // list | form | ledger
  const [selected, setSelected] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const activeAccounts = useMemo(
    () => (accounts || []).filter((a) => a && a.isActive !== false),
    [accounts]
  );

  const ledgerAll = useMemo(
    () => (selected ? buildFeeAccountLedgerLines(selected) : []),
    [selected]
  );

  const ledgerRows = useMemo(
    () => filterFeeAccountLedger(ledgerAll, { from, to, query }),
    [ledgerAll, from, to, query]
  );

  const totalPages = Math.max(1, Math.ceil(ledgerRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = ledgerRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const fromIdx = ledgerRows.length ? safePage * PAGE_SIZE + 1 : 0;
  const toIdx = Math.min(ledgerRows.length, (safePage + 1) * PAGE_SIZE);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError('');
    setView('form');
  };

  const openEdit = (account) => {
    setEditingId(account.id);
    setForm({
      name: account.name || '',
      description: account.description || '',
      feeCategories: (account.feeCategories || []).join(', '),
      balance: String(account.balance ?? ''),
    });
    setError('');
    setView('form');
  };

  const openLedger = (account) => {
    setSelected(account);
    setFrom('');
    setTo('');
    setQuery('');
    setPage(0);
    setFiltersOpen(true);
    setView('ledger');
  };

  const submit = (e) => {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        id: editingId || undefined,
        name: form.name,
        description: form.description,
        feeCategories: form.feeCategories,
        balance: form.balance,
      };
      createFeeChartAccount(payload);
      onUpsert?.(payload);
      setView('list');
    } catch (err) {
      setError(err.message || 'No se pudo guardar.');
    }
  };

  const pageButtons = () => {
    if (totalPages <= 1) return null;
    const nums = [];
    const last = totalPages;
    for (let i = 1; i <= Math.min(9, last); i += 1) nums.push(i);
    if (last > 10) {
      nums.push('…');
      nums.push(Math.max(10, last - 1));
      nums.push(last);
    }
    return (
      <div className="cash-efectivo-pager">
        <button type="button" className="btn btn-secondary btn-sm" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          Anterior
        </button>
        {nums.map((n, idx) => (
          n === '…' ? (
            <span key={`e-${idx}`} style={{ padding: '0 0.25rem', color: 'var(--text-muted)' }}>…</span>
          ) : (
            <button
              key={n}
              type="button"
              className={`cash-efectivo-page-btn${safePage === n - 1 ? ' is-active' : ''}`}
              onClick={() => setPage(n - 1)}
            >
              {n}
            </button>
          )
        ))}
        <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
          Siguiente
        </button>
      </div>
    );
  };

  if (view === 'form') {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <h3 className="cuotas-title">{editingId ? 'Editar cuenta contable' : 'Nueva cuenta contable'}</h3>
        </div>
        <form className="disc-form" onSubmit={submit}>
          <div className="disc-field">
            <label className="disc-field-label">Nombre</label>
            <input className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="disc-field">
            <label className="disc-field-label">Descripción</label>
            <input className="form-input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="disc-field">
            <label className="disc-field-label">Categorías de cuotas</label>
            <input
              className="form-input"
              list="fca-categories"
              value={form.feeCategories}
              onChange={(e) => setForm((f) => ({ ...f, feeCategories: e.target.value }))}
              placeholder="Ej. SOCIO FAMILIAR"
            />
            <datalist id="fca-categories">
              {DATITA_CUOTA_CATEGORY_NAMES.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div className="disc-field">
            <label className="disc-field-label">Balance</label>
            <input
              className="form-input"
              type="number"
              step="0.01"
              value={form.balance}
              onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value }))}
            />
          </div>
          {error ? <p className="ig-error">{error}</p> : null}
          <div className="ig-form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setView('list')}>Volver</button>
            <button type="submit" className="btn cash-lila-purple-btn">{editingId ? 'Guardar' : 'Crear'}</button>
          </div>
        </form>
      </div>
    );
  }

  if (view === 'ledger' && selected) {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setView('list'); setSelected(null); }}>
            <ArrowLeft size={14} /> Volver
          </button>
        </div>

        {filtersOpen ? (
          <section className="supplier-pay-import-block">
            <div className="cuotas-toolbar">
              <h4 className="supplier-pay-import-title" style={{ margin: 0 }}>Buscar por</h4>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFiltersOpen(false)} title="Minimizar">−</button>
            </div>
            <div className="cuotas-event-filters">
              <label>
                <span className="form-label">Desde</span>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <input type="date" className="form-input" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
                  {from ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFrom('')}>×</button> : null}
                </div>
              </label>
              <label>
                <span className="form-label">Hasta</span>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <input type="date" className="form-input" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
                  {to ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTo('')}>×</button> : null}
                </div>
              </label>
              <label>
                <span className="form-label">Texto</span>
                <input
                  className="form-input"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                  placeholder="Socio, nro., descripción…"
                />
              </label>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button type="button" className="btn cash-lila-purple-btn" onClick={() => setPage(0)}>
                  <Search size={14} /> Buscar
                </button>
              </div>
            </div>
          </section>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFiltersOpen(true)}>Mostrar filtros</button>
        )}

        <div className="cuotas-toolbar">
          <h3 className="cuotas-title">Cuentas contables: {selected.name}</h3>
        </div>

        <div className="disc-pager">
          <span>
            {ledgerRows.length === 0
              ? 'No se encontraron resultados'
              : `Mostrando ${fromIdx} - ${toIdx} de ${ledgerRows.length}`}
          </span>
          {pageButtons()}
        </div>

        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Número de socio</th>
                <th>Socio</th>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Descripción</th>
                <th>Importe</th>
                <th>Cobrado</th>
                <th>Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ color: 'var(--text-muted)' }}>
                    Sin movimientos para esta cuenta / filtro.
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.accessinId}</td>
                    <td>{row.memberNumber}</td>
                    <td style={{ fontWeight: 600 }}>{row.memberName}</td>
                    <td>{formatFeeLedgerDate(row)}</td>
                    <td>{row.type}</td>
                    <td>{row.description}</td>
                    <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>{formatLilaMoney(row.amount)}</td>
                    <td style={{ fontWeight: 700, color: row.collected > 0 ? 'var(--emerald-accent)' : undefined }}>
                      {formatLilaMoney(row.collected)}
                    </td>
                    <td style={{
                      fontWeight: 700,
                      color: row.pending > 0 ? 'var(--warning-accent)' : 'var(--emerald-accent)',
                    }}
                    >
                      {formatLilaMoney(row.pending)}
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
    <div className="fade-in cuotas-panel">
      <div className="cuotas-toolbar">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {onBack ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
              <ArrowLeft size={14} /> Volver
            </button>
          ) : null}
          <h3 className="cuotas-title" style={{ margin: 0 }}>
            <BookOpen size={18} /> Cuentas contables
          </h3>
        </div>
        <button type="button" className="btn cash-lila-purple-btn" onClick={openCreate}>
          <Plus size={14} /> Cuenta contable
        </button>
      </div>

      <p className="disc-field-hint" style={{ margin: 0 }}>
        Encontrados {activeAccounts.length} en total
      </p>

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Nombre</th>
              <th>Descripción</th>
              <th>Categorías de cuotas</th>
              <th>Balance</th>
              <th>Funciones</th>
            </tr>
          </thead>
          <tbody>
            {activeAccounts.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: 'var(--text-muted)' }}>No hay cuentas contables.</td>
              </tr>
            ) : (
              activeAccounts.map((row) => (
                <tr key={row.id}>
                  <td>{row.accessinId || row.id.slice(-4)}</td>
                  <td style={{ fontWeight: 700 }}>{row.name}</td>
                  <td>{row.description || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {(row.feeCategories || []).map((cat) => (
                        <span key={cat} className="disc-badge" style={{ borderRadius: 6 }}>{cat}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>{fmt(row.balance)}</td>
                  <td>
                    <div className="cash-lila-row-actions">
                      <button type="button" className="btn cash-lila-purple-btn btn-sm" onClick={() => openLedger(row)}>
                        C.C.
                      </button>
                      <button type="button" className="cash-lila-icon-btn is-edit" title="Editar" onClick={() => openEdit(row)}>
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="cash-lila-icon-btn is-del"
                        title="Eliminar"
                        onClick={() => {
                          if (window.confirm(`¿Eliminar la cuenta ${row.name}?`)) onDelete?.(row.id);
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
    </div>
  );
}

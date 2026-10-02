import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, Pencil, Plus, Search, Trash2, X,
} from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { DATITA_CUOTA_CATEGORY_NAMES } from '../../domain/members/tiers';
import {
  createFeeChartAccount,
  filterFeeAccountLedger,
  formatFeeLedgerDate,
  withProcessedPeriodLines,
} from '../../domain/accounting/feeChartAccounts';
import { buildFeeAccountLedgerLines } from '../../domain/accounting/feeAccountLedger';
import { feeAccountDetailsSeed } from '../../domain/accounting/feeAccountDetails';
import { listFeeLedgerLines } from '../../data/repos';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';

const PAGE_SIZE = 20;

const FEE_DETAILS_SNAPSHOTS = ['accessinFeeAccountDetails'];
const NO_SNAPSHOTS = [];

const EMPTY_FORM = {
  name: '',
  description: '',
  feeCategories: '',
};

function foldCategory(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseFeeCategories(value) {
  if (Array.isArray(value)) {
    return value.map((c) => String(c || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,;]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function joinFeeCategories(list) {
  return (list || []).join(', ');
}

function filterFeeCategoryOptions(query, selected) {
  const q = foldCategory(query);
  const taken = new Set((selected || []).map(foldCategory));
  return DATITA_CUOTA_CATEGORY_NAMES.filter((name) => {
    if (taken.has(foldCategory(name))) return false;
    if (!q) return true;
    return foldCategory(name).includes(q);
  });
}

function formatLilaMoney(n) {
  const v = Number(n) || 0;
  return `$ ${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FeeChartAccountsPanel({
  accounts = [],
  members = [],
  periods = [],
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
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [catQuery, setCatQuery] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [dbLines, setDbLines] = useState(null);
  const [saving, setSaving] = useState(false);

  const activeAccounts = useMemo(
    () => (accounts || [])
      .filter((account) => account && account.isActive !== false)
      .toSorted((a, b) => (Number(a.accessinId) || 9999) - (Number(b.accessinId) || 9999)),
    [accounts]
  );

  // El libro de cada cuenta sale del detalle de cuotas (665 kB con DNI): se baja al abrirlo.
  const { ACCESSIN_FEE_ACCOUNT_DETAILS } = useSnapshotSeed(
    view === 'ledger' ? FEE_DETAILS_SNAPSHOTS : NO_SNAPSHOTS,
    feeAccountDetailsSeed,
  );
  useEffect(() => {
    if (view !== 'ledger' || !selected?.id || !isSupabaseConfigured) {
      setDbLines(null);
      return undefined;
    }
    let cancel = false;
    setDbLines(null);
    listFeeLedgerLines(selected.id)
      .then((lines) => {
        if (!cancel) setDbLines(lines || []);
      })
      .catch(() => {
        if (!cancel) setDbLines([]);
      });
    return () => { cancel = true; };
  }, [view, selected]);

  const ledgerAll = useMemo(() => {
    if (!selected) return [];
    const snapshotLines = buildFeeAccountLedgerLines(selected, ACCESSIN_FEE_ACCOUNT_DETAILS);
    let base = [];
    if (isSupabaseConfigured && dbLines && dbLines.length >= snapshotLines.length) {
      base = dbLines;
    } else if (snapshotLines.length) {
      base = snapshotLines;
    } else {
      base = dbLines || [];
    }
    return withProcessedPeriodLines(selected, base, members, periods);
  }, [selected, ACCESSIN_FEE_ACCOUNT_DETAILS, dbLines, members, periods]);

  const ledgerRows = useMemo(
    () => filterFeeAccountLedger(ledgerAll, { query }),
    [ledgerAll, query]
  );
  const memberHits = useMemo(() => {
    const q = foldCategory(query);
    if (q.length < 2) return [];
    const seen = new Set();
    const hits = [];
    for (const line of ledgerAll) {
      const number = String(line.memberNumber || '');
      const name = String(line.memberName || '');
      const key = `${number}|${foldCategory(name)}`;
      if (!name || seen.has(key)) continue;
      const hay = foldCategory(`${number} ${name}`);
      if (!hay.includes(q)) continue;
      seen.add(key);
      hits.push({ key, memberNumber: number, memberName: name });
      if (hits.length >= 8) break;
    }
    return hits;
  }, [ledgerAll, query]);

  const totalPages = Math.max(1, Math.ceil(ledgerRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = ledgerRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const fromIdx = ledgerRows.length ? safePage * PAGE_SIZE + 1 : 0;
  const toIdx = Math.min(ledgerRows.length, (safePage + 1) * PAGE_SIZE);

  const selectedCategories = useMemo(
    () => parseFeeCategories(form.feeCategories),
    [form.feeCategories]
  );
  const categorySuggestions = useMemo(
    () => filterFeeCategoryOptions(catQuery, selectedCategories),
    [catQuery, selectedCategories]
  );
  const nameSuggestions = useMemo(() => {
    const q = foldCategory(form.name);
    const names = [...new Set([
      ...DATITA_CUOTA_CATEGORY_NAMES,
      ...activeAccounts.map((account) => account.name).filter(Boolean),
    ])];
    return names.filter((name) => !q || foldCategory(name).includes(q));
  }, [form.name, activeAccounts]);

  const pickName = (name) => {
    const next = String(name || '').trim();
    if (!next) return;
    setForm((current) => ({ ...current, name: next }));
    setNameOpen(false);
    if (DATITA_CUOTA_CATEGORY_NAMES.some((category) => foldCategory(category) === foldCategory(next))) {
      addCategory(next);
    }
  };

  const setCategories = (list) => {
    setForm((f) => ({ ...f, feeCategories: joinFeeCategories(list) }));
  };

  const addCategory = (name) => {
    const next = String(name || '').trim();
    if (!next) return;
    if (selectedCategories.some((c) => foldCategory(c) === foldCategory(next))) {
      setCatQuery('');
      setCatOpen(false);
      return;
    }
    setCategories([...selectedCategories, next]);
    setCatQuery('');
    setCatOpen(false);
  };

  const removeCategory = (name) => {
    setCategories(selectedCategories.filter((c) => foldCategory(c) !== foldCategory(name)));
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setCatQuery('');
    setCatOpen(false);
    setNameOpen(false);
    setError('');
    setView('form');
  };

  const openEdit = (account) => {
    setEditingId(account.id);
    setForm({
      name: account.name || '',
      description: account.description || '',
      feeCategories: joinFeeCategories(account.feeCategories || []),
    });
    setCatQuery('');
    setCatOpen(false);
    setNameOpen(false);
    setError('');
    setView('form');
  };

  const openLedger = (account) => {
    setSelected(account);
    setQuery('');
    setSearchOpen(false);
    setPage(0);
    setView('ledger');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        id: editingId || undefined,
        name: form.name,
        description: form.description,
        feeCategories: form.feeCategories,
      };
      createFeeChartAccount({ ...payload, balance: 0 });
      await onUpsert?.(payload);
      setView('list');
    } catch (err) {
      setError(err.message || 'No se pudo guardar.');
    } finally {
      setSaving(false);
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
            <label className="disc-field-label" htmlFor="fca-name-search">Nombre</label>
            <div className="fee-cat-pick">
              <div className="fee-cat-pick-field">
                <Search size={16} aria-hidden className="fee-cat-pick-icon" />
                <input
                  id="fca-name-search"
                  className="form-input"
                  value={form.name}
                  required
                  autoComplete="off"
                  aria-expanded={nameOpen && nameSuggestions.length > 0}
                  aria-autocomplete="list"
                  onChange={(e) => {
                    setForm((current) => ({ ...current, name: e.target.value }));
                    setNameOpen(true);
                  }}
                  onFocus={() => setNameOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setNameOpen(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nameOpen && nameSuggestions[0]
                      && foldCategory(nameSuggestions[0]) !== foldCategory(form.name)) {
                      e.preventDefault();
                      pickName(nameSuggestions[0]);
                    }
                    if (e.key === 'Escape') setNameOpen(false);
                  }}
                />
              </div>
              {nameOpen && nameSuggestions.length > 0 ? (
                <ul className="member-entry-suggest" role="listbox">
                  {nameSuggestions.map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        role="option"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickName(name)}
                      >
                        <strong>{name}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
          <div className="disc-field">
            <label className="disc-field-label">Descripción</label>
            <input className="form-input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="disc-field">
            <label className="disc-field-label" htmlFor="fca-category-search">Categorías de cuotas</label>
            {selectedCategories.length > 0 ? (
              <div className="fee-cat-chips">
                {selectedCategories.map((cat) => (
                  <span key={cat} className="fee-cat-chip">
                    {cat}
                    <button
                      type="button"
                      aria-label={`Quitar ${cat}`}
                      onClick={() => removeCategory(cat)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="fee-cat-pick">
              <div className="fee-cat-pick-field">
                <Search size={16} aria-hidden className="fee-cat-pick-icon" />
                <input
                  id="fca-category-search"
                  className="form-input"
                  type="search"
                  value={catQuery}
                  onChange={(e) => {
                    setCatQuery(e.target.value);
                    setCatOpen(true);
                  }}
                  onFocus={() => setCatOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setCatOpen(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && categorySuggestions[0]) {
                      e.preventDefault();
                      addCategory(categorySuggestions[0]);
                    }
                    if (e.key === 'Escape') setCatOpen(false);
                  }}
                  placeholder={selectedCategories.length ? 'Agregar otra categoría…' : 'Ej. SOCIO FAMILIAR'}
                  autoComplete="off"
                />
              </div>
              {catOpen && categorySuggestions.length > 0 ? (
                <ul className="member-entry-suggest" role="listbox">
                  {categorySuggestions.map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        role="option"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addCategory(name)}
                      >
                        <strong>{name}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : catOpen && catQuery.trim() ? (
                <p className="member-entry-empty">No hay categorías que coincidan</p>
              ) : null}
            </div>
            <p className="disc-field-hint">
              Escribí para buscar. Podés asociar varias categorías a la misma cuenta.
            </p>
          </div>
          <p className="disc-field-hint">
            El balance sale de los movimientos de la cuenta. Una liquidación nueva lo suma acá.
          </p>
          {error ? <p className="ig-error">{error}</p> : null}
          <div className="ig-form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setView('list')}>Volver</button>
            <button type="submit" className="btn btn-tan" disabled={saving}>{editingId ? 'Guardar' : 'Crear'}</button>
          </div>
        </form>
      </div>
    );
  }

  if (view === 'ledger' && selected) {
    return (
      <SnapshotGate names={FEE_DETAILS_SNAPSHOTS}>
        <div className="fade-in cuotas-panel">
          <section className="fee-ledger-find">
            <button type="button" className="cuotas-back" onClick={() => { setView('list'); setSelected(null); }}>
              <ArrowLeft size={14} /> Volver
            </button>
            <div className="fee-ledger-find-top">
              <div>
                <p className="cuotas-kicker">Cuenta corriente</p>
                <h3 className="cuotas-title">{selected.name}</h3>
              </div>
              <p className="fee-ledger-balance">
                <small>Balance</small>
                <strong>{fmt(selected.balance)}</strong>
              </p>
            </div>
            <div className="fee-ledger-search">
              <Search size={18} aria-hidden className="fee-ledger-search-icon" />
              <input
                className="form-input"
                type="text"
                value={query}
                aria-label="Buscar en la cuenta corriente"
                aria-expanded={searchOpen && memberHits.length > 0}
                aria-autocomplete="list"
                placeholder="Buscar socio, número o descripción"
                autoComplete="off"
                onChange={(e) => { setQuery(e.target.value); setPage(0); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => { window.setTimeout(() => setSearchOpen(false), 120); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false);
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="fee-ledger-search-clear"
                  aria-label="Limpiar búsqueda"
                  onClick={() => { setQuery(''); setPage(0); setSearchOpen(false); }}
                >
                  <X size={16} />
                </button>
              ) : null}
              {searchOpen && memberHits.length > 0 ? (
                <ul className="member-entry-suggest" role="listbox">
                  {memberHits.map((hit) => (
                    <li key={hit.key}>
                      <button
                        type="button"
                        role="option"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setQuery(hit.memberName);
                          setPage(0);
                          setSearchOpen(false);
                        }}
                      >
                        <strong>{hit.memberName}</strong>
                        <span>Socio {hit.memberNumber}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>

          <div className="disc-pager">
            <span>
              {isSupabaseConfigured && dbLines == null && ledgerRows.length === 0
                ? 'Cargando cuenta corriente…'
                : ledgerRows.length === 0
                  ? 'No se encontraron resultados'
                  : `Mostrando ${fromIdx} - ${toIdx} de ${ledgerRows.length}`}
            </span>
            {pageButtons()}
          </div>

          <div className="table-responsive">
            <table className="admin-table fee-ledger-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Número de socio</th>
                  <th>Socio</th>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Descripción</th>
                  <th className="fee-ledger-money">Importe</th>
                  <th className="fee-ledger-money">Cobrado</th>
                  <th className="fee-ledger-money">Pendiente</th>
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
                      <td className="fee-ledger-money" style={{ color: 'var(--emerald-accent)' }}>{formatLilaMoney(row.amount)}</td>
                      <td className="fee-ledger-money" style={{ color: row.collected > 0 ? 'var(--emerald-accent)' : undefined }}>
                        {formatLilaMoney(row.collected)}
                      </td>
                      <td
                        className="fee-ledger-money"
                        style={{ color: row.pending > 0 ? 'var(--warning-accent)' : 'var(--emerald-accent)' }}
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
      </SnapshotGate>
    );
  }

  return (
    <div className="fade-in cuotas-panel">
      <div className="cuotas-toolbar cuotas-toolbar--local">
        <div className="fee-account-head">
          {onBack ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
              <ArrowLeft size={14} /> Volver
            </button>
          ) : null}
          <h3 className="cuotas-title">
            <BookOpen size={18} /> Cuentas contables
          </h3>
        </div>
        <button type="button" className="fee-account-add" onClick={openCreate}>
          <i aria-hidden="true"><Plus size={16} strokeWidth={2.4} /></i>
          <span>
            <strong>Cuenta contable</strong>
            <small>Nueva cuenta del plan</small>
          </span>
        </button>
      </div>

      <p className="disc-field-hint" style={{ margin: 0 }}>
        Encontrados {activeAccounts.length} en total
      </p>
      {error ? <p className="ig-error">{error}</p> : null}

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
                    <div className="fee-account-actions">
                      <button type="button" className="fee-cc-btn" title="Cuenta corriente" onClick={() => openLedger(row)}>
                        <i aria-hidden="true"><BookOpen size={13} /></i>
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
                          if (!window.confirm(`¿Eliminar la cuenta ${row.name}?`)) return;
                          Promise.resolve(onDelete?.(row.id)).catch((err) => {
                            setError(err?.message || 'No se pudo eliminar.');
                          });
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

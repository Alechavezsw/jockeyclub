import { useMemo, useState } from 'react';
import { Truck, Search, Ban, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  ACCESSIN_SUPPLIERS_AS_OF,
  SUPPLIER_CATEGORIES,
  accessinBalanceTotals,
  compareSuppliersByAccessin,
  createSupplier,
  expensesForSupplier,
  setSupplierStatus,
  supplierAccessinBalance,
  supplierAccessinCode,
  supplierDisplayName,
  supplierOpenBalance,
  supplierPaidYtd,
  updateSupplier,
} from '../../domain/accounting/suppliers';
import { formatCurrency } from '../../domain/accounting/journal';
import SupplierPaymentsImportPanel from './SupplierPaymentsImportPanel';
import SupplierEntradaModal from './SupplierEntradaModal';

const PAGE_SIZE = 40;

const EMPTY_FORM = {
  legalName: '',
  tradeName: '',
  cuit: '',
  category: 'general',
  email: '',
  phone: '',
  address: '',
  notes: '',
  accessinCode: '',
  openingBalance: '',
};

function formatAsOf(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function balanceTone(amount) {
  if (amount > 0) return '#f59e0b';
  if (amount < 0) return 'var(--emerald-accent)';
  return 'var(--text-secondary)';
}

export default function SuppliersPanel({
  suppliers = [],
  upsertSupplier,
  toggleSupplierStatus,
  expenses = [],
  paymentImports = [],
  onImportSupplierPayments,
  onCreateSupplierEntry,
  onNavigate,
}) {
  const [view, setView] = useState('padron'); // padron | import
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [balanceFilter, setBalanceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('accessin');
  const [page, setPage] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [showEntrada, setShowEntrada] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const accessinTotals = useMemo(() => accessinBalanceTotals(suppliers), [suppliers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = suppliers
      .filter((s) => (statusFilter === 'all' ? true : s.status === statusFilter))
      .filter((s) => (categoryFilter === 'all' ? true : s.category === categoryFilter))
      .filter((s) => {
        const bal = supplierAccessinBalance(s);
        if (balanceFilter === 'with') return bal !== 0;
        if (balanceFilter === 'debt') return bal > 0;
        if (balanceFilter === 'credit') return bal < 0;
        return true;
      })
      .filter((s) => {
        if (!q) return true;
        return (
          supplierDisplayName(s).toLowerCase().includes(q)
          || String(s.tradeName || '').toLowerCase().includes(q)
          || String(s.cuit || '').includes(q)
          || String(s.phone || '').includes(q)
          || supplierAccessinCode(s).includes(q)
        );
      });

    if (sortBy === 'name') {
      return rows.toSorted((a, b) =>
        supplierDisplayName(a).localeCompare(supplierDisplayName(b), 'es')
      );
    }
    if (sortBy === 'balance') {
      return rows.toSorted((a, b) =>
        Math.abs(supplierAccessinBalance(b)) - Math.abs(supplierAccessinBalance(a))
      );
    }
    return rows.toSorted(compareSuppliersByAccessin);
  }, [suppliers, search, categoryFilter, statusFilter, balanceFilter, sortBy]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const erpOpen = useMemo(
    () => suppliers.reduce((sum, s) => sum + Math.max(0, supplierOpenBalance(expenses, s)), 0),
    [suppliers, expenses]
  );

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setError('');
  };

  const startEdit = (supplier) => {
    setEditingId(supplier.id);
    setShowForm(true);
    setForm({
      legalName: supplier.legalName || supplier.name || '',
      tradeName: supplier.tradeName || '',
      cuit: supplier.cuit || '',
      category: supplier.category || 'general',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      notes: supplier.notes || '',
      accessinCode: supplier.accessinCode || '',
      openingBalance: supplier.openingBalance != null ? String(supplier.openingBalance) : '',
    });
    setError('');
    setOk('');
  };

  const onSubmit = (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    try {
      const payload = {
        ...form,
        openingBalance: form.openingBalance === '' ? 0 : Number(form.openingBalance),
      };
      if (editingId) {
        const current = suppliers.find((s) => s.id === editingId);
        upsertSupplier(updateSupplier(current, payload));
        setOk('Proveedor actualizado.');
      } else {
        upsertSupplier(createSupplier(payload));
        setOk('Proveedor dado de alta.');
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'No se pudo guardar el proveedor.');
    }
  };

  const onToggleStatus = (supplier) => {
    const next = supplier.status === 'active' ? 'inactive' : 'active';
    if (typeof toggleSupplierStatus === 'function') {
      toggleSupplierStatus(supplier.id, next);
      return;
    }
    upsertSupplier(setSupplierStatus(supplier, next));
  };

  if (view === 'import') {
    return (
      <SupplierPaymentsImportPanel
        suppliers={suppliers}
        imports={paymentImports}
        onBack={() => setView('padron')}
        onImportBatch={onImportSupplierPayments}
      />
    );
  }

  return (
    <div className="fade-in suppliers-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Truck size={18} /> Proveedores
            <span className="suppliers-accessin-badge">
              Accessin · CC al {formatAsOf(ACCESSIN_SUPPLIERS_AS_OF)}
            </span>
          </h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0' }}>
            Padrón real de cuenta corriente ({suppliers.length} fichas). Saldo positivo = deuda del club.
          </p>
        </div>
      </div>

      <div className="suppliers-action-bar" role="toolbar" aria-label="Acciones de proveedores">
        <button type="button" className="suppliers-action-btn" onClick={() => setView('import')}>
          Importar pagos
        </button>
        <button
          type="button"
          className="suppliers-action-btn"
          onClick={() => (typeof onNavigate === 'function' ? onNavigate('expenses', { import: 'gastos' }) : null)}
        >
          Importar gastos
        </button>
        <button
          type="button"
          className="suppliers-action-btn"
          onClick={() => {
            setShowEntrada(true);
            setError('');
            setOk('');
          }}
        >
          + Entradas
        </button>
        <button
          type="button"
          className="suppliers-action-btn"
          onClick={() => {
            setShowForm(true);
            setEditingId(null);
            setForm(EMPTY_FORM);
            setError('');
            setOk('');
          }}
        >
          + Proveedores
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Fichas</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{suppliers.length}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Con saldo Accessin</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{accessinTotals.withBalance}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Deuda Accessin</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f59e0b' }}>{formatCurrency(accessinTotals.debt)}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>A favor Accessin</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--emerald-accent)' }}>{formatCurrency(accessinTotals.credit)}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Neto Accessin</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: balanceTone(accessinTotals.net) }}>
            {formatCurrency(accessinTotals.net)}
          </div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Gastos ERP abiertos</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{formatCurrency(erpOpen)}</div>
        </div>
      </div>

      <div className="suppliers-filters">
        <div style={{ position: 'relative', gridColumn: '1 / -1' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar por código Accessin, razón social, CUIT o contacto…"
            style={{ paddingLeft: '2.3rem' }}
          />
        </div>
        <select
          className="form-input"
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">Todas las categorías</option>
          {Object.entries(SUPPLIER_CATEGORIES).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <select
          className="form-input"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
          <option value="all">Todos</option>
        </select>
        <select
          className="form-input"
          value={balanceFilter}
          onChange={(e) => {
            setBalanceFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">Todo saldo</option>
          <option value="with">Con saldo</option>
          <option value="debt">Solo deuda</option>
          <option value="credit">Solo a favor</option>
        </select>
        <select
          className="form-input"
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value);
            setPage(0);
          }}
        >
          <option value="accessin">Orden Accessin</option>
          <option value="name">Por nombre</option>
          <option value="balance">Por |saldo|</option>
        </select>
      </div>

      {showForm && (
        <form
          onSubmit={onSubmit}
          style={{
            border: '1px solid var(--border-glass)',
            borderRadius: 12,
            padding: '1rem',
            display: 'grid',
            gap: '0.75rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <div>
            <label className="form-label">Código Accessin</label>
            <input
              className="form-input"
              value={form.accessinCode}
              onChange={(e) => setForm({ ...form, accessinCode: e.target.value })}
              placeholder="ej. 1348"
            />
          </div>
          <div>
            <label className="form-label">Razón social *</label>
            <input className="form-input" required value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Contacto / nombre comercial</label>
            <input className="form-input" value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
          </div>
          <div>
            <label className="form-label">CUIT</label>
            <input className="form-input" value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} placeholder="30-XXXXXXXX-X" />
          </div>
          <div>
            <label className="form-label">Saldo Accessin</label>
            <input
              type="number"
              step="0.01"
              className="form-input"
              value={form.openingBalance}
              onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
              placeholder="0"
            />
          </div>
          <div>
            <label className="form-label">Categoría</label>
            <select className="form-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(SUPPLIER_CATEGORIES).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Teléfono</label>
            <input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Domicilio</label>
            <input className="form-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Notas</label>
            <input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary btn-sm">
              {editingId ? 'Guardar cambios' : 'Alta de proveedor'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={resetForm}>Cancelar</button>
          </div>
        </form>
      )}

      {error && <p style={{ color: '#ef4444', margin: 0 }}>{error}</p>}
      {ok && <p style={{ color: 'var(--emerald-accent)', margin: 0 }}>{ok}</p>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {filtered.length} resultado{filtered.length === 1 ? '' : 's'}
          {filtered.length !== suppliers.length ? ` de ${suppliers.length}` : ''}
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Página anterior"
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: 72, textAlign: 'center' }}>
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            aria-label="Página siguiente"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="table-responsive">
        <table className="admin-table suppliers-table">
          <thead>
            <tr>
              <th>Cód.</th>
              <th>Proveedor</th>
              <th>CUIT</th>
              <th>Contacto</th>
              <th>Saldo Accessin</th>
              <th>Gastos ERP</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ color: 'var(--text-muted)', padding: '1.25rem 1rem' }}>
                  No hay proveedores con estos filtros.
                </td>
              </tr>
            ) : (
              pageRows.map((supplier) => {
                const linked = expensesForSupplier(expenses, supplier);
                const accessinBal = supplierAccessinBalance(supplier);
                const erpBal = linked.length
                  ? linked
                    .filter((e) => ['pending_approval', 'approved'].includes(e.status))
                    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
                  : 0;
                const paid = supplierPaidYtd(expenses, supplier);
                const code = supplierAccessinCode(supplier);
                return (
                  <tr key={supplier.id} className="suppliers-row">
                    <td>
                      <span className="suppliers-code">{code || '—'}</span>
                    </td>
                    <td>
                      <strong>{supplierDisplayName(supplier)}</strong>
                      {supplier.tradeName ? (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{supplier.tradeName}</div>
                      ) : null}
                      {linked.length > 0 && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-gold)', marginTop: 2 }}>
                          {linked.length} gasto{linked.length === 1 ? '' : 's'}
                          {paid ? ` · pagado ${formatCurrency(paid)}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{supplier.cuit || '—'}</td>
                    <td>
                      <div style={{ fontSize: '0.82rem' }}>{supplier.phone || '—'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{supplier.email || 'Sin email'}</div>
                    </td>
                    <td style={{ fontWeight: 700, color: balanceTone(accessinBal), whiteSpace: 'nowrap' }}>
                      {formatCurrency(accessinBal)}
                    </td>
                    <td style={{ fontWeight: 600, color: erpBal > 0 ? '#f59e0b' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {erpBal > 0 ? formatCurrency(erpBal) : '—'}
                    </td>
                    <td>
                      <span className={`status-tag ${supplier.status === 'active' ? 'confirmed' : 'cancelled'}`}>
                        {supplier.status === 'active' ? 'Activo' : 'Inactivo'}
                      </span>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                        {SUPPLIER_CATEGORIES[supplier.category] || supplier.category || '—'}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(supplier)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            border: '1px solid var(--border-glass)',
                            background: supplier.status === 'active' ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.1)',
                            color: supplier.status === 'active' ? '#fca5a5' : 'var(--emerald-accent)',
                          }}
                          onClick={() => onToggleStatus(supplier)}
                        >
                          {supplier.status === 'active' ? <><Ban size={13} /> Baja</> : <><CheckCircle2 size={13} /> Activar</>}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <SupplierEntradaModal
        open={showEntrada}
        onClose={() => setShowEntrada(false)}
        suppliers={suppliers}
        onSave={async (entry) => {
          if (typeof onCreateSupplierEntry !== 'function') {
            throw new Error('Guardado de entradas no disponible.');
          }
          await onCreateSupplierEntry(entry);
          setOk(`Entrada ${entry.typeLabel} registrada · ${entry.supplierName}`);
        }}
      />
    </div>
  );
}

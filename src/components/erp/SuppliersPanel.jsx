import { useMemo, useState } from 'react';
import { Truck, Plus, Search, Ban, CheckCircle2 } from 'lucide-react';
import {
  SUPPLIER_CATEGORIES,
  createSupplier,
  updateSupplier,
  setSupplierStatus,
  expensesForSupplier,
  supplierOpenBalance,
  supplierPaidYtd,
} from '../../domain/accounting/suppliers';
import { formatCurrency } from '../../domain/accounting/journal';

const EMPTY_FORM = {
  legalName: '',
  tradeName: '',
  cuit: '',
  category: 'general',
  email: '',
  phone: '',
  address: '',
  notes: '',
};

export default function SuppliersPanel({
  suppliers = [],
  upsertSupplier,
  toggleSupplierStatus,
  expenses = [],
}) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers
      .filter((s) => (statusFilter === 'all' ? true : s.status === statusFilter))
      .filter((s) => (categoryFilter === 'all' ? true : s.category === categoryFilter))
      .filter((s) => {
        if (!q) return true;
        return (
          s.legalName.toLowerCase().includes(q)
          || (s.tradeName || '').toLowerCase().includes(q)
          || (s.cuit || '').includes(q)
          || (s.phone || '').includes(q)
        );
      })
      .sort((a, b) => a.legalName.localeCompare(b.legalName, 'es'));
  }, [suppliers, search, categoryFilter, statusFilter]);

  const totals = useMemo(() => {
    const active = suppliers.filter((s) => s.status === 'active').length;
    const open = suppliers.reduce((sum, s) => sum + supplierOpenBalance(expenses, s), 0);
    const paid = suppliers.reduce((sum, s) => sum + supplierPaidYtd(expenses, s), 0);
    return { active, open, paid };
  }, [suppliers, expenses]);

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
      legalName: supplier.legalName || '',
      tradeName: supplier.tradeName || '',
      cuit: supplier.cuit || '',
      category: supplier.category || 'general',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      notes: supplier.notes || '',
    });
    setError('');
    setOk('');
  };

  const onSubmit = (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    try {
      if (editingId) {
        const current = suppliers.find((s) => s.id === editingId);
        upsertSupplier(updateSupplier(current, form));
        setOk('Proveedor actualizado.');
      } else {
        upsertSupplier(createSupplier(form));
        setOk('Proveedor dado de alta.');
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'No se pudo guardar el proveedor.');
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Truck size={18} /> Proveedores
          </h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0' }}>
            Altas, cuenta corriente y vínculo con gastos del club.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => {
            setShowForm((v) => !v);
            setEditingId(null);
            setForm(EMPTY_FORM);
            setError('');
          }}
        >
          <Plus size={14} /> {showForm && !editingId ? 'Cerrar' : 'Nuevo proveedor'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Activos</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{totals.active}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Deuda abierta</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f59e0b' }}>{formatCurrency(totals.open)}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Pagado {new Date().getFullYear()}</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--emerald-accent)' }}>{formatCurrency(totals.paid)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '0.75rem' }} className="responsive-form-grid">
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar razón social, CUIT o teléfono…"
            style={{ paddingLeft: '2.3rem' }}
          />
        </div>
        <select className="form-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="all">Todas las categorías</option>
          {Object.entries(SUPPLIER_CATEGORIES).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <select className="form-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
          <option value="all">Todos</option>
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
            <label className="form-label">Razón social *</label>
            <input className="form-input" required value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Nombre comercial</label>
            <input className="form-input" value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
          </div>
          <div>
            <label className="form-label">CUIT</label>
            <input className="form-input" value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} placeholder="30-XXXXXXXX-X" />
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

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>Categoría</th>
              <th>Contacto</th>
              <th>Deuda abierta</th>
              <th>Pagado año</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--text-muted)', padding: '1.25rem 1rem' }}>
                  No hay proveedores con estos filtros.
                </td>
              </tr>
            ) : (
              filtered.map((supplier) => {
                const linked = expensesForSupplier(expenses, supplier);
                const open = supplierOpenBalance(expenses, supplier);
                const paid = supplierPaidYtd(expenses, supplier);
                return (
                  <tr key={supplier.id}>
                    <td>
                      <strong>{supplier.legalName}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {supplier.tradeName || '—'}
                        {supplier.cuit ? ` · ${supplier.cuit}` : ''}
                      </div>
                      {linked.length > 0 && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-gold)', marginTop: 2 }}>
                          {linked.length} gasto{linked.length === 1 ? '' : 's'} vinculado{linked.length === 1 ? '' : 's'}
                        </div>
                      )}
                    </td>
                    <td>{SUPPLIER_CATEGORIES[supplier.category] || supplier.category}</td>
                    <td>
                      <div style={{ fontSize: '0.82rem' }}>{supplier.phone || '—'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{supplier.email || 'Sin email'}</div>
                    </td>
                    <td style={{ fontWeight: 700, color: open > 0 ? '#f59e0b' : 'var(--text-secondary)' }}>
                      {formatCurrency(open)}
                    </td>
                    <td>{formatCurrency(paid)}</td>
                    <td>
                      <span className={`status-tag ${supplier.status === 'active' ? 'confirmed' : 'cancelled'}`}>
                        {supplier.status === 'active' ? 'Activo' : 'Inactivo'}
                      </span>
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
                          onClick={() => toggleSupplierStatus(supplier.id, supplier.status === 'active' ? 'inactive' : 'active')}
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
    </div>
  );
}

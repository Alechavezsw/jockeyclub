import { useMemo, useState } from 'react';
import { Percent, Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  ACCESSIN_RETENCIONES_AS_OF,
  ACCESSIN_RETENCIONES_PERIOD_FROM,
  ACCESSIN_RETENCIONES_PERIOD_TO,
  RETENCION_STATUS,
  compareRetenciones,
  createRetencion,
  retencionTotals,
  updateRetencion,
} from '../../domain/accounting/retenciones';
import { formatCurrency } from '../../domain/accounting/journal';

const PAGE_SIZE = 40;

const EMPTY_FORM = {
  clientName: 'Jockey Club San Juan',
  supplierName: '',
  paymentOrderNumber: '',
  paymentOrderAmount: '',
  retentionType: '',
  retentionDate: new Date().toISOString().slice(0, 10),
  retentionAmount: '',
  notes: '',
};

function formatIsoDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function RetencionesPanel({
  retenciones = [],
  upsertRetencion,
  suppliers = [],
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const types = useMemo(() => {
    const set = new Set();
    retenciones.forEach((r) => {
      if (r.retentionType) set.add(r.retentionType);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [retenciones]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return retenciones
      .filter((r) => (typeFilter === 'all' ? true : r.retentionType === typeFilter))
      .filter((r) => {
        if (!q) return true;
        return (
          String(r.supplierName || '').toLowerCase().includes(q)
          || String(r.clientName || '').toLowerCase().includes(q)
          || String(r.paymentOrderNumber || '').toLowerCase().includes(q)
          || String(r.retentionType || '').toLowerCase().includes(q)
        );
      })
      .toSorted(compareRetenciones);
  }, [retenciones, search, typeFilter]);

  const totals = useMemo(() => retencionTotals(filtered), [filtered]);
  const allTotals = useMemo(() => retencionTotals(retenciones), [retenciones]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setError('');
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setShowForm(true);
    setForm({
      clientName: item.clientName || '',
      supplierName: item.supplierName || '',
      paymentOrderNumber: item.paymentOrderNumber || '',
      paymentOrderAmount: item.paymentOrderAmount != null ? String(item.paymentOrderAmount) : '',
      retentionType: item.retentionType || '',
      retentionDate: item.retentionDate || '',
      retentionAmount: item.retentionAmount != null ? String(item.retentionAmount) : '',
      notes: item.notes || '',
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
        paymentOrderAmount: form.paymentOrderAmount === '' ? 0 : Number(form.paymentOrderAmount),
        retentionAmount: form.retentionAmount === '' ? 0 : Number(form.retentionAmount),
      };
      if (editingId) {
        const current = retenciones.find((r) => r.id === editingId);
        upsertRetencion(updateRetencion(current, payload));
        setOk('Retención actualizada.');
      } else {
        upsertRetencion(createRetencion(payload));
        setOk('Retención registrada.');
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'No se pudo guardar la retención.');
    }
  };

  return (
    <div className="fade-in retenciones-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Percent size={18} /> Retenciones
            <span className="suppliers-accessin-badge">
              Accessin · {formatIsoDate(ACCESSIN_RETENCIONES_PERIOD_FROM)} – {formatIsoDate(ACCESSIN_RETENCIONES_PERIOD_TO || ACCESSIN_RETENCIONES_AS_OF)}
            </span>
          </h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0' }}>
            Resumen de retenciones sobre órdenes de pago a proveedores (export Accessin).
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
          <Plus size={14} /> {showForm && !editingId ? 'Cerrar' : 'Nueva retención'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Registros</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{allTotals.count}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Total retenido</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f59e0b' }}>{formatCurrency(allTotals.total)}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Base OP (período)</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{formatCurrency(allTotals.paymentOrders)}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Tipos</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{Object.keys(allTotals.byType).length}</div>
        </div>
      </div>

      {Object.keys(allTotals.byType).length > 0 && (
        <div className="retenciones-by-type">
          {Object.entries(allTotals.byType)
            .toSorted((a, b) => b[1] - a[1])
            .map(([type, amount]) => (
              <div key={type} className="retenciones-type-chip">
                <span>{type}</span>
                <strong>{formatCurrency(amount)}</strong>
              </div>
            ))}
        </div>
      )}

      <div className="suppliers-filters" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar proveedor, OP o tipo…"
            style={{ paddingLeft: '2.3rem' }}
          />
        </div>
        <select
          className="form-input"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">Todos los tipos</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
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
            <label className="form-label">Cliente</label>
            <input className="form-input" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Proveedor</label>
            <input
              className="form-input"
              list="retencion-suppliers"
              required
              value={form.supplierName}
              onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
            />
            <datalist id="retencion-suppliers">
              {suppliers.filter((s) => s.status !== 'inactive').map((s) => (
                <option key={s.id} value={s.legalName || s.name || ''} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="form-label">Orden de pago #</label>
            <input className="form-input" value={form.paymentOrderNumber} onChange={(e) => setForm({ ...form, paymentOrderNumber: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Monto OP</label>
            <input type="number" step="0.01" className="form-input" value={form.paymentOrderAmount} onChange={(e) => setForm({ ...form, paymentOrderAmount: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Tipo retención</label>
            <input className="form-input" list="retencion-types" value={form.retentionType} onChange={(e) => setForm({ ...form, retentionType: e.target.value })} placeholder="Ganancias / IVA / SUSS…" />
            <datalist id="retencion-types">
              {types.map((t) => <option key={t} value={t} />)}
              <option value="Ganancias" />
              <option value="IVA" />
              <option value="SUSS" />
              <option value="IIBB" />
            </datalist>
          </div>
          <div>
            <label className="form-label">Fecha retención</label>
            <input type="date" className="form-input" required value={form.retentionDate} onChange={(e) => setForm({ ...form, retentionDate: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Monto retención *</label>
            <input type="number" step="0.01" required className="form-input" value={form.retentionAmount} onChange={(e) => setForm({ ...form, retentionAmount: e.target.value })} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Notas</label>
            <input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary btn-sm">
              {editingId ? 'Guardar cambios' : 'Registrar retención'}
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
          {filtered.length ? ` · filtrado ${formatCurrency(totals.total)}` : ''}
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: 72, textAlign: 'center' }}>
            {safePage + 1} / {pageCount}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="table-responsive">
        <table className="admin-table retenciones-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Proveedor</th>
              <th>OP</th>
              <th>Monto OP</th>
              <th>Tipo</th>
              <th>Fecha</th>
              <th>Retención</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ color: 'var(--text-muted)', padding: '1.35rem 1rem' }}>
                  Sin retenciones en el período Accessin ({formatIsoDate(ACCESSIN_RETENCIONES_PERIOD_FROM)} – {formatIsoDate(ACCESSIN_RETENCIONES_PERIOD_TO)}).
                  Podés registrar nuevas con el botón de arriba.
                </td>
              </tr>
            ) : (
              pageRows.map((item) => (
                <tr key={item.id} className="suppliers-row">
                  <td><span className="suppliers-code">{item.lineNumber || '—'}</span></td>
                  <td>
                    <strong>{item.supplierName || '—'}</strong>
                    {item.clientName ? (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.clientName}</div>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.paymentOrderNumber || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.paymentOrderAmount ? formatCurrency(item.paymentOrderAmount) : '—'}</td>
                  <td>{item.retentionType || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatIsoDate(item.retentionDate)}</td>
                  <td style={{ fontWeight: 700, color: '#f59e0b', whiteSpace: 'nowrap' }}>{formatCurrency(item.retentionAmount)}</td>
                  <td>
                    <span className={`status-tag ${item.status === 'void' ? 'cancelled' : 'confirmed'}`}>
                      {RETENCION_STATUS[item.status] || item.status || 'Registrada'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(item)}>
                      Editar
                    </button>
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

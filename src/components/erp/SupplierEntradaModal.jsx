import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import {
  SUPPLIER_ENTRY_TYPE_OPTIONS,
  createSupplierEntry,
} from '../../domain/accounting/supplierEntries';
import {
  compareSuppliersByAccessin,
  supplierAccessinCode,
  supplierDisplayName,
} from '../../domain/accounting/suppliers';

const EMPTY = {
  type: 'pago',
  supplierId: '',
  date: new Date().toISOString().slice(0, 10),
  amount: '',
  concept: '',
  invoiceNumber: '',
  notes: '',
};

export default function SupplierEntradaModal({
  open,
  onClose,
  suppliers = [],
  onSave,
}) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        ...EMPTY,
        date: new Date().toISOString().slice(0, 10),
      });
      setError('');
      setBusy(false);
    }
  }, [open]);

  const supplierOptions = useMemo(
    () => suppliers
      .filter((s) => s.status !== 'inactive')
      .toSorted(compareSuppliersByAccessin),
    [suppliers]
  );

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const supplier = supplierOptions.find((s) => s.id === form.supplierId);
      if (!supplier) throw new Error('Seleccioná un proveedor.');
      const entry = createSupplierEntry({
        type: form.type,
        supplierId: supplier.id,
        supplierName: supplierDisplayName(supplier),
        accessinCode: supplierAccessinCode(supplier),
        date: form.date,
        amount: form.amount,
        concept: form.concept,
        invoiceNumber: form.invoiceNumber,
        notes: form.notes,
      });
      if (typeof onSave === 'function') {
        await onSave(entry);
      }
      onClose?.();
    } catch (err) {
      setError(err.message || 'No se pudo guardar la entrada.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      labelledBy="supplier-entrada-title"
      contentStyle={{ maxWidth: 520, width: '100%' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.85rem' }}>
        <h3
          id="supplier-entrada-title"
          style={{ margin: 0, fontSize: '1rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}
        >
          Crear nueva entrada
        </h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Cerrar">
          <X size={16} />
        </button>
      </div>

      <form onSubmit={submit} style={{ display: 'grid', gap: '0.85rem' }}>
        <div>
          <label className="form-label" htmlFor="sent-type">Tipo</label>
          <select
            id="sent-type"
            className="form-input"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            required
          >
            {SUPPLIER_ENTRY_TYPE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label" htmlFor="sent-supplier">Proveedor</label>
          <select
            id="sent-supplier"
            className="form-input"
            value={form.supplierId}
            onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            required
          >
            <option value="">Seleccionar proveedor…</option>
            {supplierOptions.map((s) => {
              const code = supplierAccessinCode(s);
              const name = supplierDisplayName(s);
              return (
                <option key={s.id} value={s.id}>
                  {code ? `#${code} ${name}` : name}
                </option>
              );
            })}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label className="form-label" htmlFor="sent-date">Fecha</label>
            <input
              id="sent-date"
              type="date"
              className="form-input"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="sent-amount">Monto</label>
            <input
              id="sent-amount"
              type="number"
              min="0.01"
              step="0.01"
              className="form-input"
              required
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
            />
          </div>
        </div>

        <div>
          <label className="form-label" htmlFor="sent-invoice">N° comprobante</label>
          <input
            id="sent-invoice"
            className="form-input"
            value={form.invoiceNumber}
            onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
          />
        </div>

        <div>
          <label className="form-label" htmlFor="sent-concept">Concepto</label>
          <input
            id="sent-concept"
            className="form-input"
            value={form.concept}
            onChange={(e) => setForm({ ...form, concept: e.target.value })}
            placeholder="Detalle de la entrada"
          />
        </div>

        <div>
          <label className="form-label" htmlFor="sent-notes">Notas</label>
          <input
            id="sent-notes"
            className="form-input"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        {error ? <p style={{ color: '#ef4444', margin: 0 }}>{error}</p> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.55rem', marginTop: '0.35rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar entrada'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

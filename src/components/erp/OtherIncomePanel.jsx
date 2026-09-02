import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Banknote, Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  OTHER_INCOME_GROUPS,
  OTHER_INCOME_PAYERS,
  OTHER_INCOME_PAYMENT_METHODS,
  createOtherIncome,
  linesTotal,
  validateOtherIncomeAttachment,
} from '../../domain/accounting/otherIncomes';
import { isSupabaseConfigured } from '../../lib/supabase';
import { uploadOtherIncomeAttachment } from '../../data/storage';

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  payerType: 'manual',
  payerName: '',
  concept: '',
  group: 'uncategorized',
  paymentMethod: 'efectivo',
  amount: '',
  documentId: '',
  address: '',
  contact: '',
  operationRef: '',
  notes: '',
  signatureLegend: '',
};

function Section({ title, children }) {
  return (
    <section className="oi-section">
      <h5 className="oi-section-title">{title}</h5>
      <div className="oi-section-body">{children}</div>
    </section>
  );
}

function FieldRow({ label, children, hint }) {
  return (
    <div className="oi-field-row">
      <label className="oi-field-label">{label}</label>
      <div className="oi-field-control">
        {children}
        {hint ? <p className="oi-field-hint">{hint}</p> : null}
      </div>
    </div>
  );
}

export default function OtherIncomePanel({ items = [], onCreate }) {
  const [view, setView] = useState('list'); // list | form
  const [form, setForm] = useState(EMPTY_FORM);
  const [lines, setLines] = useState([]);
  const [fileSlots, setFileSlots] = useState([null]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (view === 'form') {
      setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) });
      setLines([]);
      setFileSlots([null]);
      setError('');
      setBusy(false);
    }
  }, [view]);

  const computedAmount = useMemo(() => {
    const fromLines = linesTotal(lines);
    if (fromLines > 0) return fromLines;
    return Number(form.amount) || 0;
  }, [lines, form.amount]);

  const totals = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    const monthItems = items.filter((i) => String(i.date || '').startsWith(month));
    return {
      count: items.length,
      monthCount: monthItems.length,
      monthTotal: monthItems.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    };
  }, [items]);

  const setF = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, description: '', quantity: 1, unitPrice: '' },
    ]);
  };

  const updateLine = (id, patch) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLine = (id) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const setFileAt = (index, file) => {
    setError('');
    try {
      if (file) validateOtherIncomeAttachment(file);
      setFileSlots((prev) => prev.map((f, i) => (i === index ? file : f)));
    } catch (err) {
      setError(err.message);
    }
  };

  const removeFileSlot = (index) => {
    setFileSlots((prev) => {
      if (prev.length === 1) return [null];
      return prev.filter((_, i) => i !== index);
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const draftId = `oi-${Date.now()}`;
      const attachments = [];
      for (const file of fileSlots.filter(Boolean)) {
        if (isSupabaseConfigured) {
          try {
            const uploaded = await uploadOtherIncomeAttachment(file, { incomeId: draftId });
            attachments.push({
              name: uploaded.name,
              url: uploaded.url,
              path: uploaded.path,
              mimeType: uploaded.mimeType,
              size: uploaded.size,
            });
          } catch {
            attachments.push({
              name: file.name,
              mimeType: file.type,
              size: file.size,
              localOnly: true,
            });
          }
        } else {
          attachments.push({
            name: file.name,
            mimeType: file.type,
            size: file.size,
            localOnly: true,
          });
        }
      }

      const income = createOtherIncome({
        ...form,
        amount: computedAmount,
        lines,
        attachments,
      });
      income.id = draftId;

      if (typeof onCreate !== 'function') throw new Error('Guardado no disponible.');
      await onCreate(income);
      setOk(`Ingreso creado · ${income.payerName} · ${formatCurrency(income.amount)}`);
      setView('list');
    } catch (err) {
      setError(err.message || 'No se pudo crear el ingreso.');
    } finally {
      setBusy(false);
    }
  };

  if (view === 'form') {
    return (
      <div className="fade-in oi-panel">
        <div className="oi-form-header">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView('list')}>
            <ArrowLeft size={14} /> Volver
          </button>
          <h4 className="serif-font oi-form-title">Cargar otro ingreso</h4>
        </div>

        <form className="glass-card oi-form" onSubmit={submit}>
          <Section title="Datos del ingreso">
            <FieldRow label="Fecha">
              <input type="date" className="form-input" required value={form.date} onChange={(e) => setF('date', e.target.value)} />
            </FieldRow>
            <FieldRow label="Recibimos de">
              <select className="form-input" value={form.payerType} onChange={(e) => setF('payerType', e.target.value)}>
                {Object.entries(OTHER_INCOME_PAYERS).map(([id, meta]) => (
                  <option key={id} value={id}>{meta.label}</option>
                ))}
              </select>
            </FieldRow>
            {form.payerType === 'manual' ? (
              <FieldRow label="Nombre (carga manual)">
                <input className="form-input" value={form.payerName} onChange={(e) => setF('payerName', e.target.value)} required />
              </FieldRow>
            ) : (
              <FieldRow label="Nombre">
                <input className="form-input" value={form.payerName} onChange={(e) => setF('payerName', e.target.value)} required />
              </FieldRow>
            )}
            <FieldRow label="Concepto">
              <input className="form-input" value={form.concept} onChange={(e) => setF('concept', e.target.value)} required />
            </FieldRow>
            <FieldRow label="Grupo de entradas personalizadas">
              <select className="form-input" value={form.group} onChange={(e) => setF('group', e.target.value)}>
                {Object.entries(OTHER_INCOME_GROUPS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Medio de cobro">
              <select className="form-input" value={form.paymentMethod} onChange={(e) => setF('paymentMethod', e.target.value)}>
                {Object.entries(OTHER_INCOME_PAYMENT_METHODS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </FieldRow>
            <FieldRow
              label="Importe"
              hint="Si carga líneas de desglose, el importe se calcula automáticamente"
            >
              <input
                type="number"
                min="0"
                step="0.01"
                className="form-input"
                value={linesTotal(lines) > 0 ? computedAmount : form.amount}
                onChange={(e) => setF('amount', e.target.value)}
                readOnly={linesTotal(lines) > 0}
                required={linesTotal(lines) <= 0}
              />
            </FieldRow>
          </Section>

          <Section title="Desglose en líneas (opcional)">
            <div className="table-responsive">
              <table className="admin-table oi-lines-table">
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th style={{ width: 110 }}>Cantidad</th>
                    <th style={{ width: 140 }}>Precio unitario</th>
                    <th style={{ width: 48 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <input
                          className="form-input"
                          value={line.description}
                          onChange={(e) => updateLine(line.id, { description: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="form-input"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="form-input"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                        />
                      </td>
                      <td>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeLine(line.id)} aria-label="Quitar línea">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addLine}>
              <Plus size={14} /> Agregar línea
            </button>
          </Section>

          <Section title="Datos opcionales del recibo">
            <FieldRow label="DNI/CUIT">
              <input className="form-input" value={form.documentId} onChange={(e) => setF('documentId', e.target.value)} />
            </FieldRow>
            <FieldRow label="Domicilio">
              <input className="form-input" value={form.address} onChange={(e) => setF('address', e.target.value)} />
            </FieldRow>
            <FieldRow label="Contacto">
              <input className="form-input" value={form.contact} onChange={(e) => setF('contact', e.target.value)} />
            </FieldRow>
            <FieldRow label="Referencia de operación">
              <input className="form-input" value={form.operationRef} onChange={(e) => setF('operationRef', e.target.value)} />
            </FieldRow>
            <FieldRow label="Observaciones">
              <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setF('notes', e.target.value)} />
            </FieldRow>
            <FieldRow
              label="Firma / leyenda"
              hint="Leyenda que se muestra al pie del recibo (ej. aclaración de firma)."
            >
              <textarea className="form-input" rows={2} value={form.signatureLegend} onChange={(e) => setF('signatureLegend', e.target.value)} />
            </FieldRow>
          </Section>

          <Section title="Adjuntos">
            {fileSlots.map((file, index) => (
              <div key={`slot-${index}`} className="oi-attach-row">
                <span className="oi-field-label">Adjuntar</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => setFileAt(index, e.target.files?.[0] || null)}
                />
                <button type="button" className="btn btn-sm oi-attach-remove" onClick={() => removeFileSlot(index)}>
                  Eliminar
                </button>
                {file ? <span className="oi-attach-name">{file.name}</span> : null}
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setFileSlots((prev) => [...prev, null])}
            >
              Más archivos
            </button>
            <p className="oi-field-hint">PDF, JPG o PNG. Tamaño máximo: 5MB.</p>
          </Section>

          {error ? <p style={{ color: '#ef4444', margin: 0 }}>{error}</p> : null}

          <div className="oi-form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setView('list')} disabled={busy}>
              Volver
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h4 className="serif-font" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Banknote size={18} /> Otros ingresos
          </h4>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Cobros manuales con recibo, desglose y adjuntos.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setView('form')}>
          <Plus size={14} /> Cargar otro ingreso
        </button>
      </div>

      {ok ? <p style={{ color: 'var(--emerald-accent)', margin: 0 }}>{ok}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Registrados</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{totals.count}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Este mes</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{totals.monthCount}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Monto del mes</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--emerald-accent)' }}>
            {formatCurrency(totals.monthTotal)}
          </div>
        </div>
      </div>

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Recibido de</th>
              <th>Concepto</th>
              <th>Grupo</th>
              <th>Medio</th>
              <th>Importe</th>
              <th>Adj.</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                  Todavía no hay otros ingresos. Usá “Cargar otro ingreso”.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>{item.date}</td>
                  <td>{item.payerName}</td>
                  <td>{item.concept}</td>
                  <td>{item.groupLabel || item.group}</td>
                  <td>{item.paymentMethodLabel || item.paymentMethod}</td>
                  <td style={{ fontWeight: 700 }}>{formatCurrency(item.amount)}</td>
                  <td>{(item.attachments || []).length || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

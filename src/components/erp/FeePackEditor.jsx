import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { EXPENSE_CATEGORIES, periodLabel } from '../../domain/accounting/feeBilling';

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function FeePackEditor({
  period,
  draft,
  formatCurrency,
  busy = false,
  liquidateBlocked = '',
  canEditAmounts = false,
  onSave,
  onLiquidate,
  onCancel,
}) {
  const [form, setForm] = useState(draft);
  useEffect(() => {
    setForm(draft);
  }, [draft]);
  const concepts = form.concepts || [];
  const categoryNames = concepts.map((row) => row.label).filter(Boolean);
  const conceptTotal = concepts.reduce((sum, row) => sum + money(row.holders) * money(row.amount), 0);
  const expenseTotal = (form.expenses || []).reduce((sum, row) => sum + money(row.amount), 0);

  const patchConcept = (index, amount) => {
    if (!canEditAmounts) return;
    setForm((current) => ({
      ...current,
      concepts: current.concepts.map((row, i) => (i === index ? { ...row, amount } : row)),
    }));
  };

  const patchList = (key, index, patch) => {
    setForm((current) => ({
      ...current,
      [key]: current[key].map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const addRow = (key, row) => {
    setForm((current) => ({ ...current, [key]: [...(current[key] || []), row] }));
  };

  const removeRow = (key, index) => {
    setForm((current) => ({
      ...current,
      [key]: current[key].filter((_, i) => i !== index),
    }));
  };

  return (
    <form
      className="cuotas-edit"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(form);
      }}
    >
      <div className="cuotas-edit-head">
        <label className="form-label">
          Período
          <input className="form-input" value={periodLabel(period)} readOnly />
        </label>
        <label className="form-label">
          Fecha de imputación
          <input
            type="date"
            className="form-input"
            value={form.imputeDate || ''}
            onChange={(event) => setForm((current) => ({ ...current, imputeDate: event.target.value }))}
          />
        </label>
      </div>
      <p className="cuotas-edit-note">
        Nota: Se recomienda no cambiar la fecha por defecto, de cambiarla por favor controlar que la fecha sea la correcta.
      </p>

      <fieldset className="cuotas-edit-block">
        <legend>Categoría de cuotas</legend>
        {!canEditAmounts ? (
          <p className="cuotas-edit-note">
            Los valores de categoría solo los puede modificar el superadministrador.
          </p>
        ) : null}
        <div className="table-responsive">
          <table className="admin-table cuotas-liq-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Identificador</th>
                <th>Socios titulares activos</th>
                <th>Valor</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {concepts.length === 0 ? (
                <tr>
                  <td colSpan={5}>Cargando categorías desde el padrón…</td>
                </tr>
              ) : concepts.map((row, index) => (
                <tr key={`${row.id}-${row.label}`}>
                  <td>{row.id || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{row.label}</td>
                  <td className="num">{row.holders || '—'}</td>
                  <td className="num">
                    {canEditAmounts ? (
                      <input
                        className="form-input cuotas-edit-money"
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Valor de ${row.label}`}
                        value={row.amount}
                        onChange={(event) => patchConcept(index, event.target.value)}
                      />
                    ) : (
                      <span className="tabular-nums">{formatCurrency(money(row.amount))}</span>
                    )}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatCurrency(money(row.holders) * money(row.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {concepts.length > 0 ? (
          <div className="cuotas-edit-total-bar" aria-label="Total cuotas">
            <span>Total cuotas</span>
            <strong className="tabular-nums">{formatCurrency(conceptTotal)}</strong>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="cuotas-edit-block">
        <legend>Gastos de la liquidación</legend>
        <div className="cuotas-edit-subhead">
          <span>Gastos proveedores — porcentual (%)</span>
        </div>
        {(form.expenses || []).map((row, index) => (
          <div className="cuotas-edit-grid" key={`gasto-${index}`}>
            <label className="form-label">
              Concepto
              <input
                className="form-input"
                value={row.concept}
                onChange={(event) => patchList('expenses', index, { concept: event.target.value })}
              />
            </label>
            <label className="form-label">
              Categoría
              <select
                className="form-input"
                value={row.category}
                onChange={(event) => patchList('expenses', index, { category: event.target.value })}
              >
                {EXPENSE_CATEGORIES.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Monto
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                value={row.amount}
                onChange={(event) => patchList('expenses', index, { amount: event.target.value })}
              />
            </label>
            <label className="form-label">
              Nro de comprobante
              <input
                className="form-input"
                value={row.receiptNumber}
                onChange={(event) => patchList('expenses', index, { receiptNumber: event.target.value })}
              />
            </label>
            <label className="form-label">
              Fecha de comprobante
              <input
                className="form-input"
                type="date"
                value={row.receiptDate || ''}
                onChange={(event) => patchList('expenses', index, { receiptDate: event.target.value })}
              />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeRow('expenses', index)}>
              <Trash2 size={14} /> Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-emerald btn-sm"
          onClick={() => addRow('expenses', {
            concept: '',
            category: EXPENSE_CATEGORIES[0],
            amount: 0,
            receiptNumber: '',
            receiptDate: '',
          })}
        >
          <Plus size={14} /> Agregar gasto en gastos proveedores
        </button>
        {expenseTotal > 0 ? (
          <p className="cuotas-edit-note">Gastos {formatCurrency(expenseTotal)}</p>
        ) : null}
      </fieldset>

      <fieldset className="cuotas-edit-block">
        <legend>Recargos</legend>
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo de recargo</th>
                <th>Categorías de cuotas</th>
                <th>Valor</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(form.surcharges || []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-muted)' }}>Sin recargos.</td>
                </tr>
              ) : (form.surcharges || []).map((row, index) => (
                <tr key={`recargo-${index}`}>
                  <td>
                    <input
                      className="form-input"
                      type="date"
                      value={row.date || ''}
                      onChange={(event) => patchList('surcharges', index, { date: event.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="form-input"
                      value={row.type}
                      onChange={(event) => patchList('surcharges', index, { type: event.target.value })}
                    >
                      <option value="percentage">% sobre las cuotas</option>
                      <option value="fixed">Valor fijo</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-input"
                      value={row.category}
                      onChange={(event) => patchList('surcharges', index, { category: event.target.value })}
                    >
                      <option value="">Elegir</option>
                      {categoryNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="form-input cuotas-edit-money"
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.value}
                      onChange={(event) => patchList('surcharges', index, { value: event.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cash-lila-icon-btn is-del"
                      title="Quitar recargo"
                      aria-label="Quitar recargo"
                      onClick={() => removeRow('surcharges', index)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-emerald btn-sm"
          onClick={() => addRow('surcharges', {
            date: form.imputeDate || '',
            category: categoryNames.find((n) => /familiar/i.test(n)) || categoryNames[0] || '',
            type: 'percentage',
            value: 10,
          })}
        >
          <Plus size={14} /> Agregar recargo
        </button>
      </fieldset>

      <fieldset className="cuotas-edit-block">
        <legend>Boleto de pago</legend>
        <label className="form-label">
          Fecha de vencimiento
          <input
            className="form-input"
            type="date"
            value={form.paymentTicketDueDate || ''}
            onChange={(event) => setForm((current) => ({
              ...current,
              paymentTicketDueDate: event.target.value,
            }))}
          />
        </label>
        <p className="cuotas-edit-note">
          Fecha informativa en el boleto de pago, debe ser posterior a los recargos en las cuotas.
        </p>
      </fieldset>

      <fieldset className="cuotas-edit-block">
        <legend>Alertas de vencimiento</legend>
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(form.alerts || []).length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ color: 'var(--text-muted)' }}>Sin alertas.</td>
                </tr>
              ) : (form.alerts || []).map((row, index) => (
                <tr key={`alerta-${index}`}>
                  <td>{index + 1}</td>
                  <td>
                    <input
                      className="form-input"
                      type="date"
                      value={row.date || ''}
                      onChange={(event) => patchList('alerts', index, { date: event.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cash-lila-icon-btn is-del"
                      title="Quitar alerta"
                      aria-label="Quitar alerta"
                      onClick={() => removeRow('alerts', index)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-emerald btn-sm"
          onClick={() => addRow('alerts', { date: '' })}
        >
          <Plus size={14} /> Agregar alerta
        </button>
      </fieldset>

      <fieldset className="cuotas-edit-block">
        <legend>Acciones automáticas luego de liquidar</legend>
        <label className="form-label">
          ¿Imputar saldos a favor?
          <select
            className="form-input"
            value={form.imputeOverpayments ? 'si' : 'no'}
            onChange={(event) => setForm((current) => ({
              ...current,
              imputeOverpayments: event.target.value === 'si',
            }))}
          >
            <option value="no">No</option>
            <option value="si">Sí</option>
          </select>
        </label>
        <p className="cuotas-edit-note">
          Se crearán pagos utilizando el saldo pendiente de imputación luego de liquidar.
        </p>
        <label className="form-label">
          ¿Redondear cuotas?
          <select
            className="form-input"
            value={form.isRounded ? 'si' : 'no'}
            onChange={(event) => setForm((current) => ({
              ...current,
              isRounded: event.target.value === 'si',
            }))}
          >
            <option value="no">No</option>
            <option value="si">Sí</option>
          </select>
        </label>
        {form.isRounded ? (
          <label className="form-label">
            Redondear a
            <select
              className="form-input"
              value={form.roundingOption || 'peso'}
              onChange={(event) => setForm((current) => ({
                ...current,
                roundingOption: event.target.value,
              }))}
            >
              <option value="peso">1 peso (importes sin centavos)</option>
              <option value="diez">10 pesos (último dígito en 0)</option>
            </select>
          </label>
        ) : null}
        <label className="form-label">
          Finalizar comunicaciones con motivo
          <input
            className="form-input"
            value={form.finalizeCommunicationsMotive || ''}
            onChange={(event) => setForm((current) => ({
              ...current,
              finalizeCommunicationsMotive: event.target.value,
            }))}
            placeholder=""
          />
        </label>
        <p className="cuotas-edit-note">
          Se finalizarán todas aquellas comunicaciones en estado No respondida o En progreso que tengan el motivo
          seleccionado y hayan sido creadas antes de la fecha de imputación.
        </p>
      </fieldset>

      <div className="cuotas-edit-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Volver
        </button>
        <button type="submit" className="btn btn-emerald" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar y liquidar después'}
        </button>
        {typeof onLiquidate === 'function' ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || Boolean(liquidateBlocked)}
            title={liquidateBlocked || 'Liquidar período'}
            onClick={() => onLiquidate(form)}
          >
            Liquidar
          </button>
        ) : null}
      </div>
    </form>
  );
}

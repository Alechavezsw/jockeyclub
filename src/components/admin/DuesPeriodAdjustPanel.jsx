import { useMemo, useState } from 'react';
import { PencilLine, Undo2 } from 'lucide-react';
import { money } from '../../domain/money';
import { duesMonthLabel } from '../../domain/members/duesImputations';
import {
  DUES_ADJUSTMENT_MIN_REASON,
  activeDuesPeriodAdjustments,
  adjustmentDueOn,
  duesPeriodAdjustmentFromRow,
  validateDuesPeriodAdjustmentDraft,
} from '../../domain/members/duesPeriodAdjustments';

function currentYm(today = new Date()) {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function formatWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Ajuste administrativo por período, dentro de Cobrar cuota.
 * Solo administrador. Cada cambio queda auditado en la base (quién, cuándo, antes, motivo).
 * No toca el saldo de la ficha: corrige el capital exigible de cada mes.
 */
export default function DuesPeriodAdjustPanel({
  choices = [],
  adjustments = [],
  formatCurrency,
  onSave,
  onVoid,
  today = new Date(),
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [bulkAmount, setBulkAmount] = useState('');
  const [newMonth, setNewMonth] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const active = useMemo(
    () => activeDuesPeriodAdjustments({ duesPeriodAdjustments: adjustments }),
    [adjustments],
  );
  const history = useMemo(
    () => (adjustments || [])
      .map(duesPeriodAdjustmentFromRow)
      .filter(Boolean)
      .toSorted((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [adjustments],
  );
  const rows = useMemo(() => {
    const byYm = new Map();
    for (const row of choices || []) {
      if (row?.rowScope === 'tenis' || row?.chargeScope === 'abono_tenis') continue;
      const dueOn = adjustmentDueOn(row?.dueOn);
      if (!dueOn) continue;
      byYm.set(dueOn.slice(0, 7), { dueOn, label: row.label || duesMonthLabel(dueOn), capital: money(row.capital), adjustment: row.adjustment || null });
    }
    for (const adj of active) {
      const ym = adj.dueOn.slice(0, 7);
      if (adj.action === 'remove' && !byYm.has(ym)) {
        byYm.set(ym, { dueOn: adj.dueOn, label: duesMonthLabel(adj.dueOn), capital: 0, adjustment: adj, removed: true });
      }
    }
    return [...byYm.values()].toSorted((a, b) => a.dueOn.localeCompare(b.dueOn));
  }, [choices, active]);

  const setDraft = (dueOn, patch) => {
    setNotice('');
    setError('');
    setDrafts((prev) => ({ ...prev, [dueOn]: { ...(prev[dueOn] || {}), ...patch } }));
  };

  const pending = useMemo(() => {
    const out = [];
    for (const row of rows) {
      const draft = drafts[row.dueOn];
      if (!draft) continue;
      if (draft.remove) {
        if (!row.removed) out.push({ dueOn: row.dueOn, action: 'remove', capital: null });
        continue;
      }
      if (draft.amount === '' || draft.amount == null) continue;
      const amount = money(Number(draft.amount) || 0);
      if (row.removed || Math.abs(amount - row.capital) > 0.009) {
        out.push({ dueOn: row.dueOn, action: 'set', capital: amount });
      }
    }
    if (newMonth && newAmount !== '') {
      out.push({ dueOn: adjustmentDueOn(newMonth), action: 'set', capital: money(Number(newAmount) || 0) });
    }
    return out;
  }, [rows, drafts, newMonth, newAmount]);

  const applyBulk = () => {
    const amount = Number(bulkAmount);
    if (!(amount > 0)) {
      setError('Ingresá el monto de cuota para todos los meses.');
      return;
    }
    const next = {};
    for (const row of rows) next[row.dueOn] = { amount: String(amount), remove: false };
    setDrafts(next);
    setError('');
  };

  const save = async () => {
    setError('');
    setNotice('');
    if (!pending.length) {
      setError('No hay cambios para guardar.');
      return;
    }
    for (const item of pending) {
      const message = validateDuesPeriodAdjustmentDraft({ ...item, reason }, today);
      if (message) {
        setError(`${duesMonthLabel(item.dueOn) || item.dueOn}: ${message}`);
        return;
      }
    }
    setBusy(true);
    let saved = 0;
    try {
      for (const item of pending) {
        await onSave({ ...item, reason: reason.trim() });
        saved += 1;
      }
      setDrafts({});
      setNewMonth('');
      setNewAmount('');
      setBulkAmount('');
      setReason('');
      setNotice(`Ajuste guardado (${saved} ${saved === 1 ? 'mes' : 'meses'}). El cobro ya usa los montos corregidos.`);
    } catch (err) {
      setError(`${saved ? `Se guardaron ${saved}. ` : ''}${err?.message || 'No se pudo guardar el ajuste.'}`);
    } finally {
      setBusy(false);
    }
  };

  const voidOne = async (adj) => {
    const why = window.prompt(`Motivo para anular el ajuste de ${duesMonthLabel(adj.dueOn)} (mínimo ${DUES_ADJUSTMENT_MIN_REASON} caracteres):`);
    if (why == null) return;
    if (why.trim().length < DUES_ADJUSTMENT_MIN_REASON) {
      setError(`El motivo de la anulación necesita al menos ${DUES_ADJUSTMENT_MIN_REASON} caracteres.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onVoid({ adjustmentId: adj.id, reason: why.trim() });
      setNotice('Ajuste anulado. El mes vuelve a como estaba.');
    } catch (err) {
      setError(err?.message || 'No se pudo anular el ajuste.');
    } finally {
      setBusy(false);
    }
  };

  const box = {
    marginBottom: '1rem',
    padding: '0.75rem 0.85rem',
    borderRadius: 10,
    border: '1px dashed rgba(var(--primary-gold-rgb),0.55)',
  };

  if (!open) {
    return (
      <div style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <PencilLine size={14} aria-hidden="true" /> Corregir meses y montos (administrador)
        </button>
        {active.length ? (
          <small style={{ marginLeft: '0.6rem', color: 'var(--text-muted)' }}>
            {active.length} {active.length === 1 ? 'mes ajustado' : 'meses ajustados'}
          </small>
        ) : null}
      </div>
    );
  }

  return (
    <section style={box} aria-label="Ajuste administrativo de cuota">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
        <p style={{ margin: 0, fontSize: '0.78rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
          Ajuste administrativo por mes
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>Cerrar ajuste</button>
      </div>
      <p style={{ margin: '0.35rem 0 0.6rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        Corrige el capital que debe cada mes (sin el 10 %, que se calcula solo si venció). Queda registrado quién lo hizo.
        El saldo de la ficha no se modifica.
      </p>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.35rem' }}>
        {rows.map((row) => {
          const draft = drafts[row.dueOn] || {};
          return (
            <li
              key={row.dueOn}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 130px auto', gap: '0.45rem', alignItems: 'center' }}
            >
              <span>
                <strong style={{ display: 'block', textDecoration: draft.remove || row.removed ? 'line-through' : 'none' }}>
                  {row.label}
                </strong>
                <small style={{ color: 'var(--text-muted)' }}>
                  {row.removed ? 'No lo debe (ajuste)' : `Capital ${formatCurrency(row.capital)}`}
                  {row.adjustment ? ` · Ajustado por ${row.adjustment.by || row.adjustment.createdByName || 'admin'}` : ''}
                </small>
              </span>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                aria-label={`Capital de ${row.label}`}
                placeholder={row.removed ? 'Monto' : String(row.capital)}
                value={draft.amount ?? ''}
                disabled={Boolean(draft.remove) || busy}
                onChange={(e) => setDraft(row.dueOn, { amount: e.target.value, remove: false })}
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
                <input
                  type="checkbox"
                  checked={Boolean(draft.remove)}
                  disabled={busy || row.removed}
                  onChange={(e) => setDraft(row.dueOn, { remove: e.target.checked })}
                />
                No lo debe
              </label>
            </li>
          );
        })}
      </ul>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 130px auto', gap: '0.45rem', marginTop: '0.6rem', alignItems: 'end' }}>
        <label className="form-group" style={{ margin: 0 }}>
          <span className="form-label">Agregar mes que debe</span>
          <input
            className="form-input"
            type="month"
            max={currentYm(today)}
            value={newMonth}
            disabled={busy}
            onChange={(e) => { setNewMonth(e.target.value); setError(''); }}
          />
        </label>
        <label className="form-group" style={{ margin: 0 }}>
          <span className="form-label">Capital</span>
          <input
            className="form-input"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={newAmount}
            disabled={busy}
            onChange={(e) => { setNewAmount(e.target.value); setError(''); }}
          />
        </label>
        <span />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 130px auto', gap: '0.45rem', marginTop: '0.6rem', alignItems: 'end' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mismo monto para todos los meses de la lista</span>
        <input
          className="form-input"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          aria-label="Monto para todos los meses"
          value={bulkAmount}
          disabled={busy}
          onChange={(e) => setBulkAmount(e.target.value)}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={applyBulk} disabled={busy}>Aplicar</button>
      </div>

      <label className="form-group" style={{ margin: '0.6rem 0 0' }}>
        <span className="form-label">Motivo del ajuste (queda en la auditoría)</span>
        <input
          className="form-input"
          value={reason}
          disabled={busy}
          onChange={(e) => { setReason(e.target.value); setError(''); }}
          placeholder="Ej.: nivelación de migración LILA, la cuota de agosto era $ 40.000"
        />
      </label>

      {error ? <p role="alert" style={{ margin: '0.5rem 0 0', color: 'var(--danger, #f87171)', fontSize: '0.84rem' }}>{error}</p> : null}
      {notice ? <p style={{ margin: '0.5rem 0 0', color: 'var(--emerald-accent)', fontSize: '0.84rem' }}>{notice}</p> : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.6rem' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !pending.length}>
          {busy ? 'Guardando…' : `Guardar ajuste${pending.length ? ` (${pending.length})` : ''}`}
        </button>
      </div>

      {history.length ? (
        <details style={{ marginTop: '0.7rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Historial de ajustes ({history.length})
          </summary>
          <ul style={{ listStyle: 'none', margin: '0.4rem 0 0', padding: 0, display: 'grid', gap: '0.3rem', fontSize: '0.8rem' }}>
            {history.map((adj) => (
              <li key={adj.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', opacity: adj.voidedAt ? 0.6 : 1 }}>
                <span>
                  <strong>{duesMonthLabel(adj.dueOn)}</strong>
                  {' · '}
                  {adj.action === 'remove' ? 'No lo debe' : formatCurrency(adj.capital)}
                  {adj.previousCapitalOpen != null ? ` (antes ${formatCurrency(adj.previousCapitalOpen)})` : ''}
                  {' · '}
                  {adj.createdByName || 'admin'} · {formatWhen(adj.createdAt)}
                  {adj.reason ? ` · ${adj.reason}` : ''}
                  {adj.voidedAt ? ` · Anulado${adj.voidedByName ? ` por ${adj.voidedByName}` : ''}${adj.voidReason ? `: ${adj.voidReason}` : ''}` : ''}
                  {adj.appliedPaymentIds?.length ? ' · Cobrado' : ''}
                </span>
                {!adj.voidedAt && !adj.appliedPaymentIds?.length && typeof onVoid === 'function' ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => voidOne(adj)}
                    disabled={busy}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    <Undo2 size={12} aria-hidden="true" /> Anular
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

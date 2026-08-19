import { useMemo, useState } from 'react';
import { Pencil, Plus, Check, X, Trash2, Tags } from 'lucide-react';
import {
  getActiveTiers,
  upsertTier,
  removeTier,
  normalizeTier,
  remapMemberTiers,
  countMembersInTier,
  getTierDisplayName,
  TIER_COLORS,
} from '../../domain/members/tiers';

function emptyDraft(sortOrder = 10) {
  return normalizeTier({
    id: '',
    name: '',
    label: '',
    monthlyDues: 0,
    color: TIER_COLORS[sortOrder % TIER_COLORS.length],
    sortOrder,
  });
}

/**
 * Editor del catálogo de categorías de socios (cuota, nombre, color).
 */
export default function MemberTiersPanel({
  catalog = [],
  setCatalog,
  setMembers,
  members = [],
  formatCurrency,
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState('');

  const tiers = useMemo(() => getActiveTiers(catalog), [catalog]);
  const canEdit = typeof setCatalog === 'function';

  if (!canEdit) return null;

  const startCreate = () => {
    setIsCreating(true);
    setEditingId(null);
    setError('');
    setDraft(emptyDraft((tiers[tiers.length - 1]?.sortOrder || 0) + 1));
    setOpen(true);
  };

  const startEdit = (tier) => {
    setIsCreating(false);
    setEditingId(tier.id);
    setError('');
    setDraft(normalizeTier(tier));
    setOpen(true);
  };

  const cancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setError('');
  };

  const save = () => {
    const name = String(draft.name || '').trim();
    if (!name) {
      setError('Indicá un nombre para la categoría.');
      return;
    }
    const payload = normalizeTier({
      ...draft,
      id: isCreating ? undefined : (draft.id || editingId),
      name,
      monthlyDues: Number(draft.monthlyDues) || 0,
    });
    const duplicate = tiers.some(
      (t) => t.id !== payload.id && t.name.toLowerCase() === payload.name.toLowerCase()
    );
    if (duplicate) {
      setError('Ya existe una categoría con ese nombre.');
      return;
    }
    setCatalog((prev) => upsertTier(prev, payload));
    cancel();
  };

  const remove = (tier) => {
    if (tiers.length <= 1) return;
    const used = countMembersInTier(members, tier.id);
    const fallback = tiers.find((t) => t.id !== tier.id);
    if (!fallback) return;

    if (used > 0) {
      const ok = window.confirm(
        `Hay ${used} socio(s) en «${tier.name}». Se reasignarán a «${fallback.name}». ¿Continuar?`
      );
      if (!ok) return;
      if (setMembers) {
        setMembers((prev) => remapMemberTiers(prev, { fromIds: [tier.id], toId: fallback.id }));
      }
    } else {
      const ok = window.confirm(`¿Eliminar la categoría «${tier.name}»?`);
      if (!ok) return;
    }

    setCatalog((prev) => removeTier(prev, tier.id));
    if (editingId === tier.id) cancel();
  };

  return (
    <section className="member-tiers-panel glass-panel">
      <header className="member-tiers-head">
        <div>
          <h3><Tags size={16} /> Categorías de socios</h3>
          <p>Nombre, cuota mensual y color · padrón, cobranzas y credencial</p>
        </div>
        <div className="member-tiers-head-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Ocultar' : 'Gestionar'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={startCreate}>
            <Plus size={14} /> Nueva
          </button>
        </div>
      </header>

      {!open && (
        <div className="member-tiers-chips" aria-label="Categorías activas">
          {tiers.map((tier) => (
            <button
              key={tier.id}
              type="button"
              className="member-tiers-chip"
              style={{ '--tier-color': tier.color }}
              onClick={() => {
                setOpen(true);
                startEdit(tier);
              }}
              title={`${tier.name}: ${formatCurrency(tier.monthlyDues)}/mes`}
            >
              <i style={{ background: tier.color }} />
              <span>{tier.name}</span>
              <em>{formatCurrency(tier.monthlyDues)}</em>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="member-tiers-body">
          <ul className="member-tiers-list">
            {tiers.map((tier) => {
              const used = countMembersInTier(members, tier.id);
              const isEditing = !isCreating && editingId === tier.id;
              if (isEditing) {
                return (
                  <li key={tier.id} className="member-tiers-row is-editing">
                    <TierDraftForm
                      draft={draft}
                      setDraft={setDraft}
                      error={error}
                      onCancel={cancel}
                      onSave={save}
                    />
                  </li>
                );
              }
              return (
                <li key={tier.id} className="member-tiers-row">
                  <span className="member-tiers-swatch" style={{ background: tier.color }} />
                  <div className="member-tiers-copy">
                    <strong>{getTierDisplayName(tier.id, catalog)}</strong>
                    <small>
                      {tier.label || 'Sin etiqueta'} · {formatCurrency(tier.monthlyDues)} / mes · {used} socio{used === 1 ? '' : 's'}
                    </small>
                  </div>
                  <div className="member-tiers-row-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(tier)}>
                      <Pencil size={13} /> Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => remove(tier)}
                      disabled={tiers.length <= 1}
                      title={tiers.length <= 1 ? 'Debe quedar al menos una categoría' : 'Eliminar'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {isCreating && (
            <div className="member-tiers-row is-editing" style={{ marginTop: '0.65rem' }}>
              <TierDraftForm
                draft={draft}
                setDraft={setDraft}
                error={error}
                onCancel={cancel}
                onSave={save}
                creating
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TierDraftForm({ draft, setDraft, error, onCancel, onSave, creating = false }) {
  return (
    <form
      className="member-tiers-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="member-tiers-form-grid">
        <label>
          <span>Nombre</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder={creating ? 'Ej. Junior' : ''}
            required
          />
        </label>
        <label>
          <span>Etiqueta</span>
          <input
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="VIP, Estándar…"
          />
        </label>
        <label>
          <span>Cuota mensual</span>
          <input
            type="number"
            min={0}
            step={100}
            value={draft.monthlyDues}
            onChange={(e) => setDraft((d) => ({ ...d, monthlyDues: e.target.value }))}
          />
        </label>
        <label>
          <span>Orden</span>
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => setDraft((d) => ({ ...d, sortOrder: Number(e.target.value) || 0 }))}
          />
        </label>
        <div className="member-tiers-form-span">
          <span className="member-tiers-form-label">Color</span>
          <div className="member-tiers-colors">
            {TIER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`member-tiers-color${draft.color === c ? ' is-active' : ''}`}
                style={{ background: c }}
                aria-label={c}
                onClick={() => setDraft((d) => ({ ...d, color: c }))}
              />
            ))}
            <input
              type="color"
              value={draft.color || '#fbbf24'}
              onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
            />
          </div>
        </div>
      </div>
      {error ? <p className="member-tiers-error">{error}</p> : null}
      <div className="member-tiers-form-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          <X size={13} /> Cancelar
        </button>
        <button type="submit" className="btn btn-primary btn-sm">
          <Check size={13} /> Guardar
        </button>
      </div>
    </form>
  );
}

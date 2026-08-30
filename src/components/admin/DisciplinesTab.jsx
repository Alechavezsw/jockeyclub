import { useMemo, useState } from 'react';
import {
  Trophy, Users, Calendar, Activity, Search, ChevronRight, LandPlot, UserCircle2,
  Pencil, Plus, X, Check, Trash2, UserPlus,
} from 'lucide-react';
import {
  buildDisciplineStats,
  upsertDiscipline,
  removeDiscipline,
  remapMemberDisciplines,
  toggleMemberDiscipline,
  DISCIPLINE_COLORS,
  normalizeDiscipline,
} from '../../domain/sports/disciplines';
import { FACILITIES } from '../../domain/reservations/facilities';
import { getTierDisplayName } from '../../domain/members/tiers';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function emptyDraft() {
  return normalizeDiscipline({
    id: '',
    name: '',
    aliases: [],
    facilityIds: [],
    coachRole: '',
    color: DISCIPLINE_COLORS[Math.floor(Math.random() * DISCIPLINE_COLORS.length)],
  });
}

/**
 * Panel de disciplinas: estadísticas, edición de catálogo e inscripciones.
 */
export default function DisciplinesTab({
  members = [],
  setMembers,
  reservations = [],
  staffMembers = [],
  catalog = [],
  setCatalog,
  onOpenMember,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [enrollQuery, setEnrollQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [formError, setFormError] = useState('');

  const { rows, summary } = useMemo(
    () => buildDisciplineStats({ members, reservations, staffMembers, catalog }),
    [members, reservations, staffMembers, catalog]
  );

  const selected = useMemo(() => {
    if (isCreating) return null;
    return rows.find((r) => r.id === selectedId) || rows[0] || null;
  }, [rows, selectedId, isCreating]);

  const maxEnrolled = Math.max(1, ...rows.map((r) => r.enrolledCount), 1);

  const filteredMembers = useMemo(() => {
    if (!selected) return [];
    const q = query.trim().toLowerCase();
    if (!q) return selected.members;
    return selected.members.filter(
      (m) => m.name.toLowerCase().includes(q) || String(m.memberId).includes(q)
    );
  }, [selected, query]);

  const enrollCandidates = useMemo(() => {
    if (!selected || !setMembers) return [];
    const q = enrollQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const enrolledIds = new Set(selected.members.map((m) => String(m.memberId)));
    return members
      .filter((m) => m.status !== 'inactive')
      .filter((m) => !enrolledIds.has(String(m.memberId)))
      .filter((m) =>
        m.name.toLowerCase().includes(q) || String(m.memberId).toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [members, selected, enrollQuery, setMembers]);

  const openCreate = () => {
    setIsCreating(true);
    setEditing(true);
    setFormError('');
    setDraft(emptyDraft());
  };

  const openEdit = () => {
    if (!selected) return;
    setIsCreating(false);
    setEditing(true);
    setFormError('');
    setDraft(normalizeDiscipline({
      ...selected,
      aliasesText: (selected.aliases || []).filter((a) => a !== selected.name).join(', '),
    }));
  };

  const cancelEdit = () => {
    setEditing(false);
    setIsCreating(false);
    setFormError('');
  };

  const toggleFacility = (facilityId) => {
    setDraft((prev) => {
      const has = (prev.facilityIds || []).includes(facilityId);
      return {
        ...prev,
        facilityIds: has
          ? prev.facilityIds.filter((id) => id !== facilityId)
          : [...(prev.facilityIds || []), facilityId],
      };
    });
  };

  const saveDraft = () => {
    if (!setCatalog) return;
    const name = String(draft.name || '').trim();
    if (!name) {
      setFormError('Indicá un nombre para la disciplina.');
      return;
    }
    const payload = normalizeDiscipline({
      ...draft,
      id: isCreating ? undefined : (draft.id || selected?.id),
      name,
      aliasesText: draft.aliasesText,
    });
    const duplicate = (catalog || []).some(
      (d) => d.id !== payload.id && d.name.toLowerCase() === payload.name.toLowerCase()
    );
    if (duplicate) {
      setFormError('Ya existe una disciplina con ese nombre.');
      return;
    }

    if (!isCreating && selected) {
      const fromLabels = [...new Set([selected.name, ...(selected.aliases || [])])];
      if (selected.name !== payload.name && setMembers) {
        setMembers((prev) => remapMemberDisciplines(prev, {
          fromLabels,
          toLabel: payload.name,
        }));
      }
    }

    setCatalog((prev) => upsertDiscipline(prev, payload));
    setSelectedId(payload.id);
    setEditing(false);
    setIsCreating(false);
    setFormError('');
  };

  const deleteSelected = () => {
    if (!setCatalog || !selected) return;
    const ok = window.confirm(
      `¿Eliminar «${selected.name}» del catálogo? Los socios conservan la etiqueta en su ficha hasta que la edites.`
    );
    if (!ok) return;
    setCatalog((prev) => removeDiscipline(prev, selected.id));
    setEditing(false);
    setIsCreating(false);
    setSelectedId(null);
  };

  const enrollMember = (memberId) => {
    if (!setMembers || !selected) return;
    setMembers((prev) => toggleMemberDiscipline(prev, memberId, selected.name, true));
    setEnrollQuery('');
  };

  const unenrollMember = (memberId) => {
    if (!setMembers || !selected) return;
    setMembers((prev) => toggleMemberDiscipline(prev, memberId, selected.name, false));
  };

  const canEdit = typeof setCatalog === 'function';

  return (
    <div className="fade-in disc-tab">
      <header className="disc-head">
        <div>
          <h2 className="serif-font disc-title">
            <Trophy size={20} /> Disciplinas deportivas
          </h2>
          <p>Inscripciones, uso de canchas y estadísticas por deporte · Sede Rivadavia</p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary disc-add-btn" onClick={openCreate}>
            <Plus size={16} /> Nueva disciplina
          </button>
        )}
      </header>

      <section className="disc-kpis">
        <article className="disc-kpi">
          <span>Disciplinas activas</span>
          <strong>{summary.disciplinesActive}/{summary.disciplinesTotal}</strong>
          <small>Con socios o reservas recientes</small>
        </article>
        <article className="disc-kpi">
          <span>Socios inscriptos</span>
          <strong>{summary.totalEnrolled}</strong>
          <small>Suma por disciplina (puede repetir)</small>
        </article>
        <article className="disc-kpi">
          <span>Reservas (30 días)</span>
          <strong>{summary.totalBookings30}</strong>
          <small>Turnos confirmados / pendientes</small>
        </article>
        <article className="disc-kpi disc-kpi--gold">
          <span>Más popular</span>
          <strong>{summary.topDiscipline}</strong>
          <small>{summary.membersWithoutDiscipline} socios sin disciplina</small>
        </article>
      </section>

      <div className="disc-layout">
        <aside className="disc-list glass-card">
          <h3>Ranking</h3>
          <div className="disc-rank">
            {rows.map((row) => {
              const active = selected?.id === row.id && !isCreating;
              const width = Math.max(8, Math.round((row.enrolledCount / maxEnrolled) * 100));
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`disc-rank-row${active ? ' is-active' : ''}`}
                  onClick={() => {
                    setSelectedId(row.id);
                    setQuery('');
                    setEnrollQuery('');
                    setEditing(false);
                    setIsCreating(false);
                  }}
                >
                  <div className="disc-rank-top">
                    <span className="disc-dot" style={{ background: row.color }} />
                    <strong>{row.name}</strong>
                    <span>{row.enrolledCount}</span>
                  </div>
                  <div className="disc-bar">
                    <i style={{ width: `${width}%`, background: row.color }} />
                  </div>
                  <div className="disc-rank-meta">
                    <span><Calendar size={11} /> {row.upcomingBookings} próximos</span>
                    <span><Activity size={11} /> {row.bookingsLast30} / 30d</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {(selected || isCreating) && (
          <section className="disc-detail glass-card">
            {editing ? (
              <form
                className="disc-edit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveDraft();
                }}
              >
                <div className="disc-detail-head">
                  <div>
                    <h3 style={{ color: draft.color || 'var(--text-gold)' }}>
                      <Pencil size={18} /> {isCreating ? 'Nueva disciplina' : `Editar ${selected?.name}`}
                    </h3>
                    <p>Nombre, color, rol de coach e instalaciones vinculadas.</p>
                  </div>
                  <div className="disc-edit-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEdit}>
                      <X size={14} /> Cancelar
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm">
                      <Check size={14} /> Guardar
                    </button>
                  </div>
                </div>

                {formError ? <p className="disc-form-error">{formError}</p> : null}

                <div className="disc-form-grid">
                  <label>
                    <span>Nombre</span>
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="Ej. Tenis"
                      required
                    />
                  </label>
                  <label>
                    <span>Rol de coach / área</span>
                    <input
                      value={draft.coachRole}
                      onChange={(e) => setDraft((d) => ({ ...d, coachRole: e.target.value }))}
                      placeholder="Profesor Tenis"
                    />
                  </label>
                  <label className="disc-form-span">
                    <span>Aliases (separados por coma)</span>
                    <input
                      value={draft.aliasesText || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, aliasesText: e.target.value }))}
                      placeholder="tennis, tenis de mesa…"
                    />
                  </label>
                  <div className="disc-form-span">
                    <span className="disc-form-label">Color</span>
                    <div className="disc-color-row">
                      {DISCIPLINE_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`disc-color-swatch${draft.color === c ? ' is-active' : ''}`}
                          style={{ background: c }}
                          aria-label={`Color ${c}`}
                          onClick={() => setDraft((d) => ({ ...d, color: c }))}
                        />
                      ))}
                      <input
                        type="color"
                        value={draft.color || '#cfa13a'}
                        onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                        aria-label="Color personalizado"
                      />
                    </div>
                  </div>
                </div>

                <fieldset className="disc-facilities">
                  <legend>Instalaciones vinculadas</legend>
                  <div className="disc-facility-grid">
                    {FACILITIES.map((f) => {
                      const checked = (draft.facilityIds || []).includes(f.id);
                      return (
                        <label key={f.id} className={`disc-facility-chip${checked ? ' is-on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleFacility(f.id)}
                          />
                          <span>{f.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {!isCreating && canEdit && selected && (
                  <button type="button" className="disc-delete-btn" onClick={deleteSelected}>
                    <Trash2 size={14} /> Eliminar del catálogo
                  </button>
                )}
              </form>
            ) : selected ? (
              <>
                <div className="disc-detail-head">
                  <div>
                    <h3 style={{ color: selected.color }}>
                      <LandPlot size={18} /> {selected.name}
                    </h3>
                    <p>
                      {selected.facilityIds.length
                        ? `${selected.facilityIds.length} instalaciones vinculadas`
                        : 'Sin cancha asignada en catálogo'}
                      {selected.coaches.length
                        ? ` · Staff: ${selected.coaches.join(', ')}`
                        : ' · Sin staff vinculado'}
                      {selected.coachRole ? ` · ${selected.coachRole}` : ''}
                    </p>
                  </div>
                  <div className="disc-detail-tools">
                    <div className="disc-occ">
                      <span>Ocupación estimada</span>
                      <strong>{selected.occupancyPct}%</strong>
                    </div>
                    {canEdit && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={openEdit}>
                        <Pencil size={14} /> Editar
                      </button>
                    )}
                  </div>
                </div>

                <div className="disc-mini-grid">
                  <div>
                    <Users size={14} />
                    <b>{selected.enrolledCount}</b>
                    <span>titulares</span>
                  </div>
                  <div>
                    <UserCircle2 size={14} />
                    <b>{selected.adherentCount}</b>
                    <span>adherentes</span>
                  </div>
                  <div>
                    <Calendar size={14} />
                    <b>{selected.upcomingBookings}</b>
                    <span>turnos próximos</span>
                  </div>
                  <div>
                    <Activity size={14} />
                    <b>{selected.bookingsLast30}</b>
                    <span>uso 30 días</span>
                  </div>
                </div>

                <div className="disc-tiers">
                  {Object.entries(selected.byTier || {})
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([key, count]) => (
                      <div key={key} className="disc-tier">
                        <span>{getTierDisplayName(key)}</span>
                        <strong>{count}</strong>
                      </div>
                    ))}
                </div>

                {setMembers && (
                  <div className="disc-enroll">
                    <h4><UserPlus size={14} /> Inscribir socio</h4>
                    <label className="disc-search">
                      <Search size={14} />
                      <input
                        value={enrollQuery}
                        onChange={(e) => setEnrollQuery(e.target.value)}
                        placeholder="Buscar por nombre o Nº de socio…"
                      />
                    </label>
                    {enrollCandidates.length > 0 && (
                      <ul className="disc-enroll-list">
                        {enrollCandidates.map((m) => (
                          <li key={m.memberId}>
                            <span>
                              <strong>{m.name}</strong>
                              <small>{m.memberId}</small>
                            </span>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => enrollMember(m.memberId)}
                            >
                              Inscribir
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="disc-members-head">
                  <h4>Padrón de la disciplina</h4>
                  <label className="disc-search">
                    <Search size={14} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Buscar socio…"
                    />
                  </label>
                </div>

                {filteredMembers.length === 0 ? (
                  <p className="disc-empty">No hay socios inscriptos en {selected.name}.</p>
                ) : (
                  <div className="disc-table-wrap">
                    <table className="disc-table">
                      <thead>
                        <tr>
                          <th>Socio</th>
                          <th>Categoría</th>
                          <th>Estado cuota</th>
                          <th>Contacto</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMembers.map((m) => (
                          <tr key={m.memberId}>
                            <td>
                              <strong>{m.name}</strong>
                              <div className="disc-muted">{m.memberId}</div>
                            </td>
                            <td style={{ textTransform: 'capitalize' }}>{m.tier}</td>
                            <td style={{ color: m.outstandingBalance > 0 ? '#f59e0b' : 'var(--emerald-accent)' }}>
                              {m.outstandingBalance > 0 ? formatCurrency(m.outstandingBalance) : 'Al día'}
                            </td>
                            <td>{m.phone || '—'}</td>
                            <td className="disc-row-actions">
                              {onOpenMember && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => onOpenMember(m.memberId)}
                                >
                                  Ficha <ChevronRight size={12} />
                                </button>
                              )}
                              {setMembers && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => unenrollMember(m.memberId)}
                                  title="Quitar de esta disciplina"
                                >
                                  Quitar
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}

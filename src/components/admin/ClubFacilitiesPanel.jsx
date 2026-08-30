import { useEffect, useMemo, useState } from 'react';
import {
  Clock, MapPin, Users, Waves, LandPlot, Building2, Flame, PartyPopper,
  CircleDot, Ban, Snowflake, Radio, Pencil, Plus, Search, Eye, Trash2, X,
} from 'lucide-react';
import { FACILITIES, FACILITY_GROUPS, facilitiesByGroup } from '../../domain/reservations/facilities';
import { getFacilityLiveStatus } from '../../domain/reservations/availability';
import {
  buildFacilityCatalog,
  upsertFacilityInCatalog,
  removeFacilityFromCatalog,
  createBlankFacility,
  facilityCapacityNumber,
  facilityStatusLabel,
  FACILITY_MANAGE_TYPES,
} from '../../domain/reservations/facilityConfig';
import FacilityEditorModal from './FacilityEditorModal';

const GROUP_ICON = {
  espacios: Building2,
  canchas: LandPlot,
  pileta: Waves,
};

const TYPE_ICON = {
  salon: PartyPopper,
  parrilla: Flame,
  cancha: LandPlot,
  pileta: Waves,
  hipica: Building2,
  fitness: Building2,
  gastronomia: Building2,
};

const STATUS_META = {
  available: { className: 'live-ok', Icon: CircleDot },
  occupied: { className: 'live-busy', Icon: Radio },
  closed: { className: 'live-off', Icon: Ban },
  suspended: { className: 'live-off', Icon: Ban },
  season_closed: { className: 'live-season', Icon: Snowflake },
};

const ADMIN_STATUS_CLASS = {
  disponible: 'is-ok',
  suspendido: 'is-off',
  no_disponible: 'is-off',
  mantenimiento: 'is-warn',
};

/**
 * Gestión real de espacios del club (listado por tipo + editor)
 * y vista en vivo de disponibilidad.
 */
export default function ClubFacilitiesPanel({
  reservations = [],
  isZondaActive = false,
  facilityCatalog = null,
  setFacilityCatalog = null,
}) {
  const [viewMode, setViewMode] = useState('manage'); // manage | live
  const [activeType, setActiveType] = useState('salon');
  const [activeGroup, setActiveGroup] = useState('canchas');
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const catalog = useMemo(
    () => buildFacilityCatalog(FACILITIES, Array.isArray(facilityCatalog) ? facilityCatalog : []),
    [facilityCatalog]
  );

  const persistCatalog = (nextList) => {
    if (typeof setFacilityCatalog === 'function') setFacilityCatalog(nextList);
  };

  const typeMeta = FACILITY_MANAGE_TYPES.find((t) => t.id === activeType) || FACILITY_MANAGE_TYPES[0];
  const TypeIcon = TYPE_ICON[activeType] || Building2;

  const typedList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((f) => (f.spaceType || f.category) === activeType)
      .filter((f) => {
        if (!q) return true;
        return `${f.name || ''} ${f.id || ''} ${f.capacity || ''}`.toLowerCase().includes(q);
      })
      .toSorted((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
  }, [catalog, activeType, query]);

  const typeCounts = useMemo(() => {
    const counts = {};
    for (const t of FACILITY_MANAGE_TYPES) {
      counts[t.id] = catalog.filter((f) => (f.spaceType || f.category) === t.id).length;
    }
    return counts;
  }, [catalog]);

  const groups = useMemo(() => facilitiesByGroup(catalog), [catalog]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const liveById = useMemo(() => {
    const map = new Map();
    for (const facility of catalog) {
      if (facility.status && facility.status !== 'disponible') {
        map.set(facility.id, {
          status: 'closed',
          label: facilityStatusLabel(facility.status),
          detail: 'Configurado como no reservable',
          currentBooking: null,
          nextSlot: null,
        });
        continue;
      }
      map.set(
        facility.id,
        getFacilityLiveStatus(facility, { reservations, isZondaActive, now }),
      );
    }
    return map;
  }, [catalog, reservations, isZondaActive, now]);

  const groupCounts = useMemo(() => {
    const counts = {};
    for (const group of groups) {
      counts[group.id] = {
        total: group.items.length,
        available: group.items.filter((f) => liveById.get(f.id)?.status === 'available').length,
      };
    }
    return counts;
  }, [groups, liveById]);

  const active = groups.find((g) => g.id === activeGroup) || groups[0];
  const ActiveIcon = GROUP_ICON[active?.id] || Building2;
  const clockLabel = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const handleDelete = (facility) => {
    const ok = window.confirm(`¿Eliminar el espacio «${facility.name}» del catálogo del club?`);
    if (!ok) return;
    persistCatalog(removeFacilityFromCatalog(catalog, facility.id));
  };

  const handleCreate = () => {
    setEditing(createBlankFacility(activeType));
  };

  return (
    <section className="glass-card club-facilities" style={{ marginTop: '1.75rem' }}>
      <div className="club-facilities-head">
        <div>
          <h3 className="serif-font">Espacios del club</h3>
          <p>Gestión de salones, parrillas, canchas y pileta — los espacios reales reservables.</p>
          {viewMode === 'live' ? (
            <div className="club-facilities-live-clock">
              <span className="pulse" aria-hidden="true" />
              En vivo · {clockLabel}
              {isZondaActive ? ' · Zonda activo' : ''}
            </div>
          ) : null}
        </div>
        <div className="club-facilities-mode">
          <button
            type="button"
            className={viewMode === 'manage' ? 'is-active' : ''}
            onClick={() => setViewMode('manage')}
          >
            Gestión
          </button>
          <button
            type="button"
            className={viewMode === 'live' ? 'is-active' : ''}
            onClick={() => setViewMode('live')}
          >
            En vivo
          </button>
        </div>
      </div>

      {viewMode === 'manage' ? (
        <>
          <div className="club-facilities-tabs" role="tablist" aria-label="Tipos de espacio">
            {FACILITY_MANAGE_TYPES.map((t) => {
              const Icon = TYPE_ICON[t.id] || Building2;
              const count = typeCounts[t.id] || 0;
              if (count === 0 && !['salon', 'parrilla', 'cancha', 'pileta'].includes(t.id)) return null;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeType === t.id}
                  className={`club-facilities-tab${activeType === t.id ? ' active' : ''}`}
                  onClick={() => {
                    setActiveType(t.id);
                    setQuery('');
                  }}
                >
                  <Icon size={14} />
                  {t.label}
                  <span style={{ opacity: 0.75 }}>({count})</span>
                </button>
              );
            })}
          </div>

          <div className="fac-manage-toolbar">
            <div>
              <h4 className="serif-font fac-manage-title">
                <TypeIcon size={18} /> {typeMeta.label}
              </h4>
              <p className="ops-muted" style={{ margin: '0.25rem 0 0' }}>
                {typedList.length === 1
                  ? 'Se encontró 1 resultado'
                  : `Encontrados ${typedList.length} en total`}
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={handleCreate}>
              <Plus size={16} /> Espacio del club
            </button>
          </div>

          <div className="fac-manage-search">
            <label className="fac-manage-search-label" htmlFor="fac-manage-q">Buscar por</label>
            <div className="members-search-field">
              <Search size={18} className="members-search-icon" aria-hidden="true" />
              <input
                id="fac-manage-q"
                className="members-search-input"
                placeholder="Nombre, capacidad o código…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
              {query ? (
                <button type="button" className="members-search-clear" onClick={() => setQuery('')} aria-label="Limpiar">
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="table-responsive">
            <table className="admin-table fac-manage-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nombre</th>
                  <th>Capacidad</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Funciones</th>
                </tr>
              </thead>
              <tbody>
                {typedList.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                      No hay espacios de este tipo. Creá uno con “Espacio del club”.
                    </td>
                  </tr>
                ) : (
                  typedList.map((f, idx) => {
                    const status = f.status || 'disponible';
                    return (
                      <tr key={f.id}>
                        <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                          {String(f.publicId || f.id.replace(/\D/g, '').slice(-3) || idx + 1)}
                        </td>
                        <td>
                          <strong>{f.name}</strong>
                        </td>
                        <td>{facilityCapacityNumber(f) || '—'}</td>
                        <td>
                          <span className={`fac-status-pill ${ADMIN_STATUS_CLASS[status] || ''}`}>
                            {facilityStatusLabel(status)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="fac-manage-actions">
                            <button type="button" className="btn btn-secondary btn-sm" title="Ver" onClick={() => setViewing(f)}>
                              <Eye size={13} />
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm" title="Editar" onClick={() => setEditing(f)}>
                              <Pencil size={13} />
                            </button>
                            <button type="button" className="btn btn-danger btn-sm" title="Eliminar" onClick={() => handleDelete(f)}>
                              <Trash2 size={13} />
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
        </>
      ) : (
        <>
          <div className="club-facilities-tabs" role="tablist" aria-label="Grupos de instalaciones">
            {FACILITY_GROUPS.map((group) => {
              const Icon = GROUP_ICON[group.id] || Building2;
              const counts = groupCounts[group.id] || { total: 0, available: 0 };
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={activeGroup === group.id}
                  className={`club-facilities-tab${activeGroup === group.id ? ' active' : ''}`}
                  onClick={() => setActiveGroup(group.id)}
                >
                  <Icon size={14} />
                  {group.label}
                  <span style={{ opacity: 0.75 }}>
                    ({counts.available}/{counts.total})
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.85rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <ActiveIcon size={14} color="var(--primary-gold)" />
            {active?.blurb}
          </div>

          <div className="club-facilities-grid">
            {(active?.items || []).map((facility) => {
              const live = liveById.get(facility.id) || { status: 'closed', label: '—', detail: '' };
              const meta = STATUS_META[live.status] || STATUS_META.closed;
              const StatusIcon = meta.Icon;
              const cardTone = live.status === 'available'
                ? 'is-available'
                : live.status === 'occupied'
                  ? 'is-occupied'
                  : 'is-blocked';

              return (
                <article key={facility.id} className={`club-facility-card ${cardTone}`}>
                  <img src={facility.image} alt="" loading="lazy" />
                  <div className="club-facility-body">
                    <div className="club-facility-title-row">
                      <h4>{facility.name}</h4>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm club-facility-edit"
                        title="Editar espacio"
                        onClick={() => setEditing(facility)}
                      >
                        <Pencil size={13} /> Editar
                      </button>
                    </div>
                    <p>{facility.description}</p>
                    <div className="club-facility-meta">
                      <span><Clock size={12} /> {facility.hours}</span>
                      <span><Users size={12} /> {facility.capacity}</span>
                      <span><MapPin size={12} /> {facility.isOutdoor ? 'Exterior' : 'Interior'}</span>
                    </div>
                    <div className={`club-facility-live ${meta.className}`}>
                      <span className="club-facility-live-title">
                        <StatusIcon size={13} />
                        {live.label}
                      </span>
                      {live.detail && (
                        <span className="club-facility-live-detail">{live.detail}</span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {viewing ? (
        <div className="fac-view-card glass-panel">
          <div className="fac-view-card-head">
            <div>
              <h4 className="serif-font">{viewing.name}</h4>
              <p>
                {facilityStatusLabel(viewing.status)} · Capacidad {facilityCapacityNumber(viewing) || '—'}
                {' · '}{viewing.hours}
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewing(null)}>
              <X size={14} /> Cerrar
            </button>
          </div>
          <p style={{ margin: '0.65rem 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            {viewing.description || 'Sin descripción.'}
          </p>
          <div className="fac-manage-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setEditing(viewing); setViewing(null); }}>
              <Pencil size={13} /> Editar
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <FacilityEditorModal
          facility={editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            persistCatalog(upsertFacilityInCatalog(catalog, next));
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}

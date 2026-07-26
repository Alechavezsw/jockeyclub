import { useEffect, useMemo, useState } from 'react';
import {
  Clock, MapPin, Users, Waves, LandPlot, Building2,
  CircleDot, Ban, Snowflake, Radio,
} from 'lucide-react';
import { FACILITIES, FACILITY_GROUPS, facilitiesByGroup } from '../../domain/reservations/facilities';
import { getFacilityLiveStatus } from '../../domain/reservations/availability';

const GROUP_ICON = {
  espacios: Building2,
  canchas: LandPlot,
  pileta: Waves,
};

const STATUS_META = {
  available: { className: 'live-ok', Icon: CircleDot },
  occupied: { className: 'live-busy', Icon: Radio },
  closed: { className: 'live-off', Icon: Ban },
  suspended: { className: 'live-off', Icon: Ban },
  season_closed: { className: 'live-season', Icon: Snowflake },
};

/**
 * Directorio de instalaciones con disponibilidad en vivo
 * (horario, reservas actuales, Zonda y temporada).
 */
export default function ClubFacilitiesPanel({ reservations = [], isZondaActive = false }) {
  const [activeGroup, setActiveGroup] = useState('canchas');
  const [now, setNow] = useState(() => new Date());
  const groups = useMemo(() => facilitiesByGroup(FACILITIES), []);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const liveById = useMemo(() => {
    const map = new Map();
    for (const facility of FACILITIES) {
      map.set(
        facility.id,
        getFacilityLiveStatus(facility, { reservations, isZondaActive, now }),
      );
    }
    return map;
  }, [reservations, isZondaActive, now]);

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

  return (
    <section className="glass-card club-facilities" style={{ marginTop: '1.75rem' }}>
      <style>{`
        .club-facilities {
          padding: 1.25rem 1.35rem 1.4rem;
        }
        .club-facilities-head {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          align-items: flex-end;
          margin-bottom: 1.1rem;
        }
        .club-facilities-head h3 {
          margin: 0;
          font-size: 1.25rem;
          color: var(--text-gold);
        }
        .club-facilities-head p {
          margin: 0.3rem 0 0;
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
        .club-facilities-live-clock {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          margin-top: 0.45rem;
          font-size: 0.75rem;
          color: var(--emerald-accent);
          font-weight: 600;
        }
        .club-facilities-live-clock .pulse {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--emerald-accent);
          box-shadow: 0 0 0 0 rgba(16,185,129,0.55);
          animation: clubLivePulse 1.6s ease-out infinite;
        }
        @keyframes clubLivePulse {
          0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.45); }
          70% { box-shadow: 0 0 0 8px rgba(16,185,129,0); }
          100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
        }
        .club-facilities-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
        }
        .club-facilities-tab {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.45rem 0.85rem;
          border-radius: 999px;
          border: 1px solid var(--border-glass);
          background: rgba(255,255,255,0.03);
          color: var(--text-secondary);
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .club-facilities-tab.active {
          background: var(--primary-gold);
          color: #060e0a;
          border-color: transparent;
        }
        .club-facilities-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 0.9rem;
        }
        .club-facility-card {
          border: 1px solid var(--border-glass);
          border-radius: 12px;
          overflow: hidden;
          background: rgba(255,255,255,0.02);
          display: flex;
          flex-direction: column;
          min-height: 100%;
          position: relative;
        }
        .club-facility-card.is-available {
          border-color: rgba(16,185,129,0.35);
        }
        .club-facility-card.is-occupied {
          border-color: rgba(245,158,11,0.4);
        }
        .club-facility-card.is-blocked {
          border-color: rgba(239,68,68,0.3);
          opacity: 0.92;
        }
        .club-facility-card img {
          width: 100%;
          height: 120px;
          object-fit: cover;
          display: block;
          background: rgba(0,0,0,0.25);
        }
        .club-facility-body {
          padding: 0.85rem 0.95rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          flex: 1;
        }
        .club-facility-body h4 {
          margin: 0;
          font-size: 0.92rem;
          line-height: 1.3;
          color: var(--text-primary);
        }
        .club-facility-body p {
          margin: 0;
          font-size: 0.78rem;
          color: var(--text-muted);
          line-height: 1.4;
          flex: 1;
        }
        .club-facility-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.55rem 0.85rem;
          font-size: 0.72rem;
          color: var(--text-secondary);
          margin-top: 0.25rem;
        }
        .club-facility-meta span {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
        }
        .club-facility-live {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          margin-top: 0.35rem;
          padding: 0.55rem 0.65rem;
          border-radius: 8px;
          border: 1px solid transparent;
        }
        .club-facility-live.live-ok {
          background: rgba(16,185,129,0.12);
          border-color: rgba(16,185,129,0.35);
          color: var(--emerald-accent);
        }
        .club-facility-live.live-busy {
          background: rgba(245,158,11,0.12);
          border-color: rgba(245,158,11,0.4);
          color: #fbbf24;
        }
        .club-facility-live.live-off {
          background: rgba(239,68,68,0.12);
          border-color: rgba(239,68,68,0.35);
          color: #fca5a5;
        }
        .club-facility-live.live-season {
          background: rgba(99,102,241,0.12);
          border-color: rgba(99,102,241,0.35);
          color: #a5b4fc;
        }
        .club-facility-live-title {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.78rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .club-facility-live-detail {
          font-size: 0.72rem;
          opacity: 0.9;
          font-weight: 500;
        }
      `}</style>

      <div className="club-facilities-head">
        <div>
          <h3 className="serif-font">Espacios · Canchas · Pileta</h3>
          <p>Disponibilidad en vivo según horario, reservas y alertas operativas.</p>
          <div className="club-facilities-live-clock">
            <span className="pulse" aria-hidden="true" />
            En vivo · {clockLabel}
            {isZondaActive ? ' · Zonda activo' : ''}
          </div>
        </div>
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
                <h4>{facility.name}</h4>
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
    </section>
  );
}

import { useMemo, useState } from 'react';
import {
  Trophy, Users, Calendar, Activity, Search, ChevronRight, LandPlot, UserCircle2,
} from 'lucide-react';
import { buildDisciplineStats } from '../../domain/sports/disciplines';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

/**
 * Panel de disciplinas: estadísticas, ocupación y padrón por deporte.
 */
export default function DisciplinesTab({
  members = [],
  reservations = [],
  staffMembers = [],
  onOpenMember,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');

  const { rows, summary } = useMemo(
    () => buildDisciplineStats({ members, reservations, staffMembers }),
    [members, reservations, staffMembers]
  );

  const selected = rows.find((r) => r.id === selectedId) || rows[0] || null;
  const maxEnrolled = Math.max(1, ...rows.map((r) => r.enrolledCount));

  const filteredMembers = useMemo(() => {
    if (!selected) return [];
    const q = query.trim().toLowerCase();
    if (!q) return selected.members;
    return selected.members.filter(
      (m) => m.name.toLowerCase().includes(q) || String(m.memberId).includes(q)
    );
  }, [selected, query]);

  return (
    <div className="fade-in disc-tab">
      <header className="disc-head">
        <div>
          <h2 className="serif-font disc-title">
            <Trophy size={20} /> Disciplinas deportivas
          </h2>
          <p>Inscripciones, uso de canchas y estadísticas por deporte · Sede Rivadavia</p>
        </div>
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
              const active = selected?.id === row.id;
              const width = Math.max(8, Math.round((row.enrolledCount / maxEnrolled) * 100));
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`disc-rank-row${active ? ' is-active' : ''}`}
                  onClick={() => {
                    setSelectedId(row.id);
                    setQuery('');
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

        {selected && (
          <section className="disc-detail glass-card">
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
                </p>
              </div>
              <div className="disc-occ">
                <span>Ocupación estimada</span>
                <strong>{selected.occupancyPct}%</strong>
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
              {[
                ['royal', 'Royal', selected.byTier.royal],
                ['platinum', 'Platinum', selected.byTier.platinum],
                ['gold', 'Gold', selected.byTier.gold],
              ].map(([key, label, count]) => (
                <div key={key} className={`disc-tier disc-tier--${key}`}>
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>

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
                        <td>
                          {onOpenMember && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onOpenMember(m.memberId)}
                            >
                              Ficha <ChevronRight size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

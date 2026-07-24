import { useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Search, Users } from 'lucide-react';
import {
  formatShortDate,
  getOverdueMembers,
  getUpcomingDuesMembers,
} from '../../domain/members/dues';

function matchesSearch(member, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    member.name?.toLowerCase().includes(q) ||
    member.memberId?.toLowerCase().includes(q) ||
    (member.phone || '').replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
    (member.tier || '').toLowerCase().includes(q)
  );
}

function matchesTier(member, tier) {
  if (tier === 'all') return true;
  return (member.tier || '').toLowerCase() === tier;
}

/** Logo oficial WhatsApp (SVG de marca). */
function WhatsAppIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

function buildWhatsAppUrl(member, formatCurrency, isOverdue) {
  const cleanPhone = String(member.phone || '').replace(/[+\s-]/g, '');
  if (!cleanPhone) return null;

  const msg = isOverdue
    ? `Estimado/a ${member.name}, le saludamos del Jockey Club San Juan. Le recordamos que posee una cuota vencida de ${formatCurrency(member.amountDue)}. Puede regularizarla en administración o por transferencia. ¡Gracias!`
    : `Estimado/a ${member.name}, le saludamos del Jockey Club San Juan. Le recordamos que su próxima cuota (${formatCurrency(member.amountDue)}) vence pronto. Ante cualquier consulta estamos a disposición. ¡Gracias!`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

function MemberDuesRow({ member, formatCurrency, tone = 'overdue' }) {
  const isOverdue = tone === 'overdue';
  const waUrl = buildWhatsAppUrl(member, formatCurrency, isOverdue);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.4fr 0.9fr 0.9fr 1fr',
        gap: '0.75rem',
        alignItems: 'center',
        padding: '0.85rem 1rem',
        borderBottom: '1px solid var(--border-glass)',
        fontSize: '0.88rem',
      }}
      className="dues-row"
    >
      <div>
        <strong style={{ color: 'var(--text-primary)' }}>{member.name}</strong>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
          {member.tier?.toUpperCase()} · Cred. {member.memberId?.slice(0, 8)}…
        </div>
      </div>
      <div style={{ color: isOverdue ? '#fca5a5' : 'var(--text-secondary)' }}>
        {isOverdue
          ? (member.daysOverdue != null ? `${member.daysOverdue} días` : 'En mora')
          : (member.daysUntil != null ? `En ${member.daysUntil} días` : 'Próxima')}
      </div>
      <div style={{ fontWeight: 700, color: isOverdue ? '#ef4444' : '#f59e0b' }}>
        {formatCurrency(member.amountDue)}
      </div>
      <div>
        {waUrl ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm"
            title={`WhatsApp ${member.phone}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(37, 211, 102, 0.12)',
              border: '1px solid rgba(37, 211, 102, 0.45)',
              color: 'var(--text-primary)',
              borderRadius: 20,
              padding: '0.4rem 0.75rem',
              textDecoration: 'none',
              fontSize: '0.78rem',
              fontWeight: 600,
            }}
          >
            <WhatsAppIcon size={18} />
            <span>{member.phone}</span>
          </a>
        ) : (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sin teléfono</span>
        )}
      </div>
    </div>
  );
}

export default function DuesControlTab({ members = [], formatCurrency }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | overdue | upcoming
  const [tierFilter, setTierFilter] = useState('all');
  const [sortBy, setSortBy] = useState('amount'); // amount | name | days

  const overdueAll = useMemo(() => getOverdueMembers(members), [members]);
  const upcomingAll = useMemo(() => getUpcomingDuesMembers(members, { withinDays: 15 }), [members]);

  const applyListFilters = (list, tone) => {
    let next = list.filter((m) => matchesSearch(m, search) && matchesTier(m, tierFilter));
    next = [...next].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'es');
      if (sortBy === 'days') {
        const da = tone === 'overdue' ? (a.daysOverdue ?? 0) : (a.daysUntil ?? 0);
        const db = tone === 'overdue' ? (b.daysOverdue ?? 0) : (b.daysUntil ?? 0);
        return tone === 'overdue' ? db - da : da - db;
      }
      return (b.amountDue || 0) - (a.amountDue || 0);
    });
    return next;
  };

  const overdue = useMemo(
    () => applyListFilters(overdueAll, 'overdue'),
    [overdueAll, search, tierFilter, sortBy]
  );
  const upcoming = useMemo(
    () => applyListFilters(upcomingAll, 'upcoming'),
    [upcomingAll, search, tierFilter, sortBy]
  );

  const overdueTotal = overdue.reduce((s, m) => s + (m.amountDue || 0), 0);
  const showOverdue = statusFilter === 'all' || statusFilter === 'overdue';
  const showUpcoming = statusFilter === 'all' || statusFilter === 'upcoming';

  const filterBtn = (active, activeStyles = {}) => ({
    padding: '0.45rem 0.85rem',
    borderRadius: 20,
    border: active ? '1px solid transparent' : '1px solid var(--border-glass)',
    background: active ? (activeStyles.background || 'var(--primary-gold)') : 'var(--bg-secondary)',
    color: active ? (activeStyles.color || '#060e0a') : 'var(--text-secondary)',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  });

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <style>{`
        @media (max-width: 800px) {
          .dues-row {
            grid-template-columns: 1fr !important;
            gap: 0.45rem !important;
          }
          .dues-head {
            display: none !important;
          }
          .dues-filters {
            grid-template-columns: 1fr !important;
          }
          .dues-row > div:first-child {
            padding-bottom: 0.35rem;
            border-bottom: 1px solid var(--border-glass);
            margin-bottom: 0.15rem;
          }
        }
      `}</style>

      <div>
        <h2 className="serif-font" style={{ fontSize: '1.45rem', margin: 0, color: 'var(--text-gold)' }}>
          Control de Cuotas
        </h2>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Socios con cuotas vencidas y miembros con vencimiento próximo (15 días).
        </p>
      </div>

      {/* Buscador y filtros */}
      <div
        className="glass-card dues-filters"
        style={{
          padding: '1rem',
          display: 'grid',
          gridTemplateColumns: '1.6fr 1fr',
          gap: '1rem',
          alignItems: 'end',
        }}
      >
        <div>
          <label className="form-label">Buscar socio</label>
          <div style={{ position: 'relative' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="search"
              className="form-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, credencial, teléfono o categoría…"
              style={{
                paddingLeft: '2.4rem',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div>
            <label className="form-label">Estado</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              <button type="button" style={filterBtn(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>
                Todos
              </button>
              <button
                type="button"
                style={filterBtn(statusFilter === 'overdue', { background: '#ef4444', color: '#fff' })}
                onClick={() => setStatusFilter('overdue')}
              >
                Vencidas ({overdueAll.length})
              </button>
              <button
                type="button"
                style={filterBtn(statusFilter === 'upcoming', { background: '#f59e0b', color: '#111' })}
                onClick={() => setStatusFilter('upcoming')}
              >
                A vencer ({upcomingAll.length})
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label className="form-label">Categoría</label>
              <select
                className="form-input"
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              >
                <option value="all">Todas</option>
                <option value="royal">Royal</option>
                <option value="platinum">Platinum</option>
                <option value="gold">Gold</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label className="form-label">Ordenar por</label>
              <select
                className="form-input"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              >
                <option value="amount">Importe</option>
                <option value="name">Nombre</option>
                <option value="days">Días</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <button
          type="button"
          className="glass-card"
          onClick={() => setStatusFilter(statusFilter === 'overdue' ? 'all' : 'overdue')}
          style={{
            padding: '1rem',
            border: '1px solid rgba(239,68,68,0.35)',
            background: 'rgba(239,68,68,0.08)',
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', marginBottom: 6 }}>
            <AlertTriangle size={16} />
            <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>Vencidas</span>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ef4444' }}>{overdue.length}</div>
          <div style={{ fontSize: '0.78rem', color: '#fca5a5' }}>{formatCurrency(overdueTotal)} en mora</div>
        </button>
        <button
          type="button"
          className="glass-card"
          onClick={() => setStatusFilter(statusFilter === 'upcoming' ? 'all' : 'upcoming')}
          style={{
            padding: '1rem',
            border: '1px solid rgba(245,158,11,0.35)',
            background: 'rgba(245,158,11,0.08)',
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b', marginBottom: 6 }}>
            <Clock3 size={16} />
            <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>A vencer</span>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f59e0b' }}>{upcoming.length}</div>
          <div style={{ fontSize: '0.78rem', color: '#fcd34d' }}>Próximos 15 días</div>
        </button>
      </div>

      {/* Vencidas */}
      {showOverdue && (
      <section className="glass-card" style={{ padding: 0, overflow: 'hidden', border: '1px solid rgba(239,68,68,0.25)' }}>
        <div style={{
          padding: '0.9rem 1.1rem',
          borderBottom: '1px solid rgba(239,68,68,0.25)',
          background: 'rgba(239,68,68,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <AlertTriangle size={16} style={{ color: '#ef4444' }} />
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#ef4444' }}>Cuotas vencidas</h3>
          <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#fca5a5' }}>{overdue.length} socios</span>
        </div>

        <div className="dues-head" style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 0.9fr 0.9fr 1fr',
          gap: '0.75rem',
          padding: '0.55rem 1rem',
          fontSize: '0.72rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-glass)',
        }}>
          <span>Socio</span>
          <span>Mora</span>
          <span>Importe</span>
          <span>WhatsApp</span>
        </div>

        {overdue.length === 0 ? (
          <p style={{ padding: '1.5rem 1rem', color: 'var(--text-muted)', margin: 0 }}>
            No hay resultados con los filtros actuales.
          </p>
        ) : (
          overdue.map((m) => (
            <MemberDuesRow key={m.memberId} member={m} formatCurrency={formatCurrency} tone="overdue" />
          ))
        )}
      </section>
      )}

      {/* A vencer */}
      {showUpcoming && (
      <section className="glass-card" style={{ padding: 0, overflow: 'hidden', border: '1px solid rgba(245,158,11,0.25)' }}>
        <div style={{
          padding: '0.9rem 1.1rem',
          borderBottom: '1px solid rgba(245,158,11,0.25)',
          background: 'rgba(245,158,11,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <Clock3 size={16} style={{ color: '#f59e0b' }} />
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f59e0b' }}>Próximas a vencer</h3>
          <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#fcd34d' }}>{upcoming.length} socios</span>
        </div>

        <div className="dues-head" style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 0.9fr 0.9fr 1fr',
          gap: '0.75rem',
          padding: '0.55rem 1rem',
          fontSize: '0.72rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-glass)',
        }}>
          <span>Socio</span>
          <span>Vence</span>
          <span>Cuota</span>
          <span>WhatsApp</span>
        </div>

        {upcoming.length === 0 ? (
          <p style={{ padding: '1.5rem 1rem', color: 'var(--text-muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={14} /> No hay resultados con los filtros actuales.
          </p>
        ) : (
          upcoming.map((m) => (
            <div key={m.memberId}>
              <MemberDuesRow member={m} formatCurrency={formatCurrency} tone="upcoming" />
              <div style={{
                padding: '0 1rem 0.75rem',
                marginTop: '-0.35rem',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
              }}>
                Vencimiento: {formatShortDate(m.nextDueDate)}
              </div>
            </div>
          ))
        )}
      </section>
      )}
    </div>
  );
}

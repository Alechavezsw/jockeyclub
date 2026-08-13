import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Clock3, Search, Users, Download, ExternalLink, Banknote,
} from 'lucide-react';
import {
  formatShortDate,
  getOverdueMembers,
  getUpcomingDuesMembers,
  toWhatsAppPhone,
} from '../../domain/members/dues';
import { payMemberDues, payUpcomingDues } from '../../domain/members/memberPayments';
import { downloadCsv, stampDate } from '../../domain/reports/downloadCsv';

function matchesSearch(member, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const phone = (member.phone || '').replace(/\s/g, '');
  return (
    member.name?.toLowerCase().includes(q)
    || member.memberId?.toLowerCase().includes(q)
    || phone.includes(q.replace(/\s/g, ''))
    || (member.tier || '').toLowerCase().includes(q)
  );
}

function matchesTier(member, tier) {
  if (tier === 'all') return true;
  return (member.tier || '').toLowerCase() === tier;
}

function WhatsAppIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

function buildWhatsAppUrl(member, formatCurrency, isOverdue) {
  const cleanPhone = toWhatsAppPhone(member.phone);
  if (!cleanPhone) return null;

  const dueLabel = formatShortDate(member.dueDate || member.nextDueDate);
  const msg = isOverdue
    ? `Estimado/a ${member.name}, le saludamos del Jockey Club San Juan. Le recordamos que posee una cuota vencida de ${formatCurrency(member.amountDue)} (vencimiento ${dueLabel}). Puede regularizarla en administración o por transferencia. ¡Gracias!`
    : `Estimado/a ${member.name}, le saludamos del Jockey Club San Juan. Le recordamos que su próxima cuota (${formatCurrency(member.amountDue)}) vence el ${dueLabel}. Ante cualquier consulta estamos a disposición. ¡Gracias!`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

function plazoLabel(member, isOverdue) {
  if (isOverdue) {
    if (member.daysOverdue == null) return 'En mora';
    if (member.daysOverdue === 0) return 'Vence hoy';
    return `${member.daysOverdue} día${member.daysOverdue === 1 ? '' : 's'}`;
  }
  if (member.daysUntil == null) return 'Próxima';
  if (member.daysUntil === 0) return 'Hoy';
  if (member.daysUntil === 1) return 'Mañana';
  return `En ${member.daysUntil} días`;
}

function MemberDuesRow({
  member,
  formatCurrency,
  tone = 'overdue',
  onOpen,
  onCollect,
}) {
  const isOverdue = tone === 'overdue';
  const waUrl = buildWhatsAppUrl(member, formatCurrency, isOverdue);
  const dueIso = member.dueDate || member.nextDueDate || member.overdueSince;
  const canCollect = isOverdue
    ? (Number(member.outstandingBalance) || 0) > 0 || (Number(member.amountDue) || 0) > 0
    : true;

  return (
    <div className="dues-row">
      <div>
        <button type="button" className="dues-name-btn" onClick={() => onOpen?.(member)}>
          <strong>{member.name}</strong>
          <ExternalLink size={12} />
        </button>
        <div className="dues-meta">
          {(member.tier || '').toUpperCase()}
          {member.memberId ? ` · ${member.memberId}` : ''}
        </div>
      </div>
      <div className={`dues-plazo ${isOverdue ? 'is-overdue' : 'is-upcoming'}`}>
        {plazoLabel(member, isOverdue)}
      </div>
      <div className="dues-date">{formatShortDate(dueIso)}</div>
      <div className={`dues-amount ${isOverdue ? 'is-overdue' : 'is-upcoming'}`}>
        {formatCurrency(member.amountDue)}
      </div>
      <div className="dues-actions">
        {waUrl ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="dues-wa"
            title={`WhatsApp ${member.phone}`}
          >
            <WhatsAppIcon size={16} />
            <span>{member.phone}</span>
          </a>
        ) : (
          <span className="dues-no-phone">Sin teléfono</span>
        )}
        {canCollect && (
          <button
            type="button"
            className="btn btn-sm btn-primary dues-collect-btn"
            onClick={() => onCollect?.(member, tone)}
            title={isOverdue ? 'Registrar cobro de cuota' : 'Cobrar cuota anticipada'}
          >
            <Banknote size={14} /> Cobrar
          </button>
        )}
      </div>
    </div>
  );
}

function DuesTableHead({ labels }) {
  return (
    <div className="dues-head">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

export default function DuesControlTab({
  members = [],
  setMembers,
  addJournalEntry,
  formatCurrency,
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [sortBy, setSortBy] = useState('amount');
  const [flash, setFlash] = useState('');

  const overdueAll = useMemo(() => getOverdueMembers(members), [members]);
  const upcomingAll = useMemo(() => getUpcomingDuesMembers(members, { withinDays: 15 }), [members]);

  const applyListFilters = (list, tone) => {
    let next = list.filter((m) => matchesSearch(m, search) && matchesTier(m, tierFilter));
    next = [...next].sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '', 'es');
      if (sortBy === 'days') {
        const da = tone === 'overdue' ? (a.daysOverdue ?? -1) : (a.daysUntil ?? 99);
        const db = tone === 'overdue' ? (b.daysOverdue ?? -1) : (b.daysUntil ?? 99);
        return tone === 'overdue' ? db - da : da - db;
      }
      return (b.amountDue || 0) - (a.amountDue || 0);
    });
    return next;
  };

  const overdue = useMemo(
    () => applyListFilters(overdueAll, 'overdue'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overdueAll, search, tierFilter, sortBy]
  );
  const upcoming = useMemo(
    () => applyListFilters(upcomingAll, 'upcoming'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upcomingAll, search, tierFilter, sortBy]
  );

  const overdueTotalAll = overdueAll.reduce((s, m) => s + (Number(m.amountDue) || 0), 0);
  const upcomingTotalAll = upcomingAll.reduce((s, m) => s + (Number(m.amountDue) || 0), 0);
  const showOverdue = statusFilter === 'all' || statusFilter === 'overdue';
  const showUpcoming = statusFilter === 'all' || statusFilter === 'upcoming';

  const openMember = (member) => {
    if (!member?.memberId) return;
    navigate(`/panel/members/${member.memberId}`);
  };

  const handleCollect = (member, tone) => {
    if (!setMembers) return;
    const isOverdue = tone === 'overdue';
    const label = isOverdue ? 'cobro de cuota vencida' : 'cobro anticipado de cuota';
    if (!window.confirm(`¿Registrar ${label} de ${member.name} por ${formatCurrency(member.amountDue)}?`)) {
      return;
    }
    try {
      // Si figura vencido pero el saldo aún no estaba en el objeto (caso raro), usamos amountDue
      const source = (Number(member.outstandingBalance) || 0) > 0
        ? member
        : { ...member, outstandingBalance: member.amountDue };
      const result = isOverdue
        ? payMemberDues(source, { method: 'caja' })
        : payUpcomingDues(member, { method: 'caja' });

      setMembers((prev) => prev.map((m) => (
        m.memberId === member.memberId ? result.member : m
      )));

      if (typeof addJournalEntry === 'function') {
        addJournalEntry({
          date: new Date().toISOString().slice(0, 10),
          description: `Cobro cuota social (Caja) - Socio: ${member.name} (Cred. ${String(member.memberId).slice(0, 6)}…)`,
          lines: [
            { account: 'Caja General', type: 'debit', amount: result.payment.amount },
            { account: 'Cuotas Sociales', type: 'credit', amount: result.payment.amount },
          ],
          sourceModule: 'cuotas',
        });
      }

      setFlash(`Cobro registrado: ${member.name} · ${formatCurrency(result.payment.amount)}`);
      setTimeout(() => setFlash(''), 4000);
    } catch (err) {
      setFlash(err.message || 'No se pudo registrar el cobro.');
      setTimeout(() => setFlash(''), 5000);
    }
  };

  const handleExport = () => {
    const rows = [];
    if (showOverdue) {
      overdue.forEach((m) => {
        rows.push([
          'Vencida',
          m.name,
          m.memberId,
          (m.tier || '').toUpperCase(),
          plazoLabel(m, true),
          m.dueDate || m.nextDueDate || '',
          m.amountDue,
          m.phone || '',
        ]);
      });
    }
    if (showUpcoming) {
      upcoming.forEach((m) => {
        rows.push([
          'A vencer',
          m.name,
          m.memberId,
          (m.tier || '').toUpperCase(),
          plazoLabel(m, false),
          m.dueDate || m.nextDueDate || '',
          m.amountDue,
          m.phone || '',
        ]);
      });
    }
    downloadCsv(
      `jockey_club_control_cuotas_${stampDate()}.csv`,
      ['Estado', 'Socio', 'Credencial', 'Categoria', 'Plazo', 'Vencimiento', 'Importe', 'Telefono'],
      rows
    );
  };

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
    <div className="fade-in dues-control">
      <div className="dues-control-head">
        <div>
          <h2 className="serif-font">Control de Cuotas</h2>
          <p>
            Mora real (saldo o vencimiento pasado) y socios al día con vencimiento en los próximos 15 días.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={handleExport}>
          <Download size={14} /> Exportar vista CSV
        </button>
      </div>

      {flash && <div className="dues-flash">{flash}</div>}

      <div className="glass-card dues-filters">
        <div>
          <label className="form-label" htmlFor="dues-search">Buscar socio</label>
          <div className="dues-search-wrap">
            <Search size={15} />
            <input
              id="dues-search"
              type="search"
              className="form-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, credencial, teléfono o categoría…"
            />
          </div>
        </div>

        <div className="dues-filter-controls">
          <div>
            <span className="form-label">Estado</span>
            <div className="dues-filter-pills">
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
          <div className="dues-filter-selects">
            <div>
              <label className="form-label" htmlFor="dues-tier">Categoría</label>
              <select
                id="dues-tier"
                className="form-input"
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
              >
                <option value="all">Todas</option>
                <option value="royal">Royal</option>
                <option value="platinum">Platinum</option>
                <option value="gold">Gold</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="dues-sort">Ordenar por</label>
              <select
                id="dues-sort"
                className="form-input"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="amount">Importe</option>
                <option value="name">Nombre</option>
                <option value="days">Días</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="dues-kpi-grid">
        <button
          type="button"
          className={`dues-kpi is-overdue${statusFilter === 'overdue' ? ' is-active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'overdue' ? 'all' : 'overdue')}
        >
          <div className="dues-kpi-label"><AlertTriangle size={16} /> Vencidas</div>
          <div className="dues-kpi-value">{overdueAll.length}</div>
          <div className="dues-kpi-sub">{formatCurrency(overdueTotalAll)} en mora</div>
          {(search || tierFilter !== 'all') && overdue.length !== overdueAll.length && (
            <div className="dues-kpi-hint">{overdue.length} con filtro actual</div>
          )}
        </button>
        <button
          type="button"
          className={`dues-kpi is-upcoming${statusFilter === 'upcoming' ? ' is-active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'upcoming' ? 'all' : 'upcoming')}
        >
          <div className="dues-kpi-label"><Clock3 size={16} /> A vencer</div>
          <div className="dues-kpi-value">{upcomingAll.length}</div>
          <div className="dues-kpi-sub">{formatCurrency(upcomingTotalAll)} · próximos 15 días</div>
          {(search || tierFilter !== 'all') && upcoming.length !== upcomingAll.length && (
            <div className="dues-kpi-hint">{upcoming.length} con filtro actual</div>
          )}
        </button>
      </div>

      {showOverdue && (
        <section className="glass-card dues-section is-overdue">
          <div className="dues-section-head">
            <AlertTriangle size={16} />
            <h3>Cuotas vencidas</h3>
            <span>{overdue.length} socios</span>
          </div>
          <DuesTableHead labels={['Socio', 'Mora', 'Vencimiento', 'Importe', 'Acciones']} />
          {overdue.length === 0 ? (
            <p className="dues-empty">No hay resultados con los filtros actuales.</p>
          ) : (
            overdue.map((m) => (
              <MemberDuesRow
                key={m.memberId}
                member={m}
                formatCurrency={formatCurrency}
                tone="overdue"
                onOpen={openMember}
                onCollect={handleCollect}
              />
            ))
          )}
        </section>
      )}

      {showUpcoming && (
        <section className="glass-card dues-section is-upcoming">
          <div className="dues-section-head">
            <Clock3 size={16} />
            <h3>Próximas a vencer</h3>
            <span>{upcoming.length} socios</span>
          </div>
          <DuesTableHead labels={['Socio', 'Plazo', 'Vencimiento', 'Cuota', 'Acciones']} />
          {upcoming.length === 0 ? (
            <p className="dues-empty"><Users size={14} /> No hay resultados con los filtros actuales.</p>
          ) : (
            upcoming.map((m) => (
              <MemberDuesRow
                key={m.memberId}
                member={m}
                formatCurrency={formatCurrency}
                tone="upcoming"
                onOpen={openMember}
                onCollect={handleCollect}
              />
            ))
          )}
        </section>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, DoorOpen, Search, X,
} from 'lucide-react';
import {
  ACCESS_ACTIVITIES,
  ACCESS_GROUPS,
  accessCountsByDay,
  filterAccessLogs,
  normalizeAccessLog,
} from '../../domain/credentials/accessLog';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function monthLabel(year, monthIndex) {
  const name = new Date(year, monthIndex, 1).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
  });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function buildMonthCells(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  // Lunes = 0 … Domingo = 6
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * Registro de ingresos por molinete: listado, filtros, búsqueda y calendario.
 */
export default function AccessLogsTab({ entryLogs = [], onOpenGate }) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(today);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [group, setGroup] = useState('all');
  const [activity, setActivity] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const normalized = useMemo(
    () => (entryLogs || []).map(normalizeAccessLog),
    [entryLogs],
  );

  const dayCounts = useMemo(
    () => accessCountsByDay(normalized, viewYear, viewMonth),
    [normalized, viewYear, viewMonth],
  );

  const filtered = useMemo(
    () => filterAccessLogs(normalized, {
      query,
      status,
      group,
      activity,
      dateFrom,
      dateTo,
      day: selectedDay || '',
    }),
    [normalized, query, status, group, activity, dateFrom, dateTo, selectedDay],
  );

  const monthCells = useMemo(
    () => buildMonthCells(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const kpis = useMemo(() => {
    const all = selectedDay
      ? normalized.filter((l) => l.date === selectedDay)
      : normalized;
    return {
      total: all.length,
      granted: all.filter((l) => l.status === 'granted').length,
      denied: all.filter((l) => l.status !== 'granted').length,
    };
  }, [normalized, selectedDay]);

  const shiftMonth = (delta) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setGroup('all');
    setActivity('all');
    setDateFrom('');
    setDateTo('');
    setSelectedDay(today);
  };

  return (
    <div className="access-logs fade-in">
      <header className="access-logs-head">
        <div>
          <h3 className="serif-font" style={{ margin: 0, fontSize: '1.45rem' }}>
            <DoorOpen size={22} style={{ verticalAlign: -4, marginRight: 8 }} />
            Ingresos al club
          </h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            Registro de lecturas del molinete · día, hora, socio, grupo y actividad
          </p>
        </div>
        {typeof onOpenGate === 'function' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpenGate}>
            Abrir Control QR
          </button>
        )}
      </header>

      <div className="access-logs-kpis">
        <article>
          <span>Registros{selectedDay ? ' del día' : ''}</span>
          <strong>{kpis.total}</strong>
        </article>
        <article className="is-ok">
          <span>Autorizados</span>
          <strong>{kpis.granted}</strong>
        </article>
        <article className="is-bad">
          <span>Denegados</span>
          <strong>{kpis.denied}</strong>
        </article>
        <article>
          <span>En listado filtrado</span>
          <strong>{filtered.length}</strong>
        </article>
      </div>

      <div className="access-logs-layout">
        <section className="glass-card access-logs-cal">
          <div className="access-logs-cal-nav">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
              <ChevronLeft size={16} />
            </button>
            <strong>
              <CalendarDays size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
              {monthLabel(viewYear, viewMonth)}
            </strong>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="access-logs-cal-week">
            {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
          </div>
          <div className="access-logs-cal-grid">
            {monthCells.map((iso, idx) => {
              if (!iso) return <div key={`e-${idx}`} className="access-logs-cal-cell is-empty" />;
              const count = dayCounts[iso];
              const isSelected = selectedDay === iso;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  className={[
                    'access-logs-cal-cell',
                    count ? 'has-logs' : '',
                    isSelected ? 'is-selected' : '',
                    isToday ? 'is-today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setSelectedDay(iso)}
                  title={count ? `${count.total} ingreso(s)` : 'Sin ingresos'}
                >
                  <em>{Number(iso.slice(-2))}</em>
                  {count ? (
                    <span className="access-logs-cal-dots" aria-hidden="true">
                      <i className="ok" />
                      {count.denied > 0 ? <i className="bad" /> : null}
                    </span>
                  ) : null}
                  {count ? <small>{count.total}</small> : null}
                </button>
              );
            })}
          </div>
          <p className="access-logs-cal-hint">
            Los días con puntos tienen ingresos guardados. Tocá un día para filtrar el listado.
            {selectedDay ? (
              <>
                {' '}Día activo: <strong>{selectedDay}</strong>
                {' '}
                <button type="button" className="access-logs-link" onClick={() => setSelectedDay('')}>
                  Ver todos
                </button>
              </>
            ) : null}
          </p>
        </section>

        <section className="glass-card access-logs-list-wrap">
          <div className="access-logs-filters">
            <label className="access-logs-search">
              <Search size={15} aria-hidden="true" />
              <input
                className="form-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar socio, credencial, nota…"
                autoComplete="off"
              />
            </label>
            <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
              <option value="all">Estado: todos</option>
              <option value="granted">Autorizados</option>
              <option value="denied">Denegados</option>
            </select>
            <select className="form-input" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Grupo">
              <option value="all">Grupo: todos</option>
              {ACCESS_GROUPS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <select className="form-input" value={activity} onChange={(e) => setActivity(e.target.value)} aria-label="Actividad">
              <option value="all">Actividad: todas</option>
              {ACCESS_ACTIVITIES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <input
              className="form-input"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Desde"
              title="Desde"
            />
            <input
              className="form-input"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Hasta"
              title="Hasta"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
              <X size={14} /> Limpiar
            </button>
          </div>

          <div className="access-logs-table-wrap">
            <table className="admin-table access-logs-table">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Hora</th>
                  <th>Socio</th>
                  <th>Grupo</th>
                  <th>Actividad</th>
                  <th>Estado</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 1rem' }}>
                      No hay ingresos con estos filtros.
                    </td>
                  </tr>
                ) : (
                  filtered.map((log) => (
                    <tr key={log.id}>
                      <td>{log.date}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{log.time}</td>
                      <td>
                        <strong style={{ color: 'var(--text-strong)' }}>{log.memberName}</strong>
                        {log.memberId ? (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {String(log.memberId)}
                          </div>
                        ) : null}
                      </td>
                      <td>{log.group || '—'}</td>
                      <td>{log.activity || '—'}</td>
                      <td>
                        <span className={`access-logs-badge ${log.status === 'granted' ? 'ok' : 'bad'}`}>
                          {log.status === 'granted' ? 'OK' : 'NO'}
                        </span>
                      </td>
                      <td style={{ maxWidth: 220, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {log.notes || log.role || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

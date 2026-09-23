import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, DoorOpen, Search, X,
} from 'lucide-react';
import {
  ACCESS_ACTIVITIES,
  ACCESS_GROUPS,
  accessCountsByDay,
  clubDayOfAccessLog,
  filterAccessLogs,
  mergeAccessLogsWithPool,
  normalizeAccessLog,
} from '../../domain/credentials/accessLog';
import { todayISODateAR } from '../../lib/arDate';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const LIST_PAGE_SIZE = 12;

function shiftISODate(iso, days) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso;
  const next = new Date(y, m - 1, d + Number(days || 0), 12, 0, 0);
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, '0');
  const dd = String(next.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDayHeading(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  const label = new Date(y, m - 1, d, 12).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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
export default function AccessLogsTab({ entryLogs = [], poolAccesses = [], onOpenGate }) {
  const today = todayISODateAR();
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
  const [page, setPage] = useState(1);

  const normalized = useMemo(
    () => mergeAccessLogsWithPool(entryLogs, poolAccesses).map(normalizeAccessLog),
    [entryLogs, poolAccesses],
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
      day: dateFrom || dateTo ? '' : (selectedDay || today),
    }),
    [normalized, query, status, group, activity, dateFrom, dateTo, selectedDay, today],
  );

  const monthCells = useMemo(
    () => buildMonthCells(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const kpis = useMemo(() => {
    const all = selectedDay
      ? normalized.filter((l) => clubDayOfAccessLog(l) === selectedDay)
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

  const goToDay = (iso) => {
    const day = iso || today;
    setSelectedDay(day);
    setDateFrom('');
    setDateTo('');
    setPage(1);
    const [y, m] = String(day).split('-').map(Number);
    if (y && m) {
      setViewYear(y);
      setViewMonth(m - 1);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setGroup('all');
    setActivity('all');
    goToDay(today);
  };

  useEffect(() => {
    setPage(1);
  }, [selectedDay, query, status, group, activity, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE);
  const canGoNextDay = selectedDay && selectedDay < today;

  return (
    <div className="access-logs fade-in">
      <header className="access-logs-head">
        <div>
          <h3 className="serif-font" style={{ margin: 0, fontSize: '1.45rem' }}>
            <DoorOpen size={22} style={{ verticalAlign: -4, marginRight: 8 }} />
            Ingresos al club
          </h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            Molinete, pases y pileta · día, hora, socio, grupo y actividad
          </p>
        </div>
        {typeof onOpenGate === 'function' && (
          <button type="button" className="btn btn-tan btn-sm" onClick={onOpenGate}>
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
                  onClick={() => goToDay(iso)}
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
                <button type="button" className="access-logs-link" onClick={() => goToDay(today)}>
                  Ir a hoy
                </button>
              </>
            ) : null}
          </p>
        </section>

        <section className="glass-card access-logs-list-wrap">
          <div className="access-logs-day-nav">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => goToDay(shiftISODate(selectedDay || today, -1))}
              aria-label="Día anterior"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <div className="access-logs-day-nav-label">
              <strong>{formatDayHeading(selectedDay || today)}</strong>
              <span>{selectedDay === today ? 'Hoy' : selectedDay}</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => goToDay(shiftISODate(selectedDay || today, 1))}
              disabled={!canGoNextDay}
              aria-label="Día siguiente"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="access-logs-filters">
            <label className="access-logs-search" htmlFor="access-logs-query">
              <span className="access-logs-field-label">Buscar</span>
              <span className="access-logs-search-box">
                <Search size={16} aria-hidden="true" />
                <input
                  id="access-logs-query"
                  name="access-query"
                  className="form-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Socio, DNI, credencial o nota…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </span>
            </label>

            <div className="access-logs-filter-grid">
              <label className="access-logs-field" htmlFor="access-logs-status">
                <span className="access-logs-field-label">Estado</span>
                <select
                  id="access-logs-status"
                  className="form-input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">Todos</option>
                  <option value="granted">Autorizados</option>
                  <option value="denied">Denegados</option>
                </select>
              </label>
              <label className="access-logs-field" htmlFor="access-logs-group">
                <span className="access-logs-field-label">Grupo</span>
                <select
                  id="access-logs-group"
                  className="form-input"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  <option value="all">Todos</option>
                  {ACCESS_GROUPS.filter((g) => g !== '—').map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                  <option value="—">Sin grupo</option>
                </select>
              </label>
              <label className="access-logs-field" htmlFor="access-logs-activity">
                <span className="access-logs-field-label">Actividad</span>
                <select
                  id="access-logs-activity"
                  className="form-input"
                  value={activity}
                  onChange={(e) => setActivity(e.target.value)}
                >
                  <option value="all">Todas</option>
                  {ACCESS_ACTIVITIES.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label className="access-logs-field" htmlFor="access-logs-from">
                <span className="access-logs-field-label">Desde</span>
                <input
                  id="access-logs-from"
                  className="form-input"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setSelectedDay('');
                  }}
                />
              </label>
              <label className="access-logs-field" htmlFor="access-logs-to">
                <span className="access-logs-field-label">Hasta</span>
                <input
                  id="access-logs-to"
                  className="form-input"
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setSelectedDay('');
                  }}
                />
              </label>
              <div className="access-logs-filter-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
                  <X size={14} aria-hidden="true" /> Limpiar
                </button>
              </div>
            </div>
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
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 1rem' }}>
                      No hay ingresos el {formatDayHeading(selectedDay || today).toLowerCase()}.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((log) => (
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

          <div className="members-pager members-pager--bottom access-logs-pager" aria-live="polite">
            <span>
              {filtered.length === 0
                ? 'Sin registros'
                : `${(safePage - 1) * LIST_PAGE_SIZE + 1}–${Math.min(safePage * LIST_PAGE_SIZE, filtered.length)} de ${filtered.length}`}
            </span>
            <div className="members-pager-controls">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                aria-label="Página anterior"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <span className="members-pager-page">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                aria-label="Página siguiente"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

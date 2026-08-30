import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Clock, CalendarDays, X } from 'lucide-react';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthLabel(year, month) {
  const raw = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function statusLabel(status) {
  if (status === 'confirmed') return 'Confirmado';
  if (status === 'pending') return 'Pendiente';
  return 'Cancelado';
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v);
}

function formatSlot(res) {
  if (res.endTime) return `${res.time} – ${res.endTime}`;
  return res.time || '—';
}

/** Libro de reservas con calendario mensual y tabla de gestión. */
export default function BookingsTab({ reservations = [], setReservations }) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);
  const todayKey = toISODate(today);

  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const [selectedDate, setSelectedDate] = useState(null);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    // Al elegir un día, abrir el panel; al volver a “todas”, colapsar la lista larga
    setListOpen(Boolean(selectedDate));
  }, [selectedDate]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const res of reservations) {
      if (!res?.date) continue;
      const list = map.get(res.date) || [];
      list.push(res);
      map.set(res.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    }
    return map;
  }, [reservations]);

  const calendarCells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startOffset = (first.getDay() + 6) % 7; // lunes = 0
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const cells = [];

    for (let i = 0; i < startOffset; i += 1) {
      cells.push({ key: `pad-${i}`, empty: true });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(cursor.year, cursor.month, day, 12);
      const iso = toISODate(date);
      const dayRes = byDate.get(iso) || [];
      cells.push({
        key: iso,
        empty: false,
        day,
        iso,
        isToday: iso === todayKey,
        isSelected: selectedDate === iso,
        total: dayRes.length,
        confirmed: dayRes.filter((r) => r.status === 'confirmed').length,
        pending: dayRes.filter((r) => r.status === 'pending').length,
        cancelled: dayRes.filter((r) => r.status === 'cancelled').length,
      });
    }
    return cells;
  }, [cursor, byDate, todayKey, selectedDate]);

  const filteredReservations = useMemo(() => {
    const list = selectedDate
      ? reservations.filter((r) => r.date === selectedDate)
      : [...reservations];
    return list.sort((a, b) => {
      const byDateCmp = String(a.date || '').localeCompare(String(b.date || ''));
      if (byDateCmp !== 0) return byDateCmp;
      return String(a.time || '').localeCompare(String(b.time || ''));
    });
  }, [reservations, selectedDate]);

  const selectedDayList = selectedDate ? (byDate.get(selectedDate) || []) : [];

  const shiftMonth = (delta) => {
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const handleUpdateReservationStatus = (resId, newStatus) => {
    setReservations(reservations.map((res) => (
      res.id === resId ? { ...res, status: newStatus } : res
    )));
  };

  return (
    <div className="glass-card fade-in bookings-tab" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <style>{`
        .bookings-layout {
          display: grid;
          grid-template-columns: minmax(280px, 1.05fr) minmax(0, 1.35fr);
          gap: 1.25rem;
          align-items: start;
        }
        .bookings-cal {
          padding: 1rem;
          border: 1px solid var(--border-glass);
          border-radius: 12px;
          background: rgba(255,255,255,0.02);
        }
        .bookings-cal-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 0.85rem;
        }
        .bookings-cal-head h4 {
          margin: 0;
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--text-primary);
        }
        .bookings-cal-nav {
          display: inline-flex;
          gap: 0.35rem;
        }
        .bookings-cal-nav button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 8px;
          border: 1px solid var(--border-glass);
          background: rgba(255,255,255,0.03);
          color: var(--text-primary);
          cursor: pointer;
        }
        .bookings-cal-nav button:hover {
          border-color: var(--primary-gold);
          color: var(--primary-gold);
        }
        .bookings-cal-week {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 0.25rem;
          margin-bottom: 0.35rem;
        }
        .bookings-cal-week span {
          text-align: center;
          font-size: 0.68rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          padding: 0.25rem 0;
        }
        .bookings-cal-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 0.3rem;
        }
        .bookings-cal-cell {
          min-height: 64px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: rgba(255,255,255,0.02);
          padding: 0.35rem 0.3rem;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.25rem;
          cursor: pointer;
          color: var(--text-primary);
          font-family: inherit;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .bookings-cal-cell:hover:not(:disabled) {
          border-color: rgba(207,161,58,0.45);
          background: rgba(207,161,58,0.06);
        }
        .bookings-cal-cell:disabled {
          cursor: default;
          opacity: 0.25;
        }
        .bookings-cal-cell.is-today {
          border-color: rgba(16,185,129,0.45);
        }
        .bookings-cal-cell.is-selected {
          border-color: var(--primary-gold);
          background: rgba(207,161,58,0.12);
          box-shadow: inset 0 0 0 1px rgba(207,161,58,0.25);
        }
        .bookings-cal-cell.has-bookings {
          background: rgba(255,255,255,0.04);
        }
        .bookings-cal-daynum {
          font-size: 0.82rem;
          font-weight: 700;
          line-height: 1;
        }
        .bookings-cal-dots {
          display: flex;
          flex-wrap: wrap;
          gap: 3px;
          margin-top: auto;
        }
        .bookings-cal-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .bookings-cal-dot.confirmed { background: var(--emerald-accent); }
        .bookings-cal-dot.pending { background: #f59e0b; }
        .bookings-cal-dot.cancelled { background: #ef4444; }
        .bookings-cal-count {
          font-size: 0.65rem;
          color: var(--text-muted);
        }
        .bookings-day-panel {
          margin-top: 0.9rem;
          padding-top: 0.85rem;
          border-top: 1px solid var(--border-glass);
        }
        .bookings-day-panel h5 {
          margin: 0 0 0.55rem;
          font-size: 0.85rem;
          color: var(--text-gold);
        }
        .bookings-day-item {
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
          font-size: 0.8rem;
          padding: 0.45rem 0;
          border-bottom: 1px solid var(--border-glass);
        }
        .bookings-day-item:last-child { border-bottom: none; }
        .bookings-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 0.85rem;
          margin-top: 0.75rem;
          font-size: 0.72rem;
          color: var(--text-muted);
        }
        .bookings-legend span {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }
        .bookings-table-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
          margin-bottom: 0;
        }
        .bookings-list-panel {
          border: 1px solid var(--border-glass);
          border-radius: 12px;
          overflow: hidden;
          background: color-mix(in srgb, var(--bg-card, transparent) 88%, transparent);
        }
        .bookings-list-toggle {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
          padding: 0.85rem 1rem;
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
          text-align: left;
        }
        .bookings-list-toggle:hover {
          background: color-mix(in srgb, var(--primary-gold) 6%, transparent);
        }
        .bookings-list-chevron {
          flex-shrink: 0;
          transition: transform 0.18s ease;
          color: var(--text-muted);
        }
        .bookings-list-chevron.is-open {
          transform: rotate(180deg);
        }
        .bookings-list-body {
          border-top: 1px solid var(--border-glass);
          max-height: min(52vh, 420px);
          overflow: auto;
        }
        .bookings-list-actions {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
        @media (max-width: 980px) {
          .bookings-layout {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
        <CalendarDays size={20} color="var(--primary-gold)" />
        <h3 className="serif-font" style={{ fontSize: '1.4rem', margin: 0 }}>Libro de Reservas</h3>
      </div>

      <div className="bookings-layout">
        <aside className="bookings-cal">
          <div className="bookings-cal-head">
            <h4>{monthLabel(cursor.year, cursor.month)}</h4>
            <div className="bookings-cal-nav">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCursor({ year: today.getFullYear(), month: today.getMonth() });
                  setSelectedDate(todayKey);
                }}
                aria-label="Ir a hoy"
                style={{ width: 'auto', padding: '0 0.65rem', fontSize: '0.75rem', fontWeight: 600 }}
              >
                Hoy
              </button>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="bookings-cal-week">
            {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="bookings-cal-grid">
            {calendarCells.map((cell) => (
              cell.empty ? (
                <button key={cell.key} type="button" className="bookings-cal-cell" disabled aria-hidden="true" />
              ) : (
                <button
                  key={cell.key}
                  type="button"
                  className={[
                    'bookings-cal-cell',
                    cell.isToday ? 'is-today' : '',
                    cell.isSelected ? 'is-selected' : '',
                    cell.total > 0 ? 'has-bookings' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setSelectedDate((prev) => (prev === cell.iso ? null : cell.iso))}
                  title={cell.total ? `${cell.total} reserva${cell.total === 1 ? '' : 's'}` : 'Sin reservas'}
                >
                  <span className="bookings-cal-daynum">{cell.day}</span>
                  {cell.total > 0 && (
                    <>
                      <span className="bookings-cal-count">{cell.total}</span>
                      <span className="bookings-cal-dots">
                        {Array.from({ length: Math.min(cell.confirmed, 3) }).map((_, i) => (
                          <span key={`c-${i}`} className="bookings-cal-dot confirmed" />
                        ))}
                        {Array.from({ length: Math.min(cell.pending, 2) }).map((_, i) => (
                          <span key={`p-${i}`} className="bookings-cal-dot pending" />
                        ))}
                        {cell.cancelled > 0 && <span className="bookings-cal-dot cancelled" />}
                      </span>
                    </>
                  )}
                </button>
              )
            ))}
          </div>

          <div className="bookings-legend">
            <span><i className="bookings-cal-dot confirmed" /> Confirmada</span>
            <span><i className="bookings-cal-dot pending" /> Pendiente</span>
            <span><i className="bookings-cal-dot cancelled" /> Cancelada</span>
          </div>

          {selectedDate && (
            <div className="bookings-day-panel">
              <h5>
                {new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-AR', {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}
              </h5>
              {selectedDayList.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Sin turnos este día.
                </p>
              ) : (
                selectedDayList.map((res) => (
                  <div key={res.id} className="bookings-day-item">
                    <div>
                      <strong>{formatSlot(res)}</strong>
                      <div style={{ color: 'var(--text-muted)' }}>{res.facilityName}</div>
                      <div>{res.memberName}</div>
                      {formatMoney(res.chargedPrice || res.estimatedPrice) && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {formatMoney(res.chargedPrice || res.estimatedPrice)}
                        </div>
                      )}
                    </div>
                    <span className={`status-tag ${res.status}`}>{statusLabel(res.status)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </aside>

        <div className="bookings-list-panel">
          <div className="bookings-table-head" style={{ padding: '0.35rem 0.35rem 0.35rem 0.15rem' }}>
            <button
              type="button"
              className="bookings-list-toggle"
              aria-expanded={listOpen}
              onClick={() => setListOpen((v) => !v)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <div>
                <h4 style={{ margin: 0, fontSize: '1rem' }}>
                  {selectedDate
                    ? `Turnos del ${new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-AR')}`
                    : 'Todas las reservas'}
                </h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {filteredReservations.length} registro{filteredReservations.length === 1 ? '' : 's'}
                  {listOpen
                    ? (selectedDate ? ' · click de nuevo en el día para ver todas' : ' · elegí un día en el calendario')
                    : ' · clic para expandir'}
                </p>
              </div>
              <ChevronDown size={18} className={`bookings-list-chevron${listOpen ? ' is-open' : ''}`} aria-hidden />
            </button>
            {selectedDate ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedDate(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: '0.5rem' }}
              >
                <X size={14} /> Ver todas
              </button>
            ) : null}
          </div>

          {listOpen ? (
            <div className="bookings-list-body table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Socio</th>
                    <th>Instalación</th>
                    <th>Fecha</th>
                    <th>Horario</th>
                    <th>Importe</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Gestión</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReservations.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--text-muted)', padding: '1.5rem 1rem' }}>
                        No hay reservas para mostrar.
                      </td>
                    </tr>
                  ) : (
                    filteredReservations.map((res) => (
                      <tr key={res.id}>
                        <td>
                          <strong>{res.memberName}</strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Nº {res.memberId}
                          </div>
                        </td>
                        <td>
                          <span style={{ color: 'var(--text-gold)', fontWeight: 600 }}>{res.facilityName}</span>
                        </td>
                        <td>{res.date}</td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 500 }}>
                            <Clock size={12} /> {formatSlot(res)}
                          </span>
                        </td>
                        <td>
                          {formatMoney(res.chargedPrice || res.estimatedPrice) || (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          <span className={`status-tag ${res.status}`}>
                            {statusLabel(res.status)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                            {res.status === 'pending' && (
                              <button
                                type="button"
                                onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                                className="btn btn-secondary btn-sm"
                                style={{
                                  borderColor: 'var(--emerald-accent)',
                                  color: 'var(--emerald-accent)',
                                  background: 'rgba(16, 185, 129, 0.05)',
                                  padding: '0.35rem 0.75rem',
                                }}
                              >
                                Aprobar
                              </button>
                            )}
                            {res.status !== 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => handleUpdateReservationStatus(res.id, 'cancelled')}
                                className="btn btn-danger btn-sm"
                                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                              >
                                Anular
                              </button>
                            )}
                            {res.status === 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                              >
                                Reactivar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

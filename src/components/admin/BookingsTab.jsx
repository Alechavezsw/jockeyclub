import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, CalendarDays, Plus, X } from 'lucide-react';
import AdminNewReservationDialog from './AdminNewReservationDialog';

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
  if (status === 'confirmed') return 'Confirmada';
  if (status === 'pending') return 'Pendiente';
  if (status === 'rejected') return 'Rechazada';
  return 'Cancelada';
}

function formatBookingDate(iso, { today = new Date() } = {}) {
  if (!iso) return '—';
  const day = String(iso).slice(0, 10);
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = date.getFullYear() === today.getFullYear();
  const raw = date.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return raw.replace(/\./g, '');
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

function reservationCreatedAt(res) {
  return String(res?.createdAt || '').trim();
}

/** Más reciente primero; pendientes arriba cuando no hay día filtrado. */
function compareReservationsLatest(a, b, { pendingFirst = false } = {}) {
  if (pendingFirst) {
    const ap = a.status === 'pending' ? 0 : 1;
    const bp = b.status === 'pending' ? 0 : 1;
    if (ap !== bp) return ap - bp;
  }
  const byCreated = reservationCreatedAt(b).localeCompare(reservationCreatedAt(a));
  if (byCreated !== 0) return byCreated;
  const byDate = String(b.date || '').localeCompare(String(a.date || ''));
  if (byDate !== 0) return byDate;
  return String(b.time || '').localeCompare(String(a.time || ''));
}

function formatRelativeCreated(iso) {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const diffMs = Date.now() - at.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return at.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

/** Libro de reservas con calendario mensual y tabla de gestión. */
export default function BookingsTab({
  reservations = [],
  setReservations,
  updateReservationStatus,
  addReservation = null,
  members = [],
  facilityCatalog = null,
}) {
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
  const [listOpen, setListOpen] = useState(true);
  const [newReservationOpen, setNewReservationOpen] = useState(false);

  const selectCalendarDay = (iso) => {
    setSelectedDate((prev) => {
      const next = prev === iso ? null : iso;
      if (next) setListOpen(true);
      return next;
    });
  };

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

  const currentMonthKey = todayKey.slice(0, 7);
  const currentMonthLabel = useMemo(() => {
    const raw = new Date(today.getFullYear(), today.getMonth(), 1)
      .toLocaleDateString('es-AR', { month: 'long' });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [today]);

  const monthReservations = useMemo(
    () => (reservations || []).filter((r) => (
      !r.occupancyOnly && String(r.date || '').slice(0, 7) === currentMonthKey
    )),
    [reservations, currentMonthKey],
  );

  const pendingReservations = useMemo(
    () => monthReservations.filter((r) => r.status === 'pending'),
    [monthReservations],
  );
  const pendingCount = pendingReservations.length;

  const latestReservations = useMemo(
    () => monthReservations
      .toSorted((a, b) => compareReservationsLatest(a, b, { pendingFirst: true }))
      .slice(0, 10),
    [monthReservations],
  );

  const filteredReservations = useMemo(() => {
    if (selectedDate) {
      return reservations
        .filter((r) => r.date === selectedDate)
        .toSorted((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    }
    return [...monthReservations]
      .toSorted((a, b) => compareReservationsLatest(a, b, { pendingFirst: true }));
  }, [reservations, selectedDate, monthReservations]);

  const selectedDayList = selectedDate ? (byDate.get(selectedDate) || []) : [];

  const shiftMonth = (delta) => {
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const handleUpdateReservationStatus = async (resId, newStatus) => {
    if (typeof updateReservationStatus === 'function') {
      const result = await updateReservationStatus(resId, newStatus);
      if (result?.ok === false && result?.error) {
        window.alert(result.error);
      }
      return;
    }
    setReservations((prev) => prev.map((res) => (
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
          border-color: rgba(var(--primary-gold-rgb),0.45);
          background: rgba(var(--primary-gold-rgb),0.06);
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
          background: rgba(var(--primary-gold-rgb),0.12);
          box-shadow: inset 0 0 0 1px rgba(var(--primary-gold-rgb),0.25);
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
          display: grid;
          grid-template-columns: 4.6rem minmax(0, 1fr) auto;
          gap: 0.65rem;
          align-items: center;
          font-size: 0.8rem;
          padding: 0.7rem 0;
          border-bottom: 1px solid var(--border-glass);
        }
        .bookings-day-item:last-child { border-bottom: none; }
        .bookings-day-time {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--text-gold);
          line-height: 1.15;
        }
        .bookings-day-time small {
          display: block;
          margin-top: 0.15rem;
          font-weight: 500;
          font-size: 0.68rem;
          letter-spacing: 0;
          color: var(--text-muted);
        }
        .bookings-day-copy {
          min-width: 0;
        }
        .bookings-day-copy strong,
        .bookings-day-place {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bookings-day-place {
          color: var(--text-muted);
          margin-top: 0.12rem;
        }
        .bookings-day-side {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.28rem;
        }
        .bookings-money {
          font-variant-numeric: tabular-nums;
          font-weight: 650;
          letter-spacing: -0.02em;
        }
        .bookings-status {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          padding: 0.18rem 0.5rem;
          border-radius: 999px;
          font-size: 0.68rem;
          font-weight: 650;
          letter-spacing: 0.01em;
          line-height: 1.2;
          border: 1px solid transparent;
        }
        .bookings-status.confirmed {
          color: var(--emerald-accent);
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.28);
        }
        .bookings-status.pending {
          color: var(--warning-accent);
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.28);
        }
        .bookings-status.cancelled {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.25);
        }
        .bookings-when {
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .bookings-when small {
          display: block;
          margin-top: 0.12rem;
          color: var(--text-muted);
          font-weight: 500;
        }
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
        .bookings-list-toggle-main {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          min-width: 0;
          flex: 1;
        }
        .bookings-list-title-row {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          flex-wrap: wrap;
        }
        .bookings-notif-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          min-height: 1.4rem;
          padding: 0.12rem 0.55rem;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.01em;
          background: color-mix(in srgb, #f59e0b 22%, transparent);
          color: #fbbf24;
          border: 1px solid color-mix(in srgb, #f59e0b 45%, transparent);
        }
        .bookings-notif-badge.is-clear {
          background: color-mix(in srgb, var(--emerald-accent) 14%, transparent);
          color: var(--emerald-accent);
          border-color: color-mix(in srgb, var(--emerald-accent) 35%, transparent);
        }
        .bookings-list-chevron {
          flex-shrink: 0;
          transition: transform 0.18s ease;
          color: var(--text-muted);
        }
        .bookings-list-chevron.is-open {
          transform: rotate(180deg);
        }
        .bookings-inbox {
          border-top: 1px solid var(--border-glass);
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          padding: 0.65rem 0.85rem 0.85rem;
        }
        .bookings-inbox-label {
          margin: 0 0 0.15rem;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .bookings-inbox-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.55rem 0.75rem;
          align-items: center;
          padding: 0.55rem 0.65rem;
          border-radius: 10px;
          border: 1px solid var(--border-glass);
          background: color-mix(in srgb, var(--bg-card, transparent) 70%, transparent);
          text-align: left;
          color: inherit;
          cursor: pointer;
          width: 100%;
        }
        .bookings-inbox-item:hover {
          border-color: color-mix(in srgb, var(--primary-gold) 40%, var(--border-glass));
          background: color-mix(in srgb, var(--primary-gold) 7%, transparent);
        }
        .bookings-inbox-item.is-pending {
          border-color: color-mix(in srgb, #f59e0b 40%, var(--border-glass));
          background: color-mix(in srgb, #f59e0b 8%, transparent);
        }
        .bookings-inbox-copy strong {
          display: block;
          font-size: 0.86rem;
          font-weight: 650;
          color: var(--text-primary);
        }
        .bookings-inbox-copy span {
          display: block;
          margin-top: 0.12rem;
          font-size: 0.74rem;
          color: var(--text-muted);
        }
        .bookings-inbox-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.25rem;
          flex-shrink: 0;
        }
        .bookings-inbox-meta small {
          font-size: 0.68rem;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .bookings-list-body {
          border-top: 1px solid var(--border-glass);
          max-height: min(70vh, 640px);
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
        <CalendarDays size={20} color="var(--primary-gold)" />
        <h3 className="serif-font" style={{ fontSize: '1.4rem', margin: 0, flex: 1, minWidth: 0 }}>
          Libro de Reservas
        </h3>
        {typeof addReservation === 'function' ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setNewReservationOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={15} />
            Nueva reserva
          </button>
        ) : null}
      </div>

      <AdminNewReservationDialog
        open={newReservationOpen}
        onClose={() => setNewReservationOpen(false)}
        members={members}
        reservations={reservations}
        facilityCatalog={facilityCatalog}
        addReservation={addReservation}
        onCreated={(saved) => {
          const day = String(saved?.date || '').slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            const d = new Date(`${day}T12:00:00`);
            if (!Number.isNaN(d.getTime())) {
              setCursor({ year: d.getFullYear(), month: d.getMonth() });
              setSelectedDate(day);
              setListOpen(true);
            }
          }
        }}
      />

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
                  onClick={() => selectCalendarDay(cell.iso)}
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
                selectedDayList.map((res) => {
                  const money = formatMoney(res.chargedPrice || res.estimatedPrice);
                  return (
                    <div key={res.id} className="bookings-day-item">
                      <div className="bookings-day-time">
                        {res.time || '—'}
                        {res.endTime ? <small>a {res.endTime}</small> : null}
                      </div>
                      <div className="bookings-day-copy">
                        <strong>{res.memberName}</strong>
                        <span className="bookings-day-place">{res.facilityName}</span>
                      </div>
                      <div className="bookings-day-side">
                        {money ? <span className="bookings-money">{money}</span> : null}
                        <span className={`bookings-status ${res.status}`}>{statusLabel(res.status)}</span>
                      </div>
                    </div>
                  );
                })
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
              <div className="bookings-list-toggle-main">
                <div style={{ minWidth: 0 }}>
                  <div className="bookings-list-title-row">
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>
                      {selectedDate
                        ? `Turnos del ${new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-AR')}`
                        : `Reservas · ${currentMonthLabel}`}
                    </h4>
                    {!selectedDate ? (
                      <span
                        className={`bookings-notif-badge${pendingCount ? '' : ' is-clear'}`}
                        aria-label={pendingCount
                          ? `${pendingCount} pendientes de aprobación`
                          : 'Sin pendientes'}
                      >
                        {pendingCount
                          ? `${pendingCount} pendiente${pendingCount === 1 ? '' : 's'}`
                          : 'Al día'}
                      </span>
                    ) : null}
                  </div>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {selectedDate
                      ? `${filteredReservations.length} turno${filteredReservations.length === 1 ? '' : 's'} del día`
                      : `${monthReservations.length} en ${currentMonthLabel.toLowerCase()}`}
                    {listOpen ? ' · clic para plegar' : ' · clic para expandir la tabla'}
                  </p>
                </div>
              </div>
              <ChevronDown size={18} className={`bookings-list-chevron${listOpen ? ' is-open' : ''}`} aria-hidden />
            </button>
            {selectedDate ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSelectedDate(null);
                  setListOpen(true);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: '0.5rem' }}
              >
                <X size={14} /> Ver mes
              </button>
            ) : null}
          </div>

          {!listOpen && !selectedDate && latestReservations.length > 0 ? (
            <div className="bookings-inbox" aria-label="Notificaciones de reservas">
              <p className="bookings-inbox-label">
                {pendingCount
                  ? `${currentMonthLabel} · pendientes y últimas 10`
                  : `${currentMonthLabel} · últimas 10`}
              </p>
              {latestReservations.map((res) => (
                <button
                  key={res.id}
                  type="button"
                  className={`bookings-inbox-item${res.status === 'pending' ? ' is-pending' : ''}`}
                  onClick={() => {
                    setSelectedDate(res.date || null);
                    setListOpen(true);
                    if (res.date) {
                      const d = new Date(`${String(res.date).slice(0, 10)}T12:00:00`);
                      if (!Number.isNaN(d.getTime())) {
                        setCursor({ year: d.getFullYear(), month: d.getMonth() });
                      }
                    }
                  }}
                >
                  <div className="bookings-inbox-copy">
                    <strong>{res.memberName || 'Socio'}</strong>
                    <span>
                      {res.facilityName || res.facilityId || 'Instalación'}
                      {' · '}
                      {formatBookingDate(res.date)}
                      {res.time ? ` · ${res.time}` : ''}
                    </span>
                  </div>
                  <div className="bookings-inbox-meta">
                    <span className={`bookings-status ${res.status}`}>{statusLabel(res.status)}</span>
                    <small>{formatRelativeCreated(reservationCreatedAt(res)) || '—'}</small>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {listOpen ? (
            <div className="bookings-list-body table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Socio</th>
                    <th>Instalación</th>
                    <th>Fecha</th>
                    <th>Horario</th>
                    {!selectedDate ? <th>Alta</th> : null}
                    <th>Importe</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Gestión</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReservations.length === 0 ? (
                    <tr>
                      <td colSpan={selectedDate ? 7 : 8} style={{ color: 'var(--text-muted)', padding: '1.5rem 1rem' }}>
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
                        <td className="bookings-when">{formatBookingDate(res.date)}</td>
                        <td className="bookings-when">
                          {res.time || '—'}
                          {res.endTime ? <small>a {res.endTime}</small> : null}
                        </td>
                        {!selectedDate ? (
                          <td className="bookings-when">
                            {formatRelativeCreated(reservationCreatedAt(res)) || '—'}
                          </td>
                        ) : null}
                        <td className="bookings-money">
                          {formatMoney(res.chargedPrice || res.estimatedPrice) || (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          <span className={`bookings-status ${res.status}`}>
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

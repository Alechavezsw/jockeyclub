import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
  CheckCircle2,
  AlertCircle,
  X,
  Radio,
  CircleDot,
  Ban,
  Snowflake,
  Wind,
  Search,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { FACILITIES, FACILITY_GROUPS, facilitiesByGroup, sortFacilitiesForDisplay, isSalonFacility, isParrillaFacility } from '../domain/reservations/facilities';
import { buildFacilityCatalog } from '../domain/reservations/facilityConfig';
import { getFacilityLiveStatus, isSeasonOpen } from '../domain/reservations/availability';
import { hasReservationConflict } from '../domain/reservations/conflicts';
import { joinWaitlist, leaveWaitlist, waitingForSlot } from '../domain/reservations/waitlist';
import ModalDialog from './ModalDialog';

const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const ACTIVE_RES_STATUSES = new Set(['confirmed', 'pending', 'approved']);

/** Espacios del sistema real de reservas (datita): salones + parrilla. */
function isRealBookableSpace(facility) {
  return isSalonFacility(facility) || isParrillaFacility(facility);
}

function isFacilityOpenForDay(facility, { isZondaActive, now }) {
  if (!facility) return false;
  if (facility.isOutdoor && isZondaActive) return false;
  if (!isSeasonOpen(facility, now)) return false;
  const adminStatus = String(facility.status || 'disponible').toLowerCase();
  if (adminStatus === 'suspendido' || adminStatus === 'no_disponible' || adminStatus === 'mantenimiento') {
    return false;
  }
  return true;
}

const STATUS_META = {
  available: { className: 'mfb-live--ok', Icon: CircleDot, label: 'Disponible' },
  occupied: { className: 'mfb-live--busy', Icon: Radio, label: 'Ocupada' },
  closed: { className: 'mfb-live--off', Icon: Ban, label: 'Cerrada' },
  suspended: { className: 'mfb-live--off', Icon: Wind, label: 'Suspendida' },
  season_closed: { className: 'mfb-live--season', Icon: Snowflake, label: 'Fuera de temporada' },
};

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildMonthCells(viewMonth) {
  const first = startOfMonth(viewMonth);
  // Lunes = 0 … Domingo = 6
  const mondayIndex = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < mondayIndex; i += 1) cells.push(null);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function freeSlotsForFacility(facility, dateStr, reservations, { isZondaActive, now }) {
  if (!isFacilityOpenForDay(facility, { isZondaActive, now })) return [];
  return (facility.slots || []).filter(
    (slot) => !hasReservationConflict(reservations, { facilityId: facility.id, date: dateStr, time: slot })
  );
}

/**
 * Disponibilidad del día sobre los espacios reales (o el grupo activo).
 * Cuenta turnos libres y cuántas reservas confirmadas hay ese día.
 */
function dayAvailabilityScore(dateStr, reservations, isZondaActive, now, facilities = []) {
  let free = 0;
  let total = 0;
  let spacesFree = 0;
  let spacesOpen = 0;

  for (const fac of facilities) {
    if (!isFacilityOpenForDay(fac, { isZondaActive, now })) continue;
    spacesOpen += 1;
    const slots = fac.slots || [];
    total += slots.length;
    const freeSlots = slots.filter(
      (slot) => !hasReservationConflict(reservations, { facilityId: fac.id, date: dateStr, time: slot })
    ).length;
    free += freeSlots;
    if (freeSlots > 0) spacesFree += 1;
  }

  const facilityIds = new Set(facilities.map((f) => f.id));
  const reservationCount = (reservations || []).filter(
    (r) =>
      r.date === dateStr
      && facilityIds.has(r.facilityId)
      && ACTIVE_RES_STATUSES.has(String(r.status || '').toLowerCase())
  ).length;

  return {
    free,
    total,
    spacesFree,
    spacesOpen,
    reservationCount,
  };
}

/**
 * Portal socio: disponibilidad en vivo + calendario + reserva en un solo flujo.
 */
export default function MemberFacilitiesBooking({
  member,
  reservations = [],
  addReservation,
  isZondaActive = false,
  compact = false,
  onBooked,
  waitlist = [],
  setWaitlist,
  facilityCatalog = null,
}) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const todayStr = toISODate(today);

  const [now, setNow] = useState(() => new Date());
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [activeGroup, setActiveGroup] = useState('espacios');
  const [query, setQuery] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [time, setTime] = useState('');
  const [guests, setGuests] = useState(0);
  const [guestNames, setGuestNames] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [waitMsg, setWaitMsg] = useState('');

  const catalog = useMemo(
    () => buildFacilityCatalog(FACILITIES, Array.isArray(facilityCatalog) ? facilityCatalog : []),
    [facilityCatalog]
  );
  const groups = useMemo(() => facilitiesByGroup(catalog), [catalog]);
  const monthCells = useMemo(() => buildMonthCells(viewMonth), [viewMonth]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const liveById = useMemo(() => {
    const map = new Map();
    for (const facility of catalog) {
      map.set(facility.id, getFacilityLiveStatus(facility, { reservations, isZondaActive, now }));
    }
    return map;
  }, [catalog, reservations, isZondaActive, now]);

  const active = groups.find((g) => g.id === activeGroup) || groups[0];
  const availableNow = catalog.filter((f) => liveById.get(f.id)?.status === 'available').length;

  /** Calendario = espacios reales (salón/parrilla) o el grupo activo si no es Espacios. */
  const calendarFacilities = useMemo(() => {
    if (activeGroup === 'espacios' || !activeGroup) {
      return sortFacilitiesForDisplay(catalog.filter(isRealBookableSpace));
    }
    return active?.items || [];
  }, [catalog, activeGroup, active]);

  const selectedDayScore = useMemo(
    () => dayAvailabilityScore(selectedDate, reservations, isZondaActive, now, calendarFacilities),
    [selectedDate, reservations, isZondaActive, now, calendarFacilities]
  );

  const filteredFacilities = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? catalog : (active?.items || []);
    const filtered = base.filter((fac) => {
      if (q) {
        const hay = `${fac.name} ${fac.description} ${fac.category} ${fac.spaceType || ''} ${fac.capacity}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (onlyAvailable) {
        const live = liveById.get(fac.id);
        if (live?.status !== 'available') return false;
      }
      return true;
    });
    return sortFacilitiesForDisplay(filtered);
  }, [catalog, active, query, onlyAvailable, liveById]);

  const freeForSelected = useMemo(() => {
    if (!selectedFacility) return [];
    return freeSlotsForFacility(selectedFacility, selectedDate, reservations, { isZondaActive, now });
  }, [selectedFacility, selectedDate, reservations, isZondaActive, now]);

  const openBooking = (facility) => {
    const live = liveById.get(facility.id);
    if (live?.status === 'suspended' || live?.status === 'season_closed') return;
    setSelectedFacility(facility);
    setTime('');
    setGuests(0);
    setGuestNames('');
    setErrorMessage('');
    setWaitMsg('');
    setBookingSuccess(false);
  };

  const myWaitlist = useMemo(
    () => (waitlist || []).filter((e) => e.memberId === member?.memberId && e.status === 'waiting'),
    [waitlist, member?.memberId]
  );

  const handleJoinWaitlist = () => {
    if (!setWaitlist || !selectedFacility || !time) {
      setErrorMessage('Elegí un horario ocupado para anotarte.');
      return;
    }
    try {
      const { entries } = joinWaitlist(waitlist, {
        facilityId: selectedFacility.id,
        facilityName: selectedFacility.name,
        date: selectedDate,
        time,
        memberId: member.memberId,
        memberName: member.name,
      });
      setWaitlist(entries);
      setWaitMsg(`Quedaste en lista de espera para las ${time} hs.`);
      setErrorMessage('');
    } catch (err) {
      setErrorMessage(err.message || 'No se pudo anotar en lista de espera.');
    }
  };

  const closeBooking = () => {
    setSelectedFacility(null);
    setBookingSuccess(false);
    setErrorMessage('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedFacility || !member) return;
    if (!selectedDate) {
      setErrorMessage('Seleccioná una fecha en el calendario.');
      return;
    }
    if (!time) {
      setErrorMessage('Elegí un horario disponible.');
      return;
    }
    if (selectedFacility.isOutdoor && isZondaActive) {
      setErrorMessage('Actividades al aire libre suspendidas por viento Zonda.');
      return;
    }
    if (hasReservationConflict(reservations, {
      facilityId: selectedFacility.id,
      date: selectedDate,
      time,
    })) {
      setErrorMessage('Ese turno acaba de ocuparse. Elegí otro horario.');
      return;
    }

    const payload = {
      facilityId: selectedFacility.id,
      facilityName: selectedFacility.name,
      memberId: member.memberId,
      memberName: member.name,
      date: selectedDate,
      time,
      guests: Number(guests) || 0,
      guestNames: guests > 0 ? guestNames : '',
      status: 'confirmed',
    };
    const result = addReservation?.(payload);
    if (result && result.ok === false) {
      setErrorMessage(result.error || 'No se pudo confirmar la reserva.');
      return;
    }
    setBookingSuccess(true);
    setErrorMessage('');
    onBooked?.(payload);
    setTimeout(() => closeBooking(), 1800);
  };

  const monthLabel = viewMonth.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const clockLabel = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const selectedDateLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <section className={`mfb ${compact ? 'mfb--compact' : ''}`}>
      <header className="mfb-head">
        <div>
          <h2 className="mfb-title">
            <Calendar size={20} /> Instalaciones & Reservas
          </h2>
          <p className="mfb-sub">
            Disponibilidad en vivo · elegí día en el calendario y reservá el turno.
          </p>
          <div className="mfb-live-clock">
            <span className="mfb-pulse" />
            En vivo · {clockLabel} · {availableNow} disponibles ahora
          </div>
        </div>
        {isZondaActive && (
          <div className="mfb-zonda">
            <Wind size={16} />
            Exterior suspendido por Zonda. Solo cubiertos.
          </div>
        )}
      </header>

      <div className="mfb-layout">
        {/* Calendario */}
        <aside className="mfb-calendar glass-card">
          <div className="mfb-cal-nav">
            <button
              type="button"
              className="mfb-icon-btn"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
              aria-label="Mes anterior"
            >
              <ChevronLeft size={18} />
            </button>
            <strong>{monthLabel}</strong>
            <button
              type="button"
              className="mfb-icon-btn"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
              aria-label="Mes siguiente"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="mfb-cal-weekdays">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="mfb-cal-grid">
            {monthCells.map((day, idx) => {
              if (!day) return <span key={`e-${idx}`} className="mfb-cal-empty" />;
              const iso = toISODate(day);
              const past = iso < todayStr;
              const selected = iso === selectedDate;
              const isToday = iso === todayStr;
              const score = past
                ? null
                : dayAvailabilityScore(iso, reservations, isZondaActive, now, calendarFacilities);
              const heat = score && score.total
                ? score.free / score.total
                : 0;
              const hasBookings = (score?.reservationCount || 0) > 0;
              const fullyBooked = score && score.spacesOpen > 0 && score.spacesFree === 0;

              return (
                <button
                  key={iso}
                  type="button"
                  disabled={past}
                  title={
                    score
                      ? `${score.reservationCount} reserva${score.reservationCount === 1 ? '' : 's'} · ${score.spacesFree}/${score.spacesOpen} espacios libres`
                      : undefined
                  }
                  className={[
                    'mfb-cal-day',
                    selected ? 'is-selected' : '',
                    isToday ? 'is-today' : '',
                    past ? 'is-past' : '',
                    !past && fullyBooked ? 'is-full' : '',
                    !past && !fullyBooked && heat > 0.6 ? 'is-free' : '',
                    !past && !fullyBooked && hasBookings ? 'is-tight' : '',
                    !past && !fullyBooked && !hasBookings && heat > 0 && heat <= 0.35 ? 'is-tight' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    setSelectedDate(iso);
                    setTime('');
                  }}
                >
                  <span>{day.getDate()}</span>
                  {!past && score && (
                    hasBookings ? (
                      <em className="mfb-cal-count" aria-hidden="true">{score.reservationCount}</em>
                    ) : (
                      <i className="mfb-cal-dot" style={{ opacity: 0.35 + heat * 0.65 }} />
                    )
                  )}
                </button>
              );
            })}
          </div>

          <p className="mfb-cal-caption">
            Día elegido: <strong>{selectedDateLabel}</strong>
          </p>
          <p className="mfb-cal-real">
            {selectedDayScore.reservationCount > 0
              ? `${selectedDayScore.reservationCount} reserva${selectedDayScore.reservationCount === 1 ? '' : 's'} · ${selectedDayScore.spacesFree}/${selectedDayScore.spacesOpen} espacios libres`
              : `${selectedDayScore.spacesFree}/${selectedDayScore.spacesOpen} espacios libres`}
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
            onClick={() => {
              setViewMonth(startOfMonth(today));
              setSelectedDate(todayStr);
            }}
          >
            Ir a hoy
          </button>
        </aside>

        {/* Listado en vivo */}
        <div className="mfb-main">
          <div className="mfb-toolbar">
            <label className="mfb-search">
              <Search size={16} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar salón, espacio verde, cancha…"
                aria-label="Buscar instalaciones"
              />
              {query && (
                <button
                  type="button"
                  className="mfb-search-clear"
                  onClick={() => setQuery('')}
                  aria-label="Limpiar búsqueda"
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <button
              type="button"
              className={`mfb-filter-chip${onlyAvailable ? ' is-active' : ''}`}
              onClick={() => setOnlyAvailable((v) => !v)}
            >
              <Sparkles size={14} />
              Solo disponibles
            </button>
          </div>

          <div className="mfb-tabs">
            {FACILITY_GROUPS.map((group) => {
              const count = groups.find((g) => g.id === group.id)?.items.length || 0;
              const free = (groups.find((g) => g.id === group.id)?.items || []).filter(
                (f) => liveById.get(f.id)?.status === 'available'
              ).length;
              return (
                <button
                  key={group.id}
                  type="button"
                  className={`mfb-tab${activeGroup === group.id && !query ? ' is-active' : ''}`}
                  onClick={() => {
                    setActiveGroup(group.id);
                    setQuery('');
                  }}
                >
                  {group.label}
                  <span>{free}/{count}</span>
                </button>
              );
            })}
          </div>

          <div className="mfb-results-bar">
            <span>
              {query
                ? `${filteredFacilities.length} resultado${filteredFacilities.length === 1 ? '' : 's'} para “${query.trim()}”`
                : `${active?.label || 'Instalaciones'} · ${filteredFacilities.length} espacios`}
            </span>
            <span className="mfb-results-day">
              <Calendar size={13} /> {selectedDateLabel}
            </span>
          </div>

          {filteredFacilities.length === 0 ? (
            <div className="mfb-empty">
              <Search size={28} />
              <p>No hay instalaciones con ese criterio.</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setQuery(''); setOnlyAvailable(false); }}>
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="mfb-grid">
              {filteredFacilities.map((fac) => {
                const live = liveById.get(fac.id);
                const meta = STATUS_META[live?.status] || STATUS_META.closed;
                const Icon = meta.Icon;
                const freeToday = freeSlotsForFacility(fac, selectedDate, reservations, {
                  isZondaActive,
                  now,
                }).length;
              const canOpen = live?.status !== 'suspended' && live?.status !== 'season_closed';
              const bookable = freeToday > 0 && canOpen;

              return (
                <article
                  key={fac.id}
                  className={`mfb-tile ${meta.className}${bookable ? ' is-bookable' : ''}`}
                >
                    <div
                      className="mfb-tile-media"
                      style={{ backgroundImage: `url(${fac.image})` }}
                    >
                      <span className={`mfb-badge ${meta.className}`}>
                        <Icon size={12} /> {live?.label || meta.label}
                      </span>
                      {fac.isOutdoor && (
                        <span className="mfb-tile-tag">
                          <MapPin size={11} /> Exterior
                        </span>
                      )}
                    </div>
                    <div className="mfb-tile-body">
                      <h3>{fac.name}</h3>
                      <p className="mfb-tile-desc">{fac.description}</p>
                      <p className="mfb-card-detail">{live?.detail}</p>
                      <div className="mfb-card-meta">
                        <span><Clock size={12} /> {fac.hours}</span>
                        <span><Users size={12} /> {fac.capacity}</span>
                      </div>
                      <div className="mfb-tile-foot">
                        <strong className="mfb-slots-left">
                          {freeToday} turno{freeToday === 1 ? '' : 's'} libre{freeToday === 1 ? '' : 's'}
                        </strong>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={!canOpen}
                          onClick={() => openBooking(fac)}
                        >
                          {bookable ? 'Reservar' : canOpen ? 'Ver / lista espera' : 'No disponible'}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedFacility && (
        <ModalDialog
          onClose={closeBooking}
          labelledBy="mfb-book-title"
          contentClassName="modal-content glass-panel mfb-modal"
        >
            <div className="modal-header" style={{ borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <h3 id="mfb-book-title" className="serif-font" style={{ fontSize: '1.3rem' }}>Reservar turno</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-gold)' }}>{selectedFacility.name}</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {selectedDateLabel}
                </p>
              </div>
              <button type="button" onClick={closeBooking} className="mfb-icon-btn" aria-label="Cerrar">
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            {bookingSuccess ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
                <CheckCircle2 size={52} style={{ color: 'var(--emerald-accent)' }} />
                <h4 style={{ marginTop: '0.75rem' }}>Reserva confirmada</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  {selectedFacility.name} · {selectedDate} · {time} hs
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label className="form-label">Horarios libres</label>
                  <div className="mfb-time-grid">
                    {(selectedFacility.slots || []).map((slot) => {
                      const taken = hasReservationConflict(reservations, {
                        facilityId: selectedFacility.id,
                        date: selectedDate,
                        time: slot,
                      });
                      const blockedOutdoor = selectedFacility.isOutdoor && isZondaActive;
                      const queue = waitingForSlot(waitlist, {
                        facilityId: selectedFacility.id,
                        date: selectedDate,
                        time: slot,
                      }).length;
                      return (
                        <button
                          key={slot}
                          type="button"
                          disabled={blockedOutdoor}
                          className={`mfb-time${time === slot ? ' is-selected' : ''}${taken ? ' is-taken' : ''}${blockedOutdoor ? ' is-disabled' : ''}`}
                          onClick={() => setTime(slot)}
                          title={taken ? `Ocupado · ${queue} en espera` : 'Disponible'}
                        >
                          {slot}{taken ? '*' : ''}
                        </button>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 8 }}>
                    * Ocupado: podés anotarte en lista de espera.
                  </p>
                  {myWaitlist.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-gold)' }}>
                      Tus esperas: {myWaitlist.map((w) => `${w.facilityName?.split(' - ')[0] || w.facilityId} ${w.date} ${w.time}`).join(' · ')}
                      {' '}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ marginLeft: 6 }}
                        onClick={() => setWaitlist?.((prev) => leaveWaitlist(prev, myWaitlist[0].id))}
                      >
                        Salir de la primera
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="form-label">Invitados</label>
                    <select
                      className="form-input"
                      value={guests}
                      onChange={(e) => setGuests(Number(e.target.value))}
                    >
                      {[...Array((selectedFacility.guestLimit || 0) + 1).keys()].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                  {guests > 0 && (
                    <div>
                      <label className="form-label">Nombres</label>
                      <input
                        className="form-input"
                        value={guestNames}
                        onChange={(e) => setGuestNames(e.target.value)}
                        placeholder="Nombre y apellido"
                        required
                      />
                    </div>
                  )}
                </div>

                {errorMessage && (
                  <div className="mfb-error">
                    <AlertCircle size={15} /> {errorMessage}
                  </div>
                )}
                {waitMsg && (
                  <div style={{ color: 'var(--emerald-accent)', fontSize: '0.85rem' }}>{waitMsg}</div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" onClick={closeBooking}>Cancelar</button>
                  {time && hasReservationConflict(reservations, {
                    facilityId: selectedFacility.id,
                    date: selectedDate,
                    time,
                  }) ? (
                    <button type="button" className="btn btn-primary" onClick={handleJoinWaitlist}>
                      Lista de espera
                    </button>
                  ) : (
                    <button type="submit" className="btn btn-primary">Confirmar reserva</button>
                  )}
                </div>
              </form>
            )}
        </ModalDialog>
      )}
    </section>
  );
}

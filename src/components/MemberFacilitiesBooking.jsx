import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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
  Minus,
  Plus,
  QrCode,
  Upload,
} from 'lucide-react';
import { FACILITIES, facilitiesByGroup, sortFacilitiesForDisplay, isRealBookableSpace } from '../domain/reservations/facilities';
import { buildFacilityCatalog } from '../domain/reservations/facilityConfig';
import { getFacilityLiveStatus, isSeasonOpen } from '../domain/reservations/availability';
import { hasReservationConflict } from '../domain/reservations/conflicts';
import { isSlotPast } from '../domain/reservations/slotTime';
import { joinWaitlist, leaveWaitlist, waitingForSlot } from '../domain/reservations/waitlist';
import { CLUB_BANK_ACCOUNTS, MERCADO_PAGO, buildMercadoPagoQrPayload } from '../domain/members/clubBanks';
import { bookingPaymentNotice } from '../domain/members/duesPaymentNotice';
import { uploadDuesReceipt } from '../data/storage';
import ModalDialog from './ModalDialog';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const ACTIVE_RES_STATUSES = new Set(['confirmed', 'pending', 'approved']);

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
    (slot) => !isSlotPast(dateStr, slot, now)
      && !hasReservationConflict(reservations, { facilityId: facility.id, date: dateStr, time: slot })
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
      (slot) => !isSlotPast(dateStr, slot, now)
        && !hasReservationConflict(reservations, { facilityId: fac.id, date: dateStr, time: slot })
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
  user = null,
  sendMessage,
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
  const [guestNameList, setGuestNameList] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [waitMsg, setWaitMsg] = useState('');
  const [payMethod, setPayMethod] = useState('mercadopago');
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState('');
  const [paying, setPaying] = useState(false);

  const catalog = useMemo(
    () => buildFacilityCatalog(FACILITIES, Array.isArray(facilityCatalog) ? facilityCatalog : [])
      .filter(isRealBookableSpace),
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

  const openBooking = (facility) => {
    const live = liveById.get(facility.id);
    if (live?.status === 'suspended' || live?.status === 'season_closed') return;
    setSelectedFacility(facility);
    setTime('');
    setGuests(0);
    setGuestNameList([]);
    setErrorMessage('');
    setWaitMsg('');
    setBookingSuccess(false);
    setPayMethod('mercadopago');
    setReceiptFile(null);
    setReceiptPreview('');
    setPaying(false);
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

  const guestLimit = selectedFacility?.guestLimit || 0;

  const setGuestCount = (next) => {
    const count = Math.max(0, Math.min(guestLimit, next));
    setGuests(count);
    setGuestNameList((prev) => {
      const list = prev.slice(0, count);
      while (list.length < count) list.push('');
      return list;
    });
  };

  const bookingPrice = Number(selectedFacility?.defaultPrice) || 0;
  const bank = CLUB_BANK_ACCOUNTS[0];
  const bookingQr = useMemo(() => {
    if (payMethod !== 'mercadopago' || bookingPrice <= 0 || !member) return null;
    const payload = buildMercadoPagoQrPayload({
      amount: bookingPrice,
      memberId: member.memberId,
      memberName: member.name,
      concept: `${selectedFacility?.name || 'Reserva'} ${selectedDate || ''} ${time || ''}`.trim(),
    });
    const ref = payload.split('|').find((part) => part.startsWith('ref='))?.slice(4) || '';
    return { payload, ref };
  }, [payMethod, bookingPrice, member, selectedFacility?.name, selectedDate, time]);

  const handleReceipt = (event) => {
    const file = event.target.files?.[0];
    setReceiptFile(file || null);
    setReceiptPreview('');
    setErrorMessage('');
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setReceiptPreview(String(reader.result || ''));
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFacility || !member || paying) return;
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
    if (isSlotPast(selectedDate, time, now)) {
      setErrorMessage('Ese horario ya pasó. Elegí un turno más tarde.');
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
    const names = guestNameList.map((name) => name.trim()).filter(Boolean);
    if (names.length !== guests) {
      setErrorMessage('Completá el nombre y apellido de cada invitado.');
      return;
    }

    if (bookingPrice > 0 && payMethod === 'transferencia' && !receiptFile) {
      setErrorMessage('Adjuntá el comprobante de la transferencia.');
      return;
    }
    if (bookingPrice > 0 && !sendMessage) {
      setErrorMessage('El aviso de pago a administración no está disponible.');
      return;
    }

    setPaying(true);
    try {
      let attachment = null;
      if (bookingPrice > 0 && payMethod === 'transferencia') {
        attachment = await uploadDuesReceipt(receiptFile, user?.id);
      }
      if (bookingPrice > 0) {
        await sendMessage(bookingPaymentNotice({
          memberName: member.name,
          memberId: member.memberId,
          amountLabel: formatCurrency(bookingPrice),
          facilityName: selectedFacility.name,
          dateLabel: selectedDateLabel,
          time,
          method: payMethod,
          bankName: bank?.name,
          qrRef: bookingQr?.ref,
          attachment,
        }));
      }
    } catch (err) {
      setErrorMessage(err.message || 'No se pudo avisar el pago.');
      setPaying(false);
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
      guestNames: names.join(', '),
      status: bookingPrice > 0 ? 'pending' : 'confirmed',
      estimatedPrice: bookingPrice || null,
      paymentMethod: bookingPrice > 0 ? payMethod : null,
    };
    const result = await addReservation?.(payload);
    setPaying(false);
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
            {groups.filter((group) => group.items.length > 0).map((group) => {
              const count = group.items.length;
              const free = group.items.filter(
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
            <div className="modal-header mfb-book-head">
              <div>
                <p className="mfb-book-kicker">Reservar turno</p>
                <h3 id="mfb-book-title" className="serif-font">{selectedFacility.name}</h3>
                <p className="mfb-book-date">{selectedDateLabel}</p>
              </div>
              <button type="button" onClick={closeBooking} className="mfb-icon-btn" aria-label="Cerrar">
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            {bookingSuccess ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
                <CheckCircle2 size={52} style={{ color: 'var(--emerald-accent)' }} />
                <h4 style={{ marginTop: '0.75rem' }}>{bookingPrice > 0 ? 'Turno reservado' : 'Reserva confirmada'}</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  {selectedFacility.name} · {selectedDate} · {time} hs
                  {bookingPrice > 0 ? '. Avisamos el pago a administración.' : ''}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mfb-book-form">
                <div>
                  <label className="form-label">Horarios</label>
                  <div className="mfb-time-grid">
                    {(selectedFacility.slots || []).map((slot) => {
                      const past = isSlotPast(selectedDate, slot, now);
                      const taken = !past && hasReservationConflict(reservations, {
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
                      const label = blockedOutdoor ? 'Cerrado' : past ? 'Pasó' : taken ? 'Ocupado' : 'Libre';
                      return (
                        <button
                          key={slot}
                          type="button"
                          disabled={blockedOutdoor || past}
                          className={`mfb-time${time === slot ? ' is-selected' : ''}${taken ? ' is-taken' : ''}${blockedOutdoor || past ? ' is-disabled' : ''}`}
                          onClick={() => setTime(slot)}
                          title={past ? 'Ese horario ya pasó' : taken ? `Ocupado · ${queue} en espera` : 'Libre'}
                        >
                          <span>{slot}</span>
                          <small>{label}</small>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mfb-book-hint">Si el horario está ocupado, podés anotarte en la lista de espera.</p>
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

                <div className="mfb-guests">
                  <div>
                    <label className="form-label" id="mfb-guests-label">Invitados</label>
                    <div className="mfb-stepper" role="group" aria-labelledby="mfb-guests-label">
                      <button
                        type="button"
                        aria-label="Menos invitados"
                        disabled={guests <= 0}
                        onClick={() => setGuestCount(guests - 1)}
                      >
                        <Minus size={16} />
                      </button>
                      <strong>{guests}</strong>
                      <button
                        type="button"
                        aria-label="Más invitados"
                        disabled={guests >= guestLimit}
                        onClick={() => setGuestCount(guests + 1)}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <p className="mfb-book-hint">Hasta {guestLimit}. Cada invitado va con su nombre.</p>
                  </div>
                  {guestNameList.length > 0 && (
                    <div className="mfb-guest-names">
                      {guestNameList.map((name, index) => (
                        <label key={index}>
                          <span className="form-label">Invitado {index + 1}</span>
                          <input
                            className="form-input"
                            value={name}
                            onChange={(e) => {
                              const value = e.target.value;
                              setGuestNameList((prev) => prev.map((item, i) => (i === index ? value : item)));
                            }}
                            placeholder="Nombre y apellido"
                            required
                            autoComplete="name"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {bookingPrice > 0 && (
                  <div className="mfb-pay">
                    <label className="form-label" htmlFor="mfb-pay-method">Pago</label>
                    <p className="mfb-book-hint">{formatCurrency(bookingPrice)} · el mismo medio que la cuota.</p>
                    <select
                      id="mfb-pay-method"
                      className="form-input"
                      value={payMethod}
                      onChange={(e) => {
                        setPayMethod(e.target.value);
                        setErrorMessage('');
                      }}
                    >
                      <option value="mercadopago">Mercado Pago</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="debito">Débito automático</option>
                    </select>
                    {payMethod === 'mercadopago' && bookingQr ? (
                      <div className="pay-hist-qr">
                        <div className="pay-hist-qr-code">
                          <QRCodeSVG value={bookingQr.payload} size={148} level="M" includeMargin />
                        </div>
                        <div>
                          <strong><QrCode size={14} /> QR Mercado Pago</strong>
                          <p>Alias {MERCADO_PAGO.alias}</p>
                          <p>{formatCurrency(bookingPrice)}. Al confirmar, administración recibe el aviso.</p>
                        </div>
                      </div>
                    ) : null}
                    {payMethod === 'transferencia' && bank ? (
                      <div className="pay-hist-transfer">
                        <p><strong>{bank.name}</strong> · {bank.accountName}</p>
                        <p>CBU {bank.cbu}</p>
                        <p>Alias {bank.alias}</p>
                        <label className="pay-hist-file">
                          <Upload size={16} />
                          {receiptFile?.name || 'Adjuntar comprobante (JPG, PNG o PDF)'}
                          <input type="file" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" onChange={handleReceipt} />
                        </label>
                        {receiptPreview ? <img src={receiptPreview} alt="Vista previa del comprobante" /> : null}
                      </div>
                    ) : null}
                    {payMethod === 'debito' ? (
                      <p className="pay-hist-note">Administración adhiere el débito y acredita el turno cuando lo confirma.</p>
                    ) : null}
                  </div>
                )}

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
                    <button type="submit" className="btn btn-primary" disabled={paying}>
                      {paying
                        ? 'Enviando…'
                        : bookingPrice > 0
                          ? (payMethod === 'transferencia' ? 'Enviar comprobante' : 'Avisar y reservar')
                          : 'Confirmar reserva'}
                    </button>
                  )}
                </div>
              </form>
            )}
        </ModalDialog>
      )}
    </section>
  );
}

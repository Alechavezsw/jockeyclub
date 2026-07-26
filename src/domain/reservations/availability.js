/** Disponibilidad en vivo de instalaciones. */

const ACTIVE_STATUSES = new Set(['confirmed', 'pending']);

function parseHoursRange(hours = '') {
  const match = String(hours).match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return {
    openMin: Number(match[1]) * 60 + Number(match[2]),
    closeMin: Number(match[3]) * 60 + Number(match[4]),
  };
}

function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function toISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseSlotMinutes(time = '') {
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Duración estimada del turno según espaciado de slots (fallback 90'). */
export function estimateSlotDurationMinutes(slots = [], slotTime) {
  const mins = (slots || [])
    .map(parseSlotMinutes)
    .filter((n) => n != null)
    .sort((a, b) => a - b);
  const current = parseSlotMinutes(slotTime);
  if (current == null || mins.length === 0) return 90;
  const idx = mins.indexOf(current);
  if (idx >= 0 && idx < mins.length - 1) {
    return Math.max(30, mins[idx + 1] - current);
  }
  if (mins.length >= 2) {
    const gaps = [];
    for (let i = 1; i < mins.length; i += 1) gaps.push(mins[i] - mins[i - 1]);
    return Math.max(30, Math.min(...gaps));
  }
  return 90;
}

export function isSeasonOpen(facility, now = new Date()) {
  if (!facility?.isSeasonal) return true;
  const month = now.getMonth(); // 0-11
  // Pileta de verano: diciembre a marzo
  return month === 11 || month <= 2;
}

/**
 * Estado en vivo de una instalación.
 * @returns {{ status: 'available'|'occupied'|'closed'|'suspended'|'season_closed', label: string, detail: string, currentBooking?: object|null, nextSlot?: string|null }}
 */
export function getFacilityLiveStatus(facility, {
  reservations = [],
  isZondaActive = false,
  now = new Date(),
} = {}) {
  if (!facility) {
    return { status: 'closed', label: 'Sin datos', detail: '', currentBooking: null, nextSlot: null };
  }

  if (facility.isOutdoor && isZondaActive) {
    return {
      status: 'suspended',
      label: 'Suspendida',
      detail: 'Viento Zonda · exterior cerrado',
      currentBooking: null,
      nextSlot: null,
    };
  }

  if (!isSeasonOpen(facility, now)) {
    return {
      status: 'season_closed',
      label: 'Fuera de temporada',
      detail: 'Apertura diciembre a marzo',
      currentBooking: null,
      nextSlot: null,
    };
  }

  const range = parseHoursRange(facility.hours);
  const nowMin = minutesOfDay(now);
  if (range && (nowMin < range.openMin || nowMin >= range.closeMin)) {
    return {
      status: 'closed',
      label: 'Cerrada',
      detail: `Horario ${facility.hours}`,
      currentBooking: null,
      nextSlot: null,
    };
  }

  const today = toISODate(now);
  const todays = (reservations || []).filter(
    (r) =>
      r.facilityId === facility.id
      && r.date === today
      && ACTIVE_STATUSES.has(r.status),
  );

  const currentBooking = todays.find((r) => {
    const start = parseSlotMinutes(r.time);
    if (start == null) return false;
    const duration = estimateSlotDurationMinutes(facility.slots, r.time);
    return nowMin >= start && nowMin < start + duration;
  }) || null;

  if (currentBooking) {
    const start = parseSlotMinutes(currentBooking.time);
    const duration = estimateSlotDurationMinutes(facility.slots, currentBooking.time);
    const endH = Math.floor((start + duration) / 60);
    const endM = String((start + duration) % 60).padStart(2, '0');
    return {
      status: 'occupied',
      label: 'Ocupada',
      detail: `${currentBooking.memberName || 'Socio'} · hasta ${endH}:${endM}`,
      currentBooking,
      nextSlot: null,
    };
  }

  const nextSlot = (facility.slots || [])
    .map((slot) => ({ slot, min: parseSlotMinutes(slot) }))
    .filter((s) => s.min != null && s.min > nowMin)
    .find((s) => !todays.some((r) => r.time === s.slot));

  return {
    status: 'available',
    label: 'Disponible',
    detail: nextSlot ? `Próximo hueco ${nextSlot.slot}` : 'Sin turnos pendientes hoy',
    currentBooking: null,
    nextSlot: nextSlot?.slot || null,
  };
}

export function getFacilitiesLiveStatusMap(facilities, options) {
  const map = new Map();
  for (const facility of facilities || []) {
    map.set(facility.id, getFacilityLiveStatus(facility, options));
  }
  return map;
}

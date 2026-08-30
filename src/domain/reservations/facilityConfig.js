/** Configuración editable de espacios / canchas / pileta. */

export const FACILITY_STATUS_OPTIONS = [
  { id: 'disponible', label: 'Disponible' },
  { id: 'suspendido', label: 'Suspendido' },
  { id: 'no_disponible', label: 'No disponible' },
  { id: 'mantenimiento', label: 'Mantenimiento' },
];

export const FACILITY_TYPE_OPTIONS = [
  { id: 'salon', label: 'Salón de Fiestas' },
  { id: 'parrilla', label: 'Parrilla' },
  { id: 'cancha', label: 'Cancha' },
  { id: 'pileta', label: 'Pileta' },
  { id: 'hipica', label: 'Hípica' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'gastronomia', label: 'Gastronomía' },
  { id: 'otro', label: 'Otro' },
];

/** Tipos usados en la gestión administrativa (listados reales). */
export const FACILITY_MANAGE_TYPES = FACILITY_TYPE_OPTIONS.filter((t) =>
  ['salon', 'parrilla', 'cancha', 'pileta', 'hipica', 'fitness', 'gastronomia'].includes(t.id)
);

export const WEEK_DAYS = [
  { id: 0, label: 'Domingo' },
  { id: 1, label: 'Lunes' },
  { id: 2, label: 'Martes' },
  { id: 3, label: 'Miércoles' },
  { id: 4, label: 'Jueves' },
  { id: 5, label: 'Viernes' },
  { id: 6, label: 'Sábado' },
];

const TIME_OPTIONS = (() => {
  const out = [];
  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

export { TIME_OPTIONS };

function parseHoursRange(hours = '') {
  const match = String(hours).match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return { open: '08:00', close: '22:00' };
  return {
    open: `${String(match[1]).padStart(2, '0')}:${match[2]}`,
    close: `${String(match[3]).padStart(2, '0')}:${match[4]}`,
  };
}

function defaultWeeklySchedule(facility = {}) {
  const { open, close } = parseHoursRange(facility.hours);
  const price = Number(facility.defaultPrice) || 0;
  return WEEK_DAYS.map((d) => ({
    day: d.id,
    open,
    close,
    price,
    enabled: true,
  }));
}

function inferSpaceType(facility = {}) {
  if (facility.spaceType) return facility.spaceType;
  const blob = `${facility.name || ''} ${facility.id || ''} ${facility.category || ''}`;
  if (/piscin|nataci|pileta/i.test(blob)) return 'pileta';
  if (/sal[oó]n|fiesta/i.test(blob) || facility.category === 'salon') return 'salon';
  if (/parrilla|quincho|espacio verde/i.test(blob) || facility.category === 'parrilla') return 'parrilla';
  if (facility.category === 'cancha') return 'cancha';
  if (facility.category === 'hipica') return 'hipica';
  if (facility.category === 'fitness') return 'fitness';
  if (facility.category === 'gastronomia') return 'gastronomia';
  if (facility.category === 'temporada') return 'pileta';
  return facility.category || 'otro';
}

/** Completa un espacio del catálogo base con la config editable. */
export function normalizeFacilityConfig(facility = {}) {
  const weeklySchedule = Array.isArray(facility.weeklySchedule) && facility.weeklySchedule.length === 7
    ? facility.weeklySchedule
    : defaultWeeklySchedule(facility);

  const rules = {
    createStatus: 'approved',
    dailyReport: false,
    reportHour: 20,
    reportEmail: '',
    allowMultipleSameSlot: true,
    multipleRestrictMode: 'predefined',
    simultaneousMax: 1,
    limitOneApproved: false,
    allowConsecutive: false,
    forbidMultiplePending: false,
    slotDurationHours: 1.5,
    allowExtended: false,
    maxPerDay: 2,
    maxPerWeek: 6,
    maxPerMonth: 20,
    exemptMemberIds: [],
    tempBlockMinutes: 0,
    allowedTier: [],
    hoursPrior: 2,
    advanceDays: 30,
    editUntilHours: 12,
    showEndDateTime: true,
    showCalendarHours: true,
    calendarBlocks: [],
    ...(facility.rules || {}),
  };

  const guests = {
    capacity: Number(String(facility.capacity).replace(/\D/g, '')) || facility.guestLimit || 4,
    requireDocument: false,
    onlyMembers: false,
    editUntil: 'before_start',
    toleranceBefore: 'flexible',
    toleranceAfter: 'flexible',
    minGuests: 0,
    maxGuests: Number(facility.guestLimit) || 0,
    whatsappGuests: false,
    maxReservationsPerGuest: 0,
    ...(facility.guests || {}),
  };

  const accounting = {
    multiplyExtendedPrice: true,
    autoCharge: true,
    paymentButton: false,
    debtLimit: 10000,
    debtAgeDays: 30,
    paymentMethods: '',
    mpToleranceMinutes: 10,
    mpOptions: [],
    ...(facility.accounting || {}),
  };

  const terms = {
    reconfirm: true,
    text: facility.terms?.text
      || `${facility.name || 'Espacio'}\n\nCapacidad: ${facility.capacity || '—'}\n\nGracias.\nJockey Club San Juan`,
    ...(facility.terms || {}),
  };

  const extras = {
    mandatoryParticularity: false,
    services: Array.isArray(facility.extras?.services) ? facility.extras.services : [],
    conditions: Array.isArray(facility.extras?.conditions) ? facility.extras.conditions : [],
    combinations: Array.isArray(facility.extras?.combinations) ? facility.extras.combinations : [],
    combinationError: '',
    ...(facility.extras || {}),
  };

  return {
    ...facility,
    status: facility.status || 'disponible',
    spaceType: inferSpaceType(facility),
    image: facility.image || '',
    externalUrl: facility.externalUrl || '',
    linkedFacilityId: facility.linkedFacilityId || '',
    validateMaxAsOne: Boolean(facility.validateMaxAsOne),
    externalLink: facility.externalLink || '',
    externalLinkMsg: facility.externalLinkMsg || '',
    weeklySchedule,
    rules,
    guests,
    accounting,
    terms,
    extras,
  };
}

export function deriveHoursFromSchedule(weeklySchedule = []) {
  const enabled = (weeklySchedule || []).filter((r) => r.enabled);
  if (!enabled.length) return 'Cerrado';
  const first = enabled[0];
  const same = enabled.every((r) => r.open === first.open && r.close === first.close);
  if (same) return `${first.open} - ${first.close}`;
  return 'Horario variable';
}

export function deriveSlotsFromSchedule(weeklySchedule = [], durationHours = 1.5) {
  const enabled = (weeklySchedule || []).filter((r) => r.enabled);
  if (!enabled.length) return [];
  const { open, close } = enabled[0];
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  let start = oh * 60 + om;
  const end = ch * 60 + cm;
  const step = Math.max(30, Math.round(Number(durationHours) * 60) || 90);
  const slots = [];
  while (start + 30 <= end) {
    const h = Math.floor(start / 60);
    const m = start % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    start += step;
  }
  return slots;
}

/** Aplica cambios del editor y sincroniza hours/slots/guestLimit. */
export function applyFacilityEditorPatch(facility, patch = {}) {
  const next = normalizeFacilityConfig({ ...facility, ...patch });
  next.hours = deriveHoursFromSchedule(next.weeklySchedule);
  next.slots = deriveSlotsFromSchedule(next.weeklySchedule, next.rules.slotDurationHours);
  next.guestLimit = Number(next.guests.maxGuests) || next.guestLimit || 0;
  if (typeof next.guests.capacity === 'number' && next.guests.capacity > 0) {
    next.capacity = String(next.guests.capacity);
  }
  next.name = String(next.name || '').trim().slice(0, 80);
  return next;
}

export function buildFacilityCatalog(seedList = [], overrides = []) {
  const byId = new Map((overrides || []).map((f) => [f.id, f]));
  const fromSeed = (seedList || []).map((seed) => {
    const over = byId.get(seed.id);
    return normalizeFacilityConfig(over ? { ...seed, ...over } : seed);
  });
  const seedIds = new Set(fromSeed.map((f) => f.id));
  const extras = (overrides || [])
    .filter((f) => f?.id && !seedIds.has(f.id))
    .map((f) => normalizeFacilityConfig(f));
  return [...fromSeed, ...extras];
}

export function upsertFacilityInCatalog(catalog, facility) {
  const next = applyFacilityEditorPatch(facility);
  const list = [...(catalog || [])];
  const idx = list.findIndex((f) => f.id === next.id);
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  return list;
}

export function removeFacilityFromCatalog(catalog, facilityId) {
  return (catalog || []).filter((f) => f.id !== facilityId);
}

export function createBlankFacility(spaceType = 'salon') {
  const typeMeta = FACILITY_TYPE_OPTIONS.find((t) => t.id === spaceType) || FACILITY_TYPE_OPTIONS[0];
  const id = `esp-${Date.now().toString(36)}`;
  return normalizeFacilityConfig({
    id,
    name: '',
    category: spaceType,
    spaceType,
    description: '',
    image: '',
    hours: '11:00 - 23:00',
    capacity: '30',
    slots: ['11:00', '14:00', '18:00', '21:00'],
    guestLimit: 30,
    isOutdoor: spaceType === 'parrilla' || spaceType === 'pileta' || spaceType === 'cancha',
    status: 'disponible',
    defaultPrice: spaceType === 'salon' || spaceType === 'parrilla' ? 62000 : 0,
  });
}

export function facilityCapacityNumber(facility) {
  const fromGuests = Number(facility?.guests?.capacity);
  if (Number.isFinite(fromGuests) && fromGuests > 0) return fromGuests;
  const digits = String(facility?.capacity || '').replace(/\D/g, '');
  if (digits) return Number(digits);
  return Number(facility?.guestLimit) || 0;
}

export function facilityStatusLabel(status) {
  return FACILITY_STATUS_OPTIONS.find((s) => s.id === status)?.label || status || 'Disponible';
}

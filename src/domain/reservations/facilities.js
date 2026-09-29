/** Catálogo de instalaciones reservables — Sede Rivadavia (inventario real). */

/** IDs de demo / marketing / deportes de catálogo que no se reservan en el sistema real. */
export const DEMO_FACILITY_IDS = new Set([
  'gimnasio_musc',
  'gimnasio',
  'circuito_saludable',
  'boxeo_salon',
  'yoga_salon',
  'tenis_mesa',
  'voleibol_trad',
  'volei_playa',
  'piscina_verano',
  'pileta_olimpica',
  'restaurant',
  'hipismo_saltos',
  'turf_vareo',
  'equitacion_pistas',
  'rugby_masc',
  'rugby_fem',
  'hockey_cesped',
  'tenis_trad',
  'padel_vidrio',
  'futbol_fusion',
]);

export function isDemoFacilityId(id) {
  return DEMO_FACILITY_IDS.has(String(id || ''));
}

/** Versión de las reglas copiadas de Lila. Un catálogo guardado sin esta versión vuelve al seed. */
export const LILA_RULES_VERSION = 1;

/** Espacios que ya no existen en Lila y no se ofrecen. */
export const RETIRED_FACILITY_IDS = new Set(['salon_eventos']);

const NIGHT = { time: '20:00', endTime: '23:59', label: 'Noche' };

function salonTurns(dayEnd) {
  return [
    { time: '11:00', endTime: dayEnd, label: 'Día' },
    NIGHT,
  ];
}

function salonRules({
  createStatus = 'approved',
  limitOneApproved = false,
  debtLimit = 10000,
  maxGuests = 0,
  capacity,
  intervalHours = 6,
  maxPerMonth = 56,
} = {}) {
  return {
    lilaRulesVersion: LILA_RULES_VERSION,
    rules: {
      createStatus,
      hoursPrior: 12,
      advanceDays: 90,
      editUntilHours: 12,
      limitOneApproved,
      allowMultipleSameSlot: false,
      allowConsecutive: false,
      slotDurationHours: intervalHours,
      maxPerDay: 2,
      maxPerWeek: 14,
      maxPerMonth,
    },
    guests: { capacity, maxGuests },
    accounting: {
      autoCharge: true,
      paymentButton: false,
      debtLimit,
      debtAgeDays: 30,
    },
  };
}

export const FACILITIES = [
  {
    id: 'salon_anhelo',
    name: 'Salón Anhelo',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón de fiestas. Turno de día 11:00 a 18:00 y turno de noche 20:00 a 03:00. Incluye limpieza, sillas y tablones.',
    image: '/espacios/salon-anhelo.jpg',
    hours: '11:00-18:00 · 20:00-23:59',
    capacity: '60',
    turns: salonTurns('18:00'),
    slots: ['11:00', '20:00'],
    guestLimit: 60,
    isOutdoor: false,
    defaultPrice: 170000,
    ...salonRules({ createStatus: 'pending', capacity: 60, maxGuests: 0, intervalHours: 7, maxPerMonth: 56 }),
  },
  {
    id: 'salon_bustos',
    name: 'Salón Bustos',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón de fiestas para hasta 95 personas. Turno de día 11:00 a 17:00 y turno de noche 20:00 a 03:00. Una reserva vigente por socio.',
    image: '/espacios/salon-bustos.jpg',
    hours: '11:00-17:00 · 20:00-23:59',
    capacity: '95',
    turns: salonTurns('17:00'),
    slots: ['11:00', '20:00'],
    guestLimit: 60,
    isOutdoor: false,
    defaultPrice: 170000,
    ...salonRules({ limitOneApproved: true, capacity: 95, maxGuests: 60, debtLimit: 12000, maxPerMonth: 60 }),
  },
  {
    id: 'salon_maurin',
    name: 'Salón Maurin',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón de fiestas para hasta 65 personas. Turno de día 11:00 a 17:00 y turno de noche 20:00 a 03:00. Una reserva vigente por socio.',
    image: '/espacios/salon-maurin.jpg',
    hours: '11:00-17:00 · 20:00-23:59',
    capacity: '65',
    turns: salonTurns('17:00'),
    slots: ['11:00', '20:00'],
    guestLimit: 40,
    isOutdoor: false,
    defaultPrice: 130000,
    ...salonRules({ limitOneApproved: true, capacity: 65, maxGuests: 40, maxPerMonth: 50 }),
  },
  {
    id: 'salon_refugio',
    name: 'Salón Refugio',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón para hasta 30 personas. Turno de día 11:00 a 17:00 y turno de noche 20:00 a 03:00.',
    image: '/espacios/salon-refugio.jpg',
    hours: '11:00-17:00 · 20:00-23:59',
    capacity: '30',
    turns: salonTurns('17:00'),
    slots: ['11:00', '20:00'],
    guestLimit: 30,
    isOutdoor: false,
    status: 'disponible',
    defaultPrice: 96000,
    ...salonRules({ capacity: 30, maxGuests: 30, maxPerMonth: 56 }),
  },
  {
    id: 'espacio_verde',
    name: 'Espacio Verde',
    category: 'parrilla',
    spaceType: 'parrilla',
    description: 'Parrilla exterior, jornada de 11:00 a 23:00. Capacidad 30 personas. Si se supera el cupo de invitados, cada extra se abona aparte.',
    image: '/espacios/espacio-verde.jpg',
    hours: '11:00 - 23:00',
    capacity: '30',
    turns: [{ time: '11:00', endTime: '23:00', label: 'Jornada' }],
    slots: ['11:00'],
    guestLimit: 30,
    isOutdoor: true,
    defaultPrice: 62000,
    lilaRulesVersion: LILA_RULES_VERSION,
    rules: {
      createStatus: 'approved',
      hoursPrior: 6,
      advanceDays: 90,
      editUntilHours: 6,
      limitOneApproved: false,
      allowMultipleSameSlot: false,
      allowConsecutive: false,
      slotDurationHours: 12,
      maxPerDay: 1,
      maxPerWeek: 7,
      maxPerMonth: 30,
      allowedTierLabels: ['2268', '6146', '2270', '6149', '2394'],
    },
    guests: { capacity: 30, maxGuests: 0 },
    accounting: {
      autoCharge: true,
      paymentButton: true,
      debtLimit: 10000,
      debtAgeDays: 30,
    },
  },
];

export const OFFICIAL_FACILITY_IDS = new Set(FACILITIES.map((f) => f.id));

export function isPoolFacility(facility) {
  return facility?.spaceType === 'pileta'
    || facility?.category === 'pileta'
    || facility?.category === 'natacion'
    || facility?.id === 'pileta_olimpica'
    || facility?.id === 'piscina_verano'
    || /piscin|nataci[oó]n|pileta/i.test(`${facility?.name || ''} ${facility?.id || ''}`);
}

export function isCourtFacility(facility) {
  if (isPoolFacility(facility)) return false;
  if (facility?.spaceType === 'cancha') return true;
  return facility?.category === 'cancha';
}

export function isSalonFacility(facility) {
  return facility?.spaceType === 'salon'
    || facility?.category === 'salon'
    || facility?.category === 'social';
}

export function isParrillaFacility(facility) {
  return facility?.spaceType === 'parrilla' || facility?.category === 'parrilla';
}

/** Reservas reales del club (Mi Socio / datita): salones y parrilla. */
export function isRealBookableSpace(facility) {
  if (!facility || isDemoFacilityId(facility.id)) return false;
  return isSalonFacility(facility) || isParrillaFacility(facility);
}

export function isSpaceFacility(facility) {
  return isRealBookableSpace(facility);
}

export const FACILITY_GROUPS = [
  {
    id: 'espacios',
    label: 'Espacios',
    blurb: 'Salón Anhelo, Bustos, Maurin, Refugio y Espacio Verde.',
    match: isRealBookableSpace,
  },
];

/** Orden de listado: salones y parrilla (reservas reales) primero. */
function facilityListRank(facility) {
  if (isSalonFacility(facility)) return 0;
  if (isParrillaFacility(facility)) return 1;
  if (isPoolFacility(facility)) return 2;
  if (isCourtFacility(facility)) return 3;
  return 4;
}

export function sortFacilitiesForDisplay(list = []) {
  return [...(list || [])].toSorted((a, b) => {
    const rank = facilityListRank(a) - facilityListRank(b);
    if (rank !== 0) return rank;
    return String(a.name || '').localeCompare(String(b.name || ''), 'es');
  });
}

export function facilitiesByGroup(list = FACILITIES) {
  return FACILITY_GROUPS.map((group) => ({
    ...group,
    items: sortFacilitiesForDisplay(list.filter((f) => group.match(f))),
  }));
}

export function getFacilityById(id, list = FACILITIES) {
  return list.find((f) => f.id === id) || null;
}

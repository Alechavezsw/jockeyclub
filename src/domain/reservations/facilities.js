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

export const FACILITIES = [
  {
    id: 'salon_anhelo',
    name: 'Salón Anhelo',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón de fiestas para eventos sociales y celebraciones institucionales.',
    image: '/espacios/salon-anhelo.jpg',
    hours: '11:00 - 23:00',
    capacity: '60',
    slots: ['11:00', '14:00', '18:00', '21:00'],
    guestLimit: 60,
    isOutdoor: false,
    defaultPrice: 170000,
  },
  {
    id: 'salon_bustos',
    name: 'Salón Bustos',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón amplio para fiestas y eventos de hasta 95 personas.',
    image: '/espacios/salon-bustos.jpg',
    hours: '11:00 - 23:00',
    capacity: '95',
    slots: ['11:00', '14:00', '18:00', '21:00'],
    guestLimit: 95,
    isOutdoor: false,
    defaultPrice: 170000,
  },
  {
    id: 'salon_maurin',
    name: 'Salón Maurin',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón de fiestas con capacidad intermedia para celebraciones del club.',
    image: '/espacios/salon-maurin.jpg',
    hours: '11:00 - 23:00',
    capacity: '65',
    slots: ['11:00', '14:00', '18:00', '21:00'],
    guestLimit: 65,
    isOutdoor: false,
    defaultPrice: 130000,
  },
  {
    id: 'salon_refugio',
    name: 'Salón Refugio',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón íntimo para reuniones y eventos reducidos.',
    image: '/espacios/salon-refugio.jpg',
    hours: '11:00 - 23:00',
    capacity: '30',
    slots: ['11:00', '14:00', '18:00', '21:00'],
    guestLimit: 30,
    isOutdoor: false,
    status: 'suspendido',
    defaultPrice: 96000,
  },
  {
    id: 'salon_eventos',
    name: 'Salón de Eventos',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón multipropósito para actos institucionales y eventos del club.',
    image: '/espacios/salon-eventos.jpg',
    hours: '10:00 - 02:00',
    capacity: '50',
    slots: ['10:00', '14:00', '18:00', '21:00'],
    guestLimit: 50,
    isOutdoor: false,
    defaultPrice: 0,
  },
  {
    id: 'espacio_verde',
    name: 'Espacio Verde',
    category: 'parrilla',
    spaceType: 'parrilla',
    description: 'Espacio exterior con parrilla para reservas sociales. Capacidad 25 personas.',
    image: '/espacios/espacio-verde.jpg',
    hours: '11:00 - 23:00',
    capacity: '25',
    slots: ['11:00', '14:00', '18:00', '21:00'],
    guestLimit: 25,
    isOutdoor: true,
    defaultPrice: 62000,
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
    blurb: 'Salón Anhelo, Bustos, Maurin, Refugio, Eventos y Espacio Verde.',
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

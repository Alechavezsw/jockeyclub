/** Catálogo de instalaciones reservables — Sede Rivadavia. */

export const FACILITIES = [
  {
    id: 'rugby_masc',
    name: 'Rugby Masculino - Cancha Principal',
    category: 'cancha',
    description: 'Cancha de césped natural con postes reglamentarios. Sede de partidos del Regional Cuyano.',
    image: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 20:00',
    capacity: 'Equipos / Práctica',
    slots: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'],
    guestLimit: 15,
    isOutdoor: true,
  },
  {
    id: 'rugby_fem',
    name: 'Rugby Femenino & Juveniles - Cancha Auxiliar',
    category: 'cancha',
    description: 'Cancha auxiliar de césped natural adaptada para entrenamiento y divisiones juveniles.',
    image: 'https://images.unsplash.com/photo-1459865264687-595d652de67e?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 20:00',
    capacity: 'Equipos / Práctica',
    slots: ['08:30', '10:30', '12:30', '14:30', '16:30', '18:30'],
    guestLimit: 15,
    isOutdoor: true,
  },
  {
    id: 'hockey_cesped',
    name: 'Hockey sobre Césped - Cancha Sintética',
    category: 'cancha',
    description: 'Superficie de arena sintética de última generación, ideal para partidos rápidos y prácticas.',
    image: 'https://images.unsplash.com/photo-1509316975850-ff9c5edd0cd9?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 22:00',
    capacity: 'Equipos / Práctica',
    slots: ['08:00', '09:30', '11:00', '14:00', '15:30', '17:00', '18:30', '20:00'],
    guestLimit: 11,
    isOutdoor: true,
  },
  {
    id: 'tenis_trad',
    name: 'Tenis Tradicional - Polvo de Ladrillo',
    category: 'cancha',
    description: 'Ocho canchas de tierra batida ATP con iluminación LED de alta potencia.',
    image: 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 22:00',
    capacity: 'Singles o Dobles',
    slots: ['08:00', '09:30', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30', '20:00'],
    guestLimit: 3,
    isOutdoor: true,
  },
  {
    id: 'padel_vidrio',
    name: 'Pádel - Canchas de Vidrio Templado',
    category: 'cancha',
    description: 'Canchas con paredes de cristal templado y césped sintético azul, diseñadas para juego ágil.',
    image: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 23:00',
    capacity: 'Dobles',
    slots: ['08:00', '09:30', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30', '20:00', '21:30'],
    guestLimit: 3,
    isOutdoor: true,
  },
  {
    id: 'futbol_fusion',
    name: 'Fútbol - Canchas de Césped y Fusión',
    category: 'cancha',
    description: 'Cancha de césped natural para fútbol tradicional e instalaciones para fútbol fusión.',
    image: 'https://images.unsplash.com/photo-1579952362202-3ad778536f17?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 22:00',
    capacity: 'Fútbol 5 / 11',
    slots: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'],
    guestLimit: 10,
    isOutdoor: true,
  },
  {
    id: 'equitacion_pistas',
    name: 'Equitación - Pistas de Adiestramiento',
    category: 'hipica',
    description: 'Pistas de arena fina diseñadas para la alta escuela de equitación y adiestramiento de potrillos.',
    image: 'https://images.unsplash.com/photo-1598974357850-ca2ed090412e?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 18:00',
    capacity: 'Jinetes individuales',
    slots: ['08:00', '09:30', '11:00', '14:00', '15:30', '17:00'],
    guestLimit: 2,
    isOutdoor: true,
  },
  {
    id: 'hipismo_saltos',
    name: 'Hipismo - Pista de Saltos Cordillerano',
    category: 'hipica',
    description: 'Gran pista de césped y arena con ría y obstáculos reglamentarios, sede del Torneo Cordillerano.',
    image: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 18:00',
    capacity: 'Práctica de Saltos',
    slots: ['08:30', '10:00', '11:30', '14:30', '16:00'],
    guestLimit: 2,
    isOutdoor: true,
  },
  {
    id: 'turf_vareo',
    name: 'Turf - Pistas de Vareo & Studs',
    category: 'hipica',
    description: 'Pista de arena circular de vareo diario de purasangres, boxes y studs premium.',
    image: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=600&auto=format&fit=crop',
    hours: '06:00 - 14:00',
    capacity: 'Vareo / Purasangres',
    slots: ['06:00', '07:30', '09:00', '10:30', '12:00'],
    guestLimit: 1,
    isOutdoor: true,
  },
  {
    id: 'gimnasio_musc',
    name: 'Gimnasio de Musculación & Cardio',
    category: 'fitness',
    description: 'Equipamiento de fuerza Hammer Strength, cintas de correr Life Fitness y zona de pesas libres.',
    image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=600&auto=format&fit=crop',
    hours: '06:00 - 22:00',
    capacity: 'Acceso por Turno',
    slots: ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'],
    guestLimit: 1,
    isOutdoor: false,
  },
  {
    id: 'circuito_saludable',
    name: 'Circuito de Ejercicios Saludables',
    category: 'fitness',
    description: 'Pista al aire libre con estaciones de calistenia, estiramiento e hidratación rodeada de verde.',
    image: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?q=80&w=600&auto=format&fit=crop',
    hours: '06:00 - 20:00',
    capacity: 'Pista Saludable',
    slots: ['07:00', '09:00', '11:00', '13:00', '15:00', '17:00', '19:00'],
    guestLimit: 4,
    isOutdoor: true,
  },
  {
    id: 'boxeo_salon',
    name: 'Salón de Boxeo & Contacto',
    category: 'fitness',
    description: 'Ring reglamentario, bolsas de boxeo Everlast, peras de velocidad y entrenamiento guiado.',
    image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 21:00',
    capacity: 'Práctica / Ring',
    slots: ['08:00', '10:00', '12:00', '15:00', '17:00', '19:00'],
    guestLimit: 2,
    isOutdoor: false,
  },
  {
    id: 'yoga_salon',
    name: 'Salón de Yoga & Meditación',
    category: 'fitness',
    description: 'Salón climatizado y ambientado para prácticas de Hatha, Vinyasa Yoga y técnicas de relajación.',
    image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop',
    hours: '07:30 - 20:30',
    capacity: 'Práctica Grupal',
    slots: ['08:00', '09:30', '11:00', '15:00', '16:30', '18:00', '19:30'],
    guestLimit: 2,
    isOutdoor: false,
  },
  {
    id: 'tenis_mesa',
    name: 'Tenis de Mesa & Recreación',
    category: 'fitness',
    description: 'Tablas profesionales Butterfly en salón climatizado, paletas e insumos incluidos.',
    image: 'https://images.unsplash.com/photo-1534158914592-062992fbe900?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 22:00',
    capacity: 'Mesas Singles/Dobles',
    slots: ['08:00', '09:30', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30', '20:00', '21:00'],
    guestLimit: 3,
    isOutdoor: false,
  },
  {
    id: 'voleibol_trad',
    name: 'Voleibol Tradicional - Cancha Techada',
    category: 'fitness',
    description: 'Cancha de parqué techada y climatizada para partidos de voleibol tradicional.',
    image: 'https://images.unsplash.com/photo-1592656094270-b9bdb9173bb9?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 22:00',
    capacity: 'Equipos / Práctica',
    slots: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'],
    guestLimit: 12,
    isOutdoor: false,
  },
  {
    id: 'piscina_verano',
    name: 'Natación - Piscina de Verano',
    category: 'temporada',
    description: 'Piscina olímpica de 50 metros rodeada de césped y solárium premium (Apertura Diciembre a Marzo).',
    image: 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?q=80&w=600&auto=format&fit=crop',
    hours: '09:00 - 20:00',
    capacity: 'Andarivel Individual',
    slots: ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00'],
    guestLimit: 2,
    isOutdoor: true,
    isSeasonal: true,
  },
  {
    id: 'volei_playa',
    name: 'Vóley Playa - Cajón de Arena',
    category: 'temporada',
    description: 'Cancha de arena fina de playa (cajón de arena) ideal para vóley y deportes de playa.',
    image: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?q=80&w=600&auto=format&fit=crop',
    hours: '09:00 - 21:00',
    capacity: 'Equipos / Práctica',
    slots: ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30'],
    guestLimit: 6,
    isOutdoor: true,
  },
  {
    id: 'restaurant',
    name: 'Restaurante The Pavilion',
    category: 'gastronomia',
    description: 'Alta cocina de autor con maridajes de bodegas sanjuaninas en el histórico pabellón social.',
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=600&auto=format&fit=crop',
    hours: '12:00 - 23:30',
    capacity: 'Mesas exclusivas para socios',
    slots: ['12:30', '14:00', '20:30', '21:30', '22:30'],
    guestLimit: 6,
    isOutdoor: false,
  },
  {
    id: 'salon_anhelo',
    name: 'Salón Anhelo',
    category: 'salon',
    spaceType: 'salon',
    description: 'Salón de fiestas para eventos sociales y celebraciones institucionales.',
    image: 'https://images.unsplash.com/photo-1519167758481-83f15083c1f8?q=80&w=600&auto=format&fit=crop',
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
    image: 'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?q=80&w=600&auto=format&fit=crop',
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
    image: 'https://images.unsplash.com/photo-1478144592103-25e218a0807b?q=80&w=600&auto=format&fit=crop',
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
    image: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?q=80&w=600&auto=format&fit=crop',
    hours: '11:00 - 23:00',
    capacity: '30',
    slots: ['11:00', '14:00', '18:00', '21:00'],
    guestLimit: 30,
    isOutdoor: false,
    status: 'suspendido',
    defaultPrice: 96000,
  },
  {
    id: 'espacio_verde',
    name: 'Espacio Verde',
    category: 'parrilla',
    spaceType: 'parrilla',
    description: 'Espacio exterior con parrilla para reservas sociales. Capacidad 25 personas.',
    image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?q=80&w=600&auto=format&fit=crop',
    hours: '11:00 - 23:00',
    capacity: '25',
    slots: ['11:00', '14:00', '18:00', '21:00'],
    guestLimit: 25,
    isOutdoor: true,
    defaultPrice: 62000,
  },
];

export function isPoolFacility(facility) {
  return facility?.spaceType === 'pileta'
    || facility?.id === 'piscina_verano'
    || /piscin|nataci[oó]n|pileta/i.test(`${facility?.name || ''} ${facility?.id || ''}`);
}

export function isCourtFacility(facility) {
  if (isPoolFacility(facility)) return false;
  if (facility?.spaceType === 'cancha') return true;
  return facility?.category === 'cancha' || facility?.id === 'volei_playa';
}

export function isSalonFacility(facility) {
  return facility?.spaceType === 'salon' || facility?.category === 'salon';
}

export function isParrillaFacility(facility) {
  return facility?.spaceType === 'parrilla' || facility?.category === 'parrilla';
}

export function isSpaceFacility(facility) {
  return !isCourtFacility(facility) && !isPoolFacility(facility);
}

export const FACILITY_GROUPS = [
  {
    id: 'espacios',
    label: 'Espacios',
    blurb: 'Salones, Espacio Verde, gimnasio, hípica y áreas sociales.',
    match: isSpaceFacility,
  },
  {
    id: 'canchas',
    label: 'Canchas',
    blurb: 'Rugby, tenis, pádel, hockey, fútbol y vóley playa.',
    match: isCourtFacility,
  },
  {
    id: 'pileta',
    label: 'Pileta',
    blurb: 'Natación y temporada de verano.',
    match: isPoolFacility,
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

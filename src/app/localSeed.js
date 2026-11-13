import { applyAutomaticDues, pinDuesDueDate } from '../domain/members/dues';
import { attachHouseholdToMembers } from '../domain/members/households';
import { createHrRecord } from '../domain/staff/hr';
import { isSupabaseConfigured } from '../lib/supabase';

const DEMO_MEMBER_IDS = new Set([
  '2020445599881122',
  '2018776655443322',
  '2022112233445566',
  '2024990088776655',
]);

function isDemoMember(m) {
  return DEMO_MEMBER_IDS.has(String(m?.memberId || ''));
}

export const DEFAULT_MEMBERS = [
  {
    name: 'Alejandro Chávez',
    memberId: '2026887744320988',
    phone: '+5492645551234',
    phoneAlt: '+5492645551299',
    email: 'socio@jockey.sj',
    address: 'Av. Libertador San Martín 2450',
    city: 'Rivadavia',
    province: 'San Juan',
    postalCode: '5400',
    documentType: 'DNI',
    documentNumber: '28.445.912',
    birthDate: '1985-03-14',
    gender: 'Masculino',
    maritalStatus: 'Casado/a',
    nationality: 'Argentina',
    joinDate: '2021-04-10',
    emergencyContact: 'María Inés de Chávez',
    emergencyPhone: '+5492645551002',
    paymentMethod: 'Débito automático',
    billingName: 'Alejandro Chávez',
    cuitCuil: '20-28445912-3',
    taxCondition: 'Consumidor Final',
    disciplines: ['Tenis', 'Pádel', 'Equitación'],
    tier: 'socio_familiar',
    outstandingBalance: 0,
    yearsActive: 5,
    status: 'active',
    nextDueDate: '2026-10-10',
    credentialToken: 'a1b2c3d4e5f6789012345678abcdef01',
    adherents: [
      { id: 'adh-01', name: 'Sofía Chávez', tier: 'socio_familiar', relationship: 'Hijo/a', outstandingBalance: 0, status: 'active' },
      { id: 'adh-02', name: 'María Inés de Chávez', tier: 'socio_familiar', relationship: 'Cónyuge', outstandingBalance: 0, status: 'active' },
    ],
  },
];

export const DEFAULT_NEWS = [
  {
    id: 101,
    title: 'Final en Rivadavia: El Jockey Club San Juan recibe a Mendoza por el Regional Cuyano',
    category: 'deportes',
    date: '18 May 2026',
    excerpt: 'Este fin de semana se disputará el clásico regional en nuestra cancha principal de rugby, un partido clave para las aspiraciones de nuestro equipo masculino.',
    content: 'Nos enorgullece recibir al combinado mendocino para una nueva fecha del Torneo Regional Cuyano. Las actividades comenzarán el sábado a las 15:30 hs. Invitamos a las familias a acompañar a los jugadores y disfrutar del tradicional Tercer Tiempo en nuestra cantina. Sector VIP habilitado para socios de categoría Royal y Platinum.',
    image: 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?q=80&w=600&auto=format&fit=crop',
    isEvent: true
  },
  {
    id: 102,
    title: 'Se aproxima el Torneo Cordillerano de Saltos Hípicos 2026: Inscripciones abiertas',
    category: 'eventos',
    date: '15 May 2026',
    excerpt: 'El certamen de saltos hípicos más importante de la provincia de San Juan se celebrará en nuestras pistas del 12 al 14 de junio.',
    content: 'El Jockey Club San Juan se viste de fiesta para recibir a los jinetes y amazonas más destacados del país en el Torneo Cordillerano de Saltos Hípicos. Las inscripciones ya están abiertas en la Secretaría de Hípica. Contaremos con patio de comidas, música en vivo y entrada libre para la comunidad de socios.',
    image: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?q=80&w=600&auto=format&fit=crop',
    isEvent: true
  },
  {
    id: 103,
    title: 'Próxima inauguración del nuevo salón climatizado para Yoga, Boxeo y Tenis de Mesa',
    category: 'infraestructura',
    date: '10 May 2026',
    excerpt: 'La Comisión Directiva anuncia que la obra en la zona de vestuarios norte está próxima a concluir, sumando tres nuevas actividades recreativas.',
    content: 'En concordancia con los anuncios institucionales compartidos en conjunto con ASIJEMIN y el Gobierno de San Juan, estamos orgullosos de finalizar las obras de ampliación. Las disciplinas de Yoga, Boxeo y Tenis de Mesa tendrán un salón propio totalmente climatizado y equipado con elementos de última generación.',
    image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?q=80&w=600&auto=format&fit=crop',
    isEvent: false
  }
];

export const DEFAULT_JOURNAL_ENTRIES = [
  {
    id: 1,
    date: '2026-05-01',
    description: 'Suscripción e integración de capital social inicial por socios fundadores JCSJ',
    lines: [
      { account: 'Banco Macro', type: 'debit', amount: 3000000 },
      { account: 'Caja', type: 'debit', amount: 2000000 },
      { account: 'Capital Social', type: 'credit', amount: 5000000 }
    ]
  },
  {
    id: 2,
    date: '2026-05-03',
    description: 'Adquisición de postes de rugby reglamentarios e insumos para Cancha Principal',
    lines: [
      { account: 'Equipamiento Canchas', type: 'debit', amount: 1200000 },
      { account: 'Caja', type: 'credit', amount: 1200000 }
    ]
  },
  {
    id: 3,
    date: '2026-05-05',
    description: 'Abono e insumos de arena para pista de Saltos Hípicos del Torneo Cordillerano',
    lines: [
      { account: 'Equipamiento Canchas', type: 'debit', amount: 800000 },
      { account: 'Caja', type: 'credit', amount: 800000 }
    ]
  },
  {
    id: 4,
    date: '2026-05-10',
    description: 'Anticipo por concesión de Cantina del Club (Tercer Tiempo y Eventos)',
    lines: [
      { account: 'Caja', type: 'debit', amount: 350000 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 350000 }
    ]
  },
  {
    id: 5,
    date: '2026-05-15',
    description: 'Pago por mantenimiento de canchas de tenis tradicional y fertilizantes de hockey',
    lines: [
      { account: 'Mantenimiento de Canchas', type: 'debit', amount: 150000 },
      { account: 'Caja', type: 'credit', amount: 150000 }
    ]
  },
  {
    id: 6,
    date: '2026-04-05',
    description: 'Cobro cuota social (Transferencia Banco Macro) - Socio: Alejandro Chávez (Cred. 202688...)',
    lines: [
      { account: 'Banco Macro', type: 'debit', amount: 45000 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 45000 }
    ],
    sourceModule: 'cuotas',
  },
  {
    id: 7,
    date: '2026-05-03',
    description: 'Cobro cuota social (Efectivo) - Socio: Alejandro Chávez (Cred. 202688...)',
    lines: [
      { account: 'Caja General', type: 'debit', amount: 45000 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 45000 }
    ],
    sourceModule: 'cuotas',
  },
  {
    id: 8,
    date: '2026-06-02',
    description: 'Cobro cuota social (Mercado Pago) - Socio: Victoria Cantoni (Cred. 202044...)',
    lines: [
      { account: 'Mercado Pago', type: 'debit', amount: 38000 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 38000 }
    ],
    sourceModule: 'cuotas',
  },
];

export const DEFAULT_STAFF = [
  {
    id: 'emp-01',
    employeeNumber: 'E-001',
    name: 'Juan Pérez',
    role: 'Head Greenkeeper',
    specialty: 'Mantenimiento Canchas Rugby, Hockey y Turf',
    department: 'Mantenimiento',
    documentType: 'DNI',
    documentNumber: '28445112',
    cuil: '20-28445112-3',
    birthDate: '1985-03-12',
    nationality: 'Argentina',
    maritalStatus: 'casado',
    phone: '+5492644112233',
    email: 'jperez@jockey.sj',
    address: 'Av. Libertador 450, Rivadavia',
    emergencyContact: 'Laura Pérez',
    emergencyPhone: '+5492644112299',
    hireDate: '2018-02-01',
    contractType: 'Relación de dependencia',
    workShift: 'Mañana / tarde rotativa',
    reportsTo: 'Dirección de Operaciones',
    status: 'active',
    currentTask: 'Fertilizando Cancha Principal de Rugby para el Cuyano',
    avatar: 'JP',
    notes: 'Referente técnico de canchas. Certificación en riego automatizado.',
    activities: [
      { id: 1, time: '09:15', date: '2026-05-19', description: 'Niveló el cajón de arena de la cancha de vóley playa.' },
      { id: 2, time: '11:30', date: '2026-05-19', description: 'Inspeccionó el sistema de riego en cancha de hockey sobre césped.' },
      { id: 3, time: '14:00', date: '2026-05-19', description: 'Coordinó corte de césped en cancha principal de rugby.' }
    ],
    attendance: [
      { date: '2026-07-22', checkIn: '07:55', checkOut: '16:10', status: 'present' },
      { date: '2026-07-21', checkIn: '08:20', checkOut: '16:05', status: 'late', notes: 'Ingreso demorado por logística de fertilizante' },
      { date: '2026-07-20', checkIn: '07:50', checkOut: '16:00', status: 'present' },
    ],
    documents: [
      { id: 'd1', name: 'DNI digitalizado', type: 'Identidad', date: '2018-02-01', status: 'vigente' },
      { id: 'd2', name: 'Alta AFIP', type: 'Laboral', date: '2018-02-05', status: 'vigente' },
      { id: 'd3', name: 'Art / cobertura', type: 'Seguros', date: '2026-01-10', status: 'vigente' },
    ],
  },
  {
    id: 'emp-02',
    employeeNumber: 'E-002',
    name: 'Carlos Ruiz',
    role: 'Coordinador de Rugby Cuyano',
    specialty: 'Planificación de Partidos e Infantiles',
    department: 'Deportes',
    documentType: 'DNI',
    documentNumber: '30112233',
    cuil: '20-30112233-8',
    birthDate: '1988-11-04',
    nationality: 'Argentina',
    phone: '+5492644223344',
    email: 'cruiz@jockey.sj',
    address: 'Calle Mendoza 210, Capital',
    hireDate: '2019-06-15',
    contractType: 'Relación de dependencia',
    workShift: 'Tarde / fines de semana',
    reportsTo: 'Comisión de Rugby',
    status: 'active',
    currentTask: 'Coordinando fixtures con clubes de Mendoza',
    avatar: 'CR',
    activities: [
      { id: 1, time: '08:00', date: '2026-05-19', description: 'Revisión técnica de protectores de postes en cancha 1 y 2.' },
      { id: 2, time: '10:30', date: '2026-05-19', description: 'Organizó cronograma de partidos de infantiles para el fin de semana.' },
      { id: 3, time: '13:00', date: '2026-05-19', description: 'Supervisó entrenamiento liviano de la división juvenil M-17.' }
    ],
    attendance: [
      { date: '2026-07-22', checkIn: '09:00', checkOut: '18:00', status: 'present' },
      { date: '2026-07-21', checkIn: '09:05', checkOut: '18:10', status: 'present' },
    ],
    documents: [
      { id: 'd1', name: 'DNI digitalizado', type: 'Identidad', date: '2019-06-15', status: 'vigente' },
      { id: 'd2', name: 'Certificado de capacitación', type: 'Capacitación', date: '2025-03-01', status: 'vigente' },
    ],
  },
  {
    id: 'emp-03',
    employeeNumber: 'E-003',
    name: 'Roberto Gómez',
    role: 'Encargado del Club & Cantina',
    specialty: 'Gastronomía, Cantina y Eventos',
    department: 'Gastronomía',
    documentType: 'DNI',
    documentNumber: '25998877',
    cuil: '20-25998877-1',
    birthDate: '1979-07-22',
    nationality: 'Argentina',
    phone: '+5492644334455',
    email: 'rgomez@jockey.sj',
    hireDate: '2015-09-01',
    contractType: 'Relación de dependencia',
    workShift: 'Rotativa eventos',
    reportsTo: 'Administración',
    status: 'active',
    currentTask: 'Organizando stock de bebidas para el Tercer Tiempo',
    avatar: 'RG',
    activities: [
      { id: 1, time: '10:00', date: '2026-05-19', description: 'Supervisó recepción de mercadería para la cantina.' },
      { id: 2, time: '12:30', date: '2026-05-19', description: 'Coordinó el servicio de almuerzo en el quincho de socios.' },
      { id: 3, time: '16:00', date: '2026-05-19', description: 'Alineó personal para el evento gastronómico del Torneo Cordillerano.' }
    ],
    attendance: [
      { date: '2026-07-22', checkIn: '10:00', checkOut: '19:30', status: 'present' },
    ],
    documents: [
      { id: 'd1', name: 'Libreta sanitaria', type: 'Salud', date: '2026-02-01', status: 'vigente' },
    ],
  },
  {
    id: 'emp-04',
    employeeNumber: 'E-004',
    name: 'Sofía Álvarez',
    role: 'Directora Hípica y Turf',
    specialty: 'Saltos Hípicos y Pistas de Vareo',
    department: 'Hípica',
    documentType: 'DNI',
    documentNumber: '32771100',
    cuil: '27-32771100-4',
    birthDate: '1990-01-18',
    nationality: 'Argentina',
    phone: '+5492644445566',
    email: 'salvarez@jockey.sj',
    hireDate: '2020-03-10',
    contractType: 'Relación de dependencia',
    workShift: 'Completa',
    reportsTo: 'Mesa Directiva',
    status: 'active',
    currentTask: 'Inspeccionando cajones y pista de turf para el vareo',
    avatar: 'SA',
    activities: [
      { id: 1, time: '09:00', date: '2026-05-18', description: 'Inspeccionó la altura de los obstáculos en la pista de saltos.' },
      { id: 2, time: '14:00', date: '2026-05-18', description: 'Coordinó con los jinetes locales los horarios de las pistas de equitación.' },
      { id: 3, time: '19:00', date: '2026-05-18', description: 'Cierre del registro de inscritos para el Torneo Cordillerano.' }
    ],
    attendance: [
      { date: '2026-07-22', checkIn: '08:30', checkOut: '17:00', status: 'present' },
      { date: '2026-07-19', status: 'absent', notes: 'Licencia personal' },
    ],
    documents: [
      { id: 'd1', name: 'Título / credencial hípica', type: 'Profesional', date: '2020-03-10', status: 'vigente' },
    ],
  },
  {
    id: 'emp-05',
    employeeNumber: 'E-005',
    name: 'Martina Benítez',
    role: 'Cajero Central',
    specialty: 'Administración y Cobros',
    department: 'Tesorería',
    documentType: 'DNI',
    documentNumber: '35112244',
    cuil: '27-35112244-9',
    birthDate: '1994-09-30',
    nationality: 'Argentina',
    phone: '+5492644556677',
    email: 'mbenitez@jockey.sj',
    hireDate: '2022-01-20',
    contractType: 'Relación de dependencia',
    workShift: 'Administrativa 8–16',
    reportsTo: 'Contaduría',
    status: 'active',
    currentTask: 'Conciliación Caja Diaria',
    avatar: 'MB',
    activities: [
      { id: 1, time: '08:30', date: '2026-05-19', description: 'Apertura de terminal and arqueo inicial de caja.' },
      { id: 2, time: '11:00', date: '2026-05-19', description: 'Procesó pagos de cuotas sociales de socios en secretaría.' },
      { id: 3, time: '15:30', date: '2026-05-19', description: 'Conciliación de transferencias de Banco Macro recibidas.' }
    ],
    attendance: [
      { date: '2026-07-22', checkIn: '08:00', checkOut: '16:00', status: 'present' },
      { date: '2026-07-21', checkIn: '08:00', checkOut: '16:05', status: 'present' },
    ],
    documents: [
      { id: 'd1', name: 'DNI digitalizado', type: 'Identidad', date: '2022-01-20', status: 'vigente' },
      { id: 'd2', name: 'Declaración jurada caja', type: 'Laboral', date: '2026-01-02', status: 'vigente' },
    ],
  }
];

export const DEFAULT_STAFF_HR = [
  createHrRecord({
    type: 'novedad',
    title: 'Cambio de turnos por Torneo Cordillerano',
    detail: 'El personal de mantenimiento y hípica refuerza fines de semana del 12 al 14 de junio.',
    date: '2026-07-18',
    time: '09:00',
    status: 'registered',
  }),
  createHrRecord({
    type: 'falta',
    employeeId: 'emp-04',
    employeeName: 'Sofía Álvarez',
    title: 'Ausencia con aviso',
    detail: 'Licencia personal — cubierta por coordinación hípica.',
    date: '2026-07-19',
    time: '08:00',
    status: 'registered',
  }),
  createHrRecord({
    type: 'tardanza',
    employeeId: 'emp-01',
    employeeName: 'Juan Pérez',
    title: 'Ingreso 25 min tarde',
    detail: 'Logística de fertilizante demorada en ingreso a sede.',
    date: '2026-07-21',
    time: '08:20',
    status: 'registered',
  }),
  createHrRecord({
    type: 'permiso',
    employeeId: 'emp-05',
    employeeName: 'Martina Benítez',
    title: 'Permiso médico medio día',
    detail: 'Turno médico por la tarde. Cubre secretaría.',
    date: '2026-07-24',
    time: '10:15',
    status: 'pending',
  }),
  createHrRecord({
    type: 'solicitud',
    employeeId: 'emp-02',
    employeeName: 'Carlos Ruiz',
    title: 'Franco compensatorio',
    detail: 'Por jornada extendida del fin de semana de infantiles.',
    date: '2026-07-22',
    time: '11:00',
    status: 'pending',
  }),
  createHrRecord({
    type: 'solicitud',
    employeeId: 'emp-03',
    employeeName: 'Roberto Gómez',
    title: 'Anticipo de sueldo',
    detail: 'Solicitud formal por gastos familiares.',
    date: '2026-07-15',
    time: '14:30',
    status: 'approved',
  }),
];

export const DEFAULT_CLAIMS = [
  {
    id: 1,
    date: '2026-05-18',
    memberName: 'Alejandro Chávez',
    memberId: '2026887744320988',
    type: 'Mantenimiento',
    title: 'Reparación de red en Cancha de Tenis Tradicional 4',
    description: 'La red del fondo está un poco desgarrada y las pelotas se escapan al sector de circulación de carruajes.',
    status: 'pending', // 'pending', 'in_progress', 'resolved'
    assignedStaff: '',
    response: ''
  },
  {
    id: 2,
    date: '2026-05-17',
    memberName: 'Victoria Cantoni',
    memberId: '2020445599881122',
    type: 'Hípica',
    title: 'Nivelación de arena en Pista de Saltos Norte',
    description: 'Se observa acumulación irregular de arena en el obstáculo de agua de la pista de equitación.',
    status: 'resolved',
    assignedStaff: 'Sofía Álvarez',
    response: 'Se procedió al rastrillado y nivelado completo de la pista antes del inicio de las prácticas.'
  }
];

export const DEFAULT_MESSAGES = [
  {
    id: 1,
    date: '2026-09-23',
    createdAt: '2026-09-23T23:20:00.000Z',
    sender: 'Secretaría del Jockey Club',
    senderId: 'ops',
    recipientId: 'all',
    subject: 'Bienvenida al portal',
    content: 'Ya tenés el portal de socios del Jockey Club San Juan.\n\nEntrá con tu email y la contraseña que te dio secretaría. Si es la primera vez, cambiala desde Mi perfil.\n\nDesde acá ves tu ficha, reservás canchas, consultás la cuota y leés los avisos del club.',
    isRead: false,
    parentId: null,
  },
  {
    id: 2,
    date: '2026-09-23',
    createdAt: '2026-09-23T23:19:00.000Z',
    sender: 'Secretaría del Jockey Club',
    senderId: 'ops',
    recipientId: 'all',
    subject: 'Cómo usar el portal',
    content: 'Así funciona el portal, del lado del socio:\n\nInicio. El resumen de tu lugar en el club y los avisos pendientes.\n\nReservar canchas. Elegís el deporte, el día y el horario. Si el turno está tomado, te anotás en la lista de espera.\n\nMi cuenta. Ves la cuota, el saldo y los pagos.\n\nNovedades. Las noticias del club.\n\nMensajes. Acá llegan los avisos. También podés escribirle a secretaría.\n\nMi perfil. Tus datos de socio. El ingreso es siempre con tu email.',
    isRead: false,
    parentId: null,
  },
];

export const DEFAULT_ENTRY_LOGS = [
  {
    id: 1,
    date: '2026-05-19',
    time: '08:45',
    memberName: 'Victoria Cantoni',
    memberId: '2020445599881122',
    role: 'Socio Titular',
    status: 'granted',
    notes: 'Acceso aprobado - Sin deuda pendiente'
  },
  {
    id: 2,
    date: '2026-05-19',
    time: '10:15',
    memberName: 'Adolfo Sarmiento',
    memberId: '2018776655443322',
    role: 'Socio Titular',
    status: 'granted',
    notes: 'Acceso aprobado - Socio Vitalicio Royal'
  },
  {
    id: 3,
    date: '2026-07-20',
    time: '07:50',
    memberName: 'Alejandro Chávez',
    memberId: '2026887744320988',
    role: 'Socio Titular',
    status: 'granted',
    notes: 'Ingreso sede Rivadavia · Rugby matutino'
  },
  {
    id: 4,
    date: '2026-07-18',
    time: '18:10',
    memberName: 'Alejandro Chávez',
    memberId: '2026887744320988',
    role: 'Socio Titular',
    status: 'denied',
    notes: 'Acceso denegado temporalmente · Cuota vencida'
  },
  {
    id: 5,
    date: '2026-07-15',
    time: '09:20',
    memberName: 'Alejandro Chávez',
    memberId: '2026887744320988',
    role: 'Socio Titular',
    status: 'granted',
    notes: 'Ingreso con grupo familiar (2 adherentes)'
  },
  {
    id: 6,
    date: '2026-07-12',
    time: '16:40',
    memberName: 'Bautista Del Carril',
    memberId: '2022112233445566',
    role: 'Socio Titular',
    status: 'granted',
    notes: 'Ingreso Tenis · Polvo de ladrillo'
  },
];

export const DEFAULT_SURVEYS = [
  {
    id: 1,
    question: "¿Qué mejora de infraestructura edilicia consideras prioritaria para la Sede Rivadavia en 2026?",
    category: "Infraestructura",
    active: true,
    votedBy: ['2020445599881122'], // Victoria Cantoni ya votó
    options: [
      { id: 'opt1', text: 'Nueva cancha de Pádel techada (vidrio templado)', votes: 142 },
      { id: 'opt2', text: 'Renovación de luces LED en Cancha Auxiliar de Rugby', votes: 89 },
      { id: 'opt3', text: 'Ampliación de vestuarios en sector Hípico', votes: 45 },
      { id: 'opt4', text: 'Cava de vinos de alta gama en The Pavilion', votes: 67 }
    ]
  },
  {
    id: 2,
    question: "¿Qué disciplina o taller deportivo te gustaría incorporar al club en la próxima temporada?",
    category: "Deportes",
    active: true,
    votedBy: [], // Nadie ha votado todavía de los socios principales
    options: [
      { id: 'opt1', text: 'Clases formativas de Vóley de Playa (Cajón de Arena)', votes: 94 },
      { id: 'opt2', text: 'Escuela de Equitación Infantil y Pony Club', votes: 120 },
      { id: 'opt3', text: 'Taller de Iniciación al Yoga y Meditación Outdoor', votes: 76 },
      { id: 'opt4', text: 'Clases intensivas de Boxeo y defensa personal', votes: 55 }
    ]
  }
];

export function initialMembers() {
  if (isSupabaseConfigured) return [];
  const local = localStorage.getItem('jockey-members');
  const stored = local ? JSON.parse(local) : null;
  const defaultsById = Object.fromEntries(DEFAULT_MEMBERS.map((m) => [m.memberId, m]));
  const cleanedStored = Array.isArray(stored)
    ? stored.filter((m) => !isDemoMember(m))
    : null;
  const base = !cleanedStored?.length
    ? DEFAULT_MEMBERS
    : cleanedStored.map((m) => {
        const seed = defaultsById[m.memberId];
        if (!seed) return m;
        const merged = {
          ...seed,
          ...m,
          // Completar ficha con datos de semilla si faltan en localStorage
          nextDueDate: pinDuesDueDate(m.nextDueDate || seed.nextDueDate),
          overdueSince: m.overdueSince || seed.overdueSince,
          email: m.email || seed.email,
          address: m.address || seed.address,
          city: m.city || seed.city,
          province: m.province || seed.province,
          documentNumber: m.documentNumber || seed.documentNumber,
          documentType: m.documentType || seed.documentType,
          birthDate: m.birthDate || seed.birthDate,
          joinDate: m.joinDate || seed.joinDate,
          disciplines: m.disciplines?.length ? m.disciplines : seed.disciplines,
          adherents: m.adherents?.length ? m.adherents : seed.adherents,
        };
        // Limpiar deuda demo del socio de login local
        if (m.memberId === '2026887744320988') {
          return {
            ...merged,
            outstandingBalance: 0,
            nextDueDate: seed.nextDueDate,
            overdueSince: undefined,
          };
        }
        return merged;
      });
  // Local: cuota vencida genera deuda. Los saldos reales vienen de la base.
  return attachHouseholdToMembers(applyAutomaticDues(base));
}

export function initialNews() {
  if (isSupabaseConfigured) return [];
  const local = localStorage.getItem('jockey-news');
  return local ? JSON.parse(local) : DEFAULT_NEWS;
}

export function initialJournalEntries() {
  if (isSupabaseConfigured) return [];
  const local = localStorage.getItem('jockey-journal-entries');
  return local ? JSON.parse(local) : DEFAULT_JOURNAL_ENTRIES;
}

export function initialStaff() {
  if (isSupabaseConfigured) return [];
  const local = localStorage.getItem('jockey-staff-members');
  const stored = local ? JSON.parse(local) : null;
  if (!stored) return DEFAULT_STAFF;
  const defaultsById = Object.fromEntries(DEFAULT_STAFF.map((e) => [e.id, e]));
  return stored.map((emp) => {
    const seed = defaultsById[emp.id];
    if (!seed) return emp;
    return {
      ...seed,
      ...emp,
      employeeNumber: emp.employeeNumber || seed.employeeNumber,
      department: emp.department || seed.department,
      hireDate: emp.hireDate || seed.hireDate,
      attendance: emp.attendance?.length ? emp.attendance : seed.attendance,
      documents: emp.documents?.length ? emp.documents : seed.documents,
      activities: emp.activities?.length ? emp.activities : seed.activities,
    };
  });
}

export function initialStaffHr() {
  if (isSupabaseConfigured) return [];
  const local = localStorage.getItem('jockey-staff-hr');
  return local ? JSON.parse(local) : DEFAULT_STAFF_HR;
}

export function initialClaims() {
  if (isSupabaseConfigured) return [];
  const local = localStorage.getItem('jockey-claims');
  return local ? JSON.parse(local) : DEFAULT_CLAIMS;
}

export function initialMessages() {
  if (isSupabaseConfigured) return [];
  const local = localStorage.getItem('jockey-messages');
  return local ? JSON.parse(local) : DEFAULT_MESSAGES;
}

export function initialEntryLogs() {
  if (isSupabaseConfigured) return [];
  const local = localStorage.getItem('jockey-entry-logs');
  return local ? JSON.parse(local) : DEFAULT_ENTRY_LOGS;
}

export function initialSurveys() {
  if (isSupabaseConfigured) return [];
  const local = localStorage.getItem('jockey-surveys');
  return local ? JSON.parse(local) : DEFAULT_SURVEYS;
}

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import DashboardView from './views/DashboardView';
import LoginView from './views/LoginView';
import useErpStore from './hooks/useErpStore';
import { AlertsBanner } from './components/erp/AlertsPanel';
import SessionStatusBar from './components/SessionStatusBar';
import { useAuth } from './context/AuthContext';
import { canAccessAdmin, canAccessQrGate, canAccessConcessions } from './domain/auth/roles';
import { hasReservationConflict } from './domain/reservations/conflicts';
import { countUnread, markMessageRead } from './domain/messaging/messages';
import {
  buildNotifications,
  loadDismissedNotificationIds,
  saveDismissedNotificationIds,
} from './domain/notifications/buildNotifications';
import { applyAutomaticDues, diffAutomaticDues } from './domain/members/dues';
import { createHrRecord } from './domain/staff/hr';
import { loadDisciplineCatalog } from './domain/sports/disciplines';
import { loadTierCatalog, setRuntimeTierCatalog } from './domain/members/tiers';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { notifyNextOnWaitlist } from './domain/reservations/waitlist';
import { bootstrapFromDb, repos } from './data/bootstrap';
import { useDailyBackup } from './hooks/useDailyBackup';

// Lazy load de vistas pesadas (bundle-dynamic-imports)
const ReservationsView = lazy(() => import('./views/ReservationsView'));
const NewsBoardView = lazy(() => import('./views/NewsBoardView'));
const AdminView = lazy(() => import('./views/AdminView'));
const MessagesView = lazy(() => import('./views/MessagesView'));
const PaymentHistoryView = lazy(() => import('./views/PaymentHistoryView'));
const MemberProfilePanel = lazy(() => import('./components/admin/MemberProfilePanel'));
const AccessControlView = lazy(() => import('./views/AccessControlView'));
const ConcessionsView = lazy(() => import('./views/ConcessionsView'));
const ConcessionPortalView = lazy(() => import('./views/ConcessionPortalView'));

function RouteFallback() {
  return (
    <div style={{ minHeight: '40vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }} aria-live="polite">
      Cargando…
    </div>
  );
}

// Datos de semilla predeterminados para socios de Jockey Club San Juan (con teléfonos 264 y adherentes)
const DEFAULT_MEMBERS = [
  {
    name: 'Alejandro Chávez', // El socio activo predeterminado
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
    tier: 'royal',
    outstandingBalance: 32000, // Saldo inicial para demostrar el flujo de cobro
    yearsActive: 5,
    status: 'active',
    nextDueDate: '2026-06-01',
    overdueSince: '2026-06-01',
    adherents: [
      { id: 'adh-01', name: 'Sofía Chávez', tier: 'royal', relationship: 'Hijo/a', outstandingBalance: 0, status: 'active' },
      { id: 'adh-02', name: 'María Inés de Chávez', tier: 'royal', relationship: 'Cónyuge', outstandingBalance: 0, status: 'active' }
    ]
  },
  {
    name: 'Victoria Cantoni',
    memberId: '2020445599881122',
    phone: '+5492644445678',
    tier: 'platinum',
    outstandingBalance: 0,
    yearsActive: 8,
    status: 'active',
    nextDueDate: '2026-07-28', // próxima a vencer
    disciplines: ['Hockey', 'Fitness'],
    adherents: []
  },
  {
    name: 'Adolfo Sarmiento',
    memberId: '2018776655443322',
    phone: '+5492646669876',
    tier: 'royal',
    outstandingBalance: 0,
    yearsActive: 12,
    status: 'active',
    nextDueDate: '2026-08-15',
    disciplines: ['Hípica', 'Golf'],
    adherents: [
      { id: 'adh-03', name: 'Adolfo Sarmiento (Hijo)', tier: 'platinum', relationship: 'Hijo/a', outstandingBalance: 0, status: 'active', disciplines: ['Hípica'] }
    ]
  },
  {
    name: 'Bautista Del Carril',
    memberId: '2022112233445566',
    phone: '+5492642222333',
    tier: 'gold',
    outstandingBalance: 45000,
    yearsActive: 4,
    status: 'active',
    nextDueDate: '2026-05-10',
    overdueSince: '2026-05-10',
    disciplines: ['Rugby', 'Fútbol'],
    adherents: [
      { id: 'adh-04', name: 'Delfina Del Carril', tier: 'gold', relationship: 'Hijo/a', outstandingBalance: 12000, status: 'active', disciplines: ['Tenis'] }
    ]
  },
  {
    name: 'Isabel Albarracín',
    memberId: '2024990088776655',
    phone: '+5492649999888',
    tier: 'gold',
    outstandingBalance: 0,
    yearsActive: 2,
    status: 'active',
    nextDueDate: '2026-07-30', // próxima a vencer
    disciplines: ['Natación', 'Voleibol', 'Fitness'],
    adherents: []
  }
];

// Datos de semilla predeterminados para reservas (alineados con canchas de San Juan)
const DEFAULT_RESERVATIONS = [
  {
    id: 1,
    facilityId: 'rugby_masc',
    facilityName: 'Rugby Masculino - Cancha Principal',
    memberId: '2020445599881122',
    memberName: 'Victoria Cantoni',
    date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0], // En 2 días
    time: '09:00',
    guests: 3,
    guestNames: 'Mariana Cantoni, Jorge L. Cantoni, Manuel Sarmiento',
    status: 'confirmed'
  },
  {
    id: 2,
    facilityId: 'tenis_trad',
    facilityName: 'Tenis Tradicional - Polvo de Ladrillo',
    memberId: '2022112233445566',
    memberName: 'Bautista Del Carril',
    date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Mañana
    time: '17:00',
    guests: 1,
    guestNames: 'Facundo Del Carril',
    status: 'confirmed'
  },
  {
    id: 3,
    facilityId: 'rugby_masc',
    facilityName: 'Rugby Masculino - Cancha Principal',
    memberId: '2026887744320988',
    memberName: 'Alejandro Chávez',
    date: '2026-07-20',
    time: '08:00',
    guests: 0,
    guestNames: '',
    status: 'confirmed'
  },
  {
    id: 4,
    facilityId: 'fitness',
    facilityName: 'Fitness · Gimnasio Cubierto',
    memberId: '2026887744320988',
    memberName: 'Alejandro Chávez',
    date: '2026-07-14',
    time: '19:00',
    guests: 1,
    guestNames: 'Sofía Chávez',
    status: 'confirmed'
  },
];

// Datos de semilla predeterminados para noticias del Jockey Club San Juan
const DEFAULT_NEWS = [
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

// Datos de semilla contable oficial de San Juan (Libro Diario inicial balanceado)
const DEFAULT_JOURNAL_ENTRIES = [
  {
    id: 1,
    date: '2026-05-01',
    description: 'Suscripción e integración de capital social inicial por socios fundadores JCSJ',
    lines: [
      { account: 'Banco Nación', type: 'debit', amount: 3000000 },
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
    description: 'Cobro cuota social (Transferencia Banco Nación) - Socio: Alejandro Chávez (Cred. 202688...)',
    lines: [
      { account: 'Banco Nación', type: 'debit', amount: 45000 },
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
      { account: 'Banco Nación', type: 'debit', amount: 38000 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 38000 }
    ],
    sourceModule: 'cuotas',
  },
];

// Datos de semilla para el personal de San Juan y bitácora de trazabilidad
const DEFAULT_STAFF = [
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
      { id: 3, time: '15:30', date: '2026-05-19', description: 'Conciliación de transferencias de Banco Nación recibidas.' }
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

// RR.HH. personal: novedades, faltas, tardanzas, permisos, solicitudes
const DEFAULT_STAFF_HR = [
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

// NUEVO: Semillas para Solicitudes, Pedidos y Reclamos
const DEFAULT_CLAIMS = [
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

// NUEVO: Semillas para Bandeja de Entrada de Mensajería
const DEFAULT_MESSAGES = [
  {
    id: 1,
    date: '2026-05-19',
    createdAt: '2026-05-19T09:00:00.000Z',
    sender: 'Secretaría JCSJ',
    senderId: 'ops',
    recipientId: '2026887744320988',
    subject: 'Convocatoria a Asamblea Anual Ordinaria en Sede Rivadavia',
    content: 'Estimado socio, le informamos que el próximo 30 de mayo a las 18:00 hs se llevará a cabo la Asamblea Ordinaria en el Salón de Honor de República del Líbano 1799 Oeste. Su presencia es de suma importancia.',
    isRead: false,
    parentId: null,
  },
  {
    id: 2,
    date: '2026-05-15',
    createdAt: '2026-05-15T11:00:00.000Z',
    sender: 'Tesorería Jockey Club',
    senderId: 'ops',
    recipientId: '2026887744320988',
    subject: 'Recordatorio Cuota de Mayo JCSJ',
    content: 'Le recordamos que posee un saldo de cuota social mensual pendiente de cancelación. Puede regularizarlo de manera directa en las terminales del club o mediante transferencia bancaria.',
    isRead: true,
    parentId: null,
  },
  {
    id: 3,
    date: '2026-05-18',
    createdAt: '2026-05-18T16:00:00.000Z',
    sender: 'Comisión Hípica JCSJ',
    senderId: 'ops',
    recipientId: 'all',
    subject: 'Apertura de Inscripciones Torneo Cordillerano',
    content: 'Se informa a todos los socios activos de las disciplinas de equitación e hipismo que se encuentran abiertas las planillas de inscripción para el prestigioso Torneo Cordillerano de Saltos Hípicos 2026.',
    isRead: false,
    parentId: null,
  },
  {
    id: 4,
    date: '2026-05-20',
    createdAt: '2026-05-20T10:30:00.000Z',
    sender: 'Alejandro Chávez',
    senderId: '2026887744320988',
    recipientId: 'ops',
    subject: 'Consulta por horario de cancha de tenis',
    content: 'Buenos días. Quisiera saber si el próximo sábado habrá disponibilidad en Tenis Tradicional por la mañana. Gracias.',
    isRead: false,
    parentId: null,
  },
];

// NUEVO: Semillas para Registro de Accesos QR (Control de Ingreso)
const DEFAULT_ENTRY_LOGS = [
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

// Semillas para Encuestas y Consultas Colectivas
const DEFAULT_SURVEYS = [
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

export default function App() {
  const { user, loading: authLoading, isAuthenticated, role } = useAuth();
  const userRole = role || 'member';
  const cloudMode = isSupabaseConfigured;
  const hydratedRef = useRef(false);
  const [dbReady, setDbReady] = useState(!isSupabaseConfigured);
  const [dbError, setDbError] = useState('');
  const [dbHealthy, setDbHealthy] = useState(false);
  const [memberDbIds, setMemberDbIds] = useState({});

  // Inicialización de Estados Cargando desde LocalStorage o Valores de Semilla
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('jockey-theme') || 'dark';
  });

  // Navegación por URL: el "view id" histórico se traduce a rutas reales.
  const navigate = useNavigate();
  const location = useLocation();
  const isOperativeRole = canAccessAdmin(userRole);

  const pathForView = (viewId) => {
    switch (viewId) {
      case 'reservations': return isOperativeRole ? '/panel' : '/reservas';
      case 'news': return '/revista';
      case 'messages': return '/mensajes';
      case 'payments': return '/cuenta';
      case 'profile': return '/perfil';
      case 'concessions': return '/concesiones';
      case 'admin': return isOperativeRole ? '/panel' : '/';
      case 'dashboard':
      default: return isOperativeRole ? '/panel' : '/';
    }
  };

  const setCurrentView = (viewId) => navigate(pathForView(viewId));

  const currentView = location.pathname.startsWith('/reservas')
    ? 'reservations'
    : location.pathname.startsWith('/revista')
      ? 'news'
      : location.pathname.startsWith('/mensajes')
        ? 'messages'
        : location.pathname.startsWith('/cuenta')
          ? 'payments'
          : location.pathname.startsWith('/perfil')
            ? 'profile'
            : location.pathname.startsWith('/concesiones')
              ? 'concessions'
              : 'dashboard';

  const [members, setMembers] = useState(() => {
    const local = localStorage.getItem('jockey-members');
    const stored = local ? JSON.parse(local) : null;
    const defaultsById = Object.fromEntries(DEFAULT_MEMBERS.map((m) => [m.memberId, m]));
    const base = !stored
      ? DEFAULT_MEMBERS
      : stored.map((m) => {
          const seed = defaultsById[m.memberId];
          if (!seed) return m;
          return {
            ...seed,
            ...m,
            // Completar ficha con datos de semilla si faltan en localStorage
            nextDueDate: m.nextDueDate || seed.nextDueDate,
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
        });
    // Cuota vencida → deuda generada sola (sin botón manual)
    return applyAutomaticDues(base);
  });

  const [reservations, setReservations] = useState(() => {
    const local = localStorage.getItem('jockey-reservations');
    return local ? JSON.parse(local) : DEFAULT_RESERVATIONS;
  });

  const [newsList, setNewsList] = useState(() => {
    const local = localStorage.getItem('jockey-news');
    return local ? JSON.parse(local) : DEFAULT_NEWS;
  });

  const [disciplineCatalog, setDisciplineCatalog] = useState(() => loadDisciplineCatalog());
  const [tierCatalog, setTierCatalog] = useState(() => {
    const cat = loadTierCatalog();
    setRuntimeTierCatalog(cat);
    return cat;
  });

  const [rsvpList, setRsvpList] = useState(() => {
    const local = localStorage.getItem('jockey-rsvps');
    return local ? JSON.parse(local) : [];
  });

  const [journalEntries, setJournalEntries] = useState(() => {
    const local = localStorage.getItem('jockey-journal-entries');
    return local ? JSON.parse(local) : DEFAULT_JOURNAL_ENTRIES;
  });

  const [staffMembers, setStaffMembers] = useState(() => {
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
  });

  const [staffHrRecords, setStaffHrRecords] = useState(() => {
    const local = localStorage.getItem('jockey-staff-hr');
    return local ? JSON.parse(local) : DEFAULT_STAFF_HR;
  });

  // NUEVOS ESTADOS FASE 3
  const [claims, setClaims] = useState(() => {
    const local = localStorage.getItem('jockey-claims');
    return local ? JSON.parse(local) : DEFAULT_CLAIMS;
  });

  const [messages, setMessages] = useState(() => {
    const local = localStorage.getItem('jockey-messages');
    return local ? JSON.parse(local) : DEFAULT_MESSAGES;
  });

  const [entryLogs, setEntryLogs] = useState(() => {
    const local = localStorage.getItem('jockey-entry-logs');
    return local ? JSON.parse(local) : DEFAULT_ENTRY_LOGS;
  });

  const [surveys, setSurveys] = useState(() => {
    const local = localStorage.getItem('jockey-surveys');
    return local ? JSON.parse(local) : DEFAULT_SURVEYS;
  });

  const [guestPasses, setGuestPasses] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('jockey-guest-passes') || '[]');
    } catch {
      return [];
    }
  });

  const [waitlist, setWaitlist] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('jockey-waitlist') || '[]');
    } catch {
      return [];
    }
  });

  const [isZondaActive, setIsZondaActive] = useState(() => {
    return localStorage.getItem('jockey-zonda') === 'true';
  });

  // NUEVO: Estado Offline/Online y Cola de Sincronización
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncQueue, setSyncQueue] = useState(() => {
    const local = localStorage.getItem('jockey-sync-queue');
    return local ? JSON.parse(local) : [];
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-sync-queue', JSON.stringify(syncQueue));
  }, [syncQueue, cloudMode]);

  // Sincronización automática al recuperar conexión (solo modo local)
  useEffect(() => {
    if (cloudMode) return undefined;
    if (isOnline && syncQueue.length > 0) {
      const syncTimeout = setTimeout(() => {
        setSyncQueue([]);
      }, 2000);
      return () => clearTimeout(syncTimeout);
    }
    return undefined;
  }, [isOnline, syncQueue.length, cloudMode]);

  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-zonda', isZondaActive);
  }, [isZondaActive, cloudMode]);

  useEffect(() => {
    localStorage.setItem('jockey-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Persistencia local solo si no hay Supabase
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-members', JSON.stringify(members));
  }, [members, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-reservations', JSON.stringify(reservations));
  }, [reservations, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-news', JSON.stringify(newsList));
  }, [newsList, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-disciplines-catalog', JSON.stringify(disciplineCatalog));
    else if (hydratedRef.current && dbReady) {
      repos.setSetting('disciplines_catalog', disciplineCatalog, user?.id).catch(() => {});
    }
  }, [disciplineCatalog, cloudMode, dbReady, user?.id]);
  useEffect(() => {
    setRuntimeTierCatalog(tierCatalog);
    if (!cloudMode) localStorage.setItem('jockey-member-tiers', JSON.stringify(tierCatalog));
    else if (hydratedRef.current && dbReady) {
      repos.setSetting('member_tiers', tierCatalog, user?.id).catch(() => {});
    }
  }, [tierCatalog, cloudMode, dbReady, user?.id]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-rsvps', JSON.stringify(rsvpList));
  }, [rsvpList, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-journal-entries', JSON.stringify(journalEntries));
  }, [journalEntries, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-staff-members', JSON.stringify(staffMembers));
  }, [staffMembers, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-staff-hr', JSON.stringify(staffHrRecords));
  }, [staffHrRecords, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-claims', JSON.stringify(claims));
  }, [claims, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-messages', JSON.stringify(messages));
  }, [messages, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-entry-logs', JSON.stringify(entryLogs));
  }, [entryLogs, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-surveys', JSON.stringify(surveys));
  }, [surveys, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-guest-passes', JSON.stringify(guestPasses));
  }, [guestPasses, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-waitlist', JSON.stringify(waitlist));
  }, [waitlist, cloudMode]);

  // Socio activo: el vinculado a la sesión, o el primero como fallback operativo
  const activeMember =
    members.find((m) => m.memberId === user?.memberId) ||
    members.find((m) => m.memberId === '2026887744320988') ||
    members[0];

  // Alternar Tema Claro / Oscuro
  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Agregar una reserva (con guardia de dominio contra turnos duplicados)
  const addReservation = async (newRes) => {
    if (hasReservationConflict(reservations, newRes)) {
      return { ok: false, error: 'El turno ya está reservado para esa instalación, fecha y horario.' };
    }
    if (cloudMode) {
      try {
        const dbId = memberDbIds[newRes.memberId] || await repos.findMemberDbIdByNumber(newRes.memberId);
        const saved = await repos.createReservation(newRes, dbId);
        setReservations((prev) => [saved, ...prev]);
        return { ok: true, reservation: saved };
      } catch (err) {
        return { ok: false, error: err.message || 'No se pudo guardar la reserva en la base.' };
      }
    }
    const resWithId = {
      ...newRes,
      id: Date.now()
    };
    setReservations(prev => [resWithId, ...prev]);
    return { ok: true };
  };

  // Cancelar una reserva (y avisar al primero de la lista de espera)
  const cancelReservation = async (resId) => {
    const current = reservations.find((r) => r.id === resId);
    if (cloudMode && current) {
      try {
        const saved = await repos.updateReservation(resId, { status: 'cancelled' });
        setReservations((prev) => prev.map((res) => (res.id === resId ? saved : res)));
      } catch {
        setReservations((prev) =>
          prev.map((res) => (res.id === resId ? { ...res, status: 'cancelled' } : res))
        );
      }
    } else {
      setReservations((prev) =>
        prev.map((res) => (res.id === resId ? { ...res, status: 'cancelled' } : res))
      );
    }
    if (current) {
      setWaitlist((prev) => {
        const { entries, notified } = notifyNextOnWaitlist(prev, {
          facilityId: current.facilityId,
          date: current.date,
          time: current.time,
        });
        if (notified) {
          const msg = {
            id: `wl-msg-${Date.now()}`,
            date: new Date().toISOString().slice(0, 10),
            sender: 'Reservas · Jockey Club',
            senderId: 'ops',
            recipientId: notified.memberId,
            subject: 'Turno liberado · lista de espera',
            content: `Se liberó ${notified.facilityName} el ${notified.date} a las ${notified.time}. Reservá desde Instalaciones.`,
            isRead: false,
          };
          if (cloudMode) {
            repos.insertMessage(msg).then((saved) => {
              setMessages((msgs) => [saved, ...msgs]);
            }).catch(() => setMessages((msgs) => [msg, ...msgs]));
          } else {
            setMessages((msgs) => [msg, ...msgs]);
          }
        }
        if (cloudMode) {
          repos.replaceWaitlist(entries, memberDbIds).then(setWaitlist).catch(() => {});
        }
        return entries;
      });
    }
  };

  const updateMember = async (nextMember) => {
    if (!nextMember?.memberId) return;
    if (cloudMode) {
      try {
        const current = members.find((m) => m.memberId === nextMember.memberId) || {};
        const saved = await repos.upsertMember({ ...current, ...nextMember });
        setMembers((prev) =>
          prev.map((m) => (m.memberId === nextMember.memberId ? { ...m, ...saved } : m))
        );
        if (saved.id) {
          setMemberDbIds((prev) => ({ ...prev, [saved.memberId]: saved.id }));
        }
        // Pagos nuevos en paymentHistory
        const prevHist = current.paymentHistory || [];
        const nextHist = nextMember.paymentHistory || saved.paymentHistory || [];
        if (nextHist.length > prevHist.length && saved.id) {
          const newest = nextHist[0];
          if (newest && !String(newest.id || '').includes('-')) {
            await repos.insertMemberPayment(saved.id, newest);
          }
        }
        return;
      } catch (err) {
        setDbError(err.message || 'No se pudo guardar el socio');
      }
    }
    setMembers((prev) =>
      prev.map((m) => (m.memberId === nextMember.memberId ? { ...m, ...nextMember } : m))
    );
  };

  const erp = useErpStore({ setJournalEntries, isZondaActive, userId: user?.id });

  useDailyBackup({
    enabled: true,
    role: userRole,
    isAuthenticated,
    dbReady,
    snapshot: {
      members,
      reservations,
      journalEntries,
      staffMembers,
      claims,
      messages,
      entryLogs,
      surveys,
      expenses: erp.expenses,
      concessions: erp.concessions,
      clubEvents: erp.clubEvents,
      alerts: erp.alerts,
      cashRegisters: erp.cashRegisters,
      suppliers: erp.suppliers,
      newsList,
      canonPayments: erp.canonPayments,
    },
  });

  useEffect(() => {
    if (!isAuthenticated) hydratedRef.current = false;
  }, [isAuthenticated]);

  // Hidratar desde Supabase tras login
  useEffect(() => {
    if (!cloudMode || !isAuthenticated || authLoading) return undefined;
    if (hydratedRef.current) return undefined;
    let cancelled = false;
    (async () => {
      setDbReady(false);
      setDbError('');
      try {
        const data = await bootstrapFromDb();
        if (cancelled || !data) return;
        const { app, erp: erpData, health, memberDbIds: ids } = data;
        const rawMembers = app.members || [];
        const withDues = applyAutomaticDues(rawMembers);
        setMembers(withDues);
        // Persistir cuotas generadas automáticamente (vencidas sin saldo en BD)
        const duesToPersist = diffAutomaticDues(rawMembers, withDues);
        if (duesToPersist.length) {
          Promise.all(
            duesToPersist.map((m) => repos.upsertMember(m).catch(() => null))
          ).catch(() => {});
        }
        setReservations(app.reservations || []);
        setWaitlist(app.waitlist || []);
        setNewsList(app.newsList || []);
        setRsvpList(app.rsvpList || []);
        setJournalEntries(app.journalEntries || []);
        setStaffMembers(app.staffMembers || []);
        setStaffHrRecords(app.staffHrRecords || []);
        setClaims(app.claims || []);
        setMessages(app.messages || []);
        setEntryLogs(app.entryLogs || []);
        setSurveys(app.surveys || []);
        setGuestPasses(app.guestPasses || []);
        setIsZondaActive(Boolean(app.isZondaActive));
        setMemberDbIds(ids || {});
        if (Array.isArray(app.tierCatalog) && app.tierCatalog.length) {
          setTierCatalog(app.tierCatalog);
          setRuntimeTierCatalog(app.tierCatalog);
        }
        if (Array.isArray(app.disciplineCatalog) && app.disciplineCatalog.length) {
          setDisciplineCatalog(app.disciplineCatalog);
        }
        erp.applyErpHydration({
          ...erpData,
          chartOfAccounts: erpData.chartOfAccounts || [],
          cashRegisters: erpData.cashRegisters || [],
          suppliers: erpData.suppliers || [],
          alerts: erpData.alerts || [],
          clubEvents: erpData.clubEvents || [],
          concessions: erpData.concessions || [],
        });
        setDbHealthy(Boolean(health?.ok));
        hydratedRef.current = true;
      } catch (err) {
        if (!cancelled) setDbError(err.message || 'No se pudo cargar la base de datos');
      } finally {
        if (!cancelled) setDbReady(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudMode, isAuthenticated, authLoading]);

  // Wrappers de escritura BD para setters usados en vistas
  const setEntryLogsDb = (updater) => {
    setEntryLogs((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next) && next.length > prev.length) {
        const newest = next[0];
        const alreadySaved = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          String(newest?.id || '')
        );
        if (newest && !alreadySaved) {
          const dbId = memberDbIds[newest.memberId] || null;
          repos.insertAccessLog(newest, dbId).then((saved) => {
            setEntryLogs((cur) => [saved, ...cur.filter((x) => x !== newest && String(x.id) !== String(newest.id))]);
          }).catch((err) => {
            setDbError(err?.message || 'No se pudo guardar la lectura de acceso en la base de datos');
          });
        }
      }
      return next;
    });
  };

  const isDbUuid = (id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));

  const refreshMessages = useCallback(async () => {
    if (!cloudMode || !isAuthenticated) return;
    try {
      const list = await repos.listMessages();
      setMessages((prev) => {
        const fromDb = list || [];
        const dbIds = new Set(fromDb.map((m) => String(m.id)));
        const dbClientIds = new Set(fromDb.map((m) => m.clientId).filter(Boolean).map(String));
        // Conservar envíos locales aún no confirmados (evita que el poll borre el alta)
        const pending = (prev || []).filter(
          (m) => !isDbUuid(m.id) && !dbIds.has(String(m.id)) && !dbClientIds.has(String(m.id))
        );
        return pending.length ? [...pending, ...fromDb] : fromDb;
      });
    } catch {
      /* silencioso: no pisar bandeja local ante un fallo puntual */
    }
  }, [cloudMode, isAuthenticated]);

  // Envío garantizado a BD (evita “enviado” fantasma si el insert falla)
  const sendMessage = useCallback(async (msg) => {
    if (!msg) throw new Error('Mensaje vacío');
    if (!cloudMode) {
      setMessages((prev) => [msg, ...(prev || [])]);
      return msg;
    }
    setMessages((prev) => [msg, ...(prev || [])]);
    try {
      const saved = await repos.insertMessage(msg);
      setMessages((cur) => [saved, ...(cur || []).filter((x) => String(x.id) !== String(msg.id))]);
      return saved;
    } catch (err) {
      setMessages((cur) => (cur || []).filter((x) => String(x.id) !== String(msg.id)));
      const message = err?.message || 'No se pudo enviar el mensaje a la base de datos';
      setDbError(message);
      throw new Error(message);
    }
  }, [cloudMode]);

  // Campanita / badge: poll + realtime fuera de /mensajes
  useEffect(() => {
    if (!cloudMode || !isAuthenticated || !dbReady) return undefined;
    void refreshMessages();
    const onFocus = () => { void refreshMessages(); };
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshMessages();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    const timer = window.setInterval(() => { void refreshMessages(); }, 12000);

    let channel = null;
    if (supabase) {
      channel = supabase
        .channel('messages-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'messages' },
          () => { void refreshMessages(); }
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(timer);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [cloudMode, isAuthenticated, dbReady, refreshMessages]);

  const setMessagesDb = (updater) => {
    setMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (!cloudMode || !Array.isArray(next)) return next;

      // Alta de mensaje nuevo (id local msg-… / numérico → insert en BD)
      // Preferir sendMessage() desde la UI; este camino queda como fallback.
      if (next.length > prev.length) {
        const newest = next[0];
        if (newest && !isDbUuid(newest.id)) {
          const alreadyPending = prev.some((p) => String(p.id) === String(newest.id));
          if (!alreadyPending) {
            repos.insertMessage(newest).then((saved) => {
              setMessages((cur) => [saved, ...cur.filter((x) => String(x.id) !== String(newest.id))]);
            }).catch((err) => {
              setMessages((cur) => cur.filter((x) => String(x.id) !== String(newest.id)));
              setDbError(err?.message || 'No se pudo enviar el mensaje a la base de datos');
            });
          }
        }
      } else {
        // Marcar leído (broadcasts "all" quedan solo locales: is_read es compartido)
        next.forEach((m) => {
          const old = prev.find((p) => String(p.id) === String(m.id));
          if (old && !old.isRead && m.isRead && isDbUuid(m.id) && m.recipientId !== 'all') {
            repos.updateMessage(m.id, { isRead: true }).catch((err) => {
              setDbError(err?.message || 'No se pudo marcar el mensaje como leído');
            });
          }
        });
      }
      return next;
    });
  };

  const setClaimsDb = (updater) => {
    setClaims((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        if (next.length > prev.length) {
          const newest = next[0];
          const dbId = memberDbIds[newest.memberId];
          repos.upsertClaim(newest, dbId).then((saved) => {
            setClaims((cur) => [saved, ...cur.filter((x) => x.id !== newest.id)]);
          }).catch(() => {});
        } else {
          next.forEach((c) => {
            const old = prev.find((p) => p.id === c.id);
            if (old && JSON.stringify(old) !== JSON.stringify(c) && String(c.id).includes('-')) {
              repos.upsertClaim(c, memberDbIds[c.memberId]).catch(() => {});
            }
          });
        }
      }
      return next;
    });
  };

  const setGuestPassesDb = (updater) => {
    setGuestPasses((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next) && next.length > prev.length) {
        const newest = next[0];
        const hostDb = memberDbIds[newest.hostMemberId];
        repos.upsertGuestPass(newest, hostDb).catch(() => {});
      }
      return next;
    });
  };

  const setWaitlistDb = (updater) => {
    setWaitlist((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        repos.replaceWaitlist(next, memberDbIds).catch(() => {});
      }
      return next;
    });
  };

  const setStaffMembersDb = (updater) => {
    setStaffMembers((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        next.forEach((emp) => {
          const old = prev.find((p) => p.id === emp.id);
          if (!old || JSON.stringify(old) !== JSON.stringify(emp)) {
            repos.upsertEmployee(emp).catch(() => {});
          }
        });
      }
      return next;
    });
  };

  const setStaffHrDb = (updater) => {
    setStaffHrRecords((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next) && next.length > prev.length) {
        const newest = next[0];
        repos.insertHrRecord(newest).then((saved) => {
          setStaffHrRecords((cur) => [saved, ...cur.filter((x) => x.id !== newest.id)]);
        }).catch(() => {});
      }
      return next;
    });
  };

  const setSurveysDb = (updater) => {
    setSurveys((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        const prevById = new Map(prev.map((s) => [String(s.id), s]));
        const nextIds = new Set(next.map((s) => String(s.id)));

        next.forEach((survey) => {
          const old = prevById.get(String(survey.id));
          if (!old) {
            repos.upsertSurvey(survey).then((saved) => {
              setSurveys((cur) =>
                cur.map((x) => (String(x.id) === String(survey.id) ? saved : x))
              );
            }).catch((err) => setDbError(err.message || 'No se pudo guardar la encuesta'));
            return;
          }
          if (JSON.stringify(old) !== JSON.stringify(survey)) {
            repos.upsertSurvey(survey).then((saved) => {
              setSurveys((cur) =>
                cur.map((x) => (String(x.id) === String(saved.id) ? saved : x))
              );
            }).catch((err) => setDbError(err.message || 'No se pudo actualizar la encuesta'));
          }
        });

        prev.forEach((survey) => {
          if (!nextIds.has(String(survey.id))) {
            repos.deleteSurvey(survey.id).catch(() => {});
          }
        });
      }
      return next;
    });
  };

  const setNewsDb = (updater) => {
    setNewsList((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        const prevById = new Map(prev.map((n) => [String(n.id), n]));
        const nextIds = new Set(next.map((n) => String(n.id)));
        const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(String(id || ''));

        next.forEach((article) => {
          const old = prevById.get(String(article.id));
          if (!old) {
            repos.upsertNews(article).then((saved) => {
              setDbError('');
              setNewsList((cur) =>
                cur.map((x) => (String(x.id) === String(article.id) ? saved : x))
              );
            }).catch((err) => setDbError(err.message || 'No se pudo guardar la noticia'));
            return;
          }
          if (JSON.stringify(old) !== JSON.stringify(article)) {
            repos.upsertNews(article).then((saved) => {
              setDbError('');
              setNewsList((cur) =>
                cur.map((x) => (String(x.id) === String(article.id) ? saved : x))
              );
            }).catch((err) => setDbError(err.message || 'No se pudo actualizar la noticia'));
          }
        });

        prev.forEach((article) => {
          if (!nextIds.has(String(article.id))) {
            const id = article.id;
            if (isUuid(id)) {
              repos.deleteNews(id).catch(() => {});
            }
          }
        });
      }
      return next;
    });
  };

  const setMembersDb = (updater) => {
    setMembers((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        const prevIds = new Set(prev.map((m) => m.memberId));
        next.forEach((m) => {
          const old = prev.find((p) => p.memberId === m.memberId);
          if (!old || JSON.stringify(old) !== JSON.stringify(m)) {
            repos.upsertMember(m).then(async (saved) => {
              setMemberDbIds((ids) => ({ ...ids, [saved.memberId]: saved.id }));
              if (!prevIds.has(m.memberId)) {
                setMembers((cur) =>
                  cur.map((x) => (x.memberId === saved.memberId ? { ...x, ...saved } : x))
                );
              }
              // Persistir cobros nuevos (Control de Cuotas / padrón)
              const prevHist = old?.paymentHistory || [];
              const nextHist = m.paymentHistory || [];
              if (nextHist.length > prevHist.length && saved.id) {
                const newest = nextHist[0];
                const looksLocal = newest && !/^[0-9a-f-]{36}$/i.test(String(newest.id || ''));
                if (looksLocal) {
                  try {
                    await repos.insertMemberPayment(saved.id, newest);
                  } catch { /* best-effort */ }
                }
              }
            }).catch(() => {});
          }
        });
      }
      return next;
    });
  };

  const messageIdentity = {
    userId: user?.id,
    memberId: user?.memberId || null,
    role: userRole,
  };
  const unreadMessages = isAuthenticated ? countUnread(messages, messageIdentity) : 0;

  const [dismissedNotifIds, setDismissedNotifIds] = useState(() => loadDismissedNotificationIds());

  // Lecturas de campanita desde BD
  useEffect(() => {
    if (!cloudMode || !isAuthenticated || !dbReady || !user?.id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const keys = await repos.listNotificationReads();
        if (cancelled) return;
        setDismissedNotifIds((prev) => saveDismissedNotificationIds([...prev, ...(keys || [])]));
      } catch {
        /* local sigue como fallback */
      }
    })();
    return () => { cancelled = true; };
  }, [cloudMode, isAuthenticated, dbReady, user?.id]);

  const sessionMember = user?.memberId
    ? members.find((m) => m.memberId === user.memberId) || null
    : null;

  // Campanita: solo datos reales de la sesión (sin semillas / sin socio fallback)
  const notifications = (!isAuthenticated || (cloudMode && !dbReady))
    ? []
    : buildNotifications({
      role: userRole,
      userId: user?.id,
      memberId: user?.memberId || null,
      member: sessionMember,
      messages,
      waitlist,
      claims,
      alerts: erp.alerts || [],
      alertAcks: erp.alertAcks || [],
      dismissedIds: dismissedNotifIds,
    });

  const dismissNotification = useCallback((notifId, notif = null) => {
    if (!notifId) return;
    setDismissedNotifIds((prev) => saveDismissedNotificationIds([...prev, notifId]));
    if (cloudMode && user?.id) {
      repos.markNotificationRead(notifId, user.id).catch(() => {});
    }
    if (notif?.kind === 'message' && notif.messageId) {
      setMessagesDb((prev) => markMessageRead(prev, notif.messageId));
    }
  }, [cloudMode, user?.id]);

  const handleNotificationOpen = useCallback((notif) => {
    if (!notif) return;
    dismissNotification(notif.id, notif);
    if (notif.path) navigate(notif.path);
    else if (notif.view) setCurrentView(notif.view);
  }, [dismissNotification, navigate, setCurrentView]);

  const handleMarkAllNotificationsRead = useCallback(() => {
    const ids = notifications.map((n) => n.id);
    if (!ids.length) return;
    setDismissedNotifIds((prev) => saveDismissedNotificationIds([...prev, ...ids]));
    notifications.forEach((n) => {
      if (n.kind === 'message' && n.messageId) {
        setMessagesDb((prev) => markMessageRead(prev, n.messageId));
      }
    });
    if (cloudMode && user?.id) {
      repos.markNotificationsRead(ids, user.id).catch(() => {});
    }
  }, [notifications, cloudMode, user?.id]);

  // Confirmar/Desconfirmar asistencia a evento (Socio)
  const toggleEventRSVP = async (eventId) => {
    const memberNumber = activeMember?.memberId;
    setRsvpList((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      // Compat: rsvpList puede ser array de ids o de objetos
      const has = list.some((x) => x === eventId || x?.newsId === eventId);
      if (has) {
        return list.filter((x) => x !== eventId && x?.newsId !== eventId);
      }
      const entry = {
        newsId: eventId,
        memberId: memberNumber,
        memberName: activeMember?.name,
        status: 'going',
      };
      if (cloudMode && memberNumber) {
        repos.upsertRsvp(entry, memberDbIds[memberNumber]).then((saved) => {
          setRsvpList((cur) => {
            const base = Array.isArray(cur) ? cur.filter((x) => x !== eventId && x?.newsId !== eventId) : [];
            return [...base, saved];
          });
        }).catch(() => {});
      }
      return [...list, entry];
    });
  };

  // Vistas por rol: los socios ven su portal personal y los roles operativos
  // (cajero, contador, personal, admin) su panel de trabajo, cada una con URL propia.
  const memberDashboard = (
      <DashboardView
        member={activeMember}
        reservations={reservations}
        cancelReservation={cancelReservation}
        addReservation={addReservation}
        setCurrentView={setCurrentView}
        latestNews={newsList}
        staffMembers={staffMembers}
        members={members}
        claims={claims}
        setClaims={setClaimsDb}
        messages={messages}
        setMessages={setMessagesDb}
        isZondaActive={isZondaActive}
        setIsZondaActive={setIsZondaActive}
        surveys={surveys}
        setSurveys={setSurveysDb}
        waitlist={waitlist}
        setWaitlist={setWaitlistDb}
        guestPasses={guestPasses}
        setGuestPasses={setGuestPassesDb}
        updateMember={updateMember}
      />
    );

  const operativePanel = (
      <AdminView
        members={members}
        reservations={reservations}
        setMembers={setMembersDb}
        setReservations={setReservations}
        latestNews={newsList}
        setNewsList={setNewsDb}
        disciplineCatalog={disciplineCatalog}
        setDisciplineCatalog={setDisciplineCatalog}
        tierCatalog={tierCatalog}
        setTierCatalog={setTierCatalog}
        journalEntries={journalEntries}
        setJournalEntries={setJournalEntries}
        addJournalEntry={erp.addPostedEntry}
        staffMembers={staffMembers}
        setStaffMembers={setStaffMembersDb}
        staffHrRecords={staffHrRecords}
        setStaffHrRecords={setStaffHrDb}
        claims={claims}
        setClaims={setClaimsDb}
        messages={messages}
        setMessages={setMessagesDb}
        refreshMessages={refreshMessages}
        sendMessage={sendMessage}
        entryLogs={entryLogs}
        setEntryLogs={setEntryLogsDb}
        surveys={surveys}
        setSurveys={setSurveysDb}
        isOnline={isOnline}
        syncQueue={syncQueue}
        setSyncQueue={setSyncQueue}
        userRole={userRole}
        setCurrentView={setCurrentView}
        erp={erp}
        isZondaActive={isZondaActive}
      />
    );

  const reservationsView = (
    <ReservationsView
      member={activeMember}
      reservations={reservations}
      addReservation={addReservation}
      setCurrentView={setCurrentView}
      isZondaActive={isZondaActive}
      waitlist={waitlist}
      setWaitlist={setWaitlistDb}
    />
  );

  const newsView = (
    <NewsBoardView
      newsList={newsList}
      userRole={canAccessAdmin(userRole) ? 'admin' : 'member'}
      toggleEventRSVP={toggleEventRSVP}
      rsvpList={rsvpList}
    />
  );

  const paymentHistoryView = (
    <PaymentHistoryView
      member={activeMember}
      setCurrentView={setCurrentView}
      updateMember={updateMember}
    />
  );

  const memberProfileView = (
    <MemberProfilePanel
      member={activeMember}
      onBack={() => setCurrentView('dashboard')}
      backLabel="Inicio"
      selfService
      updateMember={updateMember}
      guestPasses={guestPasses}
      setGuestPasses={setGuestPassesDb}
      tierCatalog={tierCatalog}
      formatCurrency={(amount) =>
        new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount || 0)
      }
      journalEntries={journalEntries}
      entryLogs={entryLogs}
      reservations={reservations}
      claims={claims}
      messages={messages}
    />
  );

  if (authLoading || (cloudMode && isAuthenticated && !dbReady)) {
    return (
      <div className="app-container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>
          {authLoading ? 'Cargando sesión…' : 'Sincronizando con la base de datos…'}
        </p>
        {dbError && <p style={{ color: 'var(--danger-accent)', fontSize: '0.85rem' }}>{dbError}</p>}
      </div>
    );
  }

  const isConcessionPortal = location.pathname.startsWith('/concesionario/');

  if (!isAuthenticated) {
    return (
      <div className="app-container">
        <div className="ambient-glow ambient-glow-1" />
        <div className="ambient-glow ambient-glow-2" />
        <main className="main-content">
          {isConcessionPortal ? (
            <Routes>
              <Route
                path="/concesionario/:code"
                element={
                  <ConcessionPortalView
                    code={decodeURIComponent(location.pathname.split('/').pop() || '')}
                    concessions={erp.concessions || []}
                    canonPayments={erp.canonPayments || []}
                  />
                }
              />
              <Route path="*" element={<LoginView />} />
            </Routes>
          ) : (
            <LoginView />
          )}
        </main>
      </div>
    );
  }

  const isAccessGate = location.pathname.startsWith('/acceso');
  const formatCurrency = (amount) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount || 0);

  const accessGateView = canAccessQrGate(userRole) ? (
    <AccessControlView
      members={members}
      entryLogs={entryLogs}
      setEntryLogs={setEntryLogsDb}
      formatCurrency={formatCurrency}
      guestPasses={guestPasses}
    />
  ) : (
    <Navigate to="/panel" replace />
  );

  const concessionsView = canAccessConcessions(userRole) ? (
    <ConcessionsView
      concessions={erp.concessions || []}
      canonPayments={erp.canonPayments || []}
      upsertConcession={erp.upsertConcession}
      renewConcessionContract={erp.renewConcessionContract}
      setConcessionStatus={erp.setConcessionStatus}
      toggleConcessionChecklist={erp.toggleConcessionChecklist}
      addDocToConcession={erp.addDocToConcession}
      removeDocFromConcession={erp.removeDocFromConcession}
      recordCanonPayment={erp.recordCanonPayment}
      renewedBy={user?.fullName || user?.email || 'admin'}
    />
  ) : (
    <Navigate to="/panel" replace />
  );

  return (
    <div className="app-container">
      {/* Luces de Fondo Decorativas Ambientales */}
      <div className="ambient-glow ambient-glow-1" />
      <div className="ambient-glow ambient-glow-2" />

      {!isAccessGate && (
        <Navbar
          currentView={currentView}
          setCurrentView={setCurrentView}
          theme={theme}
          toggleTheme={toggleTheme}
          notifications={notifications}
          unreadMessages={unreadMessages}
          onOpenNotification={handleNotificationOpen}
          onDismissNotification={(id) => {
            const n = notifications.find((x) => String(x.id) === String(id));
            dismissNotification(id, n || null);
          }}
          onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
        />
      )}

      <a href="#contenido-principal" className="skip-link">Saltar al contenido</a>

      {/* Contenido Principal */}
      <main
        id="contenido-principal"
        className="main-content"
        tabIndex={-1}
        style={isAccessGate ? { padding: 0, maxWidth: 'none' } : undefined}
      >
        {!isAccessGate && (
          <>
            <SessionStatusBar members={members} staffMembers={staffMembers} />
            {dbError ? (
              <p className="conc-error" role="alert" aria-live="assertive" style={{ margin: '0 0 0.75rem' }}>
                {dbError}
              </p>
            ) : null}
            <AlertsBanner
              alerts={erp.alerts}
              alertAcks={erp.alertAcks}
              userRole={userRole}
              onAck={(alertId) => erp.ackAlert(alertId, user?.id || 'local-user')}
              excludeSources={['concession_expiry', 'concession_docs']}
            />
          </>
        )}
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={isOperativeRole ? <Navigate to="/panel" replace /> : memberDashboard} />
          <Route path="/reservas" element={userRole === 'member' ? reservationsView : <Navigate to="/panel" replace />} />
          <Route path="/revista" element={userRole === 'member' ? newsView : <Navigate to="/panel" replace />} />
          <Route path="/cuenta" element={userRole === 'member' ? paymentHistoryView : <Navigate to="/panel" replace />} />
          <Route path="/perfil" element={userRole === 'member' ? memberProfileView : <Navigate to="/panel" replace />} />
          <Route
            path="/mensajes"
            element={
              <MessagesView
                messages={messages}
                setMessages={setMessagesDb}
                members={members}
                onRefresh={refreshMessages}
                onSendMessage={sendMessage}
              />
            }
          />
          <Route path="/acceso" element={accessGateView} />
          <Route path="/concesiones" element={concessionsView} />
          <Route
            path="/concesionario/:code"
            element={
              <ConcessionPortalView
                concessions={erp.concessions || []}
                canonPayments={erp.canonPayments || []}
              />
            }
          />
          <Route path="/panel/qr_control" element={<Navigate to="/acceso" replace />} />
          <Route path="/panel/concessions" element={<Navigate to="/concesiones" replace />} />
          <Route path="/panel" element={isOperativeRole ? operativePanel : <Navigate to="/" replace />} />
          <Route path="/panel/:tab/:memberId?" element={isOperativeRole ? operativePanel : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to={isOperativeRole ? '/panel' : '/'} replace />} />
        </Routes>
        </Suspense>
      </main>

      {!isAccessGate && (
        <footer style={{
          textAlign: 'center',
          padding: '2rem 1.5rem',
          borderTop: '1px solid var(--border-glass)',
          color: 'var(--text-muted)',
          fontSize: '0.85rem',
          marginTop: 'auto',
          zIndex: 1,
          position: 'relative',
          background: 'rgba(6, 14, 10, 0.2)'
        }}>
          <p className="serif-font" style={{ fontSize: '1rem', color: 'var(--text-gold)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
            Jockey Club San Juan
          </p>
          <p style={{ marginBottom: '0.35rem' }}>
            República del Líbano 1799 Oeste, Rivadavia · © {new Date().getFullYear()}
          </p>
          <p style={{ fontSize: '0.75rem', marginBottom: '0.35rem' }}>
            Unión de Rugby de Cuyo · Federación Hípica de San Juan
          </p>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Portal institucional v{import.meta.env.VITE_APP_VERSION || '1.0.0'}
            {' · '}
            {cloudMode
              ? (dbHealthy ? 'Base de datos conectada' : (dbError ? `BD: ${dbError}` : 'Base de datos configurada'))
              : 'Entorno local controlado'}
          </p>
        </footer>
      )}
    </div>
  );
}

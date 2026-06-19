import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import DashboardView from './views/DashboardView';
import ReservationsView from './views/ReservationsView';
import NewsBoardView from './views/NewsBoardView';
import AdminView from './views/AdminView';

// Datos de semilla predeterminados para socios de Jockey Club San Juan (con teléfonos 264 y adherentes)
const DEFAULT_MEMBERS = [
  {
    name: 'Alejandro Chávez', // El socio activo predeterminado
    memberId: '2026887744320988',
    phone: '+5492645551234',
    tier: 'royal',
    outstandingBalance: 32000, // Saldo inicial para demostrar el flujo de cobro
    yearsActive: 5,
    status: 'active',
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
    adherents: [
      { id: 'adh-03', name: 'Adolfo Sarmiento (Hijo)', tier: 'platinum', relationship: 'Hijo/a', outstandingBalance: 0, status: 'active' }
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
    adherents: [
      { id: 'adh-04', name: 'Delfina Del Carril', tier: 'gold', relationship: 'Hijo/a', outstandingBalance: 12000, status: 'active' }
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
  }
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
  }
];

// Datos de semilla para el personal de San Juan y bitácora de trazabilidad
const DEFAULT_STAFF = [
  {
    id: 'emp-01',
    name: 'Juan Pérez',
    role: 'Head Greenkeeper',
    specialty: 'Mantenimiento Canchas Rugby, Hockey y Turf',
    status: 'active', 
    currentTask: 'Fertilizando Cancha Principal de Rugby para el Cuyano',
    avatar: 'JP',
    activities: [
      { id: 1, time: '09:15', date: '2026-05-19', description: 'Niveló el cajón de arena de la cancha de vóley playa.' },
      { id: 2, time: '11:30', date: '2026-05-19', description: 'Inspeccionó el sistema de riego en cancha de hockey sobre césped.' },
      { id: 3, time: '14:00', date: '2026-05-19', description: 'Coordinó corte de césped en cancha principal de rugby.' }
    ]
  },
  {
    id: 'emp-02',
    name: 'Carlos Ruiz',
    role: 'Coordinador de Rugby Cuyano',
    specialty: 'Planificación de Partidos e Infantiles',
    status: 'active',
    currentTask: 'Coordinando fixtures con clubes de Mendoza',
    avatar: 'CR',
    activities: [
      { id: 1, time: '08:00', date: '2026-05-19', description: 'Revisión técnica de protectores de postes en cancha 1 y 2.' },
      { id: 2, time: '10:30', date: '2026-05-19', description: 'Organizó cronograma de partidos de infantiles para el fin de semana.' },
      { id: 3, time: '13:00', date: '2026-05-19', description: 'Supervisó entrenamiento liviano de la división juvenil M-17.' }
    ]
  },
  {
    id: 'emp-03',
    name: 'Roberto Gómez',
    role: 'Encargado del Club & Cantina',
    specialty: 'Gastronomía, Cantina y Eventos',
    status: 'active',
    currentTask: 'Organizando stock de bebidas para el Tercer Tiempo',
    avatar: 'RG',
    activities: [
      { id: 1, time: '10:00', date: '2026-05-19', description: 'Supervisó recepción de mercadería para la cantina.' },
      { id: 2, time: '12:30', date: '2026-05-19', description: 'Coordinó el servicio de almuerzo en el quincho de socios.' },
      { id: 3, time: '16:00', date: '2026-05-19', description: 'Alineó personal para el evento gastronómico del Torneo Cordillerano.' }
    ]
  },
  {
    id: 'emp-04',
    name: 'Sofía Álvarez',
    role: 'Directora Hípica y Turf',
    specialty: 'Saltos Hípicos y Pistas de Vareo',
    status: 'active',
    currentTask: 'Inspeccionando cajones y pista de turf para el vareo',
    avatar: 'SA',
    activities: [
      { id: 1, time: '09:00', date: '2026-05-18', description: 'Inspeccionó la altura de los obstáculos en la pista de saltos.' },
      { id: 2, time: '14:00', date: '2026-05-18', description: 'Coordinó con los jinetes locales los horarios de las pistas de equitación.' },
      { id: 3, time: '19:00', date: '2026-05-18', description: 'Cierre del registro de inscritos para el Torneo Cordillerano.' }
    ]
  },
  {
    id: 'emp-05',
    name: 'Martina Benítez',
    role: 'Cajero Central',
    specialty: 'Administración y Cobros',
    status: 'active',
    currentTask: 'Conciliación Caja Diaria',
    avatar: 'MB',
    activities: [
      { id: 1, time: '08:30', date: '2026-05-19', description: 'Apertura de terminal and arqueo inicial de caja.' },
      { id: 2, time: '11:00', date: '2026-05-19', description: 'Procesó pagos de cuotas sociales de socios en secretaría.' },
      { id: 3, time: '15:30', date: '2026-05-19', description: 'Conciliación de transferencias de Banco Nación recibidas.' }
    ]
  }
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
    sender: 'Secretaría JCSJ',
    recipientId: '2026887744320988', // Alejandro Chávez (titular)
    subject: 'Convocatoria a Asamblea Anual Ordinaria en Sede Rivadavia',
    content: 'Estimado socio, le informamos que el próximo 30 de mayo a las 18:00 hs se llevará a cabo la Asamblea Ordinaria en el Salón de Honor de República del Líbano 1799 Oeste. Su presencia es de suma importancia.',
    isRead: false
  },
  {
    id: 2,
    date: '2026-05-15',
    sender: 'Tesorería Jockey Club',
    recipientId: '2026887744320988',
    subject: 'Recordatorio Cuota de Mayo JCSJ',
    content: 'Le recordamos que posee un saldo de cuota social mensual pendiente de cancelación. Puede regularizarlo de manera directa en las terminales del club o mediante transferencia bancaria.',
    isRead: true
  },
  {
    id: 3,
    date: '2026-05-18',
    sender: 'Comisión Hípica JCSJ',
    recipientId: 'all', // Mensaje global
    subject: 'Apertura de Inscripciones Torneo Cordillerano',
    content: 'Se informa a todos los socios activos de las disciplinas de equitación e hipismo que se encuentran abiertas las planillas de inscripción para el prestigioso Torneo Cordillerano de Saltos Hípicos 2026.',
    isRead: false
  }
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
    status: 'granted', // 'granted' o 'denied'
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
  }
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
  // Inicialización de Estados Cargando desde LocalStorage o Valores de Semilla
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('jockey-theme') || 'dark';
  });

  const [userRole, setUserRole] = useState(() => {
    return localStorage.getItem('jockey-role') || 'member'; // 'member' (Socio) o 'admin'
  });

  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard', 'reservations', 'news', 'admin'

  const [members, setMembers] = useState(() => {
    const local = localStorage.getItem('jockey-members');
    return local ? JSON.parse(local) : DEFAULT_MEMBERS;
  });

  const [reservations, setReservations] = useState(() => {
    const local = localStorage.getItem('jockey-reservations');
    return local ? JSON.parse(local) : DEFAULT_RESERVATIONS;
  });

  const [newsList, setNewsList] = useState(() => {
    const local = localStorage.getItem('jockey-news');
    return local ? JSON.parse(local) : DEFAULT_NEWS;
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
    return local ? JSON.parse(local) : DEFAULT_STAFF;
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
    localStorage.setItem('jockey-sync-queue', JSON.stringify(syncQueue));
  }, [syncQueue]);

  // Sincronización automática al recuperar conexión
  useEffect(() => {
    if (isOnline && syncQueue.length > 0) {
      const syncTimeout = setTimeout(() => {
        setSyncQueue([]);
        // Notificación opcional (se manejará visualmente en el admin dashboard)
      }, 2000);
      return () => clearTimeout(syncTimeout);
    }
  }, [isOnline, syncQueue.length]);

  useEffect(() => {
    localStorage.setItem('jockey-zonda', isZondaActive);
  }, [isZondaActive]);

  // Guardar datos en LocalStorage ante cambios
  useEffect(() => {
    localStorage.setItem('jockey-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('jockey-role', userRole);
  }, [userRole]);

  useEffect(() => {
    localStorage.setItem('jockey-members', JSON.stringify(members));
  }, [members]);

  useEffect(() => {
    localStorage.setItem('jockey-reservations', JSON.stringify(reservations));
  }, [reservations]);

  useEffect(() => {
    localStorage.setItem('jockey-news', JSON.stringify(newsList));
  }, [newsList]);

  useEffect(() => {
    localStorage.setItem('jockey-rsvps', JSON.stringify(rsvpList));
  }, [rsvpList]);

  useEffect(() => {
    localStorage.setItem('jockey-journal-entries', JSON.stringify(journalEntries));
  }, [journalEntries]);

  useEffect(() => {
    localStorage.setItem('jockey-staff-members', JSON.stringify(staffMembers));
  }, [staffMembers]);

  // NUEVO: Guardar estados Fase 3
  useEffect(() => {
    localStorage.setItem('jockey-claims', JSON.stringify(claims));
  }, [claims]);

  useEffect(() => {
    localStorage.setItem('jockey-messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('jockey-entry-logs', JSON.stringify(entryLogs));
  }, [entryLogs]);

  useEffect(() => {
    localStorage.setItem('jockey-surveys', JSON.stringify(surveys));
  }, [surveys]);

  // Socio Activo Logueado (Alejandro Chávez)
  const activeMember = members.find(m => m.memberId === '2026887744320988') || members[0];

  // Alternar Tema Claro / Oscuro
  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Agregar una reserva
  const addReservation = (newRes) => {
    const resWithId = {
      ...newRes,
      id: Date.now()
    };
    setReservations(prev => [resWithId, ...prev]);
  };

  // Cancelar una reserva
  const cancelReservation = (resId) => {
    setReservations(prev => 
      prev.map(res => {
        if (res.id === resId) {
          return { ...res, status: 'cancelled' };
        }
        return res;
      })
    );
  };

  // Agregar un asiento diario (Contabilidad)
  const addJournalEntry = (newEntry) => {
    setJournalEntries(prev => [newEntry, ...prev]);
  };

  // Agregar un anuncio/noticia (Admin)
  const addNewsArticle = (newArticle) => {
    setNewsList(prev => [newArticle, ...prev]);
  };

  // Confirmar/Desconfirmar asistencia a evento (Socio)
  const toggleEventRSVP = (eventId) => {
    setRsvpList(prev => {
      if (prev.includes(eventId)) {
        return prev.filter(id => id !== eventId);
      } else {
        return [...prev, eventId];
      }
    });
  };

  // Renderizador condicional de vistas según el enrutamiento y rol
  const renderView = () => {
    switch (currentView) {
      case 'reservations':
        if (userRole !== 'member') {
          setCurrentView('dashboard');
          return null;
        }
        return (
          <ReservationsView 
            member={activeMember}
            reservations={reservations}
            addReservation={addReservation}
            setCurrentView={setCurrentView}
            isZondaActive={isZondaActive}
          />
        );
      case 'news':
        return (
          <NewsBoardView 
            newsList={newsList}
            addNewsArticle={addNewsArticle}
            userRole={userRole}
            member={activeMember}
            toggleEventRSVP={toggleEventRSVP}
            rsvpList={rsvpList}
          />
        );
      case 'admin':
        if (userRole !== 'admin') {
          setCurrentView('dashboard');
          return null;
        }
        return (
          <AdminView 
            members={members}
            reservations={reservations}
            setMembers={setMembers}
            setReservations={setReservations}
            latestNews={newsList}
            journalEntries={journalEntries}
            setJournalEntries={setJournalEntries}
            addJournalEntry={addJournalEntry}
            staffMembers={staffMembers}
            setStaffMembers={setStaffMembers}
            claims={claims}
            setClaims={setClaims}
            messages={messages}
            setMessages={setMessages}
            entryLogs={entryLogs}
            setEntryLogs={setEntryLogs}
            surveys={surveys}
            setSurveys={setSurveys}
            isOnline={isOnline}
            syncQueue={syncQueue}
            setSyncQueue={setSyncQueue}
            userRole={userRole}
            setUserRole={setUserRole}
            setCurrentView={setCurrentView}
          />
        );
      case 'dashboard':
      default:
        return (
          <DashboardView 
            member={activeMember}
            reservations={reservations}
            cancelReservation={cancelReservation}
            setCurrentView={setCurrentView}
            latestNews={newsList}
            staffMembers={staffMembers}
            members={members}
            claims={claims}
            setClaims={setClaims}
            messages={messages}
            setMessages={setMessages}
            isZondaActive={isZondaActive}
            setIsZondaActive={setIsZondaActive}
            surveys={surveys}
            setSurveys={setSurveys}
          />
        );
    }
  };

  return (
    <div className="app-container">
      {/* Luces de Fondo Decorativas Ambientales */}
      <div className="ambient-glow ambient-glow-1" />
      <div className="ambient-glow ambient-glow-2" />

      {/* Barra de Navegación */}
      <Navbar 
        currentView={currentView}
        setCurrentView={setCurrentView}
        userRole={userRole}
        setUserRole={setUserRole}
        theme={theme}
        toggleTheme={toggleTheme}
      />

      {/* Contenido Principal */}
      <main className="main-content">
        {renderView()}
      </main>

      {/* Pie de Página Premium */}
      <footer style={{
        textAlign: 'center',
        padding: '2.5rem 1.5rem',
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
        <p style={{ marginBottom: '0.25rem' }}>© 2026 Todos los derechos reservados. Miembro de la Unión de Rugby de Cuyo y la Federación Hípica de San Juan.</p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Desarrollado para Portal Exclusivo de Socios y Gestión Operativa Interna de Sede Rivadavia.</p>
      </footer>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import DashboardView from './views/DashboardView';
import ReservationsView from './views/ReservationsView';
import NewsBoardView from './views/NewsBoardView';
import AdminView from './views/AdminView';

// Datos de semilla predeterminados para socios
const DEFAULT_MEMBERS = [
  {
    name: 'Alejandro Chávez', // El socio activo predeterminado
    memberId: '2026887744320988',
    tier: 'royal',
    outstandingBalance: 32000, // Saldo inicial para poder demostrar el flujo de cobro
    yearsActive: 5,
    status: 'active'
  },
  {
    name: 'Victoria Ocampo',
    memberId: '2020445599881122',
    tier: 'platinum',
    outstandingBalance: 0,
    yearsActive: 8,
    status: 'active'
  },
  {
    name: 'Adolfo Bioy Casares',
    memberId: '2018776655443322',
    tier: 'royal',
    outstandingBalance: 0,
    yearsActive: 12,
    status: 'active'
  },
  {
    name: 'Bautista Mitre',
    memberId: '2022112233445566',
    tier: 'gold',
    outstandingBalance: 45000,
    yearsActive: 4,
    status: 'active'
  },
  {
    name: 'Isabel de Estrada',
    memberId: '2024990088776655',
    tier: 'gold',
    outstandingBalance: 0,
    yearsActive: 2,
    status: 'active'
  }
];

// Datos de semilla predeterminados para reservas
const DEFAULT_RESERVATIONS = [
  {
    id: 1,
    facilityId: 'golf',
    facilityName: 'Campo de Golf de 18 Hoyos',
    memberId: '2020445599881122',
    memberName: 'Victoria Ocampo',
    date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0], // En 2 días
    time: '09:00',
    guests: 3,
    guestNames: 'Silvina Ocampo, Jorge L. Borges, Bioy Casares',
    status: 'confirmed'
  },
  {
    id: 2,
    facilityId: 'tennis',
    facilityName: 'Canchas de Tenis de Arcilla',
    memberId: '2022112233445566',
    memberName: 'Bautista Mitre',
    date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Mañana
    time: '17:00',
    guests: 1,
    guestNames: 'Facundo Mitre',
    status: 'confirmed'
  }
];

// Datos de semilla predeterminados para noticias/revista digital
const DEFAULT_NEWS = [
  {
    id: 101,
    title: 'Gran Copa de Oro del Jockey Club: Torneo Anual de Polo',
    category: 'deportes',
    date: '18 May 2026',
    excerpt: 'Este fin de semana se dará inicio al campeonato de polo más prestigioso de nuestra institución hípica, reuniendo a los mejores equipos de la región.',
    content: 'Nos enorgullece anunciar la apertura de las inscripciones para la histórica Copa de Oro del Jockey Club. El evento de lanzamiento se llevará a cabo el sábado a las 14:00 hs en la pista central de hípica, seguido del partido inaugural. Los socios con categoría Royal contarán con acceso preferencial al sector VIP. Es obligatorio vestir atuendo de etiqueta deportiva para presenciar la final dominical.',
    image: 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?q=80&w=600&auto=format&fit=crop',
    isEvent: true
  },
  {
    id: 102,
    title: 'Gala de Invierno 2026: Noche Solidaria en The Pavilion',
    category: 'eventos',
    date: '15 May 2026',
    excerpt: 'La tradicional Gala de Beneficencia tendrá lugar el próximo 20 de junio. Disfrutaremos de un concierto de cámara y una subasta de arte de primer nivel.',
    content: 'El comité organizador invita a toda la comunidad de socios a formar parte de nuestra tradicional Gala de Invierno. Las reservas de cubiertos y mesas exclusivas ya se encuentran disponibles en la secretaría del club. Contaremos con un menú de pasos diseñado especialmente por nuestro Chef Ejecutivo y una degustación de etiquetas premiadas de nuestra cava privada. Todo lo recaudado será destinado a obras benéficas de equinoterapia.',
    image: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?q=80&w=600&auto=format&fit=crop',
    isEvent: true
  },
  {
    id: 103,
    title: 'Nueva Carta Gourmet de Otoño-Invierno en Sede Central',
    category: 'gourmet',
    date: '10 May 2026',
    excerpt: 'El Chef Ejecutivo presenta una propuesta que rinde homenaje a los sabores autóctonos patagónicos con técnicas de vanguardia culinaria europea.',
    content: 'El restaurante insignia del club, The Pavilion, se complace en invitar a los socios a descubrir su nueva carta de estación. Platos destacados como el rack de cordero patagónico en costra de hierbas finas y los risottos trufados de hongos silvestres prometen una experiencia sensorial memorable. Recuerde reservar su mesa con anticipación dada la alta demanda para las noches de fin de semana.',
    image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?q=80&w=600&auto=format&fit=crop',
    isEvent: false
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
          Jockey Club de Buenos Aires S.A.
        </p>
        <p style={{ marginBottom: '0.25rem' }}>© 2026 Todos los derechos reservados. Miembro Oficial de la Comisión Hípica Nacional.</p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Desarrollado para Portal Exclusivo de Socios y Gestión Operativa Interna de Sede.</p>
      </footer>
    </div>
  );
}

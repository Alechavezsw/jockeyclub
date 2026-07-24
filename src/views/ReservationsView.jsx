import { useState } from 'react';
import {
  Clock, Users, Shield, CheckCircle2, ChevronRight, X, AlertCircle,
  Wind, Thermometer, ShieldAlert, Sparkles, Utensils, Award
} from 'lucide-react';
import { hasReservationConflict } from '../domain/reservations/conflicts';

const FACILITIES = [
  // 1. Deportes de Cancha
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
    isOutdoor: true
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
    isOutdoor: true
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
    isOutdoor: true
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
    isOutdoor: true
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
    isOutdoor: true
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
    isOutdoor: true
  },

  // 2. Área Hípica & Turf
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
    isOutdoor: true
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
    isOutdoor: true
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
    isOutdoor: true
  },

  // 3. Fitness & Bienestar
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
    isOutdoor: false
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
    isOutdoor: true
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
    isOutdoor: false
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
    isOutdoor: false
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
    isOutdoor: false
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
    isOutdoor: false
  },

  // 4. Playa & Temporada
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
    isSeasonal: true
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
    isOutdoor: true
  },

  // 5. Gastronomía & Social
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
    isOutdoor: false
  }
];

export default function ReservationsView({ member, reservations, addReservation, setCurrentView, isZondaActive }) {
  const [activeTab, setActiveTab] = useState('cancha');
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [guests, setGuests] = useState(0);
  const [guestNames, setGuestNames] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];

  const handleOpenModal = (facility) => {
    // Si la piscina está cerrada en invierno o si hay viento Zonda y es al aire libre, no permitir abrir modal
    if (facility.isSeasonal) {
      return;
    }
    if (facility.isOutdoor && isZondaActive) {
      return;
    }
    
    setSelectedFacility(facility);
    setDate(todayStr);
    setTime('');
    setGuests(0);
    setGuestNames('');
    setErrorMessage('');
    setBookingSuccess(false);
  };

  const handleCloseModal = () => {
    setSelectedFacility(null);
  };

  const isSlotTaken = (facilityId, checkDate, checkTime) =>
    hasReservationConflict(reservations, { facilityId, date: checkDate, time: checkTime });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!date) {
      setErrorMessage('Por favor, selecciona una fecha.');
      return;
    }
    if (!time) {
      setErrorMessage('Por favor, selecciona un horario disponible.');
      return;
    }

    // Doble verificación del clima
    if (selectedFacility.isOutdoor && isZondaActive) {
      setErrorMessage('Reserva denegada: Las actividades al aire libre se encuentran suspendidas por Alerta de Viento Zonda.');
      return;
    }

    if (isSlotTaken(selectedFacility.id, date, time)) {
      setErrorMessage('Lo sentimos, este turno acaba de ser reservado. Por favor, selecciona otro.');
      return;
    }

    const newReservation = {
      facilityId: selectedFacility.id,
      facilityName: selectedFacility.name,
      memberId: member.memberId,
      memberName: member.name,
      date,
      time,
      guests: parseInt(guests),
      guestNames: guests > 0 ? guestNames : '',
      status: 'confirmed'
    };

    const result = addReservation(newReservation);
    if (result && result.ok === false) {
      setErrorMessage(result.error);
      return;
    }
    setBookingSuccess(true);
    setErrorMessage('');

    setTimeout(() => {
      handleCloseModal();
      setCurrentView('dashboard');
    }, 2000);
  };

  // Filtrar instalaciones de acuerdo al tab activo
  const filteredFacilities = FACILITIES.filter(fac => fac.category === activeTab);

  return (
    <div className="fade-in">
      <style>{`
        .category-tabs-container {
          display: flex;
          gap: 0.75rem;
          overflow-x: auto;
          padding: 0.5rem 0.25rem;
          margin-bottom: 2rem;
          scrollbar-width: none; /* Firefox */
        }
        .category-tabs-container::-webkit-scrollbar {
          display: none; /* Safari and Chrome */
        }
        .tab-button {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-glass);
          color: var(--text-secondary);
          padding: 0.75rem 1.5rem;
          border-radius: 30px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: inherit;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .tab-button:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: var(--border-glass-hover);
          color: var(--text-primary);
          transform: translateY(-1px);
        }
        .tab-button.active {
          background: linear-gradient(135deg, var(--primary-gold) 0%, #b8860b 100%);
          border-color: var(--primary-gold);
          color: #060e0a;
          box-shadow: 0 4px 15px rgba(207, 161, 58, 0.3);
        }
        
        .sport-card {
          position: relative;
          overflow: hidden;
          border-radius: 12px;
          background-size: cover;
          background-position: center;
          height: 300px;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          border: 1px solid var(--border-glass);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }
        .sport-card.suspended {
          cursor: not-allowed;
        }
        .sport-card:not(.suspended):hover {
          transform: translateY(-4px);
          border-color: var(--primary-gold);
          box-shadow: 0 10px 25px rgba(207, 161, 58, 0.15);
        }
        .sport-info {
          background: linear-gradient(to top, rgba(6, 14, 10, 0.95) 0%, rgba(6, 14, 10, 0.7) 70%, rgba(6, 14, 10, 0) 100%);
          padding: 1.5rem;
          width: 100%;
          box-sizing: border-box;
          z-index: 1;
        }
        
        .suspension-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(6, 14, 10, 0.88);
          backdrop-filter: blur(4px);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 1.5rem;
          text-align: center;
          z-index: 2;
          transition: all 0.3s ease;
          border-radius: 11px;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .suspension-overlay h4 {
          color: var(--danger-accent);
          font-size: 1.05rem;
          margin-bottom: 0.4rem;
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-weight: 700;
        }
        .suspension-overlay p {
          color: var(--text-secondary);
          font-size: 0.78rem;
          line-height: 1.4;
          max-width: 250px;
        }

        .winter-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(6, 14, 10, 0.88);
          backdrop-filter: blur(4px);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 1.5rem;
          text-align: center;
          z-index: 2;
          transition: all 0.3s ease;
          border-radius: 11px;
          border: 1px solid rgba(207, 161, 58, 0.2);
        }
        .winter-overlay h4 {
          color: var(--text-gold);
          font-size: 1.05rem;
          margin-bottom: 0.4rem;
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-weight: 700;
        }
        .winter-overlay p {
          color: var(--text-secondary);
          font-size: 0.78rem;
          line-height: 1.4;
          max-width: 250px;
        }
        
        .zonda-warning-header {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid var(--danger-accent);
          border-radius: 12px;
          padding: 1rem 1.25rem;
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
          color: var(--danger-accent);
          font-size: 0.85rem;
          line-height: 1.4;
          margin-bottom: 1.5rem;
        }
      `}</style>

      <div className="page-header">
        <div>
          <h1 className="page-title">Instalaciones & Reservas Deportivas</h1>
          <p className="page-subtitle">
            Solicitud de turnos y entrenamiento en las 18 disciplinas y servicios del Jockey Club San Juan • Sede Rivadavia
          </p>
        </div>
      </div>

      {/* Alerta Global de Viento Zonda en Reservas */}
      {isZondaActive && (
        <div className="zonda-warning-header fade-in">
          <Wind size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ display: 'block', color: 'var(--text-strong)', marginBottom: '0.2rem', fontSize: '0.95rem' }}>
              ⚠️ RESTRICCIÓN ACTIVA: VIENTO ZONDA EN RIVADAVIA
            </strong>
            Debido a las fuertes ráfagas y el polvo en suspensión, las actividades y reservas en canchas y pistas al aire libre se encuentran **suspendidas** temporalmente. Puede continuar reservando las disciplinas en salones climatizados y gimnasio cubierto.
          </div>
        </div>
      )}

      {/* Pestañas de Categoría */}
      <div className="category-tabs-container">
        <button 
          className={`tab-button ${activeTab === 'cancha' ? 'active' : ''}`}
          onClick={() => setActiveTab('cancha')}
        >
          <Award size={16} /> Deportes de Cancha
        </button>
        <button 
          className={`tab-button ${activeTab === 'hipica' ? 'active' : ''}`}
          onClick={() => setActiveTab('hipica')}
        >
          <Sparkles size={16} /> Área Hípica & Turf
        </button>
        <button 
          className={`tab-button ${activeTab === 'fitness' ? 'active' : ''}`}
          onClick={() => setActiveTab('fitness')}
        >
          <Shield size={16} /> Fitness & Bienestar
        </button>
        <button 
          className={`tab-button ${activeTab === 'temporada' ? 'active' : ''}`}
          onClick={() => setActiveTab('temporada')}
        >
          <Thermometer size={16} /> Playa & Temporada
        </button>
        <button 
          className={`tab-button ${activeTab === 'gastronomia' ? 'active' : ''}`}
          onClick={() => setActiveTab('gastronomia')}
        >
          <Utensils size={16} /> Gastronomía & Social
        </button>
      </div>

      {/* Grilla de Deportes / Instalaciones */}
      <div className="sports-grid">
        {filteredFacilities.map(fac => {
          const isSuspendedZonda = fac.isOutdoor && isZondaActive;
          const isSuspendedSeasonal = fac.isSeasonal; // La piscina olímpica de verano en invierno
          const isCardDisabled = isSuspendedZonda || isSuspendedSeasonal;

          return (
            <div 
              key={fac.id} 
              className={`sport-card ${isCardDisabled ? 'suspended' : ''}`} 
              style={{ backgroundImage: `url(${fac.image})` }}
              onClick={() => !isCardDisabled && handleOpenModal(fac)}
            >
              {/* Capa de Suspensión por Viento Zonda */}
              {isSuspendedZonda && (
                <div className="suspension-overlay fade-in">
                  <Wind size={32} style={{ color: 'var(--danger-accent)', marginBottom: '0.4rem' }} />
                  <h4>Zonda Suspendido</h4>
                  <p>Cancha al aire libre inhabilitada por ráfagas secas e inseguras en Rivadavia.</p>
                </div>
              )}

              {/* Capa de Suspensión Estacional (Invierno) */}
              {isSuspendedSeasonal && (
                <div className="winter-overlay fade-in">
                  <ShieldAlert size={32} style={{ color: 'var(--text-gold)', marginBottom: '0.4rem' }} />
                  <h4>Cerrado por Invierno</h4>
                  <p>Piscina de Verano & Playa inhabilitadas en temporada invernal (Apertura Diciembre).</p>
                </div>
              )}

              <div className="sport-info">
                <h3 className="serif-font sport-title">{fac.name}</h3>
                <p className="sport-desc">{fac.description}</p>
                
                <div className="sport-meta">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Clock size={12} /> {fac.hours}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Users size={12} /> {fac.capacity}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-gold)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {fac.isOutdoor ? 'Al Aire Libre' : 'Instalación Cubierta'}
                  </span>
                  <button 
                    className={`btn btn-sm ${isCardDisabled ? 'btn-secondary' : 'btn-primary'}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 1rem' }}
                    disabled={isCardDisabled}
                  >
                    {isCardDisabled ? 'Inhabilitado' : 'Reservar'} <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de Reserva */}
      {selectedFacility && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ width: '90%', maxWidth: '580px', background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
              <div>
                <h3 className="serif-font" style={{ fontSize: '1.4rem', color: 'var(--text-primary)' }}>Reservar Turno</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-gold)', marginTop: '0.1rem' }}>{selectedFacility.name}</p>
              </div>
              <button 
                onClick={handleCloseModal} 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {bookingSuccess ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                  <CheckCircle2 size={56} style={{ color: 'var(--emerald-accent)' }} />
                  <div>
                    <h4 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                      Reserva Confirmada Exitosamente
                    </h4>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      Tu turno en {selectedFacility.name} para el <strong>{date}</strong> a las <strong>{time} hs</strong> ha sido registrado en su credencial de socio.
                    </p>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--primary-gold)', fontStyle: 'italic', marginTop: '1rem' }}>
                    Redirigiéndote al inicio...
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* Selector de Fecha */}
                  <div className="form-group">
                    <label className="form-label">Seleccione Fecha</label>
                    <input 
                      type="date" 
                      className="form-input" 
                      value={date}
                      min={todayStr}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setTime(''); // resetear horario al cambiar fecha
                      }}
                      required
                    />
                  </div>

                  {/* Selector de Turno de Horario */}
                  <div className="form-group">
                    <label className="form-label">Horarios Disponibles para {date}</label>
                    <div className="time-grid">
                      {selectedFacility.slots.map(slot => {
                        const taken = isSlotTaken(selectedFacility.id, date, slot);
                        const isSelected = time === slot;

                        return (
                          <div 
                            key={slot}
                            className={`time-slot ${taken ? 'disabled' : ''} ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              if (!taken) setTime(slot);
                            }}
                          >
                            {slot}
                          </div>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      * Los turnos tachados ya han sido reservados por otros socios.
                    </p>
                  </div>

                  {/* Selector de Acompañantes */}
                  <div className="res-guests-row" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '1rem', alignItems: 'end' }}>
                    <style>{`@media (max-width: 520px) { .res-guests-row { grid-template-columns: 1fr !important; } }`}</style>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Invitados</label>
                      <select 
                        className="form-input"
                        value={guests}
                        onChange={(e) => setGuests(parseInt(e.target.value))}
                        style={{ padding: '0.7rem' }}
                      >
                        {[...Array(selectedFacility.guestLimit + 1).keys()].map(num => (
                          <option key={num} value={num} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                            {num} {num === 1 ? 'invitado' : 'invitados'}
                          </option>
                        ))}
                      </select>
                    </div>

                    {guests > 0 && (
                      <div className="form-group fade-in" style={{ marginBottom: 0 }}>
                        <label className="form-label">Nombres de los Invitados</label>
                        <input 
                          type="text" 
                          placeholder="Ej: Juan Pérez, María Gómez" 
                          className="form-input"
                          value={guestNames}
                          onChange={(e) => setGuestNames(e.target.value)}
                          required
                        />
                      </div>
                    )}
                  </div>

                  {errorMessage && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-accent)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.85rem' }}>
                      <AlertCircle size={16} style={{ flexShrink: 0 }} />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border-glass)', margin: '0.5rem 0' }} />

                  {/* Botones de control */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                    <button 
                      type="button" 
                      onClick={handleCloseModal} 
                      className="btn btn-secondary"
                      style={{ padding: '0.6rem 1.25rem' }}
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit" 
                      className="btn btn-primary"
                      style={{ padding: '0.6rem 1.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <Shield size={16} /> Confirmar Reserva
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

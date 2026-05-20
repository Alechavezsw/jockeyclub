import React, { useState } from 'react';
import { Calendar, Clock, Users, Shield, CheckCircle2, ChevronRight, X, AlertCircle } from 'lucide-react';

const FACILITIES = [
  {
    id: 'polo',
    name: 'Club de Hípica y Polo',
    description: 'Pistas de nivel internacional, caballerizas premium y campos de polo profesionales para práctica y adiestramiento de élite.',
    image: 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 18:00',
    capacity: '12 jinetes',
    slots: ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00'],
    guestLimit: 3
  },
  {
    id: 'golf',
    name: 'Campo de Golf de 18 Hoyos',
    description: 'Exclusivo campo par 72 rodeado de lagos y arbolado centenario. Diseñado para ofrecer desafíos tácticos con un paisajismo de ensueño.',
    image: 'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?q=80&w=600&auto=format&fit=crop',
    hours: '07:00 - 17:00',
    capacity: 'Línea de 4 jugadores',
    slots: ['07:30', '09:00', '10:30', '12:00', '13:30', '15:00'],
    guestLimit: 3
  },
  {
    id: 'tennis',
    name: 'Canchas de Tenis de Arcilla',
    description: 'Ocho canchas de polvo de ladrillo profesional mantenidas con estándares de la ATP, iluminadas con tecnología LED de última generación.',
    image: 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?q=80&w=600&auto=format&fit=crop',
    hours: '08:00 - 22:00',
    capacity: 'Singles o Dobles',
    slots: ['08:00', '10:00', '12:00', '15:00', '17:00', '19:00', '20:30'],
    guestLimit: 3
  },
  {
    id: 'pool',
    name: 'Piscina Olímpica y Solárium',
    description: 'Piscina climatizada de 50 metros con andariveles dedicados al nado libre y un solárium de mármol travertino para un descanso premium.',
    image: 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?q=80&w=600&auto=format&fit=crop',
    hours: '06:00 - 22:00',
    capacity: 'Andariveles individuales',
    slots: ['07:00', '09:00', '11:00', '13:00', '15:00', '17:00', '19:00'],
    guestLimit: 2
  },
  {
    id: 'restaurant',
    name: 'Restaurante The Pavilion',
    description: 'Cocina gourmet de autor fusionando especialidades locales con gastronomía internacional. Incluye cava privada con los mejores varietales del mundo.',
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=600&auto=format&fit=crop',
    hours: '12:00 - 23:30',
    capacity: 'Mesas exclusivas para socios',
    slots: ['12:30', '14:00', '20:30', '21:30', '22:30'],
    guestLimit: 6
  }
];

export default function ReservationsView({ member, reservations, addReservation, setCurrentView }) {
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [guests, setGuests] = useState(0);
  const [guestNames, setGuestNames] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Obtener fecha mínima (hoy) para el selector de fecha
  const todayStr = new Date().toISOString().split('T')[0];

  const handleOpenModal = (facility) => {
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

  // Comprobar si un turno específico ya está reservado por otros socios en esa fecha
  const isSlotTaken = (facilityId, checkDate, checkTime) => {
    return reservations.some(res => 
      res.facilityId === facilityId && 
      res.date === checkDate && 
      res.time === checkTime &&
      res.status !== 'cancelled'
    );
  };

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

    // Verificar si ya está tomado (doble verificación preventiva)
    if (isSlotTaken(selectedFacility.id, date, time)) {
      setErrorMessage('Lo sentimos, este turno acaba de ser reservado. Por favor, selecciona otro.');
      return;
    }

    // Agregar la reserva
    const newReservation = {
      facilityId: selectedFacility.id,
      facilityName: selectedFacility.name,
      memberId: member.memberId,
      memberName: member.name,
      date,
      time,
      guests: parseInt(guests),
      guestNames: guests > 0 ? guestNames : '',
      status: 'confirmed' // Las reservas de socios se confirman por defecto en este prototipo premium
    };

    addReservation(newReservation);
    setBookingSuccess(true);
    setErrorMessage('');

    // Cerrar el modal y volver al inicio tras un delay agradable
    setTimeout(() => {
      handleCloseModal();
      setCurrentView('dashboard');
    }, 2000);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Instalaciones y Reservas</h1>
          <p className="page-subtitle">Agenda turnos para actividades deportivas y gastronomía exclusiva de socios</p>
        </div>
      </div>

      <div className="sports-grid" style={{ marginTop: '1rem' }}>
        {FACILITIES.map(fac => (
          <div 
            key={fac.id} 
            className="sport-card" 
            style={{ backgroundImage: `url(${fac.image})` }}
            onClick={() => handleOpenModal(fac)}
          >
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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' }}>Exclusivo Socios</span>
                <button 
                  className="btn btn-primary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 1rem' }}
                >
                  Reservar <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de Reserva */}
      {selectedFacility && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ width: '90%', maxWidth: '580px', background: 'var(--bg-secondary)' }}>
            <div className="modal-header">
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
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '1rem', alignItems: 'end' }}>
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

                  {/* Botón Guardar */}
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

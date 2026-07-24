import { Clock } from 'lucide-react';

/** Libro de reservas: aprobación, anulación y reactivación de turnos. */
export default function BookingsTab({ reservations, setReservations }) {
  const handleUpdateReservationStatus = (resId, newStatus) => {
    setReservations(reservations.map(res => {
      if (res.id === resId) {
        return { ...res, status: newStatus };
      }
      return res;
    }));
  };

  return (
    <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <h3 className="serif-font" style={{ fontSize: '1.4rem' }}>Libro de Reservas Activo</h3>
      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Socio</th>
              <th>Instalación</th>
              <th>Fecha Reservada</th>
              <th>Horario hs</th>
              <th>Acompañantes</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Gestión</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map(res => (
              <tr key={res.id}>
                <td>
                  <strong>{res.memberName}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {res.memberId.slice(0, 8)}...</div>
                </td>
                <td>
                  <span style={{ color: 'var(--text-gold)', fontWeight: '600' }}>{res.facilityName}</span>
                </td>
                <td>{res.date}</td>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: '500' }}>
                    <Clock size={12} /> {res.time}
                  </span>
                </td>
                <td>
                  {res.guests > 0 ? (
                    <span title={res.guestNames} style={{ cursor: 'help', textDecoration: 'underline dotted var(--text-muted)' }}>
                      {res.guests} ({res.guestNames || 'Sin registrar'})
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Solo</span>
                  )}
                </td>
                <td>
                  <span className={`status-tag ${res.status}`}>
                    {res.status === 'confirmed' ? 'Confirmado' : res.status === 'pending' ? 'Pendiente' : 'Cancelado'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                    {res.status === 'pending' && (
                      <button
                        onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                        className="btn btn-secondary btn-sm"
                        style={{
                          borderColor: 'var(--emerald-accent)', color: 'var(--emerald-accent)',
                          background: 'rgba(16, 185, 129, 0.05)', padding: '0.35rem 0.75rem'
                        }}
                      >
                        Aprobar
                      </button>
                    )}
                    {res.status !== 'cancelled' && (
                      <button
                        onClick={() => handleUpdateReservationStatus(res.id, 'cancelled')}
                        className="btn btn-danger btn-sm"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        Anular
                      </button>
                    )}
                    {res.status === 'cancelled' && (
                      <button
                        onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        Reactivar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { PartyPopper, Users } from 'lucide-react';
import { countRegistrations } from '../../domain/events/clubEvents';
import { formatCurrency } from '../../domain/accounting/journal';

export default function ClubEventsPanel({
  clubEvents,
  eventRegistrations,
  members,
  addClubEvent,
  registerMemberToEvent,
}) {
  const [form, setForm] = useState({
    title: '',
    category: 'fiesta',
    description: '',
    location: 'Sede Rivadavia',
    startsAt: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 16),
    capacity: '100',
    ticketPrice: '0',
  });
  const [regForm, setRegForm] = useState({ eventId: '', memberId: '', guestsCount: '1' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h4 className="serif-font" style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <PartyPopper size={18} /> Fiestas y Eventos
        </h4>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Registro de eventos, cupos, inscripciones y cobro contable automático.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addClubEvent({
            ...form,
            startsAt: new Date(form.startsAt).toISOString(),
            capacity: form.capacity,
            ticketPrice: form.ticketPrice,
          });
          setMsg('Evento creado.');
          setForm((f) => ({ ...f, title: '', description: '' }));
        }}
        style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Título</label>
          <input className="form-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Categoría</label>
          <select className="form-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="fiesta">Fiesta</option>
            <option value="deportes">Deportes</option>
            <option value="institucional">Institucional</option>
            <option value="hipica">Hípica</option>
          </select>
        </div>
        <div>
          <label className="form-label">Inicio</label>
          <input type="datetime-local" className="form-input" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Cupo</label>
          <input type="number" min="1" className="form-input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Precio entrada</label>
          <input type="number" min="0" className="form-input" value={form.ticketPrice} onChange={(e) => setForm({ ...form, ticketPrice: e.target.value })} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Descripción</label>
          <textarea className="form-input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <button type="submit" className="btn btn-primary btn-sm">Crear evento</button>
        </div>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          setMsg('');
          try {
            registerMemberToEvent({
              eventId: regForm.eventId || clubEvents[0]?.id,
              memberId: regForm.memberId || members[0]?.memberId,
              guestsCount: regForm.guestsCount,
            });
            setMsg('Inscripción registrada. Si tenía costo, se generó el asiento.');
          } catch (err) {
            setError(err.message);
          }
        }}
        style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        <div>
          <label className="form-label">Evento</label>
          <select className="form-input" value={regForm.eventId || clubEvents[0]?.id || ''} onChange={(e) => setRegForm({ ...regForm, eventId: e.target.value })}>
            {clubEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.title}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Socio</label>
          <select className="form-input" value={regForm.memberId || members[0]?.memberId || ''} onChange={(e) => setRegForm({ ...regForm, memberId: e.target.value })}>
            {members.map((m) => (
              <option key={m.memberId} value={m.memberId}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Personas</label>
          <input type="number" min="1" className="form-input" value={regForm.guestsCount} onChange={(e) => setRegForm({ ...regForm, guestsCount: e.target.value })} />
        </div>
        <div style={{ display: 'flex', alignItems: 'end' }}>
          <button type="submit" className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={14} /> Inscribir
          </button>
        </div>
      </form>

      {msg && <p style={{ color: 'var(--emerald-accent)' }}>{msg}</p>}
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {clubEvents.map((ev) => {
          const used = countRegistrations(eventRegistrations, ev.id);
          return (
            <div key={ev.id} style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '0.35rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <strong className="serif-font" style={{ fontSize: '1.05rem' }}>{ev.title}</strong>
                <span style={{ color: 'var(--text-gold)', fontSize: '0.85rem' }}>{ev.category}</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{ev.description}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {new Date(ev.startsAt).toLocaleString('es-AR')} · {ev.location}
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.85rem', marginTop: 4 }}>
                <span>Entrada: <strong>{ev.ticketPrice > 0 ? formatCurrency(ev.ticketPrice) : 'Libre'}</strong></span>
                <span>Cupos: <strong>{used}{ev.capacity ? ` / ${ev.capacity}` : ''}</strong></span>
                <span>Estado: <strong>{ev.status}</strong></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

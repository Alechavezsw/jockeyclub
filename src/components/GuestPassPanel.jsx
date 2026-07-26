import { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { UserPlus, Trash2, Ticket } from 'lucide-react';
import {
  createGuestPass,
  isGuestPassValid,
  revokeGuestPass,
} from '../domain/credentials/guestPass';

export default function GuestPassPanel({
  member,
  guestPasses = [],
  setGuestPasses,
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  const mine = useMemo(
    () =>
      (guestPasses || []).filter(
        (p) => p.hostMemberId === member?.memberId && p.date === today
      ),
    [guestPasses, member?.memberId, today]
  );

  const active = mine.filter((p) => isGuestPassValid(p, { today }));

  const add = (e) => {
    e.preventDefault();
    setError('');
    try {
      const pass = createGuestPass({
        hostMemberId: member.memberId,
        hostName: member.name,
        guestName: name,
        date: today,
        existing: guestPasses,
      });
      setGuestPasses((prev) => [pass, ...(prev || [])]);
      setName('');
    } catch (err) {
      setError(err.message || 'No se pudo crear el pase.');
    }
  };

  return (
    <div className="guest-pass">
      <header className="guest-pass-head">
        <Ticket size={18} />
        <div>
          <h3>Invitados del día</h3>
          <p>QR temporal válido solo para hoy ({today.split('-').reverse().join('/')})</p>
        </div>
      </header>

      <form className="guest-pass-form" onSubmit={add}>
        <input
          className="form-input"
          placeholder="Nombre del invitado"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm">
          <UserPlus size={14} /> Generar QR
        </button>
      </form>
      {error && <p className="guest-pass-error">{error}</p>}

      <div className="guest-pass-grid">
        {active.length === 0 && (
          <p className="guest-pass-empty">Sin invitados activos hoy (máx. 3).</p>
        )}
        {active.map((pass) => (
          <article key={pass.id} className="guest-pass-card">
            <div className="guest-pass-qr">
              <QRCodeSVG value={pass.payload} size={96} level="M" />
            </div>
            <div>
              <strong>{pass.guestName}</strong>
              <span>Anfitrión: {pass.hostName}</span>
              <span>Válido: hoy</span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setGuestPasses((prev) => revokeGuestPass(prev, pass.id))}
              >
                <Trash2 size={12} /> Revocar
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

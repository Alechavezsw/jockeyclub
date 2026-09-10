import { randomCredentialToken } from './qr';

/** Pases de invitado del día (QR temporal). */

function todayISO(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function buildGuestPassPayload(pass) {
  const token = pass?.token ? `:${pass.token}` : '';
  return `JCSJ-GUEST:${pass?.id || ''}:${pass?.hostMemberId || ''}:${pass?.date || ''}${token}`;
}

export function parseGuestPassPayload(raw) {
  if (!raw || !String(raw).startsWith('JCSJ-GUEST:')) return null;
  const parts = String(raw).split(':');
  const id = parts[1];
  const hostMemberId = parts[2];
  const date = parts[3];
  const token = parts[4] || null;
  if (!id || !hostMemberId || !date) return null;
  return { id, hostMemberId, date, token, signed: Boolean(token) };
}

export function createGuestPass({
  hostMemberId,
  hostName,
  guestName,
  date = todayISO(),
  maxGuests = 3,
  existing = [],
}) {
  const name = String(guestName || '').trim();
  if (!name) throw new Error('Indicá el nombre del invitado.');
  if (!hostMemberId) throw new Error('Socio anfitrión requerido.');

  const todayPasses = (existing || []).filter(
    (p) => p.hostMemberId === hostMemberId && p.date === date && p.status !== 'revoked'
  );
  if (todayPasses.length >= maxGuests) {
    throw new Error(`Máximo ${maxGuests} invitados por día.`);
  }

  const id = `gp-${Date.now().toString(36)}`;
  const token = randomCredentialToken();
  return {
    id,
    hostMemberId,
    hostName: hostName || '',
    guestName: name,
    date,
    token,
    createdAt: new Date().toISOString(),
    status: 'active',
    payload: buildGuestPassPayload({ id, hostMemberId, date, token }),
  };
}

export function isGuestPassValid(pass, { today = todayISO(), parsed } = {}) {
  if (!pass || pass.status === 'revoked') return false;
  if (pass.date !== today) return false;
  if (pass.token) {
    if (!parsed?.token || parsed.token !== pass.token) return false;
  }
  return true;
}

export function revokeGuestPass(passes, passId) {
  return (passes || []).map((p) =>
    p.id === passId ? { ...p, status: 'revoked', revokedAt: new Date().toISOString() } : p
  );
}

/** Pases de invitado del día (QR temporal). */

function todayISO(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function buildGuestPassPayload(pass) {
  return `JCSJ-GUEST:${pass?.id || ''}:${pass?.hostMemberId || ''}:${pass?.date || ''}`;
}

export function parseGuestPassPayload(raw) {
  if (!raw || !String(raw).startsWith('JCSJ-GUEST:')) return null;
  const [, id, hostMemberId, date] = String(raw).split(':');
  if (!id || !hostMemberId || !date) return null;
  return { id, hostMemberId, date };
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
  return {
    id,
    hostMemberId,
    hostName: hostName || '',
    guestName: name,
    date,
    createdAt: new Date().toISOString(),
    status: 'active',
    payload: buildGuestPassPayload({ id, hostMemberId, date }),
  };
}

export function isGuestPassValid(pass, { today = todayISO() } = {}) {
  if (!pass || pass.status === 'revoked') return false;
  return pass.date === today;
}

export function revokeGuestPass(passes, passId) {
  return (passes || []).map((p) =>
    p.id === passId ? { ...p, status: 'revoked', revokedAt: new Date().toISOString() } : p
  );
}

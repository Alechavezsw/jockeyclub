/** Token aleatorio de 16 bytes (hex) para firmar credenciales y pases. */
export function randomCredentialToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 18)}`;
}

/**
 * Payload del QR de credencial. Con token no se puede falsificar solo con el número.
 * Va en MAYÚSCULAS a propósito: así el QR usa el modo alfanumérico, que es más corto que el de
 * bytes (29 módulos por lado en vez de 37) y el celular lo lee más rápido y desde más lejos.
 * Al leerlo se vuelve a minúsculas, así que los QR viejos (en minúsculas) siguen valiendo.
 */
export function buildCredentialQRPayload(member) {
  const id = String(member?.memberId || '').trim();
  const token = String(member?.credentialToken || '').trim();
  if (!id) return '';
  if (!token) return `JCSJ:${id}`;
  return `JCSJ:${id}.${token.toUpperCase()}`;
}

/**
 * Extrae memberId y firma desde el payload leído por el molinete / cámara.
 * @returns {{ memberId: string, token: string|null, signed: boolean } | null}
 */
export function parseCredentialQRPayload(raw) {
  if (!raw) return null;
  const text = String(raw)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '');

  let body;
  if (/^JCSJ:/i.test(text)) {
    body = text.slice(5);
  } else {
    const embedded = text.match(/JCSJ:([0-9]{6,20}(?:\.[a-f0-9]{16,64})?)/i);
    if (embedded) body = embedded[1];
    else if (/^\d{6,20}$/.test(text)) body = text;
    else return null;
  }

  const dot = body.indexOf('.');
  if (dot > 0) {
    const memberId = body.slice(0, dot);
    const token = body.slice(dot + 1);
    if (!memberId || !/^[a-f0-9]{16,64}$/i.test(token)) return null;
    return { memberId, token: token.toLowerCase(), signed: true };
  }

  if (!body) return null;
  return { memberId: body, token: null, signed: false };
}

export function credentialTokenMatches(member, parsed) {
  if (!member || !parsed?.signed || !parsed.token) return false;
  const expected = String(member.credentialToken || '').toLowerCase();
  const got = String(parsed.token).toLowerCase();
  if (!expected || expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verificación de la firma del QR en el molinete.
 *
 * Tres cosas que antes fallaban juntas:
 * 1. Cada lectura bajaba la ficha entera del socio (con su secreto) al navegador del portero.
 *    Ahora se le pregunta al servidor «¿esta firma es la de este socio?» y contesta sí o no.
 * 2. Si esa consulta fallaba (sin señal), se comparaba contra una ficha sin firma y el socio
 *    legítimo veía «QR adulterado». Ahora «no pude verificar» es un estado aparte.
 * 3. Cada socio nuevo costaba una ida y vuelta. Lo ya verificado se recuerda un turno
 *    (solo un hash, nunca la firma) y la segunda lectura es instantánea y anda sin internet.
 */

import { credentialTokenMatches } from './qr';

export const VERIFIED_TTL_MS = 12 * 60 * 60 * 1000;

/** SHA-256 en hexadecimal. Sin crypto.subtle (contexto no seguro) devuelve '' y no se usa la memoria. */
export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '';
  const bytes = new TextEncoder().encode(String(text));
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** ¿El servidor todavía no tiene la función de verificación? Entonces se usa el camino de antes. */
export function isMissingVerifyFunction(error) {
  const code = String(error?.code || '');
  const text = String(error?.message || '');
  return code === 'PGRST202' || code === '42883'
    || (/verify_member_credential/i.test(text) && /not find|does not exist|no function/i.test(text));
}

/**
 * @param {object} deps
 * @param {(memberNumber: string, token: string) => Promise<{ found: boolean, valid: boolean }>} deps.verifyRemote
 * @param {(memberNumber: string) => Promise<{ credentialToken?: string } | null>} [deps.fetchMember]
 *        camino de respaldo mientras el servidor no tenga la función nueva
 */
export function createCredentialVerifier({
  verifyRemote,
  fetchMember = null,
  now = () => Date.now(),
  ttlMs = VERIFIED_TTL_MS,
} = {}) {
  const verified = new Map();

  const remember = async (memberId, token) => {
    const hash = await sha256Hex(`${memberId}:${token}`);
    if (hash) verified.set(String(memberId), { hash, at: now() });
  };

  return {
    /**
     * @returns {Promise<{ status: 'valid' | 'invalid' | 'unknown_member' | 'unreachable', source: string }>}
     */
    async verify(memberId, token, { member = null } = {}) {
      const id = String(memberId || '').trim();
      const clean = String(token || '').trim().toLowerCase();
      if (!id || !clean) return { status: 'invalid', source: 'local' };

      // 1) La ficha en memoria ya trae la firma (alta reciente, sesión de caja): sin red.
      if (member?.credentialToken && credentialTokenMatches(member, { signed: true, token: clean })) {
        await remember(id, clean);
        return { status: 'valid', source: 'local' };
      }

      // 2) Ya se verificó en este turno: instantáneo y sin internet.
      const hash = await sha256Hex(`${id}:${clean}`);
      const seen = verified.get(id);
      if (hash && seen && seen.hash === hash && now() - seen.at < ttlMs) {
        return { status: 'valid', source: 'cache' };
      }

      // 3) Se le pregunta al servidor.
      try {
        const reply = await verifyRemote(id, clean);
        if (!reply?.found) return { status: 'unknown_member', source: 'server' };
        if (reply.valid) {
          await remember(id, clean);
          return { status: 'valid', source: 'server' };
        }
        verified.delete(id);
        return { status: 'invalid', source: 'server' };
      } catch (error) {
        if (isMissingVerifyFunction(error) && typeof fetchMember === 'function') {
          try {
            const full = await fetchMember(id);
            if (!full) return { status: 'unknown_member', source: 'fallback' };
            if (credentialTokenMatches(full, { signed: true, token: clean })) {
              await remember(id, clean);
              return { status: 'valid', source: 'fallback' };
            }
            verified.delete(id);
            return { status: 'invalid', source: 'fallback' };
          } catch {
            return { status: 'unreachable', source: 'fallback' };
          }
        }
        return { status: 'unreachable', source: 'server' };
      }
    },

    forget() {
      verified.clear();
    },
  };
}

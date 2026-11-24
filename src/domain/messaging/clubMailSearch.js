import { lilaClubNumber } from '../accounting/memberBalances';
import { deliverableEmail } from './clubNotice';

export const CLUB_MAIL_NUMBER_MISS = 'No encontramos un socio con ese número';

/** Solo un identificador numérico pierde los ceros de la izquierda. El padrón no se reescribe. */
export function clubMailMemberQuery(raw) {
  const text = String(raw || '').trim();
  if (!text) return { kind: 'empty', text: '', canonical: '' };
  if (/^\d+$/.test(text)) {
    return { kind: 'number', text, canonical: text.replace(/^0+/, '') || '0' };
  }
  return { kind: 'text', text, canonical: text };
}

export function clubMailSearchMissMessage(query) {
  const parsed = typeof query === 'string' ? clubMailMemberQuery(query) : query;
  if (!parsed || parsed.kind === 'empty') return '';
  if (parsed.kind === 'number') return CLUB_MAIL_NUMBER_MISS;
  return 'No se encontraron socios con ese criterio.';
}

/** Primera letra y dominio. La dirección completa no sale en la pantalla. */
export function maskClubMailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  const at = email.indexOf('@');
  if (at < 1) return '';
  return `${email.slice(0, 1)}•••@${email.slice(at + 1)}`;
}

function fold(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function storedNumber(member) {
  return String(member?.memberId || member?.memberNumber || '').trim();
}

function numericIdentity(value) {
  const text = String(value || '').trim();
  if (!/^\d+$/.test(text)) return '';
  return text.replace(/^0+/, '') || '0';
}

/**
 * Búsqueda del compositor.
 * Un número coincide solo con el mismo socio, aunque se escriba con ceros.
 * Un texto se compara tal cual: no se le sacan letras para adivinar un número.
 */
export function clubMailMemberHits(members, query) {
  const parsed = clubMailMemberQuery(query);
  const rows = Array.isArray(members) ? members : [];
  if (parsed.kind === 'empty') return rows;
  if (parsed.kind === 'number') {
    return rows.filter((member) => numericIdentity(storedNumber(member)) === parsed.canonical);
  }
  const needle = fold(parsed.text);
  return rows.filter((member) => {
    const stored = fold(storedNumber(member));
    const shown = fold(lilaClubNumber(member));
    const name = fold(member?.name);
    const family = fold(member?.familyGroupName);
    return stored === needle
      || shown === needle
      || (name && name.includes(needle))
      || (family && family.includes(needle));
  });
}

/** En la ficha, el socio ve su propio correo. El personal, al mirarla, ve la máscara. */
export function profileEmailDisplay(email, { selfService = false } = {}) {
  const text = String(email || '').trim();
  if (selfService) return { text, href: text ? `mailto:${text}` : '' };
  return { text: maskClubMailAddress(text), href: '' };
}

/** Lista y detalle: si el remitente es un correo, se enmascara. Un nombre queda igual. */
export function visibleMailboxAddress(value, fallback = 'Sin remitente') {
  const text = String(value || '').trim();
  const masked = maskClubMailAddress(text);
  if (masked) return masked;
  return text || fallback;
}

export function presentMemberPicker(member) {
  const rawEmail = String(member?.email || '');
  const maskedEmail = maskClubMailAddress(rawEmail);
  const nro = lilaClubNumber(member);
  const dni = String(member?.documentNumber || member?.dni || '').replace(/\D/g, '');
  const bits = [
    nro ? `N° ${nro}` : '',
    dni ? `DNI ${dni}` : '',
    maskedEmail,
    member?.phone || member?.phoneAlt || '',
    member?.familyGroupName || '',
  ].filter(Boolean);
  return {
    name: String(member?.name || '').trim(),
    detail: bits.join(' · ') || String(member?.tier || ''),
    maskedEmail,
    hasDeliverableMail: Boolean(deliverableEmail(rawEmail)),
  };
}

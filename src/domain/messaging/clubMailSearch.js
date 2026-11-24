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

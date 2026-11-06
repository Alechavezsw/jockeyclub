/** Texto del certificado de baja. El PDF lo dibuja exportBajaCertificatePdf. */

import { money } from '../money';
import { formatInstantAR } from '../../lib/arDate';

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const MONEY_FMT = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBajaLongDate(iso) {
  const raw = String(iso || '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || '—';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return raw;
  return `${Number(match[3])} de ${month} del ${match[1]}`;
}

export function formatBajaMoney(amount) {
  return MONEY_FMT.format(money(amount));
}

export function buildBajaCertificate({
  member = {},
  reasonLabel = '',
  detail = '',
  presentedOn = '',
  effectiveOn = '',
  amount = 0,
  actorName = '',
  registeredAt = '',
  tierLabel = '',
  club = {},
} = {}) {
  const clubName = club.name || 'Jockey Club San Juan';
  const name = String(member.name || '').trim() || 'el socio';
  const dni = String(member.documentNumber || '').trim() || '—';
  const nro = String(member.memberId || '').trim() || '—';
  const category = String(tierLabel || '').trim();
  const motivo = String(reasonLabel || '').trim() || '—';
  const note = String(detail || '').trim();
  const fecha = formatBajaLongDate(presentedOn);
  const vigencia = formatBajaLongDate(effectiveOn);
  const monto = formatBajaMoney(amount);
  const quien = String(
    actorName
    || member.bajaActorName
    || member.meta?.bajaActorName
    || ''
  ).trim();
  const cuando = formatInstantAR(
    registeredAt
    || member.bajaRegistradaAt
    || member.meta?.bajaRegistradaAt
    || ''
  );
  const paragraphs = [
    `San Juan, ${fecha}.`,
    'CERTIFICO:',
    `Que ${name}, DNI ${dni}, socio Nº ${nro}${category ? `, categoría ${category}` : ''}, registra la baja de su membresía en ${clubName}.`,
    `Motivo: ${motivo}.`,
    note ? `Detalle: ${note}.` : '',
    `Fecha de la baja: ${fecha}.`,
    `Vigencia: ${vigencia}. El mes en curso se cobra.`,
    `Monto registrado: ${monto}.`,
    quien ? `Registró la baja: ${quien}.` : '',
    cuando && cuando !== '—' ? `Fecha y hora del registro: ${cuando}.` : '',
    'Se extiende el presente certificado a los efectos que hubiera lugar.',
    'Firma y sello',
  ].filter(Boolean);

  return {
    fileName: `certificado-baja-${nro}.pdf`,
    memberNumber: nro,
    presentedOn,
    effectiveOn,
    amount: money(amount),
    letter: {
      headingMember: `${name} · Nº ${nro}`,
      headingClub: clubName,
      headingTitle: 'CERTIFICADO DE BAJA',
      paragraphs,
      note: 'Quedan registrados el usuario, la fecha y la hora de la baja, junto con el motivo y el saldo.',
      stamp: [club.issuer || 'Administración', club.address].filter(Boolean).join(' · '),
    },
  };
}

export function buildReactivacionCertificate({
  member = {},
  reasonLabel = '',
  detail = '',
  presentedOn = '',
  amount = 0,
  actorName = '',
  registeredAt = '',
  tierLabel = '',
  club = {},
} = {}) {
  const clubName = club.name || 'Jockey Club San Juan';
  const name = String(member.name || '').trim() || 'el socio';
  const dni = String(member.documentNumber || '').trim() || '—';
  const nro = String(member.memberId || '').trim() || '—';
  const category = String(tierLabel || '').trim();
  const motivo = String(reasonLabel || '').trim() || '—';
  const note = String(detail || '').trim();
  const fecha = formatBajaLongDate(presentedOn);
  const monto = formatBajaMoney(amount);
  const bajaMotivo = String(member.bajaMotivo || member.meta?.bajaMotivo || '').trim();
  const bajaCuando = formatBajaLongDate(member.bajaPresentada || member.meta?.bajaPresentada || member.bajaFecha || '');
  const quien = String(
    actorName
    || member.reactivateActorName
    || member.meta?.reactivateActorName
    || ''
  ).trim();
  const cuando = formatInstantAR(
    registeredAt
    || member.reactivateRegistradaAt
    || member.meta?.reactivateRegistradaAt
    || ''
  );
  const paragraphs = [
    `San Juan, ${fecha}.`,
    'CERTIFICO:',
    `Que ${name}, DNI ${dni}, socio Nº ${nro}${category ? `, categoría ${category}` : ''}, registra la reactivación de su membresía en ${clubName}.`,
    `Motivo: ${motivo}.`,
    note ? `Detalle: ${note}.` : '',
    bajaMotivo ? `Baja anterior: ${bajaMotivo}${bajaCuando && bajaCuando !== '—' ? `, presentada el ${bajaCuando}` : ''}.` : '',
    `Fecha de la reactivación: ${fecha}.`,
    `Monto del saldo: ${monto}.`,
    quien ? `Registró la reactivación: ${quien}.` : '',
    cuando && cuando !== '—' ? `Fecha y hora del registro: ${cuando}.` : '',
    'Se extiende el presente certificado a los efectos que hubiera lugar.',
    'Firma y sello',
  ].filter(Boolean);

  return {
    fileName: `certificado-reactivacion-${nro}.pdf`,
    memberNumber: nro,
    presentedOn,
    amount: money(amount),
    letter: {
      headingMember: `${name} · Nº ${nro}`,
      headingClub: clubName,
      headingTitle: 'CERTIFICADO DE REACTIVACIÓN',
      paragraphs,
      note: 'La baja anterior queda en la ficha. Esta reactivación anota el usuario, la fecha y la hora.',
      stamp: [club.issuer || 'Administración', club.address].filter(Boolean).join(' · '),
    },
  };
}

/** Certificado de libre deuda con el saldo de cuota vivo. */

import { cobranzasSeed } from './cobranzas';
import { lookupMonthlyDebt } from './monthlyDebts';
import { lookupDetailedCc, periodLabelFromKey } from './detailedCurrentAccounts';
import { formatSpanishLongDate } from './memberBalances';
import { appMonthlyDebtForMember } from './appMonthlyDebts';
import { liveFamilyBalanceForMember } from './liveFamilyGroupBalances';
import { pinDuesDueDate } from '../members/dues';
import { memberNumberOf } from '../members/households';
import { getTierDisplayName } from '../members/tiers';
import { arParts } from '../../lib/arDate';
import { getClubSettings } from '../system/clubSettings';

export const LIBRE_DEUDA_SNAPSHOTS = [];

export const LIBRE_DEUDA_MODULE = 'contabilidad';
export const LIBRE_DEUDA_REPORT_TYPE = 'libre_deuda';

export const ACCOUNTING_REPORT_MODULES = {
  contabilidad: 'Contabilidad',
};

export const ACCOUNTING_REPORT_TYPES = {
  libre_deuda: 'Libre deuda',
};

/** Datos legales del club. */
export const LIBRE_DEUDA_CLUB = {
  name: 'JOCKEY CLUB SAN JUAN',
  address: 'República del Líbano Oeste 1799, Rivadavia, San Juan',
  cuit: '30-53106908-7',
  issuer: 'Administración',
  issuerRole: 'Administrador y representante legal',
  systemName: 'Jockey Club',
};

export function libreDeudaClub() {
  const live = getClubSettings();
  return {
    ...LIBRE_DEUDA_CLUB,
    name: live.legalName || live.name || LIBRE_DEUDA_CLUB.name,
    address: [live.address, live.city].filter(Boolean).join(', ') || LIBRE_DEUDA_CLUB.address,
    cuit: live.cuit || LIBRE_DEUDA_CLUB.cuit,
  };
}

export const LIBRE_DEUDA_NOTE = [
  'NOTA: El siguiente documento hace referencia únicamente a la información registrada en el sistema del Jockey Club San Juan, sin tener en cuenta datos o deudas',
  'ajenas al club. Toda la información cargada en el mismo es exclusiva responsabilidad de Administración.',
].join(' ');

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const MONEY_FMT = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONTH_IN_TEXT = new RegExp(
  `(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\\s+del\\s+(\\d{4})`,
  'i',
);

function rawDigits(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

/** Comparación de nro. de socio: 00045 y 45 son el mismo. */
export function normalizeLibreDeudaMemberNumber(n) {
  const digits = rawDigits(n);
  return digits.replace(/^0+/, '') || (digits ? '0' : '');
}

export function formatLibreDeudaMemberNumber(n) {
  const digits = normalizeLibreDeudaMemberNumber(n);
  if (!digits) return '';
  return digits.padStart(Math.max(5, digits.length), '0');
}

function formatMoney(n) {
  return `$ ${MONEY_FMT.format(Math.abs(Number(n) || 0))}`;
}

function monthHasDebt(row) {
  if (!row) return false;
  return (Number(row.capital) || 0) !== 0 || (Number(row.interest) || 0) !== 0;
}

function periodFromMonthName(text) {
  const m = String(text || '').match(MONTH_IN_TEXT);
  if (!m) return '';
  const idx = MONTHS_ES.findIndex((name) => name.toLowerCase() === m[1].toLowerCase());
  if (idx < 0) return '';
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
}

export function formatLibreDeudaMonthYear(periodKey) {
  return periodLabelFromKey(periodKey) || '';
}

/** “a los 26 dias del mes de Septiembre de 2026 .” */
export function formatLibreDeudaPlaceDate(iso) {
  const key = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const [y, m, d] = key.split('-').map(Number);
  const month = MONTHS_ES[m - 1];
  if (!month) return '';
  return `a los ${d} dias del mes de ${month} de ${y} .`;
}

/** “26 DE SEPTIEMBRE DEL 2026 A LAS 12:08” */
export function formatLibreDeudaStamp(date = new Date()) {
  const { year, month, day, hour, minute } = arParts(date);
  const monthName = (MONTHS_ES[Number(month) - 1] || '').toUpperCase();
  return `${Number(day)} DE ${monthName} DEL ${year} A LAS ${hour}:${minute}`;
}

function collectPaidPeriods(memberNumber, asOf, {
  detailed,
  monthly,
  cobranzas,
} = {}) {
  const nro = normalizeLibreDeudaMemberNumber(memberNumber);
  const cutoff = String(asOf || '').slice(0, 10);
  const cutoffMonth = cutoff.slice(0, 7);
  const periods = [];

  const cc = detailed || lookupDetailedCc(nro);
  (cc?.lines || []).forEach((line) => {
    if ((Number(line.paid) || 0) <= 0) return;
    if (line.feeDate && cutoff && line.feeDate > cutoff) return;
    if (line.periodKey && cutoffMonth && line.periodKey > cutoffMonth) return;
    if (line.periodKey) periods.push(line.periodKey);
  });

  const debt = monthly || lookupMonthlyDebt(nro);
  (debt?.months || []).forEach((row) => {
    if (!row.periodKey || monthHasDebt(row)) return;
    if (cutoffMonth && row.periodKey > cutoffMonth) return;
    periods.push(row.periodKey);
  });

  const rows = cobranzas || cobranzasSeed().ACCESSIN_COBRANZAS;
  (rows || []).forEach((row) => {
    if (normalizeLibreDeudaMemberNumber(row.memberNumber) !== nro) return;
    if (row.date && cutoff && String(row.date).slice(0, 10) > cutoff) return;
    const period = periodFromMonthName(row.concept);
    if (period && (!cutoffMonth || period <= cutoffMonth)) periods.push(period);
  });

  return [...new Set(periods)].toSorted();
}

/**
 * Último período de liquidación pago a la fecha de corte.
 * LILA lo imprime como “Siendo la última liquidación paga en Septiembre del 2026.”
 */
export function lastPaidLiquidationPeriod(memberNumber, asOf = '', sources = {}) {
  const livePaid = sources.member?.lastPaymentDate || sources.lastPaymentDate;
  if (livePaid) {
    const paidOn = String(livePaid).slice(0, 10);
    if (!asOf || paidOn <= String(asOf).slice(0, 10)) {
      const due = pinDuesDueDate(paidOn);
      if (due) return due.slice(0, 7);
    }
  }
  const paid = collectPaidPeriods(memberNumber, asOf, sources);
  if (paid.length) return paid[paid.length - 1];

  const nro = normalizeLibreDeudaMemberNumber(memberNumber);
  const cutoffMonth = String(asOf || '').slice(0, 7);
  const debt = sources.monthly || lookupMonthlyDebt(nro);
  const unpaid = (debt?.months || [])
    .filter((row) => row.periodKey && monthHasDebt(row) && (!cutoffMonth || row.periodKey <= cutoffMonth))
    .map((row) => row.periodKey)
    .toSorted();
  if (!unpaid.length) return '';

  const [y, m] = unpaid[0].split('-').map(Number);
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

export function findMemberForLibreDeuda(members = [], raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const head = text.split(/\s*[-–—]\s*/)[0];
  const nro = normalizeLibreDeudaMemberNumber(head);
  if (nro) {
    const byNumber = (members || []).find((m) => normalizeLibreDeudaMemberNumber(memberNumberOf(m) || m.memberId) === nro);
    if (byNumber) return byNumber;
  }
  const q = text.toLowerCase();
  return (members || []).find((m) => String(m.name || '').toLowerCase().includes(q)) || null;
}

export function validateLibreDeudaInput({ member, memberNumber } = {}) {
  const nro = normalizeLibreDeudaMemberNumber(memberNumber || memberNumberOf(member) || member?.memberId);
  if (!nro) {
    const err = new Error('Socio. Es obligatorio');
    err.code = 'SOCIO_REQUIRED';
    throw err;
  }
  return nro;
}

/**
 * Saldo del socio a la fecha de corte, con la cuota viva de la app.
 */
export function balanceAsOf(member, asOf = '') {
  const persisted = Math.max(0, Number(member?.outstandingBalance) || 0);
  if (persisted <= 0) return 0;
  const debt = appMonthlyDebtForMember(member, { today: asOf || new Date() });
  if (debt) return Number(debt.totalDebt) || persisted;
  return persisted;
}

function cleanExtra(raw) {
  return String(raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*+/g, '')
    .replace(/_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCertificateName(member) {
  return member?.name || '—';
}

function resolveCertificateDni(member) {
  return rawDigits(member?.documentNumber || member?.dni) || '—';
}

export function buildLibreDeudaLetter(certificate) {
  const club = libreDeudaClub();
  const name = certificate.memberName;
  const dni = certificate.dni;
  const nro = certificate.memberNumberPadded || formatLibreDeudaMemberNumber(certificate.memberNumber);
  const statusClause = certificate.isClear
    ? 'no posee saldos pendientes de pago'
    : `posee saldos pendientes de pago por ${formatMoney(certificate.individualBalance)}`;

  const paragraphs = [
    `Estimado/a ${name}, DNI ${dni}:`,
    `Yo ${club.issuer} en mi carácter de ${club.issuerRole}, del club ${club.name}, sito en ${club.address}, CUIT ${club.cuit},`,
    'CERTIFICO:',
    `Que el socio, numero ${nro}, del citado club, que se encuentra registrada a nombre de ${name}, DNI ${dni}, conforme surge de los libros de la administración, a la fecha ${certificate.asOfLabel}, ${statusClause} en el sistema ${club.systemName}.`,
  ];

  if (certificate.lastPaidLabel) {
    paragraphs.push(`Siendo la última liquidación paga en ${certificate.lastPaidLabel}.`);
  }
  if (certificate.extraInfo) {
    paragraphs.push(certificate.extraInfo);
  }
  paragraphs.push(`Se extiende el presente certificado a solicitud de ${name}, DNI ${dni}.`);
  paragraphs.push(`En la ubicación ${club.address}, ${certificate.placeDate}`);
  paragraphs.push(`Atte. ${club.issuer} de ${club.name}.`);
  paragraphs.push('Firma y sello');

  return {
    headingMember: `SOCIO ${nro}`,
    headingClub: club.name,
    headingTitle: 'DOCUMENTO LIBRE DEUDA',
    paragraphs,
    note: LIBRE_DEUDA_NOTE,
    stamp: certificate.issuedStamp,
  };
}

export function buildLibreDeudaCertificate(member, {
  asOf = new Date().toISOString().slice(0, 10),
  extraInfo = '',
  allMembers = [],
  issuedAt = new Date(),
} = {}) {
  const memberNumber = validateLibreDeudaInput({ member });
  const padded = formatLibreDeudaMemberNumber(memberNumber);
  const individualBalance = balanceAsOf(member, asOf);
  const debt = individualBalance > 0 ? appMonthlyDebtForMember(member, { today: asOf }) : null;
  const family = liveFamilyBalanceForMember(member, allMembers, { today: asOf });
  const familyAmount = family.isTitular ? Number(family.amount) || 0 : null;
  const isClear = individualBalance <= 0 && (familyAmount == null || familyAmount <= 0);
  const extra = cleanExtra(extraInfo);
  const asOfLabel = formatSpanishLongDate(asOf);
  const lastPaidPeriod = lastPaidLiquidationPeriod(memberNumber, asOf, { member });
  const lastPaidLabel = formatLibreDeudaMonthYear(lastPaidPeriod);
  const memberName = resolveCertificateName(member);
  const dni = resolveCertificateDni(member);
  const tierLabel = getTierDisplayName(member.tier) || debt?.socialFee || '—';
  const issuedStamp = formatLibreDeudaStamp(issuedAt);
  const placeDate = formatLibreDeudaPlaceDate(asOf);
  const fileName = `Socio ${padded} - ${memberName}.pdf`;

  const certificate = {
    module: LIBRE_DEUDA_MODULE,
    reportType: LIBRE_DEUDA_REPORT_TYPE,
    memberNumber,
    memberNumberPadded: padded,
    memberName,
    dni,
    tierLabel,
    asOf,
    asOfLabel,
    placeDate,
    extraInfo: extra,
    individualBalance,
    familyAmount,
    isTitular: Boolean(family.isTitular),
    isClear,
    statusLabel: isClear ? 'Libre de deuda' : 'Con saldo deudor',
    lastPaidPeriod,
    lastPaidLabel,
    issuedStamp,
    unpaidMonths: (debt?.months || []).filter((row) => monthHasDebt(row)).length,
    unpaidLines: (debt?.months || []).filter((row) => monthHasDebt(row)).length,
    clubName: libreDeudaClub().name,
    fileName,
  };

  const letter = buildLibreDeudaLetter(certificate);
  const constancia = letter.paragraphs.join(' ');

  return {
    ...certificate,
    letter,
    constancia,
  };
}

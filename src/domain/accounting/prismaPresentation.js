/**
 * Presentación de débitos automáticos Prisma, el mismo TXT que arma Lila
 * en Contabilidad → Cobros online → Prisma.
 *
 * Cada registro cierra con * y la línea termina en CRLF.
 * Con identificador de establecimiento: 100 caracteres (guía Prisma: encabezado,
 * un cuerpo por débito, cierre).
 * Sin identificador, Lila omite esos 10 caracteres y el archivo queda en 90.
 * El archivo 707 del club (29/08/2026 22:21, Visa crédito, 0 débitos) es ese caso.
 */

import { canChargeSocialDues } from '../members/dues';

export const PRISMA_FILE_TYPES = {
  DEBLIQC: { code: 'DEBLIQC', label: 'Visa Crédito', filename: 'DEBLIQC.txt' },
  DEBLIQD: { code: 'DEBLIQD', label: 'Visa Débito', filename: 'DEBLIQD.txt' },
  DEBLIMC: { code: 'DEBLIMC', label: 'Mastercard Crédito', filename: 'DEBLIMC.txt' },
};

/** El único archivo que Lila tiene generado para este club. */
export const LILA_PRISMA_FILE_707 = {
  id: '707',
  fileType: 'DEBLIQC',
  createdAt: '2026-08-29T22:21:00-03:00',
  debitCount: 0,
  totalCents: 0,
  status: 'Listo para procesar pagos',
  establishment: '',
};

const FIXED_FIELD = '900000';
const TX_DEBIT = '0005';
const TX_REFUND = '6000';

function padLeft(value, length, ch = '0') {
  const text = String(value ?? '');
  if (text.length > length) throw new Error(`El campo supera los ${length} caracteres.`);
  return text.padStart(length, ch);
}

function padRight(value, length) {
  const text = String(value ?? '');
  if (text.length > length) throw new Error(`El campo supera los ${length} caracteres.`);
  return text.padEnd(length, ' ');
}

function finish(parts, length) {
  const line = parts.join('');
  if (line.length !== length || !line.endsWith('*')) {
    throw new Error(`Registro de ${line.length} caracteres. Tiene que medir ${length} y cerrar con *.`);
  }
  return line;
}

export function arStamp(when = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(when).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    time: `${parts.hour}${parts.minute}`,
  };
}

function moneyToCents(amount) {
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 999999999999999) {
    throw new Error('Importe de débito inválido.');
  }
  return cents;
}

function bodyLine(debit, presentationDate, index, length) {
  const card = String(debit.card || '').replace(/\D/g, '');
  if (card.length !== 16) throw new Error('La tarjeta tiene que tener 16 dígitos.');
  const client = String(debit.clientId || '').replace(/\D/g, '');
  if (!client) throw new Error('El débito no tiene número de socio.');
  const cents = moneyToCents(debit.amount);
  const line = finish([
    '1',
    card,
    '   ',
    padLeft(debit.invoice ?? index + 1, 8),
    presentationDate,
    debit.refund ? TX_REFUND : TX_DEBIT,
    padLeft(cents, 15),
    padLeft(client, 15),
    debit.isNew ? 'E' : ' ',
    ' '.repeat(28),
    '*',
  ], 100);
  if (length !== 100) throw new Error('Sin identificador de Prisma no se agregan socios.');
  return { line, cents };
}

/**
 * @param {{ fileType: string, establishment?: string, when?: Date, debits?: Array<{ card: string, clientId: string, amount: number, invoice?: number, isNew?: boolean, refund?: boolean }> }} input
 */
export function buildPrismaPresentation({
  fileType,
  establishment = '',
  when = new Date(),
  debits = [],
} = {}) {
  const type = PRISMA_FILE_TYPES[fileType];
  if (!type) throw new Error('Tipo de archivo inválido.');
  const rawEst = String(establishment || '').replace(/\s/g, '');
  if (rawEst && !/^\d{1,10}$/.test(rawEst)) {
    throw new Error('El identificador de Prisma es numérico, de hasta 10 dígitos.');
  }
  const includeEstablishment = rawEst.length > 0;
  const length = includeEstablishment ? 100 : 90;
  const { date, time } = arStamp(when);
  const brand = padRight(type.code, 8);
  const establishmentField = includeEstablishment ? padLeft(rawEst, 10) : '';
  const fixed = padRight(FIXED_FIELD, 10);
  const rows = includeEstablishment ? debits : [];
  const bodies = rows.map((debit, index) => bodyLine(debit, date, index, length));
  const totalCents = bodies.reduce((sum, row) => sum + row.cents, 0);
  const header = finish([
    '0',
    brand,
    establishmentField,
    fixed,
    date,
    time,
    '0',
    '  ',
    ' '.repeat(55),
    '*',
  ], length);
  const trailer = finish([
    '9',
    brand,
    establishmentField,
    fixed,
    date,
    time,
    padLeft(bodies.length, 7),
    padLeft(totalCents, 15),
    ' '.repeat(36),
    '*',
  ], length);
  const text = [header, ...bodies.map((row) => row.line), trailer].join('\r\n') + '\r\n';
  return {
    filename: type.filename,
    text,
    recordLength: length,
    debitCount: bodies.length,
    totalCents,
    header,
    trailer,
  };
}

export function fileTypeForMember(member) {
  const tipo = String(member?.prismaTipoDebito || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!tipo) return '';
  if (tipo.includes('master')) return 'DEBLIMC';
  if (tipo.includes('visa') && tipo.includes('debito')) return 'DEBLIQD';
  if (tipo.includes('visa') || tipo.includes('credito')) return 'DEBLIQC';
  return '';
}

/** Socios que entrarían en el TXT. Vitalicio, fundador y comisión no. Sin saldo, tampoco. */
export function presentationDebits(members, fileType) {
  const rows = [];
  for (const member of members || []) {
    if (!canChargeSocialDues(member)) continue;
    if (fileTypeForMember(member) !== fileType) continue;
    const card = String(member?.prismaId || '').replace(/\D/g, '');
    if (card.length !== 16) continue;
    const amount = Number(member?.outstandingBalance) || 0;
    if (amount <= 0) continue;
    rows.push({
      card,
      clientId: member.memberId,
      amount,
      memberId: member.memberId,
      memberName: member.name || '',
      isNew: false,
    });
  }
  return rows;
}

export function maskCard(card) {
  const digits = String(card || '').replace(/\D/g, '');
  if (digits.length < 4) return '····';
  return `···· ${digits.slice(-4)}`;
}

/** Lectura del archivo de respuesta (RDEBLIQC / RDEBLIQD / RDEBLIMC / LDEBLIQD). No guarda tarjetas. */
export function summarizeResponseFile(filename, text) {
  const name = String(filename || '');
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.length);
  const head = lines[0] || '';
  const known = /DEBLI|RDEBL|LDEBL/i.test(`${name}\n${head}`);
  if (!known) throw new Error('No es un archivo de respuesta de Prisma.');
  const details = lines.filter((line) => line.startsWith('1')).length;
  return {
    filename: name,
    records: details,
    lines: lines.length,
    kind: head.slice(0, 12).trim() || name,
  };
}

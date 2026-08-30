/**
 * Transformación listado de reservas datita (xlsx/csv export Mi Socio)
 * → shape de reservations del portal.
 */

import { FACILITIES } from './facilities.js';

const MONTHS_ES = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/** Espacio del export → facilityId del catálogo. */
export const SPACE_TO_FACILITY_ID = {
  'espacio verde': 'espacio_verde',
  'salon maurin': 'salon_maurin',
  'salón maurin': 'salon_maurin',
  'salon anhelo': 'salon_anhelo',
  'salón anhelo': 'salon_anhelo',
  'salon bustos': 'salon_bustos',
  'salón bustos': 'salon_bustos',
  'salon refugio': 'salon_refugio',
  'salón refugio': 'salon_refugio',
};

const FACILITY_NAME_BY_ID = Object.fromEntries(
  FACILITIES.map((f) => [f.id, f.name]),
);

export function emptyToNull(v) {
  const s = String(v ?? '').trim();
  if (!s || /^no definido$/i.test(s) || s === '-' || s === 'None') return null;
  return s;
}

export function parseMoney(v) {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!s) return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * "30 de Agosto del 2026" | "29 de Agosto del 2026 a las 17:50" | ISO
 * → YYYY-MM-DD (fecha) o ISO datetime string si hay hora.
 */
export function parseSpanishDate(v, { withTime = false } = {}) {
  const raw = emptyToNull(v);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return withTime && raw.includes('T') ? raw : raw.slice(0, 10);
  }

  const m = raw.match(
    /^(\d{1,2})\s+de\s+([A-Za-záéíóúñÁÉÍÓÚÑ]+)\s+del?\s+(\d{4})(?:\s+a\s+las\s+(\d{1,2}):(\d{2}))?/i,
  );
  if (!m) return null;

  const day = m[1].padStart(2, '0');
  const monthNum = MONTHS_ES[m[2].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')];
  if (!monthNum) return null;
  const month = String(monthNum).padStart(2, '0');
  const date = `${m[3]}-${month}-${day}`;
  if (withTime && m[4] != null) {
    const hh = m[4].padStart(2, '0');
    const mm = m[5].padStart(2, '0');
    return `${date}T${hh}:${mm}:00`;
  }
  return date;
}

export function mapSpaceToFacility(spaceLabel) {
  const key = String(spaceLabel || '').trim().toLowerCase();
  if (!key) return null;
  const id = SPACE_TO_FACILITY_ID[key];
  if (!id) return null;
  return {
    facilityId: id,
    facilityName: FACILITY_NAME_BY_ID[id] || spaceLabel,
  };
}

export function mapReservaStatus(estado) {
  const s = String(estado || '').trim().toLowerCase();
  if (!s) return 'pending';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('aprob') || s.includes('confirm') || s.includes('pagad')) return 'confirmed';
  if (s.includes('pend')) return 'pending';
  return 'pending';
}

export function mapPaymentMethod(forma) {
  const s = emptyToNull(forma);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.includes('transfer')) return 'transferencia';
  if (lower.includes('mercado') || lower.includes('mp')) return 'mercadopago';
  if (lower.includes('efectivo') || lower.includes('caja')) return 'efectivo';
  return s;
}

export function normalizeTime(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** Columnas del export Mi Socio (fila de encabezado). */
export const RESERVA_HEADERS = [
  '#',
  'NRO DE SOCIO',
  'NOMBRE',
  'APELLIDO',
  'DOCUMENTO DEL RESPONSABLE',
  'ESPACIO',
  'CREADO EL',
  'FECHA DE LA RESERVA',
  'HORA INICIO',
  'HORA FIN',
  'ESTADO',
  'INVITADOS',
  'PRECIO ESTIMADO',
  'FORMA DE PAGO',
  'PRECIO IMPUTADO',
  'VOUCHER',
  'NUMERO DE TRANSACCION MP',
  'NOMBRE ASISTE',
  'APELLIDO ASISTE',
  'IDENTIFICADOR EXTERNO',
];

/**
 * Detecta fila de encabezado en una matriz AOA (export con filas de título arriba).
 */
export function findHeaderRowIndex(aoa) {
  for (let i = 0; i < (aoa || []).length; i += 1) {
    const row = aoa[i] || [];
    const a = String(row[0] || '').trim();
    const b = String(row[1] || '').trim().toUpperCase();
    if ((a === '#' || a === 'NRO') && b.includes('SOCIO')) return i;
    if (a === '#' && String(row[5] || '').toUpperCase().includes('ESPACIO')) return i;
  }
  return -1;
}

export function rowArrayToObject(headers, cells) {
  const obj = {};
  for (let i = 0; i < headers.length; i += 1) {
    obj[headers[i]] = cells[i] ?? '';
  }
  return obj;
}

/**
 * Una fila del export → reserva del portal (o null si no se puede mapear).
 */
export function datitaRowToReservation(row) {
  const externalId = emptyToNull(row['#'] ?? row.id ?? row.ID);
  const memberId = emptyToNull(row['NRO DE SOCIO'] ?? row.memberId);
  const first = String(row.NOMBRE ?? row.nombre ?? '').trim();
  const last = String(row.APELLIDO ?? row.apellido ?? '').trim();
  const memberName = [first, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const space = mapSpaceToFacility(row.ESPACIO ?? row.espacio);
  const date = parseSpanishDate(row['FECHA DE LA RESERVA'] ?? row.date);
  const time = normalizeTime(row['HORA INICIO'] ?? row.time);
  const endTime = normalizeTime(row['HORA FIN'] ?? row.endTime);

  if (!space || !date || !time || !memberId) return null;

  const guestsRaw = parseMoney(row.INVITADOS ?? row.guests);
  const guests = Number.isFinite(guestsRaw) ? Math.round(guestsRaw) : 0;
  const attendeeFirst = String(row['NOMBRE ASISTE'] || '').trim();
  const attendeeLast = String(row['APELLIDO ASISTE'] || '').trim();
  const guestNames = [attendeeFirst, attendeeLast].filter(Boolean).join(' ').trim();

  const estimatedPrice = parseMoney(row['PRECIO ESTIMADO']);
  const chargedPrice = parseMoney(row['PRECIO IMPUTADO']);
  const createdAt = parseSpanishDate(row['CREADO EL'], { withTime: true });

  return {
    id: externalId ? `datita-res-${externalId}` : `datita-res-${memberId}-${date}-${time}-${space.facilityId}`,
    facilityId: space.facilityId,
    facilityName: space.facilityName,
    memberId: String(memberId),
    memberName: memberName || `Socio ${memberId}`,
    date,
    time,
    endTime: endTime || null,
    guests,
    guestNames,
    status: mapReservaStatus(row.ESTADO),
    estimatedPrice,
    chargedPrice,
    paymentMethod: mapPaymentMethod(row['FORMA DE PAGO']),
    mpTransactionId: emptyToNull(row['NUMERO DE TRANSACCION MP']),
    voucher: emptyToNull(row.VOUCHER),
    document: emptyToNull(row['DOCUMENTO DEL RESPONSABLE']),
    externalId: emptyToNull(row['IDENTIFICADOR EXTERNO']) || externalId,
    createdAt,
    source: 'datita',
    notes: '',
  };
}

/**
 * AOA (primera hoja del xlsx) → reservas.
 */
export function aoaToReservations(aoa) {
  const headerIdx = findHeaderRowIndex(aoa);
  if (headerIdx < 0) {
    return { reservations: [], skipped: 0, errors: ['No se encontró fila de encabezado (# / NRO DE SOCIO).'] };
  }
  const headerCells = (aoa[headerIdx] || []).map((c) => String(c || '').trim());
  const reservations = [];
  let skipped = 0;
  const errors = [];

  for (let i = headerIdx + 1; i < aoa.length; i += 1) {
    const cells = aoa[i] || [];
    const idCell = String(cells[0] ?? '').trim();
    if (!idCell || !/^\d+$/.test(idCell)) continue;
    const row = rowArrayToObject(headerCells, cells);
    const mapped = datitaRowToReservation(row);
    if (!mapped) {
      skipped += 1;
      errors.push(`Fila ${i + 1}: no se pudo mapear (espacio/fecha/socio).`);
      continue;
    }
    reservations.push(mapped);
  }

  reservations.sort((a, b) => {
    const byDate = String(b.date).localeCompare(String(a.date));
    if (byDate !== 0) return byDate;
    return String(b.time).localeCompare(String(a.time));
  });

  return { reservations, skipped, errors };
}

/** Objetos con claves de encabezado (csv parseado) → reservas. */
export function rowsToReservations(rows) {
  const reservations = [];
  let skipped = 0;
  for (const row of rows || []) {
    const mapped = datitaRowToReservation(row);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    reservations.push(mapped);
  }
  reservations.sort((a, b) => {
    const byDate = String(b.date).localeCompare(String(a.date));
    if (byDate !== 0) return byDate;
    return String(b.time).localeCompare(String(a.time));
  });
  return { reservations, skipped, errors: [] };
}

export function summarizeReservations(reservations) {
  const byFacility = {};
  const byStatus = {};
  for (const r of reservations || []) {
    byFacility[r.facilityId] = (byFacility[r.facilityId] || 0) + 1;
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  return {
    total: (reservations || []).length,
    byFacility,
    byStatus,
  };
}

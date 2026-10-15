/** Fecha/hora en zona del club (San Juan, Argentina). */

export const AR_TZ = 'America/Argentina/San_Juan';

/**
 * Partes de calendario/reloj en Argentina (evita el desfase de toISOString/UTC).
 * @param {Date} [date]
 */
export function arParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
  };
}

const MONTHS_LONG_AR = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Fecha larga del día en Argentina, sin title-case en “de”. */
export function formatLongDateAR(date = new Date()) {
  const raw = date.toLocaleDateString('es-AR', {
    timeZone: AR_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** YYYY-MM-DD → “30 de agosto de 2026” (calendario, no UTC). */
export function formatISODateLongAR(iso) {
  const key = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key || '—';
  const [year, month, day] = key.split('-').map(Number);
  const monthLabel = MONTHS_LONG_AR[month - 1];
  if (!monthLabel) return key;
  return `${day} de ${monthLabel} de ${year}`;
}

/** YYYY-MM-DD en Argentina. */
export function todayISODateAR(date = new Date()) {
  const { year, month, day } = arParts(date);
  return `${year}-${month}-${day}`;
}

/** HH:mm en Argentina (input type="time"). */
export function nowTimeAR(date = new Date()) {
  const { hour, minute } = arParts(date);
  return `${hour}:${minute}`;
}

/** Suma meses a una fecha ISO (calendario local, mediodía). */
export function addMonthsISODate(iso, months = 1) {
  const raw = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return todayISODateAR();
  const [y, m, d] = raw.split('-').map(Number);
  const next = new Date(y, m - 1, d, 12, 0, 0, 0);
  next.setMonth(next.getMonth() + Number(months) || 0);
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, '0');
  const dd = String(next.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const INSTANT_LABEL = {
  timeZone: AR_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

function parseInstant(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.includes('T')
    ? raw
    : raw.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** True si el valor trae reloj (no solo YYYY-MM-DD). */
export function hasClock(value) {
  if (value instanceof Date) return true;
  const raw = String(value || '');
  return /T\d{2}:\d{2}/.test(raw) || /\s\d{2}:\d{2}/.test(raw);
}

/** Etiqueta corta fecha+hora en es-AR. */
export function formatDateTimeAR(isoDate, timeHHMM) {
  if (!isoDate) return '—';
  const date = new Date(`${String(isoDate).slice(0, 10)}T${timeHHMM || '12:00'}:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleString('es-AR', INSTANT_LABEL);
}

/** Fecha, y hora si el ISO la trae. No inventa 12:00. */
export function formatInstantAR(value, timeHHMM) {
  if (!value && !timeHHMM) return '—';
  const day = String(value || '').slice(0, 10);
  if (timeHHMM) return formatDateTimeAR(day || value, timeHHMM);
  const instant = hasClock(value) ? parseInstant(value) : null;
  if (instant) return instant.toLocaleString('es-AR', INSTANT_LABEL);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value ? String(value) : '—';
  const [year, month, date] = day.split('-').map(Number);
  const noon = new Date(year, month - 1, date, 12, 0, 0);
  return noon.toLocaleDateString('es-AR', {
    timeZone: AR_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

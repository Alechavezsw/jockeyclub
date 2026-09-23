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

/** Etiqueta corta fecha+hora en es-AR. */
export function formatDateTimeAR(isoDate, timeHHMM) {
  if (!isoDate) return '—';
  const date = new Date(`${String(isoDate).slice(0, 10)}T${timeHHMM || '12:00'}:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleString('es-AR', {
    timeZone: AR_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

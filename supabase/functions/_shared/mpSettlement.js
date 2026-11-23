/** Reglas de acreditación Mercado Pago. Solo `approved` mueve plata. */

export function paymentStatus(value) {
  return String(value || '').trim().toLowerCase();
}

/** Único estado que acredita cuota, reserva, saldo, asiento y recibo. */
export function isApprovedCreditStatus(value) {
  return paymentStatus(value) === 'approved';
}

export function currencyIsArs(value) {
  return String(value || '').trim().toUpperCase() === 'ARS';
}

/** Centavos enteros. null si el importe no es un número finito. */
export function moneyCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

/** Igualdad exacta en centavos. No hay tolerancia porcentual. */
export function moneyCentsEqual(left, right) {
  const a = moneyCents(left);
  const b = moneyCents(right);
  return a != null && b != null && a > 0 && a === b;
}

/** Cuota social / débito de cuota no puede cubrir el abono de tenis. */
export function isTennisCharge(concept, chargeScope) {
  const text = `${concept || ''} ${chargeScope || ''}`.toLowerCase();
  return /abono[_\s-]*tenis/.test(text) || /(^|[^a-z])tenis([^a-z]|$)/.test(text);
}

/**
 * Un débito recurrente acredita solo si el pago anidado está approved.
 * `processed`, `authorized`, `pending`, `rejected` y `cancelled` no acreditan.
 */
export function subscriptionDebitCredits(paymentStatusValue) {
  return isApprovedCreditStatus(paymentStatusValue);
}

const AR_TZ = 'America/Argentina/Buenos_Aires';
const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function duesPeriodParts(now = new Date()) {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const match = iso.match(/^(\d{4})-(\d{2})-/);
  if (!match) return null;
  return { year: match[1], month: match[2] };
}

export function duesMonthPhrase(now = new Date()) {
  const parts = duesPeriodParts(now);
  const name = parts ? MONTHS_ES[Number(parts.month) - 1] : '';
  return name && parts ? `${name} de ${parts.year}` : '';
}

export function duesDueOn(now = new Date()) {
  const parts = duesPeriodParts(now);
  return parts ? `${parts.year}-${parts.month}-10` : null;
}

/** Una fecha sola de Mercado Pago es el día en Argentina, no la medianoche UTC. */
export function debitInstant(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00-03:00`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** La adhesión solo puede caer sobre un intent de suscripción con socio. */
export function isSubscriptionAdhesionIntent(intent) {
  return String(intent?.kind || '').toLowerCase() === 'subscription' && Boolean(intent?.member_id);
}

export function sameMember(left, right) {
  return Boolean(left) && Boolean(right) && String(left) === String(right);
}

export function isUniqueViolation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '23505' || /duplicate key|unique/i.test(message);
}

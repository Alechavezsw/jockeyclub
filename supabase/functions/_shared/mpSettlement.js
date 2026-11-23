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

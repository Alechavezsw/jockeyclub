/** Checkout y suscripción de Mercado Pago. El token vive en las secretas. */

import { PORTAL_PUBLIC_ORIGIN, PORTAL_WWW_ORIGIN } from '../members/selfService';

export const MP_KINDS = ['dues', 'pool', 'subscription'];
export const MP_STATUSES = ['pending', 'in_process', 'approved', 'authorized', 'rejected', 'cancelled'];

export const MP_CHANNELS = ['online', 'onsite', 'subscription'];

export const DEFAULT_MP_SETTINGS = {
  enabled: false,
  posId: 'jcsj-caja',
};

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  PORTAL_PUBLIC_ORIGIN,
  PORTAL_WWW_ORIGIN,
]);

export function mergeMercadoPagoSettings(raw = {}) {
  const pos = String(raw?.posId || '').trim() || DEFAULT_MP_SETTINGS.posId;
  return {
    enabled: raw?.enabled === true,
    posId: pos.slice(0, 40),
  };
}

export function mpChannelFor({ kind, channel, mode, subscribe } = {}) {
  if (kind === 'subscription' || channel === 'subscription' || subscribe) return 'subscription';
  if (channel === 'onsite' || mode === 'qr') return 'onsite';
  if (channel === 'online' || mode === 'redirect') return 'online';
  return 'online';
}

export function isMpKind(value) {
  return MP_KINDS.includes(String(value || ''));
}

export function isMpPaidStatus(status) {
  const next = String(status || '').toLowerCase();
  return next === 'approved' || next === 'authorized';
}

/** Adhesión de débito confirmada por Mercado Pago. No alcanza con “débito” en la ficha. */
export function isMpAdhered(member) {
  const status = String(member?.mpAdhesion || member?.mercadoPagoAdhesion || '')
    .toLowerCase()
    .trim();
  return status === 'authorized' || status === 'active' || status === 'adherido';
}

export function sanitizeMpOrigin(origin, fallback = PORTAL_WWW_ORIGIN) {
  const raw = String(origin || '').trim().replace(/\/+$/, '');
  if (/jockeyclubsj\.org/i.test(raw)) return PORTAL_WWW_ORIGIN;
  if (ALLOWED_ORIGINS.has(raw)) return raw;
  return String(fallback || PORTAL_WWW_ORIGIN).replace(/\/+$/, '');
}

/** Avisos y vuelta de cuota van a www/cuenta, no al .org ni al apex. */
export function mpAccountOrigin(origin) {
  const next = sanitizeMpOrigin(origin, PORTAL_WWW_ORIGIN);
  if (next === PORTAL_PUBLIC_ORIGIN) return PORTAL_WWW_ORIGIN;
  return next;
}

export function mpBackPath(kind) {
  if (kind === 'pool') return '/entrada-pileta';
  return '/cuenta';
}

export function mpCheckoutTitle(kind) {
  if (kind === 'pool') return 'Canon pileta · Jockey Club San Juan';
  if (kind === 'subscription') return 'Suscripción cuota social · Jockey Club San Juan';
  return 'Cuota social · Jockey Club San Juan';
}

export function mpMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Mail que Mercado Pago puede usar. Descarta alias de rebote del padrón. */
export function isMpDeliverableEmail(value) {
  const email = String(value || '').trim();
  if (!email.includes('@')) return false;
  const lower = email.toLowerCase();
  if (lower.includes('@lila-jockey')) return false;
  if (lower.endsWith('@jockeyclubsj.com')) return false;
  return true;
}

export function firstMpDeliverableEmail(...candidates) {
  return candidates.find((value) => isMpDeliverableEmail(value)) || '';
}

/** Un cobro: la deuda de la ficha, o la cuota del mes si está al día. */
export function mpPayNowAmount(outstanding, monthly) {
  const due = mpMoney(outstanding);
  if (due > 0) return due;
  return mpMoney(monthly);
}

/** El débito mensual cobra la cuota del mes, nunca el saldo atrasado. */
export function mpSubscribeAmount(monthly) {
  return mpMoney(monthly);
}

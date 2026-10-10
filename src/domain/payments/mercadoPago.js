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

export function sanitizeMpOrigin(origin, fallback = PORTAL_PUBLIC_ORIGIN) {
  const raw = String(origin || '').trim().replace(/\/+$/, '');
  if (ALLOWED_ORIGINS.has(raw)) return raw;
  return String(fallback || PORTAL_PUBLIC_ORIGIN).replace(/\/+$/, '');
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

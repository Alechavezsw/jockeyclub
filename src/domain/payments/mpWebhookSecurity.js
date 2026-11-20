/**
 * Validación de webhooks Mercado Pago (HMAC + ts + estados acreditables).
 * Fuente de verdad compartida con tests; la Edge Function replica la misma lógica.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Tolerancia por defecto: 5 minutos (docs MP / SDK). Configurable vía env en Edge. */
export const MP_WEBHOOK_DEFAULT_TS_TOLERANCE_SECONDS = 300;

/** Solo `approved` acredita dinero en Payments / Checkout / Orders. */
export const MP_PAYMENT_CREDIT_STATUSES = Object.freeze(['approved']);

/** Adhesión de suscripción (preapproval), no cobro puntual. */
export const MP_SUBSCRIPTION_ADHESION_STATUSES = Object.freeze(['authorized', 'approved']);

export const MP_EXPECTED_CURRENCY = 'ARS';

/** Desvío máximo permitido entre intent.amount y transaction_amount (centavos). */
export const MP_AMOUNT_TOLERANCE = 0.05;

export function mpNormalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

/** Acreditación de cobro puntual: únicamente approved. */
export function mpIsPaymentCreditableStatus(status) {
  return MP_PAYMENT_CREDIT_STATUSES.includes(mpNormalizeStatus(status));
}

/** UI / adhesión: approved o authorized (preapproval). */
export function mpIsSettledOrAdheredStatus(status) {
  const next = mpNormalizeStatus(status);
  return next === 'approved' || next === 'authorized';
}

export function mpCurrencyOk(value, expected = MP_EXPECTED_CURRENCY) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return true;
  return raw === String(expected || MP_EXPECTED_CURRENCY).toUpperCase();
}

export function mpAmountMatchesIntent(paidAmount, intentAmount, tolerance = MP_AMOUNT_TOLERANCE) {
  const paid = Number(paidAmount);
  const expected = Number(intentAmount);
  if (!Number.isFinite(paid) || paid <= 0) return false;
  if (!Number.isFinite(expected) || expected <= 0) return false;
  const delta = Math.abs(paid - expected);
  if (delta <= tolerance) return true;
  // Subpago: nunca acreditar por menos que el intent.
  if (paid < expected - tolerance) return false;
  // Sobrepeso extremo (posible pago de otra intención).
  if (paid > expected * 1.5 + tolerance) return false;
  return true;
}

export function parseMpSignatureHeader(header) {
  const raw = String(header || '').trim();
  const parts = {};
  if (!raw) return parts;
  for (const chunk of raw.split(',')) {
    const [key, ...rest] = chunk.split('=');
    if (!key) continue;
    parts[key.trim().toLowerCase()] = rest.join('=').trim();
  }
  return parts;
}

/**
 * Manifest oficial: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * data.id en minúsculas. request-id se omite si viene vacío.
 */
export function buildMpWebhookManifest({ dataId, requestId, ts }) {
  const id = String(dataId || '').trim().toLowerCase();
  const req = String(requestId || '').trim();
  const stamp = String(ts || '').trim();
  const chunks = [];
  if (id) chunks.push(`id:${id}`);
  if (req) chunks.push(`request-id:${req}`);
  chunks.push(`ts:${stamp}`);
  return `${chunks.join(';')};`;
}

/** ts puede venir en segundos (10 dígitos) o milisegundos (13). */
export function mpSignatureTimestampMs(ts) {
  const raw = String(ts || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (raw.length >= 13) return n;
  return n * 1000;
}

export function isMpWebhookTimestampFresh(ts, {
  nowMs = Date.now(),
  toleranceSeconds = MP_WEBHOOK_DEFAULT_TS_TOLERANCE_SECONDS,
} = {}) {
  const tsMs = mpSignatureTimestampMs(ts);
  if (tsMs == null) return false;
  const tolMs = Math.max(0, Number(toleranceSeconds) || 0) * 1000;
  return Math.abs(Number(nowMs) - tsMs) <= tolMs;
}

export function mpWebhookHmacHex(secret, manifest) {
  return createHmac('sha256', String(secret || ''))
    .update(String(manifest || ''), 'utf8')
    .digest('hex');
}

export function mpHexEqual(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (a.length !== b.length || a.length === 0) return false;
  try {
    const leftBytes = Uint8Array.from(a, (ch) => ch.charCodeAt(0));
    const rightBytes = Uint8Array.from(b, (ch) => ch.charCodeAt(0));
    return timingSafeEqual(leftBytes, rightBytes);
  } catch {
    return false;
  }
}

/**
 * Valida x-signature + x-request-id + data.id + frescura de ts.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyMpWebhookSignature({
  xSignature,
  xRequestId,
  dataId,
  secret,
  nowMs = Date.now(),
  toleranceSeconds = MP_WEBHOOK_DEFAULT_TS_TOLERANCE_SECONDS,
}) {
  if (!String(secret || '').trim()) {
    return { ok: false, reason: 'missing_secret' };
  }
  const parts = parseMpSignatureHeader(xSignature);
  const ts = parts.ts || '';
  const v1 = String(parts.v1 || '').toLowerCase();
  const id = String(dataId || '').trim();
  if (!String(xSignature || '').trim()) return { ok: false, reason: 'missing_signature' };
  if (!ts || !v1) return { ok: false, reason: 'malformed_signature' };
  if (!id) return { ok: false, reason: 'missing_data_id' };
  if (!isMpWebhookTimestampFresh(ts, { nowMs, toleranceSeconds })) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }
  const manifest = buildMpWebhookManifest({
    dataId: id,
    requestId: xRequestId,
    ts,
  });
  const expected = mpWebhookHmacHex(secret, manifest);
  if (!mpHexEqual(expected, v1)) return { ok: false, reason: 'signature_mismatch' };
  return { ok: true };
}

/** Extrae data.id desde query (preferido) o body JSON. */
export function extractMpSignedResourceId({ url, rawBody }) {
  try {
    const parsedUrl = typeof url === 'string' ? new URL(url, 'https://local.invalid') : url;
    const fromQuery = parsedUrl.searchParams.get('data.id')
      || parsedUrl.searchParams.get('id')
      || '';
    if (String(fromQuery).trim()) return String(fromQuery).trim();
  } catch {
    /* ignore */
  }
  try {
    const parsed = JSON.parse(rawBody || '{}');
    return String(parsed?.data?.id || parsed?.id || '').trim();
  } catch {
    return '';
  }
}

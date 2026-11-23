import { describe, expect, it } from 'vitest';
import { currencyIsArs, isApprovedCreditStatus, moneyCentsEqual } from '../../../supabase/functions/_shared/mpSettlement.js';

const SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS = 300;

function hexOf(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameHex(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function computeHmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return hexOf(signed);
}

async function mpSignatureOk(headers, rawBody, secret, resourceId) {
  const header = String(headers['x-signature'] || '').trim();
  const requestId = String(headers['x-request-id'] || '').trim();
  if (!header) return { valid: false, reason: 'missing-header' };
  if (!secret) return { valid: false, reason: 'missing-secret' };

  const parts = {};
  for (const chunk of header.split(',')) {
    const [key, ...rest] = chunk.split('=');
    if (key) parts[key.trim()] = rest.join('=').trim();
  }
  const ts = parts.ts || '';
  const hash = String(parts.v1 || '').toLowerCase();
  const dataId = resourceId.toLowerCase();
  if (!ts) return { valid: false, reason: 'missing-timestamp' };
  if (!hash) return { valid: false, reason: 'missing-hash' };
  if (!dataId) return { valid: false, reason: 'missing-data-id' };

  const tsNum = parseInt(ts, 10);
  if (Number.isNaN(tsNum)) return { valid: false, reason: 'invalid-timestamp' };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const age = nowSeconds - tsNum;
  if (age < -60) return { valid: false, reason: 'timestamp-in-future' };
  if (age > SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS) return { valid: false, reason: 'timestamp-expired' };

  const chunks = [`id:${dataId}`];
  if (requestId) chunks.push(`request-id:${requestId}`);
  chunks.push(`ts:${ts}`);
  const manifest = `${chunks.join(';')};`;

  const expectedHash = await computeHmac(manifest, secret);
  if (!sameHex(expectedHash, hash)) return { valid: false, reason: 'signature-mismatch' };

  return { valid: true };
}

async function generateValidSignature(secret, resourceId, requestId = null) {
  const ts = Math.floor(Date.now() / 1000);
  const chunks = [`id:${resourceId.toLowerCase()}`];
  if (requestId) chunks.push(`request-id:${requestId}`);
  chunks.push(`ts:${ts}`);
  const manifest = `${chunks.join(';')};`;
  const hash = await computeHmac(manifest, secret);
  return { ts, hash, header: `ts=${ts},v1=${hash}` };
}

describe('Mercado Pago Webhook Security', () => {
  const TEST_SECRET = 'test-webhook-secret-12345';
  const TEST_RESOURCE_ID = '12345678901';

  describe('Firma válida', () => {
    it('acepta firma válida con timestamp actual', async () => {
      const { header } = await generateValidSignature(TEST_SECRET, TEST_RESOURCE_ID);
      const result = await mpSignatureOk(
        { 'x-signature': header },
        '{}',
        TEST_SECRET,
        TEST_RESOURCE_ID,
      );
      expect(result.valid).toBe(true);
    });

    it('acepta firma válida con request-id', async () => {
      const requestId = 'abc-123-def';
      const { header } = await generateValidSignature(TEST_SECRET, TEST_RESOURCE_ID, requestId);
      const result = await mpSignatureOk(
        { 'x-signature': header, 'x-request-id': requestId },
        '{}',
        TEST_SECRET,
        TEST_RESOURCE_ID,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('Firma inválida', () => {
    it('rechaza header x-signature faltante', async () => {
      const result = await mpSignatureOk({}, '{}', TEST_SECRET, TEST_RESOURCE_ID);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('missing-header');
    });

    it('rechaza secret faltante', async () => {
      const { header } = await generateValidSignature(TEST_SECRET, TEST_RESOURCE_ID);
      const result = await mpSignatureOk({ 'x-signature': header }, '{}', '', TEST_RESOURCE_ID);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('missing-secret');
    });

    it('rechaza hash incorrecto (firma manipulada)', async () => {
      const ts = Math.floor(Date.now() / 1000);
      const header = `ts=${ts},v1=0000000000000000000000000000000000000000000000000000000000000000`;
      const result = await mpSignatureOk({ 'x-signature': header }, '{}', TEST_SECRET, TEST_RESOURCE_ID);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('signature-mismatch');
    });

    it('rechaza firma con secret incorrecto', async () => {
      const { header } = await generateValidSignature('wrong-secret', TEST_RESOURCE_ID);
      const result = await mpSignatureOk({ 'x-signature': header }, '{}', TEST_SECRET, TEST_RESOURCE_ID);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('signature-mismatch');
    });
  });

  describe('Timestamp vencido (anti-replay)', () => {
    it('rechaza timestamp mayor a 5 minutos', async () => {
      const oldTs = Math.floor(Date.now() / 1000) - 400;
      const chunks = [`id:${TEST_RESOURCE_ID.toLowerCase()}`, `ts:${oldTs}`];
      const manifest = `${chunks.join(';')};`;
      const hash = await computeHmac(manifest, TEST_SECRET);
      const header = `ts=${oldTs},v1=${hash}`;

      const result = await mpSignatureOk({ 'x-signature': header }, '{}', TEST_SECRET, TEST_RESOURCE_ID);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('timestamp-expired');
    });

    it('acepta timestamp justo al límite (5 minutos)', async () => {
      const borderTs = Math.floor(Date.now() / 1000) - 299;
      const chunks = [`id:${TEST_RESOURCE_ID.toLowerCase()}`, `ts:${borderTs}`];
      const manifest = `${chunks.join(';')};`;
      const hash = await computeHmac(manifest, TEST_SECRET);
      const header = `ts=${borderTs},v1=${hash}`;

      const result = await mpSignatureOk({ 'x-signature': header }, '{}', TEST_SECRET, TEST_RESOURCE_ID);
      expect(result.valid).toBe(true);
    });

    it('rechaza timestamp en el futuro (clock skew excesivo)', async () => {
      const futureTs = Math.floor(Date.now() / 1000) + 120;
      const chunks = [`id:${TEST_RESOURCE_ID.toLowerCase()}`, `ts:${futureTs}`];
      const manifest = `${chunks.join(';')};`;
      const hash = await computeHmac(manifest, TEST_SECRET);
      const header = `ts=${futureTs},v1=${hash}`;

      const result = await mpSignatureOk({ 'x-signature': header }, '{}', TEST_SECRET, TEST_RESOURCE_ID);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('timestamp-in-future');
    });

    it('acepta clock skew menor a 60 segundos en el futuro', async () => {
      const nearFutureTs = Math.floor(Date.now() / 1000) + 30;
      const chunks = [`id:${TEST_RESOURCE_ID.toLowerCase()}`, `ts:${nearFutureTs}`];
      const manifest = `${chunks.join(';')};`;
      const hash = await computeHmac(manifest, TEST_SECRET);
      const header = `ts=${nearFutureTs},v1=${hash}`;

      const result = await mpSignatureOk({ 'x-signature': header }, '{}', TEST_SECRET, TEST_RESOURCE_ID);
      expect(result.valid).toBe(true);
    });
  });

  describe('Moneda incorrecta', () => {
    it('acepta moneda ARS', () => {
      expect(currencyIsArs('ARS')).toBe(true);
      expect(currencyIsArs('ars')).toBe(true);
      expect(currencyIsArs(' ARS ')).toBe(true);
    });

    it('rechaza moneda USD', () => {
      expect(currencyIsArs('USD')).toBe(false);
    });

    it('rechaza moneda BRL', () => {
      expect(currencyIsArs('BRL')).toBe(false);
    });

    it('rechaza cuando no se especifica moneda', () => {
      expect(currencyIsArs('')).toBe(false);
      expect(currencyIsArs(null)).toBe(false);
      expect(currencyIsArs(undefined)).toBe(false);
    });
  });

  describe('Monto incorrecto', () => {
    it('acepta monto exacto en centavos', () => {
      expect(moneyCentsEqual(40000, 40000)).toBe(true);
      expect(moneyCentsEqual(40000.1, 40000.1)).toBe(true);
    });

    it('rechaza un centavo de diferencia', () => {
      expect(moneyCentsEqual(40000, 40000.01)).toBe(false);
      expect(moneyCentsEqual(40000, 40200)).toBe(false);
    });

    it('rechaza un pago en cero', () => {
      expect(moneyCentsEqual(40000, 0)).toBe(false);
      expect(moneyCentsEqual(0, 40000)).toBe(false);
    });
  });

  describe('Webhook duplicado (idempotencia)', () => {
    it('detecta provider_payment_id ya usado en otro intent', () => {
      const existingPayments = new Map([
        ['PAY-123', 'intent-aaa'],
        ['PAY-456', 'intent-bbb'],
      ]);

      const checkDuplicate = (paymentId, currentIntentId) => {
        const existingIntentId = existingPayments.get(paymentId);
        if (existingIntentId && existingIntentId !== currentIntentId) {
          return { duplicate: true, existingIntentId };
        }
        return { duplicate: false };
      };

      expect(checkDuplicate('PAY-123', 'intent-ccc').duplicate).toBe(true);
      expect(checkDuplicate('PAY-123', 'intent-aaa').duplicate).toBe(false);
      expect(checkDuplicate('PAY-789', 'intent-ccc').duplicate).toBe(false);
    });

    it('permite reprocesar el mismo intent con el mismo payment_id', () => {
      const checkAlreadyApplied = (intent) => {
        return Boolean(intent.applied_at);
      };

      const pendingIntent = { id: 'intent-1', applied_at: null };
      const appliedIntent = { id: 'intent-2', applied_at: '2026-11-20T10:00:00Z' };

      expect(checkAlreadyApplied(pendingIntent)).toBe(false);
      expect(checkAlreadyApplied(appliedIntent)).toBe(true);
    });
  });

  describe('Pagos concurrentes', () => {
    it('simula lock optimista con versión', async () => {
      let dbVersion = 1;
      let appliedAt = null;

      const tryApply = async (expectedVersion) => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));

        if (appliedAt) {
          return { ok: false, reason: 'already-applied' };
        }
        if (dbVersion !== expectedVersion) {
          return { ok: false, reason: 'version-mismatch' };
        }

        appliedAt = new Date().toISOString();
        dbVersion += 1;
        return { ok: true };
      };

      const results = await Promise.all([
        tryApply(1),
        tryApply(1),
        tryApply(1),
      ]);

      const successes = results.filter((r) => r.ok);
      expect(successes.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Pago rechazado', () => {
    it('identifica estados de pago rechazado', () => {
      const isRejectedStatus = (status) => {
        const s = String(status || '').toLowerCase();
        return ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(s);
      };

      expect(isRejectedStatus('rejected')).toBe(true);
      expect(isRejectedStatus('cancelled')).toBe(true);
      expect(isRejectedStatus('refunded')).toBe(true);
      expect(isRejectedStatus('charged_back')).toBe(true);
      expect(isRejectedStatus('approved')).toBe(false);
      expect(isRejectedStatus('pending')).toBe(false);
    });

    it('no acredita pagos con estado no aprobado', () => {
      expect(isApprovedCreditStatus('approved')).toBe(true);
      expect(isApprovedCreditStatus('authorized')).toBe(false);
      expect(isApprovedCreditStatus('accredited')).toBe(false);
      expect(isApprovedCreditStatus('processed')).toBe(false);
      expect(isApprovedCreditStatus('pending')).toBe(false);
      expect(isApprovedCreditStatus('rejected')).toBe(false);
      expect(isApprovedCreditStatus('in_process')).toBe(false);
    });
  });

  describe('Validación de external_reference', () => {
    it('rechaza intent sin external_reference válida', () => {
      const validateExternalRef = (ref) => {
        const clean = String(ref || '').trim();
        if (!clean) return { valid: false, reason: 'missing-external-reference' };
        if (clean.length < 8) return { valid: false, reason: 'external-reference-too-short' };
        return { valid: true, ref: clean };
      };

      expect(validateExternalRef('').valid).toBe(false);
      expect(validateExternalRef(null).valid).toBe(false);
      expect(validateExternalRef('abc').valid).toBe(false);
      expect(validateExternalRef('intent-12345678').valid).toBe(true);
    });
  });

  describe('Asociación a socio', () => {
    it('verifica que el intent tiene member_id antes de acreditar cuota', () => {
      const validateMemberAssociation = (intent, kind) => {
        const duesKinds = ['dues', 'subscription', 'pool'];
        if (!duesKinds.includes(kind)) return { valid: true, reason: 'non-dues-kind' };
        if (!intent.member_id) return { valid: false, reason: 'missing-member-id' };
        return { valid: true };
      };

      expect(validateMemberAssociation({ member_id: '123' }, 'dues').valid).toBe(true);
      expect(validateMemberAssociation({ member_id: null }, 'dues').valid).toBe(false);
      expect(validateMemberAssociation({ member_id: null }, 'booking').valid).toBe(true);
    });
  });
});

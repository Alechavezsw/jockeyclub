import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MP_WEBHOOK_DEFAULT_TS_TOLERANCE_SECONDS,
  buildMpWebhookManifest,
  extractMpSignedResourceId,
  isMpWebhookTimestampFresh,
  mpAmountMatchesIntent,
  mpCurrencyOk,
  mpIsPaymentCreditableStatus,
  mpIsSettledOrAdheredStatus,
  mpNormalizeStatus,
  mpSignatureTimestampMs,
  parseMpSignatureHeader,
  verifyMpWebhookSignature,
} from './mpWebhookSecurity';

function sign({ secret, dataId, requestId, ts }) {
  const manifest = buildMpWebhookManifest({ dataId, requestId, ts });
  const v1 = createHmac('sha256', secret).update(manifest, 'utf8').digest('hex');
  return { manifest, header: `ts=${ts},v1=${v1}` };
}

describe('mpWebhookSecurity', () => {
  const secret = 'test-webhook-secret';

  it('firma válida con ts en segundos', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const { header } = sign({ secret, dataId: '123456789', requestId: 'req-1', ts });
    const result = verifyMpWebhookSignature({
      xSignature: header,
      xRequestId: 'req-1',
      dataId: '123456789',
      secret,
      nowMs: Number(ts) * 1000,
    });
    expect(result).toEqual({ ok: true });
  });

  it('firma válida con ts en milisegundos (Orders)', () => {
    const ts = String(Date.now());
    const { header } = sign({ secret, dataId: 'ABC', requestId: 'req-ms', ts });
    const result = verifyMpWebhookSignature({
      xSignature: header,
      xRequestId: 'req-ms',
      dataId: 'abc',
      secret,
      nowMs: Number(ts),
    });
    expect(result.ok).toBe(true);
  });

  it('rechaza firma ausente', () => {
    expect(verifyMpWebhookSignature({
      xSignature: '',
      xRequestId: 'req',
      dataId: '1',
      secret,
    }).reason).toBe('missing_signature');
  });

  it('rechaza firma inválida', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const result = verifyMpWebhookSignature({
      xSignature: `ts=${ts},v1=${'ab'.repeat(32)}`,
      xRequestId: 'req-1',
      dataId: '123',
      secret,
      nowMs: Number(ts) * 1000,
    });
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rechaza timestamp vencido', () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - MP_WEBHOOK_DEFAULT_TS_TOLERANCE_SECONDS - 30);
    const { header } = sign({ secret, dataId: '9', requestId: 'r', ts: oldTs });
    const result = verifyMpWebhookSignature({
      xSignature: header,
      xRequestId: 'r',
      dataId: '9',
      secret,
    });
    expect(result.reason).toBe('timestamp_out_of_tolerance');
  });

  it('acepta reintento dentro de la tolerancia', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 120);
    const { header } = sign({ secret, dataId: '77', requestId: 'retry', ts });
    expect(verifyMpWebhookSignature({
      xSignature: header,
      xRequestId: 'retry',
      dataId: '77',
      secret,
    }).ok).toBe(true);
  });

  it('parsea x-signature y arma el manifest oficial', () => {
    expect(parseMpSignatureHeader('ts=1,v1=abc')).toEqual({ ts: '1', v1: 'abc' });
    expect(buildMpWebhookManifest({ dataId: 'Aa', requestId: 'r1', ts: '1' }))
      .toBe('id:aa;request-id:r1;ts:1;');
    expect(mpSignatureTimestampMs('1704908010')).toBe(1704908010000);
    expect(mpSignatureTimestampMs('1742505638683')).toBe(1742505638683);
    expect(isMpWebhookTimestampFresh('1704908010', { nowMs: 1704908010000 + 1000 })).toBe(true);
  });

  it('extrae data.id desde query o body', () => {
    expect(extractMpSignedResourceId({
      url: 'https://example/hooks?data.id=999',
      rawBody: '{}',
    })).toBe('999');
    expect(extractMpSignedResourceId({
      url: 'https://example/hooks',
      rawBody: JSON.stringify({ data: { id: '888' } }),
    })).toBe('888');
  });

  it('solo approved acredita dinero; authorized no', () => {
    expect(mpIsPaymentCreditableStatus('approved')).toBe(true);
    expect(mpIsPaymentCreditableStatus('authorized')).toBe(false);
    expect(mpIsPaymentCreditableStatus('processed')).toBe(false);
    expect(mpIsPaymentCreditableStatus('accredited')).toBe(false);
    expect(mpIsPaymentCreditableStatus('pending')).toBe(false);
    expect(mpIsPaymentCreditableStatus('rejected')).toBe(false);
    expect(mpIsSettledOrAdheredStatus('authorized')).toBe(true);
    expect(mpNormalizeStatus(' Approved ')).toBe('approved');
  });

  it('valida moneda ARS e importes', () => {
    expect(mpCurrencyOk('ARS')).toBe(true);
    expect(mpCurrencyOk('USD')).toBe(false);
    expect(mpCurrencyOk('')).toBe(true);
    expect(mpAmountMatchesIntent(40000, 40000)).toBe(true);
    expect(mpAmountMatchesIntent(39999.97, 40000)).toBe(true);
    expect(mpAmountMatchesIntent(26000, 40000)).toBe(false);
    expect(mpAmountMatchesIntent(90000, 40000)).toBe(false);
    expect(mpAmountMatchesIntent(0, 40000)).toBe(false);
  });
});

describe('mp webhook scenarios (unit)', () => {
  const secret = 'scenario-secret';

  it('webhook duplicado: misma firma válida dos veces (idempotencia de validación)', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const { header } = sign({ secret, dataId: 'dup-1', requestId: 'same', ts });
    const once = verifyMpWebhookSignature({
      xSignature: header, xRequestId: 'same', dataId: 'dup-1', secret, nowMs: Number(ts) * 1000,
    });
    const twice = verifyMpWebhookSignature({
      xSignature: header, xRequestId: 'same', dataId: 'dup-1', secret, nowMs: Number(ts) * 1000,
    });
    expect(once.ok && twice.ok).toBe(true);
  });

  it('pago pendiente / rechazado no son acreditables', () => {
    expect(mpIsPaymentCreditableStatus('pending')).toBe(false);
    expect(mpIsPaymentCreditableStatus('in_process')).toBe(false);
    expect(mpIsPaymentCreditableStatus('rejected')).toBe(false);
    expect(mpIsPaymentCreditableStatus('cancelled')).toBe(false);
  });

  it('pileta / reserva / cuota usan la misma regla de crédito', () => {
    for (const kind of ['pool', 'booking', 'dues', 'subscription']) {
      expect(kind && mpIsPaymentCreditableStatus('approved')).toBe(true);
      expect(mpIsPaymentCreditableStatus('authorized')).toBe(false);
    }
  });
});

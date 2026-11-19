import { describe, expect, it } from 'vitest';
import {
  accessScanKind,
  buildCredentialBarcodePayload,
  credentialBarcodeCheckDigits,
  looksLikeCredentialBarcode,
  parseCredentialBarcodePayload,
  resolveAccessScanPayload,
  sanitizeBarcodeScan,
} from './barcode';
import { buildCredentialQRPayload } from './qr';

describe('credential barcode', () => {
  it('arma JCSJ-{id}-{check} para Code 128', () => {
    expect(buildCredentialBarcodePayload({ memberId: '10508' })).toMatch(/^JCSJ-10508-\d{2}$/);
    expect(buildCredentialBarcodePayload('10508', { withCheck: false })).toBe('JCSJ-10508');
    expect(buildCredentialBarcodePayload('')).toBe('');
  });

  it('el check atrapa un dígito cambiado', () => {
    const good = buildCredentialBarcodePayload('10508');
    const bad = good.replace('10508', '10509');
    expect(parseCredentialBarcodePayload(good)?.memberId).toBe('10508');
    expect(parseCredentialBarcodePayload(bad)).toBeNull();
  });

  it('acepta scan HID con AIM, CR y sin check', () => {
    expect(sanitizeBarcodeScan(']C1JCSJ-10508\r')).toBe('JCSJ-10508');
    expect(parseCredentialBarcodePayload(']C1JCSJ-10508\n')?.memberId).toBe('10508');
    expect(parseCredentialBarcodePayload('JCSJ10508')?.memberId).toBe('10508');
    expect(parseCredentialBarcodePayload('10508')?.memberId).toBe('10508');
    expect(parseCredentialBarcodePayload('10508')?.checkOk).toBeNull();
  });

  it('checkDigits es estable', () => {
    expect(credentialBarcodeCheckDigits('10508')).toBe(credentialBarcodeCheckDigits('10508'));
    expect(credentialBarcodeCheckDigits('10508')).not.toBe(credentialBarcodeCheckDigits('10509'));
  });

  it('no confunde QR firmado con barcode', () => {
    const qr = buildCredentialQRPayload({
      memberId: '10508',
      credentialToken: '3f9a0c7be21d4c55a8b6e0f1d29c7a44',
    });
    expect(looksLikeCredentialBarcode(qr)).toBe(false);
    expect(accessScanKind(qr)).toBe('qr');
    expect(resolveAccessScanPayload(qr)?.kind).toBe('qr');
    expect(resolveAccessScanPayload(qr)?.signed).toBe(true);
  });

  it('clasifica barcode vs búsqueda por apellido', () => {
    const payload = buildCredentialBarcodePayload('10508');
    expect(accessScanKind(payload)).toBe('barcode');
    expect(accessScanKind('10508')).toBe('barcode');
    expect(accessScanKind('Puebla')).toBe('search');
    expect(resolveAccessScanPayload('Puebla')).toEqual({ kind: 'search', raw: 'Puebla' });
    expect(resolveAccessScanPayload(payload)).toMatchObject({
      kind: 'barcode',
      memberId: '10508',
      signed: false,
      checkOk: true,
    });
  });
});


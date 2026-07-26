import { describe, expect, it } from 'vitest';
import { buildCredentialQRPayload, parseCredentialQRPayload } from './qr';

describe('credential QR payload', () => {
  it('arma y parsea el formato JCSJ', () => {
    const payload = buildCredentialQRPayload({ memberId: '2026887744320988' });
    expect(payload).toBe('JCSJ:2026887744320988');
    expect(parseCredentialQRPayload(payload)).toBe('2026887744320988');
  });

  it('acepta solo el número de credencial', () => {
    expect(parseCredentialQRPayload('2026887744320988')).toBe('2026887744320988');
  });

  it('rechaza basura', () => {
    expect(parseCredentialQRPayload('hola')).toBeNull();
    expect(parseCredentialQRPayload('')).toBeNull();
  });

  it('tolera espacios y payload embebido', () => {
    expect(parseCredentialQRPayload('  JCSJ: 2026887744320988  ')).toBe('2026887744320988');
    expect(parseCredentialQRPayload('xJCSJ:2026887744320988y')).toBe('2026887744320988');
  });
});

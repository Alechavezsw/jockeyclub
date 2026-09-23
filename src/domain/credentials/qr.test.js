import { describe, expect, it } from 'vitest';
import {
  buildCredentialQRPayload,
  credentialTokenMatches,
  parseCredentialQRPayload,
} from './qr';

describe('credential QR payload', () => {
  it('arma y parsea el formato firmado', () => {
    const payload = buildCredentialQRPayload({
      memberId: '2026887744320988',
      credentialToken: 'aabbccddeeff00112233445566778899',
    });
    expect(payload).toBe('JCSJ:2026887744320988.aabbccddeeff00112233445566778899');
    expect(parseCredentialQRPayload(payload)).toEqual({
      memberId: '2026887744320988',
      token: 'aabbccddeeff00112233445566778899',
      signed: true,
    });
  });

  it('acepta solo el número de credencial (sin firma)', () => {
    expect(parseCredentialQRPayload('2026887744320988')).toEqual({
      memberId: '2026887744320988',
      token: null,
      signed: false,
    });
    expect(parseCredentialQRPayload('123456')).toEqual({
      memberId: '123456',
      token: null,
      signed: false,
    });
  });

  it('rechaza basura', () => {
    expect(parseCredentialQRPayload('hola')).toBeNull();
    expect(parseCredentialQRPayload('')).toBeNull();
  });

  it('tolera espacios y payload embebido', () => {
    expect(parseCredentialQRPayload('  JCSJ: 2026887744320988  ').memberId).toBe('2026887744320988');
    expect(parseCredentialQRPayload('xJCSJ:2026887744320988y').memberId).toBe('2026887744320988');
  });

  it('compara el token en tiempo constante', () => {
    const member = { credentialToken: 'aabbccddeeff00112233445566778899' };
    const parsed = parseCredentialQRPayload(
      buildCredentialQRPayload({ memberId: '1', credentialToken: member.credentialToken })
    );
    expect(credentialTokenMatches(member, parsed)).toBe(true);
    expect(credentialTokenMatches(member, { ...parsed, token: 'bbccddeeff00112233445566778899aa' })).toBe(false);
  });
});

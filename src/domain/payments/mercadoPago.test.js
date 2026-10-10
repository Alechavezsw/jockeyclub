import { describe, expect, it } from 'vitest';
import {
  isMpKind,
  isMpPaidStatus,
  mergeMercadoPagoSettings,
  mpBackPath,
  mpCheckoutTitle,
  mpChannelFor,
  mpMoney,
  sanitizeMpOrigin,
} from './mercadoPago';

describe('mercadoPago', () => {
  it('solo prende la integración cuando el club la habilita', () => {
    expect(mergeMercadoPagoSettings({}).enabled).toBe(false);
    expect(mergeMercadoPagoSettings({ enabled: true }).enabled).toBe(true);
    expect(mergeMercadoPagoSettings({}).posId).toBe('jcsj-caja');
  });

  it('acepta el origen del portal y descarta uno ajeno', () => {
    expect(sanitizeMpOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(sanitizeMpOrigin('https://jockeyclubsj.com.ar')).toBe('https://jockeyclubsj.com.ar');
    expect(sanitizeMpOrigin('https://www.jockeyclubsj.com.ar')).toBe('https://www.jockeyclubsj.com.ar');
    expect(sanitizeMpOrigin('https://jockeyclubsj.org')).toBe('https://jockeyclubsj.com.ar');
    expect(sanitizeMpOrigin('https://evil.example')).toBe('https://jockeyclubsj.com.ar');
  });

  it('nombra el checkout según el cobro', () => {
    expect(isMpKind('dues')).toBe(true);
    expect(mpCheckoutTitle('pool')).toMatch(/pileta/i);
    expect(mpBackPath('subscription')).toBe('/cuenta');
    expect(mpMoney('1500.456')).toBe(1500.46);
    expect(isMpPaidStatus('approved')).toBe(true);
    expect(isMpPaidStatus('pending')).toBe(false);
    expect(mpChannelFor({ mode: 'qr' })).toBe('onsite');
    expect(mpChannelFor({ kind: 'subscription' })).toBe('subscription');
    expect(mpChannelFor({ subscribe: true, mode: 'qr' })).toBe('subscription');
    expect(mpChannelFor({ mode: 'redirect' })).toBe('online');
  });
});

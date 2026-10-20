import { describe, expect, it } from 'vitest';
import {
  mpReceiptChannelLabel,
  mpReceiptChannelOf,
  mpReceiptCopy,
  mpReceiptDeliverableEmail,
  shouldIssueMpDuesReceipt,
} from './mpPaymentReceipt';

describe('mpPaymentReceipt', () => {
  it('el comprobante es de cuota, no de pileta', () => {
    expect(shouldIssueMpDuesReceipt('dues')).toBe(true);
    expect(shouldIssueMpDuesReceipt('subscription')).toBe(true);
    expect(shouldIssueMpDuesReceipt('pool')).toBe(false);
  });

  it('distingue cuenta, QR del club y débito mensual', () => {
    expect(mpReceiptChannelOf({ channel: 'online' })).toBe('online');
    expect(mpReceiptChannelOf({ channel: 'onsite' })).toBe('onsite');
    expect(mpReceiptChannelOf({ from_subscription: 'abc' })).toBe('subscription');
    expect(mpReceiptChannelLabel('online')).toMatch(/Mi cuenta/i);
    expect(mpReceiptChannelLabel('onsite')).toMatch(/QR/i);
    expect(mpReceiptChannelLabel('subscription')).toMatch(/débito/i);
  });

  it('arma el comprobante con número, importe y aviso al socio', () => {
    const copy = mpReceiptCopy({
      name: 'Rubén Chávez',
      memberNumber: '100874',
      amount: 70000,
      receiptNumber: 'MP-a1b2c3d4',
      channel: 'onsite',
      date: '15 de octubre de 2026',
      concept: 'Cuota social · Mercado Pago',
      period: '10/2026',
    });
    expect(copy.kind).toBe('dues_receipt');
    expect(copy.subject).toMatch(/Comprobante de pago/i);
    expect(copy.text).toMatch(/Rubén Chávez/);
    expect(copy.text).toMatch(/MP-a1b2c3d4/);
    expect(copy.text).toMatch(/QR en el club/);
    expect(copy.text).toMatch(/70\.000/);
    expect(copy.html).toMatch(/Comprobante de pago/);
    expect(copy.html).toMatch(/MP-a1b2c3d4/);
    expect(copy.html).toMatch(/https:\/\/www\.jockeyclubsj\.com\.ar\/cuenta/);
  });

  it('no manda mail a alias que rebotan', () => {
    expect(mpReceiptDeliverableEmail('socio@gmail.com')).toBe('socio@gmail.com');
    expect(mpReceiptDeliverableEmail('5586118@jockeyclubsj.com')).toBe('');
    expect(mpReceiptDeliverableEmail('alejandro@jockeyclubsj.com.ar')).toBe('alejandro@jockeyclubsj.com.ar');
    expect(mpReceiptDeliverableEmail('x@lila-jockey.test')).toBe('');
  });
});

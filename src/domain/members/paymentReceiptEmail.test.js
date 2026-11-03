import { describe, expect, it } from 'vitest';
import {
  paymentReceiptDeliverableEmail,
  paymentReceiptEmailCopy,
} from './paymentReceiptEmail';

describe('paymentReceiptEmailCopy', () => {
  it('arma el mail institucional del comprobante', () => {
    const copy = paymentReceiptEmailCopy({
      name: 'Ana',
      memberNumber: '10343',
      amount: 32000,
      receiptNumber: '3661928',
      methodLabel: 'Pago con Efectivo',
      date: '2 de Noviembre del 2026',
      concept: 'Cuota social',
    });
    expect(copy.subject).toMatch(/Comprobante de pago/);
    expect(copy.kind).toBe('dues_receipt');
    expect(copy.text).toContain('Ana');
    expect(copy.text).toContain('3661928');
    expect(copy.text).toContain('Pago con Efectivo');
    expect(copy.html).toContain('Ver Mi cuenta');
    expect(copy.html).toContain('jockeyclubsj.com.ar/cuenta');
  });
});

describe('paymentReceiptDeliverableEmail', () => {
  it('rechaza mails internos del club', () => {
    expect(paymentReceiptDeliverableEmail('ana@example.com')).toBe('ana@example.com');
    expect(paymentReceiptDeliverableEmail('x@lila-jockey.local')).toBe('');
    expect(paymentReceiptDeliverableEmail('ops@jockeyclubsj.com')).toBe('');
  });
});

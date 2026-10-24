import { describe, expect, it } from 'vitest';
import {
  AMET_CASH_ACCOUNT,
  CASH_JOURNAL_ACCOUNT,
  CLUB_BANK_ACCOUNTS,
  MERCADO_PAGO,
  buildMercadoPagoQrPayload,
  journalAccountForPayment,
} from './clubBanks';

describe('journalAccountForPayment', () => {
  it('efectivo y tarjeta van a Caja General', () => {
    expect(journalAccountForPayment('efectivo')).toBe(CASH_JOURNAL_ACCOUNT);
    expect(journalAccountForPayment('tarjeta')).toBe(CASH_JOURNAL_ACCOUNT);
  });

  it('Mercado Pago y transferencia usan el banco del club', () => {
    expect(journalAccountForPayment('mercadopago')).toBe(MERCADO_PAGO.journalAccount);
    expect(journalAccountForPayment('transferencia', 'nacion')).toBe('Banco Nación');
    expect(journalAccountForPayment('transferencia', 'desconocido')).toBe(CLUB_BANK_ACCOUNTS[0].journalAccount);
  });
});

describe('buildMercadoPagoQrPayload', () => {
  it('arma alias, monto y referencia', () => {
    const payload = buildMercadoPagoQrPayload({
      amount: 40000,
      memberId: '244346',
      memberName: 'Ana',
      concept: 'Cuota social',
    });
    expect(payload).toMatch(/^mercadopago:/);
    expect(payload).toContain(`alias=${MERCADO_PAGO.alias}`);
    expect(payload).toContain('amount=40000');
    expect(payload).toContain('concept=Cuota social');
    expect(payload).toMatch(/ref=JCSJ-244346-/);
  });
});

describe('cuentas institucionales', () => {
  it('tiene Nación, MP y AMET con cuenta de asiento', () => {
    expect(CLUB_BANK_ACCOUNTS[0].id).toBe('nacion');
    expect(CLUB_BANK_ACCOUNTS[0].cbu).toHaveLength(22);
    expect(MERCADO_PAGO.journalAccount).toBeTruthy();
    expect(AMET_CASH_ACCOUNT.journalAccount).toBe('AMET');
  });
});

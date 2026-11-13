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

  it('Mercado Pago y transferencia usan las cuentas del club', () => {
    expect(journalAccountForPayment('mercadopago')).toBe('Mercado Pago');
    expect(journalAccountForPayment('transferencia', 'macro')).toBe('Banco Macro');
    expect(journalAccountForPayment('transferencia', 'mercadopago')).toBe('Mercado Pago');
    expect(journalAccountForPayment('transferencia', 'desconocido')).toBe(CLUB_BANK_ACCOUNTS[0].journalAccount);
  });

  it('débito acredita en el banco o alias elegido', () => {
    expect(journalAccountForPayment('debito', 'macro')).toBe('Banco Macro');
    expect(journalAccountForPayment('debito', 'mercadopago')).toBe('Mercado Pago');
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
  it('tiene Macro y Mercado Pago (sin Nación)', () => {
    expect(CLUB_BANK_ACCOUNTS.map((b) => b.id)).toEqual(['macro', 'mercadopago']);
    expect(CLUB_BANK_ACCOUNTS.some((b) => b.id === 'nacion')).toBe(false);
    expect(CLUB_BANK_ACCOUNTS[0].alias).toBe('Jockey.club.sj');
    expect(MERCADO_PAGO.journalAccount).toBe('Mercado Pago');
    expect(AMET_CASH_ACCOUNT.journalAccount).toBe('AMET');
  });
});

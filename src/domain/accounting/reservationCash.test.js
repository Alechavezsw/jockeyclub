import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts.js';
import {
  buildReservationCashJournal,
  reservationCashConcept,
  reservationCashShouldPost,
  reservationCashTreasuryAccount,
} from './reservationCash.js';

const reservation = {
  id: 'res-1',
  facilityId: 'salon_anhelo',
  facilityName: 'Salón Anhelo',
  memberName: 'Lucas Alberto Reynoso',
  date: '2026-11-13',
  time: '20:00',
  estimatedPrice: 170000,
  depositAmount: 85000,
  chargedPrice: 85000,
  paymentMethod: 'transferencia',
};

describe('reservationCash', () => {
  it('no asienta cuenta corriente ni Mercado Pago', () => {
    expect(reservationCashShouldPost('cuenta_corriente')).toBe(false);
    expect(reservationCashShouldPost('mercadopago')).toBe(false);
    expect(reservationCashShouldPost('efectivo')).toBe(true);
    expect(reservationCashShouldPost('transferencia')).toBe(true);
  });

  it('elige banco en transferencia, Tarjetas a cobrar en POS y caja en efectivo', () => {
    expect(reservationCashTreasuryAccount('transferencia')).toBe('Banco Macro');
    expect(reservationCashTreasuryAccount('efectivo')).toBe('Caja General');
    expect(reservationCashTreasuryAccount('tarjeta')).toBe('Tarjetas a cobrar');
    expect(reservationCashTreasuryAccount('pos')).toBe('Tarjetas a cobrar');
  });

  it('arma concepto de confirmación / seña', () => {
    expect(reservationCashConcept(reservation, { confirm: true, scope: 'deposit' }))
      .toContain('Confirmación · Seña reserva');
    expect(reservationCashConcept(reservation, { confirm: true, scope: 'deposit' }))
      .toContain('Salón Anhelo');
  });

  it('buildReservationCashJournal debita banco y acredita reservas', () => {
    const entry = buildReservationCashJournal({
      reservation,
      method: 'transferencia',
      amount: 85000,
      confirm: true,
      chart: DEFAULT_CHART_OF_ACCOUNTS,
      date: '2026-11-13',
    });
    expect(entry.sourceModule).toBe('reservas');
    expect(entry.description).toMatch(/Confirmación · Seña reserva/);
    const debit = entry.lines.find((l) => l.debit > 0);
    const credit = entry.lines.find((l) => l.credit > 0);
    expect(debit.debit).toBe(85000);
    expect(credit.credit).toBe(85000);
    expect(debit.accountId).toBe('coa-1.1.03');
    expect(credit.accountId).toBe('coa-4.1.02');
  });

  it('no duplica si ya hay depositJournalId', () => {
    const entry = buildReservationCashJournal({
      reservation: { ...reservation, depositJournalId: 'je-already' },
      method: 'efectivo',
      amount: 85000,
      chart: DEFAULT_CHART_OF_ACCOUNTS,
    });
    expect(entry).toBeNull();
  });
});

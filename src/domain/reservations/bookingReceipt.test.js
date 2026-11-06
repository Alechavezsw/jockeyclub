import { describe, expect, it } from 'vitest';
import {
  buildBookingPaymentReceipt,
  buildBookingReceiptFromReservation,
  reservationPaidInFull,
} from './bookingReceipt';

describe('buildBookingPaymentReceipt', () => {
  const member = { memberId: '11017', name: 'Ana' };
  const facility = { id: 'salon', name: 'Salón Maurín', defaultPrice: 200000 };

  it('arma comprobante de seña con saldo pendiente', () => {
    const payment = buildBookingPaymentReceipt({
      member,
      facility,
      date: '2026-12-01',
      time: '21:00',
      method: 'transferencia',
      payFull: false,
      today: '2026-11-06',
    });
    expect(payment.kind).toBe('reserva');
    expect(payment.bookingScope).toBe('deposit');
    expect(payment.amount).toBe(100000);
    expect(payment.totalPrice).toBe(200000);
    expect(payment.balanceRemaining).toBe(100000);
    expect(payment.concept).toMatch(/Seña 50 %/i);
    expect(payment.receiptNumber).toMatch(/^RSV-SEN-/);
    expect(payment.period).toContain('2026-12-01');
  });

  it('arma comprobante de alquiler total saldado', () => {
    const payment = buildBookingPaymentReceipt({
      member,
      facility,
      date: '2026-12-01',
      time: '21:00',
      method: 'efectivo',
      payFull: true,
      today: '2026-11-06',
    });
    expect(payment.bookingScope).toBe('total');
    expect(payment.amount).toBe(200000);
    expect(payment.balanceRemaining).toBe(0);
    expect(payment.concept).toMatch(/Alquiler total/i);
    expect(payment.receiptNumber).toMatch(/^RSV-TOT-/);
  });

  it('reimprime desde una fila de reserva', () => {
    const seña = buildBookingReceiptFromReservation({
      memberId: '11017',
      memberName: 'Ana',
      facilityName: 'Salón Bustos',
      date: '2026-11-22',
      time: '20:00',
      estimatedPrice: 200000,
      depositAmount: 100000,
      paymentMethod: 'transferencia',
      createdAt: '2026-11-06T18:00:00.000Z',
    }, { payFull: false });
    expect(seña.amount).toBe(100000);
    expect(seña.balanceRemaining).toBe(100000);
    expect(seña.facilityName).toBe('Salón Bustos');

    const total = buildBookingReceiptFromReservation({
      memberId: '11017',
      memberName: 'Ana',
      facilityName: 'Salón Bustos',
      date: '2026-11-22',
      time: '20:00',
      estimatedPrice: 200000,
    }, { payFull: true });
    expect(total.amount).toBe(200000);
    expect(total.balanceRemaining).toBe(0);
  });

  it('detecta pago total vs seña', () => {
    expect(reservationPaidInFull({
      estimatedPrice: 200000,
      chargedPrice: 200000,
    })).toBe(true);
    expect(reservationPaidInFull({
      estimatedPrice: 200000,
      chargedPrice: 100000,
    })).toBe(false);
    expect(reservationPaidInFull({
      estimatedPrice: 200000,
      chargedPrice: 100000,
      notes: 'Pago: total alquiler',
    })).toBe(true);
  });
});

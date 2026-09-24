import { describe, expect, it } from 'vitest';
import { MAILBOX } from '../messaging/messages';
import { bookingPaymentNotice, duesPaymentNotice } from './duesPaymentNotice';

describe('duesPaymentNotice', () => {
  it('el QR avisa a administración con alias y referencia', () => {
    const msg = duesPaymentNotice({
      memberName: 'Ana',
      memberId: '111',
      amountLabel: '$ 10.000',
      method: 'mercadopago',
      qrRef: 'JCSJ-111',
    });
    expect(msg.recipientId).toBe(MAILBOX.OPERATIONS);
    expect(msg.subject).toBe('Pago por Mercado Pago');
    expect(msg.content).toMatch(/jockey.club.sj.mp/);
    expect(msg.content).toMatch(/JCSJ-111/);
  });

  it('la transferencia lleva el nombre del comprobante', () => {
    const msg = duesPaymentNotice({
      memberName: 'Ana',
      memberId: '111',
      method: 'transferencia',
      attachment: { name: 'recibo.jpg', path: 'uid/recibo.jpg' },
    });
    expect(msg.subject).toBe('Comprobante de transferencia');
    expect(msg.content).toMatch(/recibo.jpg/);
    expect(msg.meta.attachment.path).toBe('uid/recibo.jpg');
  });

  it('la reserva avisa el salón y el horario', () => {
    const msg = bookingPaymentNotice({
      memberName: 'Ana',
      memberId: '111',
      amountLabel: '$ 170.000',
      facilityName: 'Salón Bustos',
      dateLabel: 'jueves, 24 de septiembre',
      time: '18:00',
      method: 'mercadopago',
      qrRef: 'JCSJ-111',
    });
    expect(msg.recipientId).toBe(MAILBOX.OPERATIONS);
    expect(msg.subject).toBe('Pago de reserva por Mercado Pago');
    expect(msg.content).toMatch(/Salón Bustos/);
    expect(msg.content).toMatch(/18:00/);
    expect(msg.meta.kind).toBe('booking_payment');
  });
});
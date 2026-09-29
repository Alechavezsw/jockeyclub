import { describe, expect, it } from 'vitest';
import { MAILBOX } from '../messaging/messages';
import { bookingPaymentNotice, duesBoletoMessage, duesPaymentNotice } from './duesPaymentNotice';
import { buildOnlineDuesBoleto } from './duesReceiptDelivery';
import { paymentBoletoPdfFile } from './exportPaymentReceiptPdf';

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

  it('arma un boleto con número del día, sin marcarlo como cobrado', () => {
    const boleto = buildOnlineDuesBoleto({
      member: { memberId: '111' },
      amount: 10000,
      dueLabel: '10 sep 2026',
    });
    expect(boleto.method).toBe('mercadopago');
    expect(boleto.status).toBe('issued');
    expect(boleto.amount).toBe(10000);
    expect(boleto.receipt).toMatch(/^BOL-111-\d{8}$/);
    expect(boleto.period).toBe('10 sep 2026');
  });

  it('el PDF del boleto se arma y dice boleto, no recibo cobrado', async () => {
    const boleto = buildOnlineDuesBoleto({
      member: { memberId: '111', name: 'Ana' },
      amount: 10000,
      dueLabel: '10 sep 2026',
    });
    const file = await paymentBoletoPdfFile({
      member: { memberId: '111', name: 'Ana' },
      boleto,
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = String.fromCharCode(...bytes.slice(0, 5));
    expect(file.type).toBe('application/pdf');
    expect(file.name).toMatch(/^boleto-BOL-/);
    expect(head).toBe('%PDF-');
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toMatch(/BOLETO DE PAGO/);
    expect(text).not.toMatch(/constancia de pago/);
  });

  it('el boleto de Mercado Pago va al socio, no a caja', () => {
    const msg = duesBoletoMessage({
      member: { name: 'Ana', memberId: '111' },
      boleto: { amount: 10000, receiptNumber: 'BOL-111-20260929', period: '10 sep 2026' },
    });
    expect(msg.recipientId).toBe('111');
    expect(msg.subject).toBe('Boleto de pago de cuota');
    expect(msg.content).toMatch(/Mercado Pago/);
    expect(msg.content).toMatch(/BOL-111-20260929/);
    expect(msg.meta.kind).toBe('dues_boleto');
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
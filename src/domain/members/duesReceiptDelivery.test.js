import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../data/storage', () => ({
  uploadDuesReceipt: vi.fn(),
}));

import { uploadDuesReceipt } from '../../data/storage';
import {
  buildOnlineDuesBoleto,
  prepareOnlineDuesBoleto,
  sendDuesReceiptMessage,
} from './duesReceiptDelivery';

describe('buildOnlineDuesBoleto', () => {
  it('arma un boleto emitido de Mercado Pago', () => {
    const boleto = buildOnlineDuesBoleto({
      member: { memberId: '244346' },
      amount: 40000,
      dueLabel: '10 oct 2026',
    });
    expect(boleto.status).toBe('issued');
    expect(boleto.method).toBe('mercadopago');
    expect(boleto.amount).toBe(40000);
    expect(boleto.receipt).toMatch(/^BOL-244346-\d{8}$/);
    expect(boleto.period).toBe('10 oct 2026');
  });
});

describe('prepareOnlineDuesBoleto', () => {
  beforeEach(() => {
    uploadDuesReceipt.mockReset();
  });

  it('genera PDF, sube comprobante y arma mensaje al socio', async () => {
    uploadDuesReceipt.mockResolvedValue({
      path: '244346/boleto.pdf',
      bucket: 'dues-receipts',
      name: 'boleto.pdf',
    });
    const result = await prepareOnlineDuesBoleto({
      member: { memberId: '244346', name: 'Ana' },
      amount: 40000,
      dueLabel: '10 oct 2026',
      profileId: '244346',
    });
    expect(result.boleto.amount).toBe(40000);
    expect(result.file.type).toBe('application/pdf');
    expect(uploadDuesReceipt).toHaveBeenCalledOnce();
    expect(result.message.recipientId).toBe('244346');
    expect(result.message.meta.kind).toBe('dues_boleto');
    expect(result.message.meta.attachment.path).toBe('244346/boleto.pdf');
  });

  it('si falla el upload, igual entrega boleto y mensaje sin attachment', async () => {
    uploadDuesReceipt.mockRejectedValue(new Error('offline'));
    const result = await prepareOnlineDuesBoleto({
      member: { memberId: '111', name: 'Ana' },
      amount: 1000,
    });
    expect(result.boleto.status).toBe('issued');
    expect(result.message.meta?.attachment).toBeFalsy();
  });
});

describe('sendDuesReceiptMessage', () => {
  beforeEach(() => {
    uploadDuesReceipt.mockReset();
  });

  it('no hace nada sin callback o sin pago', async () => {
    await sendDuesReceiptMessage({ member: { memberId: '1' }, payment: { amount: 1 } });
    await sendDuesReceiptMessage({
      member: { memberId: '1' },
      payment: null,
      onSendMessage: vi.fn(),
    });
    expect(uploadDuesReceipt).not.toHaveBeenCalled();
  });

  it('manda el recibo aunque el upload falle', async () => {
    uploadDuesReceipt.mockRejectedValue(new Error('sin supabase'));
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    await sendDuesReceiptMessage({
      member: { memberId: '111', name: 'Ana' },
      payment: {
        amount: 40000,
        date: '2026-10-20',
        method: 'efectivo',
        receiptNumber: 'RC-111-20261020',
        concept: 'Cuota social',
      },
      onSendMessage,
    });
    expect(onSendMessage).toHaveBeenCalledOnce();
    expect(onSendMessage.mock.calls[0][0].recipientId).toBe('111');
    expect(onSendMessage.mock.calls[0][0].meta.kind).toBe('dues_receipt');
  });

  it('no corta el cobro si el envío falla', async () => {
    uploadDuesReceipt.mockResolvedValue({ path: 'x', name: 'r.pdf' });
    const onSendMessage = vi.fn().mockRejectedValue(new Error('mailbox down'));
    await expect(sendDuesReceiptMessage({
      member: { memberId: '111', name: 'Ana' },
      payment: {
        amount: 1000,
        date: '2026-10-20',
        method: 'efectivo',
        receiptNumber: 'RC-1',
        concept: 'Cuota',
      },
      onSendMessage,
    })).resolves.toBeUndefined();
  });
});

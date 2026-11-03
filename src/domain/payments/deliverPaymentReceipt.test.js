import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../members/duesReceiptDelivery', () => ({
  sendDuesReceiptMessage: vi.fn(),
}));
vi.mock('../accounting/cashPaymentReceiptDelivery', () => ({
  sendCashPaymentReceipt: vi.fn(),
}));

import { sendDuesReceiptMessage } from '../members/duesReceiptDelivery';
import { sendCashPaymentReceipt } from '../accounting/cashPaymentReceiptDelivery';
import { deliverPaymentReceipt, PAYMENT_RECEIPT_TRIGGERS } from './deliverPaymentReceipt';

describe('deliverPaymentReceipt', () => {
  beforeEach(() => {
    sendDuesReceiptMessage.mockReset().mockResolvedValue(undefined);
    sendCashPaymentReceipt.mockReset().mockResolvedValue({ emailed: true, messaged: true });
  });

  it('cubre los canales de la regla permanente', () => {
    expect(PAYMENT_RECEIPT_TRIGGERS).toEqual(expect.arrayContaining([
      'debito_automatico',
      'app_socio',
      'efectivo',
      'mercadopago',
      'tarjeta',
      'transferencia',
      'reserva',
      'cuota',
      'porteria',
    ]));
  });

  it('manda comprobante de cuota al socio', async () => {
    await deliverPaymentReceipt({
      member: { memberId: '10343', name: 'Ana', tier: 'socio_individual' },
      payment: { amount: 32000, method: 'efectivo', receiptNumber: 'RC-1' },
      onSendMessage: vi.fn(),
      kind: 'cuota',
    });
    expect(sendDuesReceiptMessage).toHaveBeenCalledOnce();
  });

  it('no manda cuota a exento', async () => {
    const result = await deliverPaymentReceipt({
      member: { memberId: '1', name: 'Vitalicio', tier: 'vitalicio' },
      payment: { amount: 1 },
      kind: 'cuota',
    });
    expect(result.reason).toBe('dues-exempt');
    expect(sendDuesReceiptMessage).not.toHaveBeenCalled();
  });

  it('usa el detalle de caja cuando viene de movimientos', async () => {
    await deliverPaymentReceipt({
      cashDetail: { memberNumber: '10343', paymentTotal: 1000 },
      onSendMessage: vi.fn(),
      kind: 'efectivo',
    });
    expect(sendCashPaymentReceipt).toHaveBeenCalledOnce();
  });
});

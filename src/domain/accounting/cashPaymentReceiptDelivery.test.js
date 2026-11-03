import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../data/storage', () => ({
  uploadDuesReceipt: vi.fn(),
}));
vi.mock('../../data/repos', () => ({
  sendPaymentReceiptEmail: vi.fn(),
}));
vi.mock('./exportCashPaymentPdf', () => ({
  cashPaymentPdfFile: vi.fn(),
}));

import { uploadDuesReceipt } from '../../data/storage';
import { sendPaymentReceiptEmail } from '../../data/repos';
import { cashPaymentPdfFile } from './exportCashPaymentPdf';
import {
  cashPaymentReceiptMessage,
  sendCashPaymentReceipt,
} from './cashPaymentReceiptDelivery';

const DETAIL = {
  memberNumber: '10343',
  memberName: 'Ana',
  email: 'ana@example.com',
  paymentNumber: '3661928',
  accessinId: 3661928,
  paymentTotal: 32000,
  description: 'Pago con Efectivo',
  dateLabel: '2 de Noviembre del 2026',
  typeLabel: 'Pago con Efectivo',
  paymentMethods: [{ id: '1', label: 'Pago con Efectivo', amount: 32000 }],
};

describe('cashPaymentReceiptMessage', () => {
  it('arma el MD del comprobante al socio', () => {
    const msg = cashPaymentReceiptMessage({ detail: DETAIL });
    expect(msg.recipientId).toBe('10343');
    expect(msg.meta.kind).toBe('dues_receipt');
    expect(msg.content).toContain('3661928');
  });
});

describe('sendCashPaymentReceipt', () => {
  beforeEach(() => {
    uploadDuesReceipt.mockReset();
    sendPaymentReceiptEmail.mockReset();
    cashPaymentPdfFile.mockReset();
    cashPaymentPdfFile.mockResolvedValue(new File([new Uint8Array([1, 2, 3])], 'pago.pdf', {
      type: 'application/pdf',
    }));
    uploadDuesReceipt.mockResolvedValue({ path: '10343/pago.pdf', name: 'pago.pdf' });
    sendPaymentReceiptEmail.mockResolvedValue({ ok: true, id: 're_1', to: 'ana@example.com' });
  });

  it('envía MD y mail con el PDF', async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const result = await sendCashPaymentReceipt({ detail: DETAIL, onSendMessage });
    expect(result.emailed).toBe(true);
    expect(result.messaged).toBe(true);
    expect(onSendMessage).toHaveBeenCalledOnce();
    expect(sendPaymentReceiptEmail).toHaveBeenCalledOnce();
    expect(sendPaymentReceiptEmail.mock.calls[0][0].memberNumber).toBe('10343');
    expect(sendPaymentReceiptEmail.mock.calls[0][0].receiptNo).toBe('3661928');
  });

  it('sin mail real igual manda MD', async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const result = await sendCashPaymentReceipt({
      detail: { ...DETAIL, email: 'ops@jockeyclubsj.com' },
      onSendMessage,
    });
    expect(result.emailed).toBe(false);
    expect(result.messaged).toBe(true);
    expect(sendPaymentReceiptEmail).not.toHaveBeenCalled();
  });
});

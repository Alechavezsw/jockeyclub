import { describe, expect, it } from 'vitest';
import { MAILBOX } from '../messaging/messages';
import {
  appPaymentRequestAmountLabel,
  appPaymentRequestBankId,
  appPaymentRequestCollectMethod,
  appPaymentRequestMemberId,
  appPaymentRequestMethodLabel,
  appPaymentRequestReceipt,
  isAppPaymentAuto,
  isAppPaymentRequest,
  isOpenAppPaymentRequest,
  listOpenAppPaymentRequests,
  withAppPaymentHandled,
} from './appPaymentRequests';

describe('appPaymentRequests', () => {
  const transfer = {
    id: '1',
    recipientId: MAILBOX.OPERATIONS,
    senderId: '12063',
    isRead: false,
    createdAt: '2026-11-14T12:00:00.000Z',
    content: 'Dayana envió el comprobante.\nImporte: $ 40.000\nBanco: Banco Macro',
    meta: {
      kind: 'dues_payment',
      method: 'transferencia',
      attachment: { path: 'uid/comp.jpg', name: 'comp.jpg', bucket: 'dues-receipts' },
    },
  };

  it('marca transferencia, débito y Mercado Pago como operación entrante', () => {
    expect(isAppPaymentRequest(transfer)).toBe(true);
    expect(isAppPaymentRequest({
      ...transfer,
      meta: { kind: 'dues_payment', method: 'debito' },
    })).toBe(true);
    const mp = {
      ...transfer,
      meta: { kind: 'dues_payment', method: 'mercadopago', paymentAuto: true },
    };
    expect(isAppPaymentRequest(mp)).toBe(true);
    expect(isAppPaymentAuto(mp)).toBe(true);
    expect(isAppPaymentAuto(transfer)).toBe(false);
  });

  it('quedan abiertas hasta paymentHandled, aunque estén leídas en MD', () => {
    expect(isOpenAppPaymentRequest(transfer)).toBe(true);
    expect(isOpenAppPaymentRequest({ ...transfer, isRead: true })).toBe(true);
    expect(isOpenAppPaymentRequest(withAppPaymentHandled(transfer))).toBe(false);
    expect(listOpenAppPaymentRequests([
      transfer,
      withAppPaymentHandled({ ...transfer, id: '2' }),
      { ...transfer, id: '3', isRead: true, createdAt: '2026-11-14T13:00:00.000Z' },
    ]).map((m) => m.id)).toEqual(['3', '1']);
  });

  it('lee socio, importe, banco y comprobante del aviso', () => {
    expect(appPaymentRequestMemberId(transfer)).toBe('12063');
    expect(appPaymentRequestMethodLabel(transfer)).toBe('Transferencia');
    expect(appPaymentRequestAmountLabel(transfer)).toBe('$ 40.000');
    expect(appPaymentRequestCollectMethod(transfer)).toBe('transferencia');
    expect(appPaymentRequestBankId(transfer)).toBe('macro');
    expect(appPaymentRequestReceipt(transfer)?.path).toBe('uid/comp.jpg');
  });
});

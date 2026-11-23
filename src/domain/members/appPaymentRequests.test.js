import { describe, expect, it } from 'vitest';
import { MAILBOX } from '../messaging/messages';
import {
  appPaymentRequestAmountLabel,
  appPaymentRequestBankId,
  appPaymentRequestCollectMethod,
  appPaymentRequestCollectionLabel,
  appPaymentRequestMemberId,
  appPaymentRequestMethodLabel,
  appPaymentRequestReceipt,
  appPaymentRequestProviderId,
  dedupeOpenAppPaymentRequests,
  findAppPaymentRequestCollection,
  groupOpenAppPaymentRequests,
  isAppPaymentAuto,
  isAppPaymentBookingRequest,
  isAppPaymentDuesRequest,
  isAppPaymentRequest,
  isOpenAppPaymentRequest,
  listOpenAppPaymentRequests,
  parseAppPaymentAmountLabel,
  withAppPaymentHandled,
  withAppPaymentRead,
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

  it('leer el comprobante de transferencia no cierra ni imputa', () => {
    const read = withAppPaymentRead(transfer);
    expect(read.isRead).toBe(true);
    expect(read.meta.paymentHandled).toBeUndefined();
    expect(isOpenAppPaymentRequest(read)).toBe(true);
    expect(isOpenAppPaymentRequest(withAppPaymentHandled(read))).toBe(false);
  });

  it('quedan abiertas hasta paymentHandled, aunque estén leídas en MD', () => {
    expect(isOpenAppPaymentRequest(transfer)).toBe(true);
    expect(isOpenAppPaymentRequest({ ...transfer, isRead: true })).toBe(true);
    expect(isOpenAppPaymentRequest(withAppPaymentHandled(transfer))).toBe(false);
    // Mismo socio + mismo importe → un solo aviso (el más reciente).
    expect(listOpenAppPaymentRequests([
      transfer,
      withAppPaymentHandled({ ...transfer, id: '2' }),
      { ...transfer, id: '3', isRead: true, createdAt: '2026-11-14T13:00:00.000Z' },
    ]).map((m) => m.id)).toEqual(['3']);
  });

  it('no repite el mismo cobro MP como transferencia y Mercado Pago', () => {
    const mp = {
      ...transfer,
      id: 'mp-auto',
      senderId: '100714',
      createdAt: '2026-11-14T18:00:00.000Z',
      content: 'Adrian Fernandez (Nº 100714) pagó por Mercado Pago.\nImporte: $ 88,000.00',
      meta: {
        kind: 'dues_payment',
        method: 'mercadopago',
        paymentAuto: true,
        provider_payment_id: '188540448227',
      },
    };
    const transferMpPdf = {
      ...transfer,
      id: 'xfer-mp',
      senderId: '100714',
      createdAt: '2026-11-14T12:00:00.000Z',
      content: 'Adrian Fernandez (Nº 100714) envió el comprobante de una transferencia.\nImporte: $ 88.000\nArchivo: Comprobante_188540448227.pdf',
      meta: {
        kind: 'dues_payment',
        method: 'transferencia',
        attachment: { name: 'Comprobante_188540448227.pdf', path: 'x/y.pdf', bucket: 'dues-receipts' },
      },
    };
    expect(appPaymentRequestProviderId(transferMpPdf)).toBe('188540448227');
    const open = listOpenAppPaymentRequests([transferMpPdf, mp]);
    expect(open.map((m) => m.id)).toEqual(['mp-auto']);
    expect(dedupeOpenAppPaymentRequests([transferMpPdf, mp]).duplicateIds).toEqual(['xfer-mp']);
  });

  it('no junta una transferencia con un Mercado Pago distinto del mismo importe', () => {
    const mp = {
      ...transfer,
      id: 'mp-otro',
      createdAt: '2026-11-14T18:00:00.000Z',
      content: 'Importe: $ 40.000',
      meta: { kind: 'dues_payment', method: 'mercadopago', paymentAuto: true },
    };
    const open = dedupeOpenAppPaymentRequests([transfer, mp]);
    expect(open.duplicateIds).toEqual([]);
    expect(open.messages.map((row) => row.id).sort()).toEqual(['1', 'mp-otro']);
  });

  it('vincula transferencia al cobro MP por id del comprobante', () => {
    const notice = {
      ...transfer,
      date: '2026-11-14',
      content: 'Adrian envió el comprobante.\nImporte: $ 88.000\nArchivo: Comprobante_188540448227.pdf',
      meta: {
        kind: 'dues_payment',
        method: 'transferencia',
        attachment: { name: 'Comprobante_188540448227.pdf', path: 'x/y.pdf' },
      },
    };
    const hit = findAppPaymentRequestCollection(notice, {
      memberId: '100714',
      paymentHistory: [{
        amount: 88000,
        method: 'mercadopago',
        date: '2026-11-14',
        receiptNumber: 'RC-MP',
        status: 'paid',
        meta: { provider_payment_id: '188540448227' },
      }],
    });
    expect(hit?.receiptNumber).toBe('RC-MP');
  });

  it('lee socio, importe, banco y comprobante del aviso', () => {
    expect(appPaymentRequestMemberId(transfer)).toBe('12063');
    expect(appPaymentRequestMethodLabel(transfer)).toBe('Transferencia');
    expect(appPaymentRequestAmountLabel(transfer)).toBe('$ 40.000');
    expect(appPaymentRequestCollectMethod(transfer)).toBe('transferencia');
    expect(appPaymentRequestBankId(transfer)).toBe('macro');
    expect(appPaymentRequestReceipt(transfer)?.path).toBe('uid/comp.jpg');
  });

  it('separa cuota y reserva en pagos entrantes', () => {
    const booking = {
      ...transfer,
      id: 'b1',
      meta: { kind: 'booking_payment', method: 'transferencia', paymentRequest: true },
    };
    expect(isAppPaymentDuesRequest(transfer)).toBe(true);
    expect(isAppPaymentBookingRequest(booking)).toBe(true);
    const grouped = groupOpenAppPaymentRequests([transfer, booking, withAppPaymentHandled({ ...booking, id: 'b2' })]);
    expect(grouped.dues.map((m) => m.id)).toEqual(['1']);
    expect(grouped.bookings.map((m) => m.id)).toEqual(['b1']);
  });

  it('detecta si la solicitud ya tiene cobro imputado', () => {
    expect(parseAppPaymentAmountLabel('$ 77.000')).toBe(77000);
    const notice = {
      ...transfer,
      date: '2026-11-12',
      content: 'Leonardo envió el comprobante.\nImporte: $ 77.000',
      meta: { kind: 'dues_payment', method: 'transferencia' },
    };
    const member = {
      memberId: '101559',
      paymentHistory: [
        {
          amount: 70000,
          method: 'transferencia',
          date: '2026-11-12',
          receiptNumber: 'RC-101559-20261112',
          status: 'paid',
        },
      ],
    };
    const hit = findAppPaymentRequestCollection(notice, member);
    expect(hit?.receiptNumber).toBe('RC-101559-20261112');
    expect(appPaymentRequestCollectionLabel(hit)).toMatch(/Ya imputado y cobrado/);
    expect(findAppPaymentRequestCollection(notice, {
      ...member,
      paymentHistory: [{ amount: 1000, method: 'efectivo', date: '2026-11-12' }],
    })).toBeNull();
  });
});

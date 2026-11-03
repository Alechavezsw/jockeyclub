import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../data/repos', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
}));
vi.mock('./cashPaymentReceiptDelivery', () => ({
  sendCashPaymentReceipt: vi.fn(),
}));

import { getSetting, setSetting } from '../../data/repos';
import { sendCashPaymentReceipt } from './cashPaymentReceiptDelivery';
import {
  autoSendCashPaymentReceipts,
  cashPaymentReceiptKey,
  isAutoCashReceiptCandidate,
} from './cashPaymentAutoReceipts';

describe('cashPaymentAutoReceipts', () => {
  beforeEach(() => {
    getSetting.mockReset();
    setSetting.mockReset();
    sendCashPaymentReceipt.mockReset();
    getSetting.mockResolvedValue({});
    setSetting.mockResolvedValue({});
  });

  it('detecta pagos de socio y arma clave estable', () => {
    const row = {
      accessinId: 3661928,
      memberNumber: '10343',
      amount: 32000,
      date: '2026-11-02',
      typeLabel: 'Pago con Efectivo',
      movementType: 'income',
    };
    expect(isAutoCashReceiptCandidate(row)).toBe(true);
    expect(cashPaymentReceiptKey(row)).toBe('10343:3661928');
    expect(isAutoCashReceiptCandidate({ ...row, memberNumber: '' })).toBe(false);
    expect(isAutoCashReceiptCandidate({ ...row, movementType: 'expense' })).toBe(false);
  });

  it('envía pendientes y marca enviados', async () => {
    sendCashPaymentReceipt.mockResolvedValue({ emailed: true, messaged: true, to: 'ana@example.com' });
    const result = await autoSendCashPaymentReceipts({
      movements: [{
        id: 'm1',
        accessinId: 3661928,
        memberNumber: '10343',
        amount: 32000,
        date: '2026-11-02',
        typeLabel: 'Pago con Efectivo',
        movementType: 'income',
      }],
      members: [{ memberId: '10343', name: 'Ana', email: 'ana@example.com' }],
      onSendMessage: vi.fn(),
      sentMap: {},
    });
    expect(result.emailed).toBe(1);
    expect(sendCashPaymentReceipt).toHaveBeenCalledOnce();
    expect(setSetting).toHaveBeenCalled();
    expect(result.sentMap['10343:3661928'].status).toBe('emailed');
    expect(result.remaining).toBe(0);
  });

  it('no reenvía si ya está marcado', async () => {
    const result = await autoSendCashPaymentReceipts({
      movements: [{
        accessinId: 3661928,
        memberNumber: '10343',
        amount: 32000,
        date: '2026-11-02',
        typeLabel: 'Pago con Efectivo',
      }],
      members: [{ memberId: '10343', email: 'ana@example.com' }],
      sentMap: { '10343:3661928': { status: 'emailed' } },
    });
    expect(result.total).toBe(0);
    expect(sendCashPaymentReceipt).not.toHaveBeenCalled();
  });
});

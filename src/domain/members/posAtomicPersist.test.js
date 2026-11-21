/**
 * B9 — persist POS atómico: si el RPC ya publicó el asiento, no re-publica.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true }));

const registrarCobroPos = vi.fn();
const registrarCobro = vi.fn();
const findDuesJournalBySourceId = vi.fn(async () => null);

vi.mock('../../data/repos', async () => {
  const actual = await vi.importActual('../../data/repos');
  return {
    ...actual,
    registrarCobroPos: (...args) => registrarCobroPos(...args),
    registrarCobro: (...args) => registrarCobro(...args),
    findDuesJournalBySourceId: (...args) => findDuesJournalBySourceId(...args),
    patchMemberPaymentChargeScope: vi.fn(async () => null),
    quitarRecargoCuota: vi.fn(),
    revertDuesPayment: vi.fn(),
  };
});

import { setRuntimeTierCatalog } from './tiers';
import { persistDuesCollection, recordDuesCollection } from './memberPayments';

const receipt = {
  path: 'desk/v.jpg',
  bucket: 'dues-receipts',
  name: 'v.jpg',
  mimeType: 'image/jpeg',
  size: 12,
};

const plans = [
  {
    id: 'visa-3-a',
    label: 'Visa 3 A',
    active: true,
    cardBrand: 'Visa',
    installments: 3,
    financingMode: 'club_keeps',
    financingPercent: 10,
    allowOperatorOverride: false,
  },
];

beforeEach(() => {
  setRuntimeTierCatalog([
    { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 40000, sortOrder: 1 },
  ]);
  registrarCobroPos.mockReset();
  registrarCobro.mockReset();
  findDuesJournalBySourceId.mockReset();
  findDuesJournalBySourceId.mockResolvedValue(null);
});

describe('B9 persist POS atómico', () => {
  it('si registrarCobroPos publica asiento, no llama addJournalEntry', async () => {
    registrarCobroPos.mockResolvedValue({
      payment: {
        id: '11111111-1111-1111-1111-111111111111',
        amount: 40000,
        method: 'tarjeta',
        date: '2026-11-05',
        cardFinancing: {
          mode: 'club_keeps',
          financingAmount: 4000,
          financingBase: 40000,
          surchargeAmount: 0,
          voucherTotal: 44000,
          authorizedByServer: true,
        },
      },
      outstandingBalance: 0,
      nextDueDate: '2026-12-10',
      imputations: [],
      journal: {
        entry: { id: '22222222-2222-2222-2222-222222222222', status: 'posted' },
        lines: [],
        idempotent: false,
      },
      authorized: true,
    });

    const member = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      memberId: '1001',
      name: 'Atomic',
      category: 'socio_individual',
      outstandingBalance: 40000,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    };
    const draft = recordDuesCollection(member, {
      method: 'tarjeta',
      journalAccount: 'Tarjetas a cobrar',
      receiptAttachment: receipt,
      receiptName: receipt.name,
      amount: 40000,
      paymentPlanId: 'visa-3-a',
      paymentPlanLabel: 'Visa 3 A',
      paymentPlans: plans,
      receiptParse: { amount: 44000, reference: 'AUTH-A', source: 'manual' },
      today: new Date('2026-11-05T12:00:00-03:00'),
    });
    draft.payment.id = 'local-pos-1';
    draft.member.id = member.id;

    const addJournalEntry = vi.fn(async () => {
      throw new Error('no debería llegar al asiento client-side');
    });
    const saved = await persistDuesCollection(draft, {
      setMembers: () => {},
      addJournalEntry,
    });
    expect(registrarCobroPos).toHaveBeenCalled();
    expect(registrarCobro).not.toHaveBeenCalled();
    expect(saved.journalAtomic).toBe(true);
    expect(saved.payment.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(addJournalEntry).not.toHaveBeenCalled();
    expect(saved.authorized).toBe(true);
  }, 15000);
});

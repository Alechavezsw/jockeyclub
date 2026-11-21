/**
 * B11 — sin fallback inseguro cuando falta registrar_cobro_pos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true }));

const registrarCobroPos = vi.fn();
const registrarCobro = vi.fn();

vi.mock('../../data/repos', async () => {
  const actual = await vi.importActual('../../data/repos');
  return {
    ...actual,
    registrarCobroPos: (...args) => registrarCobroPos(...args),
    registrarCobro: (...args) => registrarCobro(...args),
    findDuesJournalBySourceId: vi.fn(async () => null),
    patchMemberPaymentChargeScope: vi.fn(async () => null),
    quitarRecargoCuota: vi.fn(),
    revertDuesPayment: vi.fn(),
  };
});

import { setRuntimeTierCatalog } from './tiers';
import {
  commitDuesCollection,
  duesCollectionNeedsPosAtomicCommit,
  persistDuesCollection,
  recordDuesCollection,
} from './memberPayments';

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
});

function posDraft() {
  const member = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    memberId: '1001',
    name: 'POS Fail',
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
  draft.payment.id = 'local-pos-fail';
  draft.member.id = member.id;
  return draft;
}

describe('B11 POS sin degradación', () => {
  it('RPC ausente: no acredita ni llama registrarCobro', async () => {
    const missing = new Error('RPC registrar_cobro_pos no disponible');
    missing.code = 'POS_RPC_MISSING';
    registrarCobroPos.mockRejectedValue(missing);

    await expect(persistDuesCollection(posDraft(), {
      setMembers: () => {},
      addJournalEntry: vi.fn(),
    })).rejects.toMatchObject({
      code: 'POS_RPC_MISSING',
      message: expect.stringMatching(/no está disponible|administrador/i),
    });
    expect(registrarCobroPos).toHaveBeenCalled();
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it('error de red: mismo bloqueo, cero acreditación clásica', async () => {
    registrarCobroPos.mockRejectedValue(Object.assign(
      new Error('El cobro POS financiado no está disponible. Contactá al administrador'),
      { code: 'POS_RPC_MISSING' },
    ));

    await expect(commitDuesCollection(posDraft().member, posDraft().payment)).rejects.toMatchObject({
      code: 'POS_RPC_MISSING',
    });
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it('efectivo sigue usando registrarCobro (sin POS)', async () => {
    expect(duesCollectionNeedsPosAtomicCommit({ method: 'efectivo' })).toBe(false);
    expect(duesCollectionNeedsPosAtomicCommit({
      method: 'mixto',
      paymentSplits: [{ method: 'efectivo' }, { method: 'tarjeta' }],
    })).toBe(true);
  });
});

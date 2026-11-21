/**
 * B7/B10 — flujo real mostrador → recordDuesCollection (sin inyectar deps
 * que CollectDuesDeskFlow no envía).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setRuntimeTierCatalog } from './tiers';
import {
  duesCollectionNeedsPosAtomicCommit,
  recordDuesCollection,
  recordTennisAbonoCollection,
} from './memberPayments';
import { computePosFinancing } from './posFinancing';

const receipt = {
  path: 'desk/v.jpg',
  bucket: 'dues-receipts',
  name: 'v.jpg',
  mimeType: 'image/jpeg',
  size: 12,
};

const plans = [
  {
    id: 'visa-contado',
    label: 'Visa contado',
    active: true,
    cardBrand: 'Visa',
    installments: 1,
  },
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
  {
    id: 'visa-3-b',
    label: 'Visa 3 B',
    active: true,
    cardBrand: 'Visa',
    installments: 3,
    financingMode: 'issuer_keeps',
    financingPercent: 10,
    allowOperatorOverride: false,
  },
];

function deskPayload(extra = {}) {
  // Espejo de CollectDuesDeskFlow → CollectDuesModal → onConfirm
  // (paymentPlans viene del desk; no se inventan repos ni authorize).
  return {
    method: 'tarjeta',
    journalAccount: 'Tarjetas a cobrar',
    receiptAttachment: receipt,
    receiptName: receipt.name,
    amount: 40000,
    paymentPlanId: 'visa-3-a',
    paymentPlanLabel: 'Visa 3 A',
    paymentPlans: plans,
    receiptParse: { amount: 44000, reference: 'AUTH-DESK-1', source: 'manual' },
    ...extra,
  };
}

beforeEach(() => {
  setRuntimeTierCatalog([
    { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 40000, sortOrder: 1 },
  ]);
});

describe('B7 desk flow → recordDuesCollection', () => {
  it('cobro POS simple: planes del desk autorizan y separan capital/mora', () => {
    const member = {
      memberId: '1001',
      name: 'Desk Socio',
      category: 'socio_individual',
      outstandingBalance: 40000,
      unpaidCapital: 40000,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    };
    // Sin mora (pago el 5): capital 40000 → financ 10 % = 4000 → cupón 44000.
    const result = recordDuesCollection(member, deskPayload({
      amount: 40000,
      receiptParse: { amount: 44000, reference: 'AUTH-1', source: 'manual' },
      today: new Date('2026-11-05T12:00:00-03:00'),
    }));
    expect(result.payment.method).toBe('tarjeta');
    expect(result.payment.paymentPlanId).toBe('visa-3-a');
    expect(result.payment.cardFinancing).toBeTruthy();
    expect(result.payment.cardFinancing.financingBase).toBe(40000);
    expect(Number(result.payment.cardFinancing.surchargeAmount) || 0).toBe(0);
    expect(result.payment.cardFinancing.financingAmount).toBe(4000);
    expect(result.payment.cardFinancing.voucherTotal).toBe(44000);
    expect(result.payment.cardFinancing.mode).toBe('club_keeps');
    expect(duesCollectionNeedsPosAtomicCommit(result.payment)).toBe(true);

    // Con mora explícita en authorize: la tasa no se aplica sobre surcharge.
    const withMora = computePosFinancing({
      financingBase: result.payment.quota || 40000,
      surchargeAmount: 4000,
      plan: plans[1],
    });
    expect(withMora.financingAmount).toBe(4000);
    expect(withMora.voucherTotal).toBe(48000);
  });

  it('cobro mixto con POS: el desk pasa paymentPlans y autoriza el tramo tarjeta', () => {
    const member = {
      memberId: '1002',
      name: 'Mixto Desk',
      category: 'socio_individual',
      outstandingBalance: 40000,
      unpaidCapital: 40000,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    };
    const result = recordDuesCollection(member, {
      method: 'mixto',
      amount: 40000,
      paymentPlans: plans,
      today: new Date('2026-11-05T12:00:00-03:00'),
      paymentSplits: [
        {
          method: 'efectivo',
          amount: 20000,
          journalAccount: 'Caja General',
        },
        {
          method: 'tarjeta',
          amount: 20000,
          paymentPlanId: 'visa-3-b',
          paymentPlanLabel: 'Visa 3 B',
          journalAccount: 'Tarjetas a cobrar',
          receiptAttachment: receipt,
          receiptName: receipt.name,
          receiptParse: { amount: 22000, reference: 'MIX-POS', source: 'manual' },
        },
      ],
    });
    expect(result.payment.method).toBe('mixto');
    const pos = result.payment.paymentSplits.find((s) => s.method === 'tarjeta');
    expect(pos.cardFinancing.financingAmount).toBe(2000);
    expect(pos.cardFinancing.mode).toBe('issuer_keeps');
    expect(duesCollectionNeedsPosAtomicCommit(result.payment)).toBe(true);
  });

  it('sin paymentPlans del desk → POS_PLAN_NOT_FOUND (no se inventa catálogo)', () => {
    const member = {
      memberId: '1003',
      name: 'Sin planes',
      category: 'socio_individual',
      outstandingBalance: 40000,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    };
    expect(() => recordDuesCollection(member, deskPayload({
      paymentPlans: [],
      today: new Date('2026-11-05T12:00:00-03:00'),
      receiptParse: { amount: 40000, reference: 'X', source: 'manual' },
      paymentPlanId: 'visa-3-a',
      amount: 40000,
    }))).toThrow(/inexistente|plan/i);
  });
});

describe('B10 mora vs base POS + tenis', () => {
  it('computePosFinancing no aplica tasa sobre mora', () => {
    const out = computePosFinancing({
      financingBase: 70000,
      surchargeAmount: 7000,
      plan: plans[1],
    });
    expect(out.financingAmount).toBe(7000);
    expect(out.voucherTotal).toBe(84000); // 70000 + 7000 financ + 7000 mora
    expect(out.surchargeAmount).toBe(7000);
  });

  it('abono tenis rechaza plan con financiación predeterminada sin campo interés', () => {
    const member = {
      memberId: '2001',
      name: 'Tenis',
      category: 'socio_individual',
      cuotaCategories: ['SOCIO INDIVIDUAL', 'ABONO TENIS'],
      outstandingBalance: 0,
      paymentHistory: [],
    };
    expect(() => recordTennisAbonoCollection(member, {
      method: 'tarjeta',
      amount: 12000,
      paymentPlanId: 'visa-3-a',
      paymentPlans: plans,
      receiptAttachment: receipt,
      receiptName: receipt.name,
      receiptParse: { amount: 12000, reference: 'TENIS', source: 'manual' },
      today: new Date('2026-11-05T12:00:00-03:00'),
      monthlyAmount: 12000,
    })).toThrow(/tenis|financi/i);
  });
});

describe('commitDuesCollection helpers', () => {
  it('detecta POS simple y mixto', () => {
    expect(duesCollectionNeedsPosAtomicCommit({ method: 'tarjeta' })).toBe(true);
    expect(duesCollectionNeedsPosAtomicCommit({ method: 'efectivo' })).toBe(false);
    expect(duesCollectionNeedsPosAtomicCommit({
      method: 'mixto',
      paymentSplits: [{ method: 'efectivo' }, { method: 'tarjeta' }],
    })).toBe(true);
  });
});

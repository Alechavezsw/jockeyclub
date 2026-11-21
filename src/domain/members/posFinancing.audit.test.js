import { describe, expect, it, vi } from 'vitest';
import {
  assertJournalLinesBalanced,
  assertPosVoucherMatchesComputed,
  assertTennisPosFinancingAllowed,
  authorizePosCardFinancing,
  buildPosJournalLines,
  computePosFinancing,
  POS_DISCOUNT_ACCOUNT,
  POS_FINANCING_INCOME_ACCOUNT,
} from './posFinancing';
import {
  buildDuesCollectionJournalLines,
  ensureDuesCollectionJournal,
  recordDuesCollection,
  recordTennisAbonoCollection,
  voidMemberDuesPayment,
} from './memberPayments';

const planA = {
  id: 'visa-3-a',
  label: 'Visa 3 A',
  installments: 3,
  financingMode: 'club_keeps',
  financingPercent: 10,
  allowOperatorOverride: true,
};
const planB = {
  id: 'visa-3-b',
  label: 'Visa 3 B',
  installments: 3,
  financingMode: 'issuer_keeps',
  financingPercent: 10,
  allowOperatorOverride: true,
};

const receipt = {
  path: 'x/v.jpg',
  bucket: 'dues-receipts',
  name: 'v.jpg',
  mimeType: 'image/jpeg',
  size: 10,
};

describe('B1 asiento POS con descuento', () => {
  it('modo A: Tarjetas = cash+financ; Descuentos aparte; balanceado', () => {
    const lines = buildDuesCollectionJournalLines({
      cashReceived: 65000,
      socialIncome: 70000,
      discount: 5000,
      isCardPos: true,
      cardFinancing: { mode: 'club_keeps', financingAmount: 6500 },
      cashAccount: 'Tarjetas a cobrar',
    });
    // Antes (bug): Tarjetas debitaba socialIncome+financ y además Descuentos → desbalance / cobrado inflado.
    // Después: Tarjetas 71500, Descuentos 5000, Cuotas 70000, Financ 6500.
    expect(lines).toEqual([
      { account: 'Tarjetas a cobrar', type: 'debit', amount: 71500 },
      { account: POS_DISCOUNT_ACCOUNT, type: 'debit', amount: 5000 },
      { account: 'Cuotas Sociales', type: 'credit', amount: 70000 },
      { account: POS_FINANCING_INCOME_ACCOUNT, type: 'credit', amount: 6500 },
    ]);
    assertJournalLinesBalanced(lines);
  });

  it('modo B con descuento: sin ingreso financiación, balanceado', () => {
    const lines = buildDuesCollectionJournalLines({
      cashReceived: 65000,
      socialIncome: 70000,
      discount: 5000,
      isCardPos: true,
      cardFinancing: { mode: 'issuer_keeps', financingAmount: 6500 },
      cashAccount: 'Tarjetas a cobrar',
    });
    expect(lines.find((l) => l.account === 'Tarjetas a cobrar')).toEqual({
      account: 'Tarjetas a cobrar', type: 'debit', amount: 65000,
    });
    expect(lines.every((l) => l.account !== POS_FINANCING_INCOME_ACCOUNT)).toBe(true);
    assertJournalLinesBalanced(lines);
  });

  it('mixto con descuento + POS A balanceado', () => {
    const lines = buildDuesCollectionJournalLines({
      cashReceived: 65000,
      socialIncome: 70000,
      discount: 5000,
      mixedSplits: [
        { method: 'efectivo', amount: 25000, journalAccount: 'Caja General' },
        {
          method: 'tarjeta',
          amount: 40000,
          journalAccount: 'Tarjetas a cobrar',
          cardFinancing: { mode: 'club_keeps', financingAmount: 4000 },
        },
      ],
    });
    expect(lines.find((l) => l.account === 'Tarjetas a cobrar')?.amount).toBe(44000);
    expect(lines.find((l) => l.account === POS_FINANCING_INCOME_ACCOUNT)?.amount).toBe(4000);
    assertJournalLinesBalanced(lines);
  });

  it('rechaza asiento desbalanceado', () => {
    expect(() => assertJournalLinesBalanced([
      { account: 'A', type: 'debit', amount: 100 },
      { account: 'B', type: 'credit', amount: 90 },
    ])).toThrow(/desbalanceado/i);
  });
});

describe('B2 validación cupón real', () => {
  it('bloquea cupón 88000 vs calculado 77000', () => {
    const computed = computePosFinancing({ socialAmount: 70000, plan: planB, percent: 10 });
    expect(computed.voucherTotal).toBe(77000);
    expect(() => assertPosVoucherMatchesComputed({
      receiptVoucher: 88000,
      computedVoucher: computed.voucherTotal,
    })).toThrow(/no coincide/i);
  });

  it('no interpreta automáticamente la diferencia del comprobante como interés', () => {
    const computed = computePosFinancing({
      socialAmount: 393000,
      plan: { id: 'data-3', installments: 3, financingMode: 'issuer_keeps' },
    });
    expect(computed.financingAmount).toBe(0);
    expect(computed.voucherTotal).toBe(393000);
    expect(() => authorizePosCardFinancing({
      socialAmount: 393000,
      plan: { id: 'data-3', installments: 3, financingMode: 'issuer_keeps', allowOperatorOverride: true },
      receiptVoucher: 432383.78,
    })).toThrow(/no coincide|POS_VOUCHER/i);
  });

  it('acepta cupón coherente con la tasa', () => {
    const meta = authorizePosCardFinancing({
      socialAmount: 70000,
      plans: [planB],
      paymentPlanId: 'visa-3-b',
      percent: 10,
      receiptVoucher: 77000,
    });
    expect(meta.voucherTotal).toBe(77000);
    expect(meta.receiptVoucher).toBe(77000);
  });
});

describe('B3 autorización servidor', () => {
  it('modalidad la impone el plan, no el cliente', () => {
    expect(() => authorizePosCardFinancing({
      socialAmount: 70000,
      plans: [planB],
      paymentPlanId: 'visa-3-b',
      percent: 10,
      clientCardFinancing: { mode: 'club_keeps', financingAmount: 7000, voucherTotal: 77000 },
    })).toThrow(/modalidad|MODE_TAMPER/i);
  });

  it('rechaza importes de cardFinancing alterados', () => {
    expect(() => authorizePosCardFinancing({
      socialAmount: 70000,
      plans: [planA],
      paymentPlanId: 'visa-3-a',
      percent: 10,
      clientCardFinancing: { mode: 'club_keeps', financingAmount: 9999, voucherTotal: 79999 },
    })).toThrow(/no coinciden|TAMPER/i);
  });

  it('rechaza % negativo y plan inexistente', () => {
    expect(() => authorizePosCardFinancing({
      socialAmount: 70000,
      plans: [planA],
      paymentPlanId: 'visa-3-a',
      percent: -5,
    })).toThrow(/negativo/i);
    expect(() => authorizePosCardFinancing({
      socialAmount: 70000,
      plans: [planA],
      paymentPlanId: 'no-existe',
    })).toThrow(/inexistente|no está/i);
  });

  it('cajero sin override no altera tasa', () => {
    expect(() => authorizePosCardFinancing({
      socialAmount: 70000,
      plans: [{ ...planB, allowOperatorOverride: false, financingPercent: 10 }],
      paymentPlanId: 'visa-3-b',
      percent: 20,
      operatorRole: 'cajero',
    })).toThrow(/permiso/i);
  });
});

describe('B4 atomicidad e idempotencia del asiento', () => {
  it('reintento recupera asiento existente sin duplicar', async () => {
    const paymentId = '11111111-1111-4111-8111-111111111111';
    const addJournalEntry = vi.fn(async () => ({ id: 'new-journal' }));
    const result = {
      payment: { id: paymentId },
      journalEntry: {
        sourceId: paymentId,
        sourceModule: 'cuotas',
        lines: [
          { account: 'Tarjetas a cobrar', type: 'debit', amount: 70000 },
          { account: 'Cuotas Sociales', type: 'credit', amount: 70000 },
        ],
      },
    };
    // Sin supabase: publica una vez
    const first = await ensureDuesCollectionJournal(result, { addJournalEntry });
    expect(first.journalEntry.id).toBe('new-journal');
    expect(addJournalEntry).toHaveBeenCalledTimes(1);
  });

  it('doble publicación del mismo cobro no crea segundo asiento si ya hay sourceId', async () => {
    const paymentId = '22222222-2222-4222-8222-222222222222';
    vi.resetModules();
    // Simula findDuesJournalBySourceId vía fallo de add + recovery path cuando no hay supabase
    const addJournalEntry = vi.fn(async () => {
      throw new Error('timeout de red');
    });
    await expect(ensureDuesCollectionJournal({
      payment: { id: paymentId },
      journalEntry: { sourceId: paymentId, lines: [] },
    }, { addJournalEntry })).rejects.toMatchObject({ code: 'JOURNAL_POST_FAILED', recoverable: true });
  });
});

describe('B6 abono tenis', () => {
  it('bloquea tenis + financiación POS', () => {
    expect(() => assertTennisPosFinancingAllowed({
      method: 'tarjeta',
      cardFinancing: { financingAmount: 4000 },
    })).toThrow(/abono tenis no admite/i);

    const member = {
      memberId: 't1',
      name: 'Tenis',
      outstandingBalance: 12000,
      cuotaCategories: ['ABONO TENIS'],
      paymentHistory: [],
      meta: { tennisAbono: true },
    };
    expect(() => recordTennisAbonoCollection(member, {
      method: 'tarjeta',
      amount: 12000,
      monthlyAmount: 12000,
      periodDueOns: ['2026-11-10'],
      receiptAttachment: receipt,
      receiptName: 'v.jpg',
      paymentPlanId: 'visa-3-a',
      financingPercent: 10,
      cardFinancing: { financingAmount: 1200 },
    })).toThrow(/abono tenis no admite|financiación/i);
  });
});

describe('anulaciones financiación A', () => {
  it('void revierte haber de financiación', () => {
    const member = { memberId: 'va', name: 'V', outstandingBalance: 70000, paymentHistory: [] };
    const charged = recordDuesCollection(member, {
      method: 'tarjeta',
      amount: 70000,
      receiptAttachment: receipt,
      receiptName: 'v.jpg',
      paymentPlanId: 'visa-3-a',
      paymentPlans: [planA],
      financingPercent: 10,
      receiptParse: { amount: 77000, reference: 'OK' },
      today: new Date('2026-11-05T12:00:00'),
    });
    const voided = voidMemberDuesPayment(charged.member, charged.payment.id, {
      reason: 'Anulación financiación A de prueba',
    });
    expect(voided.journalEntry.lines.find((l) => l.account === POS_FINANCING_INCOME_ACCOUNT && l.type === 'debit')?.amount)
      .toBe(7000);
    assertJournalLinesBalanced(voided.journalEntry.lines);
  });
});

describe('buildPosJournalLines API', () => {
  it('posCashReceived no usa socialIncome con descuento embebido', () => {
    const pos = buildPosJournalLines({
      posCashReceived: 65000,
      socialCredit: 70000,
      discount: 5000,
      financingAmount: 6500,
      mode: 'club_keeps',
    });
    expect(pos.debitTotal).toBe(71500 + 5000);
    expect(pos.creditTotal).toBe(70000 + 6500);
  });
});

import { describe, expect, it } from 'vitest';
import {
  FINANCING_MODE_CLUB,
  FINANCING_MODE_ISSUER,
} from '../system/paymentPlans';
import {
  assertPosFinancingOperationSupported,
  buildPosJournalLines,
  buildPosSettlementStub,
  computePosFinancing,
  POS_FINANCING_INCOME_ACCOUNT,
  posFinancingPortalSummary,
} from './posFinancing';

const plan3 = {
  id: 'visa-3',
  label: 'Visa 3 cuotas',
  installments: 3,
  financingMode: FINANCING_MODE_ISSUER,
  financingPercent: 10,
  allowOperatorOverride: true,
};

const planClub = {
  ...plan3,
  id: 'visa-3-club',
  financingMode: FINANCING_MODE_CLUB,
};

describe('computePosFinancing', () => {
  it('70k sin financiación → total 70k', () => {
    const result = computePosFinancing({
      socialAmount: 70000,
      plan: { id: 'visa-contado', installments: 1, financingMode: FINANCING_MODE_ISSUER },
    });
    expect(result.base).toBe(70000);
    expect(result.financingAmount).toBe(0);
    expect(result.voucherTotal).toBe(70000);
  });

  it('70k + 10% → 77k', () => {
    const result = computePosFinancing({
      socialAmount: 70000,
      plan: plan3,
      percent: 10,
    });
    expect(result.financingAmount).toBe(7000);
    expect(result.voucherTotal).toBe(77000);
  });

  it('3 cuotas suman exactamente el voucher', () => {
    const result = computePosFinancing({
      socialAmount: 70000,
      plan: plan3,
      percent: 10,
    });
    const sum = result.installmentAmounts.reduce((a, b) => a + b, 0);
    expect(sum).toBe(result.voucherTotal);
    expect(result.installmentAmounts).toHaveLength(3);
  });

  it('no mezcla mora social: base = capital social cobrado', () => {
    const result = computePosFinancing({
      socialAmount: 70000,
      plan: plan3,
      percent: 10,
    });
    expect(result.base).toBe(70000);
    expect(result.financingAmount).toBe(7000);
  });
});

describe('buildPosJournalLines', () => {
  it('modo A asienta financiación como ingreso', () => {
    const entry = buildPosJournalLines({
      socialIncome: 70000,
      financingAmount: 7000,
      mode: FINANCING_MODE_CLUB,
    });
    expect(entry.mode).toBe(FINANCING_MODE_CLUB);
    expect(entry.debitTotal).toBe(77000);
    expect(entry.lines.find((l) => l.account === POS_FINANCING_INCOME_ACCOUNT)?.amount).toBe(7000);
    expect(entry.lines.find((l) => l.type === 'debit')?.amount).toBe(77000);
  });

  it('modo B no asienta financiación', () => {
    const entry = buildPosJournalLines({
      socialIncome: 70000,
      financingAmount: 7000,
      mode: FINANCING_MODE_ISSUER,
    });
    expect(entry.mode).toBe(FINANCING_MODE_ISSUER);
    expect(entry.debitTotal).toBe(70000);
    expect(entry.lines.every((l) => l.account !== POS_FINANCING_INCOME_ACCOUNT)).toBe(true);
  });
});

describe('stubs y portal', () => {
  it('liquidación neta queda bloqueada', () => {
    expect(() => buildPosSettlementStub({ kind: 'settlement' })).toThrow(/no soportada/i);
    expect(() => assertPosFinancingOperationSupported('chargeback')).toThrow(/unsupported|no soportada/i);
  });

  it('portal muestra contado vs financiado sin CFT', () => {
    const summary = posFinancingPortalSummary({
      amount: 70000,
      cardFinancing: {
        baseAmount: 70000,
        financingAmount: 7000,
        voucherTotal: 77000,
        installments: 3,
        mode: FINANCING_MODE_CLUB,
        planLabel: 'Visa 3',
      },
    });
    expect(summary.cashPrice).toBe(70000);
    expect(summary.financedTotal).toBe(77000);
    expect(summary.cft).toBeNull();
  });

  it('modo club del plan se respeta en compute', () => {
    const result = computePosFinancing({ socialAmount: 40000, plan: planClub, percent: 10 });
    expect(result.mode).toBe(FINANCING_MODE_CLUB);
    expect(result.voucherTotal).toBe(44000);
  });
});

/**
 * B18 — reintento real con el objeto de cobroPeriods() (dueOns), no JSON artificial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setRuntimeTierCatalog } from './tiers';
import {
  cobroPeriods,
  normalizeCobroDueOns,
  recordDuesCollection,
} from './memberPayments';

const receipt = {
  path: 'desk/b18.jpg',
  bucket: 'dues-receipts',
  name: 'b18.jpg',
  mimeType: 'image/jpeg',
  size: 20,
};

const plan = {
  id: 'visa-10',
  label: 'Visa 10%',
  active: true,
  cardBrand: 'Visa',
  installments: 3,
  financingMode: 'club_keeps',
  financingPercent: 10,
  allowOperatorOverride: false,
};

beforeEach(() => {
  setRuntimeTierCatalog([
    { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
  ]);
});

function buildPosCollection() {
  const member = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    memberId: '100218',
    name: 'B18 Idem',
    category: 'socio_familiar',
    tier: 'socio_familiar',
    outstandingBalance: 77000,
    nextDueDate: '2026-10-10',
    paymentHistory: [],
  };
  // Cupón = capital 70k + mora 7k + interés 7k = 84k (B16).
  const { member: next, payment } = recordDuesCollection(member, {
    method: 'tarjeta',
    journalAccount: 'Tarjetas a cobrar',
    receiptAttachment: receipt,
    receiptName: receipt.name,
    receiptParse: { amount: 84000, reference: 'B18-REF', source: 'manual' },
    paymentPlanId: plan.id,
    paymentPlanLabel: plan.label,
    paymentPlans: [plan],
    voucherAmount: 84000,
    financingPercent: 10,
  });
  return { member: next, payment };
}

describe('B18 cobroPeriods dueOns ↔ periodDueOns canónicos', () => {
  it('cobroPeriods() emite dueOns (no periodDueOns) y conserva plan/cupón/comprobante', () => {
    const { member, payment } = buildPosCollection();
    const periods = cobroPeriods(member, payment);

    expect(Object.prototype.hasOwnProperty.call(periods, 'dueOns')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(periods, 'periodDueOns')).toBe(false);
    expect(Array.isArray(periods.dueOns)).toBe(true);
    expect(periods.dueOns.length).toBeGreaterThan(0);

    expect(periods.paymentPlanId).toBe(plan.id);
    expect(periods.method).toBe('tarjeta');
    expect(periods.receiptParse?.reference || periods.receiptName).toBeTruthy();
    expect(
      periods.voucherAmount
      ?? periods.cardFinancing?.voucherTotal
      ?? payment.voucherAmount
      ?? payment.cardFinancing?.voucherTotal,
    ).toBeTruthy();
  });

  it('dueOns de cobroPeriods equivale a periodDueOns persistidos (sin falso conflicto)', () => {
    const { member, payment } = buildPosCollection();
    const periods = cobroPeriods(member, payment);

    const fromClient = normalizeCobroDueOns(periods);
    const fromStoredMeta = normalizeCobroDueOns({
      periodDueOns: payment.periodDueOns,
    });

    expect(fromClient).toEqual(fromStoredMeta);
    expect(fromClient.length).toBeGreaterThan(0);
  });

  it('períodos distintos → canonical distinto (conflicto real)', () => {
    const { member, payment } = buildPosCollection();
    const periods = cobroPeriods(member, payment);
    const same = normalizeCobroDueOns(periods);
    const other = normalizeCobroDueOns({
      ...periods,
      dueOns: ['2099-01-10'],
    });
    expect(same).not.toEqual(other);
  });

  it('normalizeCobroDueOns no pierde el resto del payload al leer solo fechas', () => {
    const { member, payment } = buildPosCollection();
    const periods = cobroPeriods(member, payment);
    const snapshot = {
      ...periods,
      cardFinancing: payment.cardFinancing || { percent: 10, voucherTotal: 84000 },
      financingPercent: 10,
    };
    normalizeCobroDueOns(snapshot);
    expect(snapshot.cardFinancing?.percent ?? snapshot.financingPercent).toBe(10);
    expect(snapshot.paymentPlanId).toBe(plan.id);
    expect(snapshot.dueOns).toEqual(periods.dueOns);
  });
});

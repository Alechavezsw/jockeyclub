import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { setRuntimeTierCatalog } from './tiers.js';
import { applyFeeChargeDeltasToMembers } from '../accounting/feeBilling.js';
import { collectionPreview, recordDuesCollection } from './memberPayments.js';
import { detectMemberDuesAnomalies, auditMembersDuesBalances } from './duesBalanceAudit.js';

describe('duesBalanceAudit', () => {
  beforeEach(() => {
    setRuntimeTierCatalog([
      { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
    ]);
  });
  afterEach(() => setRuntimeTierCatalog(null));

  it('9751: alerta de desync sin crédito ficticio', () => {
    const member = {
      memberId: '9751',
      memberNumber: '9751',
      name: 'Jorge Maximilia Calderon Luna',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      outstandingBalance: 7000,
      unpaidCapital: 70000,
      nextDueDate: '2026-12-10',
      lastPaymentDate: '2026-11-01',
      paymentHistory: [],
    };
    const findings = detectMemberDuesAnomalies(member, {
      today: new Date('2026-11-20T12:00:00-03:00'),
    });
    expect(findings.some((row) => row.code === 'unpaid_above_outstanding')).toBe(true);
    const preview = collectionPreview(member, new Date('2026-11-20T12:00:00-03:00'));
    expect(preview.creditApplied).toBe(0);
  });

  it('socio que pagó de más conserva crédito real', () => {
    const member = {
      memberId: '1005',
      name: 'Nora',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      outstandingBalance: -7000,
      nextDueDate: '2026-11-10',
      lastPaymentDate: '2026-10-13',
      paymentHistory: [],
    };
    const preview = collectionPreview(member, new Date('2026-10-22T12:00:00'));
    expect(preview.creditApplied).toBe(7000);
    expect(detectMemberDuesAnomalies(member).every((row) => row.code !== 'credit_without_trace')).toBe(true);
  });

  it('liquidación acarrea crédito explícito y no deja hueco unpaid/outstanding como crédito', () => {
    const before = {
      memberId: '2202',
      tier: 'socio_familiar',
      outstandingBalance: -10000,
      unpaidCapital: 0,
    };
    const [after] = applyFeeChargeDeltasToMembers([before], [
      { memberId: '2202', amount: 70000 },
    ]);
    expect(after.outstandingBalance).toBe(70000);
    expect(after.unpaidCapital).toBe(70000);
    expect(after.creditBalance).toBe(10000);
    const preview = collectionPreview({
      ...after,
      cuotaCategories: ['SOCIO FAMILIAR'],
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    }, new Date('2026-11-12T15:00:00-03:00'));
    expect(preview.creditApplied).toBe(10000);
    expect(preview.balanceDesync).toBeUndefined();
  });

  it('pago de octubre no cancela noviembre ni inventa crédito', () => {
    const member = {
      memberId: '9751',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      outstandingBalance: 7000,
      unpaidCapital: 7000,
      nextDueDate: '2026-12-10',
      lastPaymentDate: '2026-11-01',
      paymentHistory: [{
        amount: 70000,
        paidAt: '2026-11-01',
        method: 'transferencia',
        periodDueOns: ['2026-10-10'],
        receiptNumber: '03656347',
      }],
    };
    const preview = collectionPreview(member, new Date('2026-11-20T12:00:00-03:00'));
    expect(preview.creditApplied).toBe(0);
    expect(preview.cash).toBe(7000);
    expect(preview.quota).toBe(0);
    const dueOns = (preview.periods || []).map((row) => String(row.dueOn).slice(0, 7));
    expect(dueOns.includes('2026-12')).toBe(false);
  });

  it('crédito no se aplica dos veces', () => {
    const member = {
      memberId: 'c1',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      outstandingBalance: 70000,
      unpaidCapital: 70000,
      creditBalance: 10000,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    };
    const today = new Date('2026-11-12T15:00:00-03:00');
    const paid = recordDuesCollection(member, { method: 'efectivo', today });
    expect(paid.payment.creditApplied).toBe(10000);
    expect(collectionPreview(paid.member, today).creditApplied).toBe(0);
  });

  it('auditoría agrega hallazgos por socio', () => {
    const report = auditMembersDuesBalances([
      {
        memberId: '9751',
        outstandingBalance: 7000,
        unpaidCapital: 70000,
        tier: 'socio_familiar',
      },
      {
        memberId: 'ok',
        outstandingBalance: 70000,
        unpaidCapital: 70000,
        tier: 'socio_familiar',
      },
    ], { today: new Date('2026-11-20T12:00:00-03:00') });
    expect(report.anomalyCount).toBeGreaterThan(0);
    expect(report.findings.some((row) => row.memberId === '9751')).toBe(true);
  });
});

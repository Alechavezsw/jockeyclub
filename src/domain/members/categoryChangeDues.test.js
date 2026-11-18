import { describe, expect, it } from 'vitest';
import {
  categoryChangeIdempotencyKey,
  findCategoryDuesMismatches,
  previewCategoryChangeDues,
} from './categoryChangeDues';

const today = new Date('2026-11-18T15:00:00-03:00');

describe('previewCategoryChangeDues', () => {
  it('individual → familiar recalcula noviembre 40k → 70k', () => {
    const member = {
      memberId: '111663',
      name: 'Lopez',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 40000,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    };
    const preview = previewCategoryChangeDues(member, 'socio_familiar', { today });
    expect(preview.blocked).toBe(false);
    expect(preview.needsAdjustment).toBe(true);
    expect(preview.totalDelta).toBe(30000);
    expect(preview.oldBalance).toBe(40000);
    expect(preview.newBalance).toBe(70000);
    expect(preview.periods.length).toBeGreaterThanOrEqual(1);
    expect(preview.periods[0].oldCapital).toBe(40000);
    expect(preview.periods[0].newCapital).toBe(70000);
  });

  it('familiar → individual baja el capital abierto', () => {
    const member = {
      memberId: '200',
      tier: 'socio_familiar',
      status: 'active',
      outstandingBalance: 70000,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    };
    const preview = previewCategoryChangeDues(member, 'socio_individual', { today });
    expect(preview.totalDelta).toBe(-30000);
    expect(preview.newBalance).toBe(40000);
  });

  it('no toca meses ya pagos', () => {
    const member = {
      memberId: '201',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 0,
      nextDueDate: '2026-12-10',
      lastPaymentDate: '2026-11-05',
      paymentHistory: [{
        amount: 40000,
        status: 'posted',
        periodDueOns: ['2026-11-10'],
        chargeScope: 'social',
      }],
    };
    const preview = previewCategoryChangeDues(member, 'socio_familiar', { today });
    expect(preview.needsAdjustment).toBe(false);
    expect(preview.totalDelta).toBe(0);
    expect(preview.periods).toEqual([]);
  });

  it('varios meses vencidos suma el delta de cada uno', () => {
    const member = {
      memberId: '202',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 80000,
      nextDueDate: '2026-10-10',
      paymentHistory: [],
    };
    const preview = previewCategoryChangeDues(member, 'socio_familiar', { today });
    expect(preview.periods.length).toBeGreaterThanOrEqual(2);
    expect(preview.totalDelta).toBe(preview.periods.length * 30000);
    expect(preview.newBalance).toBe(80000 + preview.totalDelta);
  });

  it('bloquea exentos e integrantes', () => {
    expect(previewCategoryChangeDues({
      memberId: '1',
      tier: 'socio_individual',
      familyPrincipalNumber: '99',
      outstandingBalance: 0,
    }, 'socio_familiar', { today }).blocked).toBe(true);

    expect(previewCategoryChangeDues({
      memberId: '2',
      tier: 'socio_vitalicio',
      outstandingBalance: 0,
    }, 'socio_familiar', { today }).blocked).toBe(true);
  });

  it('arma clave idempotente estable', () => {
    expect(categoryChangeIdempotencyKey('uuid-1', 'socio_individual', 'socio_familiar', [
      { dueOn: '2026-11-10' },
    ])).toBe('categoria:uuid-1:socio_individual->socio_familiar:2026-11-10');
  });
});

describe('findCategoryDuesMismatches', () => {
  it('marca familiar con saldo de individual', () => {
    const rows = findCategoryDuesMismatches([{
      memberId: '111663',
      name: 'Lopez',
      tier: 'socio_familiar',
      status: 'active',
      outstandingBalance: 40000,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    }], { today });
    expect(rows.length).toBe(1);
    expect(rows[0].memberId).toBe('111663');
    expect(rows[0].suggested?.fromTier).toBe('socio_individual');
    expect(rows[0].suggested?.deltaToFix).toBe(30000);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildCuotasReview,
  feeChargedNumbersFromPeriod,
  reviewTodayForPeriod,
} from './cuotasReview';

describe('cuotasReview', () => {
  it('toma números cobrados del pack.charges del período', () => {
    expect(feeChargedNumbersFromPeriod({
      pack: {
        charges: [
          { memberId: '10.811' },
          { memberNumber: '101605' },
          { memberId: '' },
        ],
      },
    })).toEqual(['10811', '101605']);
  });

  it('ancla la revisión al mes del período', () => {
    const d = reviewTodayForPeriod({ year: 2026, month: 11 });
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(15);
  });

  it('deja solo hallazgos de dues/members (altas, bajas, fichas, cuota)', () => {
    const review = buildCuotasReview({
      today: new Date(2026, 10, 15),
      period: {
        id: 'fp-2026-11',
        year: 2026,
        month: 11,
        status: 'draft',
        pack: { charges: [] },
      },
      feePeriods: [{
        id: 'fp-2026-11',
        year: 2026,
        month: 11,
        status: 'draft',
      }],
      members: [
        {
          memberId: '100',
          name: 'Titular Sin DNI',
          documentNumber: '',
          tier: 'familiar',
          status: 'active',
        },
      ],
      membershipMovesAsOf: '2026-11-01',
      bajas: [
        { memberId: '100', name: 'Titular Sin DNI', date: '2026-11-02', motivo: 'se mudó' },
      ],
      journalEntries: [
        {
          id: 'bad',
          date: '2026-11-01',
          status: 'posted',
          lines: [
            { accountId: 'caja', debit: 100, credit: 0 },
            { accountId: 'socios', debit: 0, credit: 40 },
          ],
        },
      ],
    });

    const ids = review.items.map((item) => item.id);
    expect(ids).toContain('no-dni');
    expect(ids).toContain('bajas-sigue-activo');
    expect(ids).toContain('fee-month');
    expect(ids).not.toContain('journal-unbalanced');
    expect(review.periodLabel).toMatch(/Noviembre/i);
  });
});

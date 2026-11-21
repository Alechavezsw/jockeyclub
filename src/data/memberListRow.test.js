import { describe, expect, it } from 'vitest';
import { metaFromListRow } from './repos.js';

describe('metaFromListRow', () => {
  it('arma meta liviano desde columnas extraídas', () => {
    const meta = metaFromListRow({
      last_payment_date: '2026-06-14',
      family_principal: '10009',
      family_group_name: 'GF - Rojo',
      cuota_categories: ['SOCIO INDIVIDUAL'],
      current_account_as_of: '2026-09-29',
    });
    expect(meta.lastPaymentDate).toBe('2026-06-14');
    expect(meta.familyPrincipalNumber).toBe('10009');
    expect(meta.familyGroupName).toBe('GF - Rojo');
    expect(meta.cuotaCategories).toEqual(['SOCIO INDIVIDUAL']);
    expect(meta.currentAccountAsOf).toBe('2026-09-29');
  });

  it('conserva meta si ya vino en la fila', () => {
    const meta = metaFromListRow({
      meta: { lastPaymentDate: '2026-01-01', extra: true },
    });
    expect(meta.lastPaymentDate).toBe('2026-01-01');
    expect(meta.extra).toBe(true);
  });

  it('hidrata unpaidCapital y duesOpenPeriods desde columnas del padrón', () => {
    const meta = metaFromListRow({
      unpaid_capital: 70000,
      dues_open_periods: [{ dueOn: '2026-11-10', capital: 70000 }],
    });
    expect(meta.unpaidCapital).toBe(70000);
    expect(meta.duesOpenPeriods).toEqual([{ dueOn: '2026-11-10', capital: 70000 }]);

    const cleared = metaFromListRow({
      unpaid_capital: 0,
      dues_open_periods: [],
    });
    expect(cleared.unpaidCapital).toBe(0);
    expect(cleared.duesOpenPeriods).toEqual([]);
  });
});

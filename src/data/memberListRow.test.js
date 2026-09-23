import { describe, expect, it } from 'vitest';
import { metaFromListRow } from './repos.js';

describe('metaFromListRow', () => {
  it('arma meta liviano desde columnas extraídas', () => {
    const meta = metaFromListRow({
      last_payment_date: '2026-06-14',
      family_principal: '10009',
      family_group_name: 'GF - Rojo',
      cuota_categories: ['SOCIO INDIVIDUAL'],
    });
    expect(meta.lastPaymentDate).toBe('2026-06-14');
    expect(meta.familyPrincipalNumber).toBe('10009');
    expect(meta.familyGroupName).toBe('GF - Rojo');
    expect(meta.cuotaCategories).toEqual(['SOCIO INDIVIDUAL']);
  });

  it('conserva meta si ya vino en la fila', () => {
    const meta = metaFromListRow({
      meta: { lastPaymentDate: '2026-01-01', extra: true },
    });
    expect(meta.lastPaymentDate).toBe('2026-01-01');
    expect(meta.extra).toBe(true);
  });
});

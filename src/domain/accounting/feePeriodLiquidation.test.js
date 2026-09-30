import { describe, expect, it } from 'vitest';
import { ACCESSIN_FEE_PERIODS } from './feeBilling';
import { buildFeePeriodLiquidation } from './feePeriodLiquidation';

const january = ACCESSIN_FEE_PERIODS.find((p) => p.month === 1 && p.year === 2026);
const catalog = [
  { id: 'abono_tenis', name: 'ABONO TENIS', label: '2394', monthlyDues: 8500, sortOrder: 12, isActive: true },
  { id: 'socio_familiar', name: 'SOCIO FAMILIAR', label: '2268', monthlyDues: 60000, sortOrder: 5, isActive: true },
  { id: 'basquet_no_socio', name: 'BÁSQUET (No socio)', label: '21215', monthlyDues: 0, sortOrder: 20, isActive: true },
];

const members = [
  { memberId: '1', status: 'active', cuotaCategories: ['ABONO TENIS', 'SOCIO FAMILIAR'] },
  { memberId: '2', status: 'active', cuotaCategories: ['ABONO TENIS'] },
  { memberId: '3', status: 'active', cuotaCategories: ['BÁSQUET (No socio)'] },
  { memberId: '4', status: 'inactive', cuotaCategories: ['ABONO TENIS'] },
  {
    memberId: '5',
    status: 'active',
    familyPrincipalNumber: '1',
    cuotaCategories: ['GRUPO FAMILIAR (Familiar)'],
  },
];

describe('buildFeePeriodLiquidation', () => {
  it('arma el detalle de gastos de titulares activos', () => {
    const model = buildFeePeriodLiquidation(january, { members, tierCatalog: catalog });
    expect(model.title).toBe('Liquidación - Enero del 2026');
    expect(model.total).toBe(64545500);
    expect(model.rows.map((row) => row.name)).toEqual([
      'SOCIO FAMILIAR',
      'ABONO TENIS',
      'BÁSQUET (No socio)',
    ]);
    expect(model.rows[1]).toMatchObject({
      identifier: '2394',
      name: 'ABONO TENIS',
      holders: 2,
      unit: 8500,
      total: 17000,
    });
    expect(model.rows[2]).toMatchObject({
      identifier: '21215',
      holders: 1,
    });
  });

  it('infiere el valor desde el detalle de cuentas si el catálogo no tiene precio', () => {
    const model = buildFeePeriodLiquidation(january, {
      members: [{ memberId: '8', status: 'active', cuotaCategories: ['BÁSQUET (No socio)'] }],
      tierCatalog: catalog,
      feeAccounts: [{
        lines: [
          { type: 'BÁSQUET (No socio)', billed: 12000 },
          { type: 'BÁSQUET (No socio)', billed: 12000 },
          { type: 'BÁSQUET (No socio)', billed: 9000 },
        ],
      }],
    });
    expect(model.rows[0]).toMatchObject({ unit: 12000, total: 12000 });
  });
});

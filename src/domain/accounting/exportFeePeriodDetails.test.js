import { describe, expect, it } from 'vitest';
import { ACCESSIN_FEE_PERIODS } from './feeBilling';
import {
  FEE_PERIOD_EXCEL_HEADERS,
  buildFeePeriodExcelAoA,
  buildFeePeriodExportModel,
} from './exportFeePeriodDetails';

const january = ACCESSIN_FEE_PERIODS.find((p) => p.month === 1 && p.year === 2026);

const members = [
  { memberId: '1', status: 'active', cuotaCategories: ['ABONO TENIS'] },
  { memberId: '2', status: 'active', cuotaCategories: ['ABONO TENIS'] },
  { memberId: '3', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
];

const tierCatalog = [
  { id: 'abono_tenis', name: 'ABONO TENIS', label: '2394', monthlyDues: 8500, sortOrder: 12, isActive: true },
  { id: 'socio_familiar', name: 'SOCIO FAMILIAR', label: '2268', monthlyDues: 60000, sortOrder: 5, isActive: true },
];

describe('exportFeePeriodDetails', () => {
  it('exporta la misma tabla de liquidación que se ve en pantalla', () => {
    const model = buildFeePeriodExportModel(january, { members, tierCatalog });
    expect(model.title).toBe('Liquidación - Enero del 2026');
    expect(model.total).toBe(64545500);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]).toMatchObject({ name: 'SOCIO FAMILIAR', holders: 1, total: 60000 });
    expect(model.rows[1]).toMatchObject({ name: 'ABONO TENIS', holders: 2, unit: 8500, total: 17000 });

    const aoa = buildFeePeriodExcelAoA(model, {
      formatCurrency: (n) => `$ ${Number(n || 0).toLocaleString('es-AR')}`,
    });
    expect(aoa[0]).toEqual(['Liquidación - Enero del 2026']);
    expect(aoa[1][0]).toMatch(/Detalle de gastos · total/);
    expect(aoa[3]).toEqual(FEE_PERIOD_EXCEL_HEADERS);
    expect(aoa).toHaveLength(6);
    expect(aoa[5][0]).toBe('2394');
    expect(aoa[5][1]).toBe('ABONO TENIS');
    expect(aoa[5][2]).toBe(2);
  });

  it('reutiliza el modelo visible sin recalcular otra cosa', () => {
    const visible = {
      title: 'Liquidación - Enero del 2026',
      label: 'Enero del 2026',
      total: 64545500,
      rows: [
        { identifier: '2266', name: 'FUNDADOR', holders: 1, unit: 0, total: 0 },
        { identifier: '2394', name: 'ABONO TENIS', holders: 52, unit: 10000, total: 520000 },
      ],
    };
    const model = buildFeePeriodExportModel(visible);
    expect(model).toBe(visible);
    const aoa = buildFeePeriodExcelAoA(visible);
    expect(aoa[4]).toEqual(['2266', 'FUNDADOR', 1, '$ 0', '$ 0']);
    expect(aoa[5]).toEqual(['2394', 'ABONO TENIS', 52, '$ 10.000', '$ 520.000']);
  });
});

import { describe, expect, it } from 'vitest';
import { ACCESSIN_FEE_PERIODS } from './feeBilling';
import { buildFeePeriodLiquidation, liquidatedTotalForMonth, liquidationFromPack } from './feePeriodLiquidation';

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

describe('liquidationFromPack', () => {
  const october = {
    ...ACCESSIN_FEE_PERIODS.find((p) => p.id === 'fp-1382'),
    status: 'draft',
    generatedAt: null,
    lines: [],
  };
  const pack = {
    title: 'Liquidación - Octubre del 2026',
    concepts: [
      { id: '39279', label: 'ABONO TENIS', holders: 61, amount: 10000, total: 610000 },
      { id: '39288', label: 'SOCIO FAMILIAR', holders: 869, amount: 70000, total: 60830000 },
      { id: '39280', label: 'FUNDADOR', holders: 1, amount: 0, total: 0 },
    ],
  };

  it('suma titulares por valor con el padrón actual y deja afuera al que no está activo', () => {
    const model = liquidationFromPack(october, pack, {
      members: [
        { memberId: '1', status: 'active', cuotaCategories: ['ABONO TENIS', 'SOCIO FAMILIAR'] },
        { memberId: '2', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
        { memberId: '3', status: 'inactive', cuotaCategories: ['SOCIO FAMILIAR'] },
        { memberId: '4', status: 'active', cuotaCategories: ['FUNDADOR'] },
      ],
    });
    expect(model.rows.find((row) => row.name === 'ABONO TENIS')).toMatchObject({
      holders: 1, unit: 10000, total: 10000,
    });
    expect(model.rows.find((row) => row.name === 'SOCIO FAMILIAR')).toMatchObject({
      holders: 2, unit: 70000, total: 140000,
    });
    expect(model.rows.find((row) => row.name === 'FUNDADOR').total).toBe(0);
    expect(model.total).toBe(150000);
  });

  it('un socio más en la categoría suma exactamente el valor', () => {
    const base = [
      { memberId: '1', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
    ];
    const extra = [
      ...base,
      { memberId: '2', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
    ];
    const first = liquidationFromPack(october, pack, { members: base });
    const second = liquidationFromPack(october, pack, { members: extra });
    expect(second.total - first.total).toBe(70000);
  });

  it('un mes ya cerrado conserva el detalle guardado', () => {
    const closed = {
      ...october,
      status: 'processed',
      lines: [{ identifier: '39288', name: 'SOCIO FAMILIAR', holders: 10, unit: 70000, total: 700000 }],
    };
    const model = liquidationFromPack(closed, pack, {
      members: [{ memberId: '1', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] }],
    });
    expect(model.rows).toEqual([
      { identifier: '39288', name: 'SOCIO FAMILIAR', holders: 10, unit: 70000, total: 700000 },
    ]);
    expect(model.total).toBe(700000);
  });
});

describe('liquidatedTotalForMonth', () => {
  it('usa el total procesado de octubre, igual que la fila de Lila', () => {
    const october = ACCESSIN_FEE_PERIODS.find((p) => p.year === 2026 && p.month === 10);
    const members = [
      { memberId: '1', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
      { memberId: '2', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
    ];
    const total = liquidatedTotalForMonth(ACCESSIN_FEE_PERIODS, '2026-10', { members });
    expect(october.status).toBe('processed');
    expect(total).toBe(63233000);
    expect(total).toBe(october.amount);
  });
});

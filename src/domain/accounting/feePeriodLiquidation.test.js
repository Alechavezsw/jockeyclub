import { describe, expect, it } from 'vitest';
import { ACCESSIN_FEE_PERIODS } from './feeBilling';
import {
  buildFeePeriodLiquidation,
  liquidatedTotalForMonth,
  liquidationFromPack,
  periodDisplayTotal,
} from './feePeriodLiquidation';

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
    ]);
    expect(model.rows[1]).toMatchObject({
      identifier: '2394',
      name: 'ABONO TENIS',
      holders: 2,
      unit: 8500,
      total: 17000,
    });
    expect(model.rows.some((row) => row.name === 'BÁSQUET (No socio)')).toBe(false);
  });

  it('no cuenta vitalicio, fundador ni comisión en el recuento', () => {
    const model = buildFeePeriodLiquidation(
      { ...january, amount: 0, status: 'draft' },
      {
        members: [
          ...members,
          { memberId: 'v', status: 'active', tier: 'socio_vitalicio', cuotaCategories: ['SOCIO (Vitalicio)'] },
          { memberId: 'f', status: 'active', tier: 'fundador', cuotaCategories: ['FUNDADOR'] },
          { memberId: 'c', status: 'active', tier: 'comision', cuotaCategories: ['COMISION'] },
        ],
        tierCatalog: [
          ...catalog,
          { id: 'socio_vitalicio', name: 'SOCIO (Vitalicio)', monthlyDues: 70000, isActive: true },
          { id: 'fundador', name: 'FUNDADOR', monthlyDues: 70000, isActive: true },
          { id: 'comision', name: 'COMISION', monthlyDues: 70000, isActive: true },
        ],
      },
    );
    expect(model.rows.some((row) => /vitalicio|fundador|comision/i.test(row.name))).toBe(false);
    expect(model.holderCount).toBe(3); // 1 familiar+tenis, 1 tenis, (basquet 0), dependent out
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

  it('con pack preparado respeta titulares × valor guardados (Monto = TOTAL LILA)', () => {
    const model = liquidationFromPack(october, pack, {
      members: [
        { memberId: '1', status: 'active', cuotaCategories: ['ABONO TENIS', 'SOCIO FAMILIAR'] },
        { memberId: '2', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
      ],
    });
    expect(model.rows.find((row) => row.name === 'ABONO TENIS')).toMatchObject({
      holders: 61, unit: 10000, total: 610000,
    });
    expect(model.rows.find((row) => row.name === 'SOCIO FAMILIAR')).toMatchObject({
      holders: 869, unit: 70000, total: 60830000,
    });
    expect(model.total).toBe(61440000);
  });

  it('recountHolders=true rearma titulares desde el padrón vivo', () => {
    const model = liquidationFromPack(october, pack, {
      recountHolders: true,
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
    expect(model.rows.find((row) => row.name === 'FUNDADOR')).toBeUndefined();
    expect(model.total).toBe(150000);
  });

  it('un socio más en la categoría suma exactamente el valor al recontar', () => {
    const base = [
      { memberId: '1', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
    ];
    const extra = [
      ...base,
      { memberId: '2', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
    ];
    const first = liquidationFromPack(october, pack, { recountHolders: true, members: base });
    const second = liquidationFromPack(october, pack, { recountHolders: true, members: extra });
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

describe('periodDisplayTotal', () => {
  const novConcepts = [
    { label: 'SOCIO FAMILIAR', holders: 813, amount: 70000, total: 56910000 },
    { label: 'SOCIO INDIVIDUAL', holders: 132, amount: 40000, total: 5280000 },
    { label: 'ABONO TENIS', holders: 63, amount: 12000, total: 756000 },
    { label: 'SOCIO FAMILIAR (AMET)', holders: 11, amount: 68250, total: 750750 },
    { label: 'INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)', holders: 15, amount: 1750, total: 26250 },
    { label: 'SOCIO INDIVIDUAL (AMET)', holders: 1, amount: 39000, total: 39000 },
    { label: 'INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)', holders: 1, amount: 1000, total: 1000 },
  ];

  it('pending vacío (sin monto ni pack) no inventa un total de padrón', () => {
    expect(periodDisplayTotal({
      id: 'fp-2026-12',
      year: 2026,
      month: 12,
      status: 'pending',
      amount: 0,
      pack: null,
    }, { members })).toBeNull();
  });

  it('borrador sin pack no muestra estimación de padrón en la grilla', () => {
    expect(periodDisplayTotal({
      id: 'fp-2026-12',
      year: 2026,
      month: 12,
      status: 'draft',
      amount: 0,
    }, { members, tierCatalog: catalog })).toBeNull();
  });

  it('en borrador usa titulares × valor del pack, no un pack.total distinto', () => {
    const draft = {
      id: 'fp-2026-11',
      year: 2026,
      month: 11,
      status: 'draft',
      amount: 66832000,
      pack: { total: 66832000, concepts: novConcepts },
    };
    expect(periodDisplayTotal(draft)).toBe(63763000);
  });

  it('Monto del año y TOTAL del detalle Generar son el mismo número', () => {
    const draft = {
      id: 'fp-2026-11',
      year: 2026,
      month: 11,
      status: 'draft',
      amount: 63513000,
      pack: { total: 63513000, concepts: novConcepts },
      lines: novConcepts.map((row) => ({
        name: row.label,
        holders: row.holders,
        unit: row.amount,
        total: row.holders * row.amount - 1000,
      })),
    };
    const members = novConcepts.flatMap((row) => Array.from({ length: row.holders }, (_, index) => ({
      memberId: `${row.label}-${index}`,
      status: 'active',
      cuotaCategories: [row.label],
    })));
    const detail = liquidationFromPack(draft, draft.pack, { members });
    expect(detail.total).toBe(63763000);
    expect(periodDisplayTotal(draft, { members })).toBe(detail.total);
    expect(detail.rows.find((row) => row.name === 'SOCIO FAMILIAR')).toMatchObject({
      holders: 813,
      unit: 70000,
      total: 56910000,
    });
  });
});

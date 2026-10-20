import { afterEach, describe, expect, it } from 'vitest';
import { discountOnAmount, setRuntimeDiscountRules } from './discountApplication';
import { liquidationFromPack } from './feePeriodLiquidation';
import { duesPayableForMember } from '../members/dues';

const puyg = {
  id: 'amdis-9216-1634',
  category: 'members',
  memberIds: ['9216'],
  memberNumber: '9216',
  valueType: 'percent',
  value: 100,
  validFrom: '2026-06-12',
  validTo: '2027-04-30',
  isActive: true,
};

const comision = {
  id: 'amdis-cat-376',
  category: 'fee_category',
  feeCategories: ['COMISION'],
  valueType: 'percent',
  value: 100,
  validFrom: '2025-05-29',
  validTo: '2027-04-30',
  isActive: true,
};

afterEach(() => setRuntimeDiscountRules([]));

describe('discountOnAmount', () => {
  const member = { memberId: '9216', cuotaCategories: ['SOCIO FAMILIAR'] };

  it('deja la cuota en cero cuando el 100 % cubre el mes', () => {
    const quote = discountOnAmount(70000, [puyg], member, {
      on: '2026-10-01',
      categoryName: 'SOCIO FAMILIAR',
    });
    expect(quote.net).toBe(0);
    expect(quote.discount).toBe(70000);
  });

  it('no aplica un descuento vencido respecto de la imputación', () => {
    const quote = discountOnAmount(70000, [puyg], member, {
      on: '2027-05-01',
      categoryName: 'SOCIO FAMILIAR',
    });
    expect(quote.net).toBe(70000);
    expect(quote.applied).toHaveLength(0);
  });

  it('el descuento de categoría solo baja esa cuota', () => {
    const person = { memberId: '1', tier: 'comision', cuotaCategories: ['COMISION', 'SOCIO FAMILIAR'] };
    const familiar = discountOnAmount(70000, [comision], person, {
      on: '2026-10-01',
      categoryName: 'SOCIO FAMILIAR',
    });
    const board = discountOnAmount(70000, [comision], person, {
      on: '2026-10-01',
      categoryName: 'COMISION',
    });
    expect(familiar.net).toBe(70000);
    expect(board.net).toBe(0);
  });

  it('topa el porcentaje en 100 y después resta el importe', () => {
    const quote = discountOnAmount(1000, [
      { ...puyg, value: 80 },
      { ...puyg, id: 'fijo', valueType: 'amount', value: 300 },
    ], member, { on: '2026-10-01', categoryName: 'SOCIO FAMILIAR' });
    expect(quote.net).toBe(0);
  });
});

describe('liquidación con descuentos', () => {
  it('resta el 100 % del socio en un mes abierto', () => {
    const model = liquidationFromPack({
      id: 'fp-2026-11',
      year: 2026,
      month: 11,
      status: 'draft',
      lines: [],
    }, {
      concepts: [{ id: '1', label: 'SOCIO FAMILIAR', holders: 1, amount: 70000 }],
    }, {
      members: [
        { memberId: '9216', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
        { memberId: '2', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
      ],
      discountRules: [puyg],
    });
    expect(model.rows[0].total).toBe(70000);
  });

  it('un mes ya cerrado no se vuelve a descontar', () => {
    const model = liquidationFromPack({
      id: 'fp-1382',
      year: 2026,
      month: 10,
      status: 'processed',
      lines: [{ identifier: '1', name: 'SOCIO FAMILIAR', holders: 2, unit: 70000, total: 140000 }],
    }, { concepts: [] }, {
      members: [{ memberId: '9216', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] }],
      discountRules: [puyg],
    });
    expect(model.total).toBe(140000);
  });
});

describe('cuota a cobrar', () => {
  it('el socio con 100 % vigente no genera cuota de ese mes', () => {
    const amount = duesPayableForMember(
      { memberId: '9216', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'], status: 'active' },
      { paidOn: '2026-10-01', dueOn: '2026-10-10', on: '2026-10-01', rules: [puyg] },
    );
    expect(amount).toBe(0);
  });
});

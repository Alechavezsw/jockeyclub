import { describe, expect, it } from 'vitest';
import {
  createFeeExpense,
  feeExpenseCategoryCounts,
  resolveFeeExpenses,
} from './feeExpenses';

describe('feeExpenses / gastos a cuotas', () => {
  it('arranca vacío (sin seed Accessin)', () => {
    const all = resolveFeeExpenses(null);
    expect(all).toHaveLength(0);
    expect(feeExpenseCategoryCounts(all).every((c) => c.count === 0)).toBe(true);
  });

  it('crea gasto por socios', () => {
    const d = createFeeExpense({
      category: 'members',
      memberIds: '10600',
      memberName: 'Rago Jorge',
      description: 'Cargo extraordinario',
      valueType: 'amount',
      value: 5000,
    });
    expect(d.amount).toBe(5000);
    expect(d.memberNumber).toBe('10600');
  });

  it('crea gasto por categoría de cuota', () => {
    const d = createFeeExpense({
      category: 'fee_category',
      feeCategories: 'ACTIVO',
      description: 'Aporte cancha',
      valueType: 'percent',
      value: 10,
    });
    expect(d.appliedTo).toBe('ACTIVO');
    expect(d.percentage).toBe(10);
  });

  it('resuelve merge con locales', () => {
    const local = createFeeExpense({
      category: 'general',
      description: 'Aporte general',
      valueType: 'amount',
      value: 1000,
    });
    const merged = resolveFeeExpenses([local]);
    expect(merged).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_BONIFICACIONES,
  ACCESSIN_DISCOUNT_RULES,
  createDiscount,
  discountCategoryCounts,
  resolveDiscounts,
} from './discounts';

describe('discounts / bonificaciones', () => {
  it('carga seed Accessin real + regla COMISION', () => {
    const all = resolveDiscounts(null);
    expect(ACCESSIN_BONIFICACIONES.length).toBe(27);
    expect(ACCESSIN_DISCOUNT_RULES).toHaveLength(1);
    expect(discountCategoryCounts(all).find((c) => c.id === 'members')?.count).toBe(27);
    expect(discountCategoryCounts(all).find((c) => c.id === 'fee_category')?.count).toBe(1);
  });

  it('crea descuento por categoría de cuota', () => {
    const d = createDiscount({
      category: 'fee_category',
      feeCategories: 'COMISION',
      description: 'MIEMBRO DE COMISION',
      valueType: 'percent',
      value: 100,
      validFrom: '2025-05-29',
      validTo: '2027-04-30',
    });
    expect(d.appliedTo).toBe('COMISION');
    expect(d.percentage).toBe(100);
  });

  it('crea descuento por socio', () => {
    const d = createDiscount({
      category: 'members',
      memberIds: '10600',
      memberName: 'Rago Jorge',
      description: 'Bonificación comisión',
      valueType: 'percent',
      value: 100,
    });
    expect(d.percentage).toBe(100);
    expect(d.memberNumber).toBe('10600');
  });

  it('resuelve merge seed + locales', () => {
    const local = createDiscount({
      category: 'general',
      description: 'General staff',
      valueType: 'percent',
      value: 10,
    });
    const merged = resolveDiscounts([...ACCESSIN_BONIFICACIONES, local]);
    expect(merged.length).toBeGreaterThanOrEqual(28);
  });
});

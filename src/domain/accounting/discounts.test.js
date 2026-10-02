import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  ACCESSIN_DISCOUNT_RULES,
  createDiscount,
  discountCategoryCounts,
  discountFromRule,
  resolveDiscounts,
} from './discounts';
import { bonificacionesSeed, seedDiscounts } from './discountsSeed';
import { listBonificaciones } from './bonificaciones';

let ACCESSIN_BONIFICACIONES;
let ACCESSIN_BONIFICACIONES_AS_OF;
let ACCESSIN_BONIFICACIONES_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots(['accessinBonificaciones']);
  ({
    ACCESSIN_BONIFICACIONES,
    ACCESSIN_BONIFICACIONES_AS_OF,
    ACCESSIN_BONIFICACIONES_SNAPSHOT,
  } = bonificacionesSeed());
});

describe('discounts / bonificaciones', () => {
  it('carga seed Accessin real + regla COMISION', () => {
    const all = resolveDiscounts(null, seedDiscounts());
    expect(ACCESSIN_BONIFICACIONES_AS_OF).toBe('2026-09-26');
    expect(ACCESSIN_BONIFICACIONES_SNAPSHOT.asOfLabel).toMatch(/26 de Septiembre del 2026/);
    expect(ACCESSIN_BONIFICACIONES.length).toBe(17);
    expect(ACCESSIN_DISCOUNT_RULES).toHaveLength(1);
    expect(discountCategoryCounts(all).find((c) => c.id === 'members')?.count).toBe(17);
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

  it('lee una regla de descuentos extras ya guardada', () => {
    const row = discountFromRule({
      id: '60fea9a6-1916-47ad-aaa9-ce8130ad00b2',
      rule_key: 'amdis-100007-636',
      category: 'members',
      member_numbers: '100007',
      member_name: 'Moreno Marcelo',
      description: 'Bonificación Comisión Directiva',
      value_type: 'percent',
      value: '100.00',
      valid_from: '2025-09-25',
      valid_to: '2026-04-30',
      is_active: true,
      accessin_id: 636,
      source: 'lila',
    });
    expect(row.ruleKey).toBe('amdis-100007-636');
    expect(row.memberNumber).toBe('100007');
    expect(row.percentage).toBe(100);
    expect(row.source).toBe('lila');
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
    const merged = resolveDiscounts([...ACCESSIN_BONIFICACIONES, local], seedDiscounts());
    expect(merged.length).toBeGreaterThanOrEqual(18);
  });

  it('reemplaza bonificaciones Accessin que ya no están en el corte', () => {
    const stale = {
      id: 'abon-viejo-1',
      source: 'accessin',
      category: 'members',
      description: 'corte anterior',
      isActive: true,
    };
    const local = createDiscount({
      category: 'general',
      description: 'General staff',
      valueType: 'percent',
      value: 10,
    });
    const merged = resolveDiscounts([stale, local], seedDiscounts());
    expect(merged.some((d) => d.id === 'abon-viejo-1')).toBe(false);
    expect(merged.some((d) => d.id === local.id)).toBe(true);
    expect(merged.filter((d) => d.source === 'accessin' && d.category === 'members')).toHaveLength(17);
  });

  it('lista el corte y encuentra a Laciar', () => {
    expect(listBonificaciones()).toHaveLength(17);
    expect(listBonificaciones({ query: '8377' }).every((r) => r.memberNumber === '8377')).toBe(true);
    expect(listBonificaciones({ query: 'Ferrer' })[0]?.memberName).toMatch(/Ferrer/);
  });
});

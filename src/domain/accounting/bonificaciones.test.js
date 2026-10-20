import { describe, expect, it } from 'vitest';
import { buildLiveBonificaciones, listBonificaciones } from './bonificaciones';

const puygRule = {
  id: 'amdis-9216-1634',
  category: 'members',
  memberIds: ['9216'],
  memberNumber: '9216',
  memberName: 'Puyg Alejandro',
  description: 'Membresia hasta abril 2027',
  valueType: 'percent',
  value: 100,
  percentage: 100,
  validFrom: '2026-06-12',
  validTo: '2027-04-30',
  isActive: true,
};

const expiredRule = {
  id: 'amdis-exp',
  category: 'members',
  memberIds: ['11765'],
  memberNumber: '11765',
  memberName: 'Pillarou Agustin',
  description: 'Pago anticipado hasta abril 2026',
  valueType: 'percent',
  value: 100,
  validFrom: '2025-12-18',
  validTo: '2026-04-30',
  isActive: true,
};

const comisionRule = {
  id: 'amdis-cat-376',
  category: 'fee_category',
  feeCategories: ['COMISION'],
  description: 'Miembro de comisión',
  valueType: 'percent',
  value: 100,
  validFrom: '2025-05-29',
  validTo: '2027-04-30',
  isActive: true,
};

const puyg = {
  memberId: '9216',
  name: 'Puyg Alejandro',
  status: 'active',
  tier: 'socio_familiar',
  cuotaCategories: ['SOCIO FAMILIAR'],
  familyGroupName: 'GF Puyg',
};

const comision = {
  memberId: '8377',
  name: 'Laciar',
  status: 'active',
  tier: 'comision',
  cuotaCategories: ['COMISION'],
};

describe('buildLiveBonificaciones', () => {
  it('lista la bonificación vigente y el importe que baja este mes', () => {
    const book = buildLiveBonificaciones([puygRule], [puyg], { today: '2026-10-19' });
    expect(book.rows).toHaveLength(1);
    expect(book.rows[0].covering).toBe(true);
    expect(book.rows[0].waived).toBe(70000);
    expect(book.summary.uniqueMembers).toBe(1);
    expect(book.summary.waivedThisMonth).toBe(70000);
  });

  it('conserva la nota nominada aunque ya esté vencida', () => {
    const book = buildLiveBonificaciones([expiredRule], [{
      memberId: '11765',
      name: 'Pillarou Agustin',
      status: 'active',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
    }], { today: '2026-10-19' });
    expect(book.rows).toHaveLength(1);
    expect(book.rows[0].covering).toBe(false);
    expect(book.rows[0].waived).toBe(0);
    expect(book.summary.expiredCount).toBe(1);
  });

  it('no arma una fila por categoría si la cuota de esa línea ya es cero', () => {
    const book = buildLiveBonificaciones([comisionRule], [comision], { today: '2026-10-19' });
    expect(book.rows).toHaveLength(0);
  });

  it('filtra vigentes', () => {
    const book = buildLiveBonificaciones([puygRule, expiredRule], [puyg], { today: '2026-10-19' });
    expect(listBonificaciones({ items: book.rows, status: 'active' })).toHaveLength(1);
    expect(listBonificaciones({ items: book.rows, query: '9216' })[0].memberNumber).toBe('9216');
  });
});

import { describe, expect, it } from 'vitest';
import { feePeriodCategoryMoves } from './feePeriodCategoryMoves';

describe('feePeriodCategoryMoves', () => {
  it('cuenta altas y bajas del mes por categoría del socio', () => {
    const members = [
      {
        memberId: '10',
        name: 'Alta Familiar',
        status: 'active',
        joinDate: '2026-11-05',
        tier: 'socio_familiar',
        cuotaCategories: ['SOCIO FAMILIAR'],
      },
      {
        memberId: '20',
        name: 'Baja Individual',
        status: 'inactive',
        bajaFecha: '2026-11-12',
        tier: 'socio_individual',
        cuotaCategories: ['SOCIO INDIVIDUAL'],
      },
      {
        memberId: '30',
        name: 'Otra mes',
        status: 'active',
        joinDate: '2026-10-01',
        tier: 'socio_familiar',
        cuotaCategories: ['SOCIO FAMILIAR'],
      },
    ];
    const concepts = [
      { id: 'socio_familiar', label: 'SOCIO FAMILIAR' },
      { id: 'socio_individual', label: 'SOCIO INDIVIDUAL' },
    ];
    const result = feePeriodCategoryMoves({
      year: 2026,
      month: 11,
      concepts,
      members,
      altas: [{ memberId: '10', name: 'Alta Familiar', date: '2026-11-05' }],
      bajas: [{ memberId: '20', name: 'Baja Individual', date: '2026-11-12', motivo: 'renuncia' }],
    });
    expect(result.totalAltas).toBe(1);
    expect(result.totalBajas).toBe(1);
    expect(result.statsForConcept(concepts[0])).toEqual({ altas: 1, bajas: 0 });
    expect(result.statsForConcept(concepts[1])).toEqual({ altas: 0, bajas: 1 });
  });
});

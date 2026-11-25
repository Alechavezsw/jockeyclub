import { describe, expect, it } from 'vitest';
import { buildMemberFichaModel } from './exportMemberFichaPdf';

describe('exportMemberFichaPdf', () => {
  it('arma la ficha con identidad, cuota y grupo familiar', () => {
    const model = buildMemberFichaModel({
      memberId: '101539',
      name: 'Laura Jannete Arroyo',
      documentType: 'DNI',
      documentNumber: '30111222',
      tier: 'socio_familiar',
      status: 'active',
      phone: '2644000000',
      email: 'laura@example.com',
      address: 'Calle 1',
      city: 'San Juan',
      province: 'San Juan',
      joinDate: '2026-10-01',
      outstandingBalance: 0,
      paymentMethod: 'efectivo',
    }, {
      household: [
        {
          memberId: '101540',
          name: 'Hijo Arroyo',
          tier: 'grupo_familiar',
          meta: { familyPrincipalNumber: '101539' },
        },
      ],
    });

    expect(model.fileName).toMatch(/^ficha-socio-101539-\d{8}\.pdf$/);
    expect(model.name).toBe('Laura Jannete Arroyo');
    expect(model.memberId).toBe('101539');
    expect(model.rows.some(([label, value]) => label === 'Documento' && String(value).includes('30111222'))).toBe(true);
    expect(model.rows.some(([label]) => label === 'Cuota social')).toBe(true);
    expect(model.family).toEqual([
      expect.objectContaining({
        memberId: '101540',
        name: 'Hijo Arroyo',
        role: 'Integrante',
      }),
    ]);
    expect(model.note).toMatch(/padrón/i);
  });
});

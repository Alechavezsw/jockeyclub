import { describe, expect, it } from 'vitest';
import { buildPadronPdfModel } from './exportMembersPdf';

describe('buildPadronPdfModel', () => {
  const titular = {
    memberId: '10009',
    name: 'Titular Rojo',
    familyPrincipalNumber: 10009,
    status: 'active',
  };
  const hijo = {
    memberId: '3501',
    name: 'Milagros Rojo',
    familyPrincipalNumber: 10009,
    status: 'active',
  };

  it('cuenta exactamente los socios únicos del sistema', () => {
    const model = buildPadronPdfModel([titular, hijo, { ...titular }]);
    expect(model.total).toBe(2);
    expect(model.titulares).toBe(1);
    expect(model.integrantes).toBe(1);
    expect(model.rows).toHaveLength(2);
  });

  it('no pierde socios inactivos ni suspendidos', () => {
    const model = buildPadronPdfModel([
      titular,
      { memberId: '9', name: 'Baja', status: 'inactive' },
      { memberId: '8', name: 'Mora', status: 'suspended' },
    ]);
    expect(model.total).toBe(3);
    expect(model.titulares).toBe(3);
  });
});

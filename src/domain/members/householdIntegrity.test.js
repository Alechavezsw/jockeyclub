import { describe, expect, it } from 'vitest';
import {
  assessHouseholdIntegrity,
  memberFichaGaps,
  scanPadronHouseholdIssues,
  summarizeHouseholdIssues,
} from './householdIntegrity';

describe('householdIntegrity', () => {
  it('detecta huecos de ficha sin inventar datos', () => {
    const gaps = memberFichaGaps({
      memberId: '100',
      name: 'Sin datos',
      status: 'active',
    });
    expect(gaps.map((g) => g.field)).toEqual(
      expect.arrayContaining(['documentNumber', 'email', 'phone', 'joinDate', 'birthDate']),
    );
    expect(memberFichaGaps({
      memberId: '101',
      documentNumber: '30111222',
      email: 'a@b.com',
      phone: '2644112233',
      joinDate: '2010-01-01',
      birthDate: '1980-05-05',
    })).toEqual([]);
  });

  it('marca integrante sin titular en el hogar RPC', () => {
    const member = {
      memberId: '12087',
      name: 'Luisiana',
      status: 'active',
      familyPrincipalNumber: '12086',
      documentNumber: '30111222',
      email: 'a@b.com',
      phone: '2644112233',
      joinDate: '2020-01-01',
      birthDate: '1990-01-01',
    };
    const result = assessHouseholdIntegrity({
      member,
      householdRows: [member],
    });
    expect(result.warnings.some((w) => w.code === 'dependent_missing_titular')).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('marca titular inactivo con integrantes activos', () => {
    const titular = {
      memberId: '8600',
      name: 'Titular baja',
      status: 'inactive',
      familyPrincipalNumber: '8600',
      bajaFecha: '2020-01-01',
    };
    const hijo = {
      memberId: '92',
      name: 'Integrante',
      status: 'active',
      familyPrincipalNumber: '8600',
    };
    const result = assessHouseholdIntegrity({
      member: titular,
      householdRows: [titular, hijo],
    });
    expect(result.warnings.some((w) => w.code === 'inactive_titular_active_dependents')).toBe(true);
  });

  it('escanea el padrón cargado sin mutar ni inventar vínculos', () => {
    const members = [
      {
        memberId: '3462',
        name: 'Patricia',
        status: 'active',
        familyPrincipalNumber: '8600',
        documentNumber: '20111222',
        email: 'p@x.com',
        phone: '2644000000',
        joinDate: '2015-01-01',
        birthDate: '1975-01-01',
      },
      {
        memberId: '100',
        name: 'Titular ok',
        status: 'active',
        familyPrincipalNumber: '100',
        documentNumber: '30111222',
        email: 't@x.com',
        phone: '2644111111',
        joinDate: '2010-01-01',
        birthDate: '1970-01-01',
      },
      {
        memberId: '101',
        name: 'Hijo ok',
        status: 'active',
        familyPrincipalNumber: '100',
        documentNumber: '40111222',
        email: 'h@x.com',
        phone: '2644222222',
        joinDate: '2018-01-01',
        birthDate: '2005-01-01',
      },
      {
        memberId: '200',
        name: 'Dup A',
        status: 'active',
        documentNumber: '55111222',
        email: 'a@x.com',
        phone: '2644333333',
        joinDate: '2012-01-01',
        birthDate: '1988-01-01',
      },
      {
        memberId: '201',
        name: 'Dup B',
        status: 'active',
        familyPrincipalNumber: '999',
        documentNumber: '55111222',
        email: 'b@x.com',
        phone: '2644444444',
        joinDate: '2013-01-01',
        birthDate: '1989-01-01',
      },
    ];

    const issues = scanPadronHouseholdIssues(members);
    expect(issues.some((i) => i.code === 'dependent_missing_titular' && i.memberId === '3462')).toBe(true);
    expect(issues.some((i) => i.code === 'same_document_multiple_households')).toBe(true);

    const summary = summarizeHouseholdIssues(issues);
    expect(summary.errors).toBeGreaterThan(0);
    expect(summary.total).toBe(issues.length);
  });

  it('distingue titular inactivo de titular inexistente y marca la cadena', () => {
    const issues = scanPadronHouseholdIssues([
      {
        memberId: '50',
        name: 'Titular baja',
        status: 'inactive',
        tier: 'socio_familiar',
        familyPrincipalNumber: '50',
        documentNumber: '20111000',
        email: 't@x.com',
      },
      {
        memberId: '51',
        name: 'Hijo activo',
        status: 'active',
        tier: 'grupo_familiar_familiar',
        familyPrincipalNumber: '50',
        documentNumber: '30111000',
        email: 'h@x.com',
      },
      {
        memberId: '70',
        name: 'Integrante puente',
        status: 'active',
        tier: 'grupo_familiar_familiar',
        familyPrincipalNumber: '80',
        documentNumber: '40111000',
        email: 'p@x.com',
      },
      {
        memberId: '71',
        name: 'Nieto',
        status: 'active',
        tier: 'grupo_familiar_familiar',
        familyPrincipalNumber: '70',
        documentNumber: '50111000',
        email: 'n@x.com',
      },
      {
        memberId: '90',
        name: 'Sin numero',
        status: 'active',
        tier: 'grupo_familiar_familiar',
        documentNumber: '60111000',
        email: 's@x.com',
      },
    ]);

    expect(issues.some((i) => i.code === 'dependent_missing_titular' && i.memberId === '51')).toBe(false);
    expect(issues.some((i) => i.code === 'inactive_titular_active_dependent' && i.memberId === '51')).toBe(true);
    expect(issues.some((i) => i.code === 'dependent_points_to_dependent' && i.memberId === '71')).toBe(true);
    expect(issues.some((i) => i.code === 'integrante_sin_vinculo' && i.memberId === '90')).toBe(true);
    expect(issues.some((i) => i.code === 'dependent_missing_titular' && i.memberId === '70')).toBe(true);
  });

  it('marca categoría de integrante que opera como titular y no toca al socio familiar', () => {
    const issues = scanPadronHouseholdIssues([
      {
        memberId: '10',
        name: 'Cabeza mal categorizada',
        status: 'active',
        tier: 'grupo_familiar_familiar',
        familyPrincipalNumber: '10',
        documentNumber: '20111222',
        email: 'c@x.com',
      },
      {
        memberId: '11',
        name: 'Hijo',
        status: 'active',
        tier: 'grupo_familiar_familiar',
        familyPrincipalNumber: '10',
        documentNumber: '30111222',
        email: 'i@x.com',
      },
      {
        memberId: '12',
        name: 'Familiar que abona',
        status: 'active',
        tier: 'socio_familiar',
        documentNumber: '40111222',
        email: 'f@x.com',
      },
    ]);

    expect(issues.some((i) => i.code === 'integrante_como_titular' && i.memberId === '10')).toBe(true);
    expect(issues.some((i) => i.code === 'integrante_sin_vinculo' && i.memberId === '12')).toBe(false);
    expect(issues.some((i) => i.memberId === '11' && i.code === 'integrante_sin_vinculo')).toBe(false);
  });
});

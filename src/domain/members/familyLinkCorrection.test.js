import { describe, expect, it } from 'vitest';
import {
  FAMILY_LINK_MODULE_IMPACT,
  buildFamilyLinkPreview,
  buildPrincipalLookup,
  detectFamilyLinkCycle,
  detectProposedIsDependent,
  familyLinkConfirmPhrase,
  familyLinkMatchesConfirm,
  normalizeClubNumber,
  walkFamilyPrincipalChain,
} from './familyLinkCorrection';
import { billingAccountMember } from './households';

describe('familyLinkCorrection', () => {
  const integrante = {
    memberId: '12087',
    name: 'Luisiana Mesina',
    status: 'active',
    familyPrincipalNumber: '12086',
    outstandingBalance: 70000,
  };
  /** Fixture de laboratorio — no es destino autorizado para la ficha real 12087. */
  const titularOk = {
    memberId: '10009',
    name: 'Titular Ok',
    status: 'active',
    familyPrincipalNumber: '10009',
    familyGroupName: 'GF Ok',
  };
  const titularInactive = {
    memberId: '20001',
    name: 'Titular Baja',
    status: 'inactive',
    bajaFecha: '2020-01-01',
    familyPrincipalNumber: '20001',
  };

  it('normaliza números de socio', () => {
    expect(normalizeClubNumber('Nº 12.087')).toBe('12087');
    expect(normalizeClubNumber('')).toBeNull();
  });

  it('caso 12087: preview de lectura con titular 12086 inexistente (sin apply)', () => {
    const preview = buildFamilyLinkPreview({
      member: integrante,
      expectedPrincipal: '12086',
      proposedPrincipal: '99999',
      proposedMember: null,
      reason: 'Solo lectura: titular histórico inexistente',
    });
    expect(preview.expectedPrincipal).toBe('12086');
    expect(preview.ok).toBe(false);
    expect(preview.errors.some((e) => e.code === 'proposed_missing')).toBe(true);
    expect(preview.financialNote).toMatch(/no se tocan saldos/i);
    // 10009 es fixture de test, no se usa como destino real aquí.
    expect(preview.proposedPrincipal).toBe('99999');
  });

  it('bloquea titular inexistente, auto-titular e integrante como titular', () => {
    const missing = buildFamilyLinkPreview({
      member: integrante,
      expectedPrincipal: '12086',
      proposedPrincipal: '99999',
      proposedMember: null,
      reason: 'Titular histórico inexistente, reasignar con evidencia LILA',
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors.some((e) => e.code === 'proposed_missing')).toBe(true);

    expect(detectFamilyLinkCycle('12087', '12087', null)?.code).toBe('self_principal');

    const dependent = {
      memberId: '30002',
      name: 'Integrante',
      status: 'active',
      familyPrincipalNumber: '30001',
    };
    expect(detectProposedIsDependent(dependent)?.code).toBe('proposed_is_dependent');
    const blocked = buildFamilyLinkPreview({
      member: integrante,
      expectedPrincipal: '12086',
      proposedPrincipal: '30002',
      proposedMember: dependent,
      reason: 'Intento inválido de titular intermediario',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.some((e) => e.code === 'proposed_is_dependent')).toBe(true);
  });

  it('detecta ciclos de 2 y de 3+ niveles', () => {
    const a = { memberId: '40001', name: 'A', status: 'active', familyPrincipalNumber: '40001' };
    const b = { memberId: '40002', name: 'B', status: 'active', familyPrincipalNumber: '40001' };
    const c = { memberId: '40003', name: 'C', status: 'active', familyPrincipalNumber: '40002' };
    const lookup = buildPrincipalLookup([a, b, c]);

    // A↔B directo vía proposedMember.
    expect(detectFamilyLinkCycle('40001', '40002', {
      ...b,
      familyPrincipalNumber: '40001',
    })?.code).toBe('circular_link');

    // A → C → B → A (al poner A bajo C).
    const deep = detectFamilyLinkCycle('40001', '40003', null, {
      lookup: (number) => {
        if (number === '40003') return '40002';
        if (number === '40002') return '40001';
        if (number === '40001') return null;
        return undefined;
      },
    });
    expect(deep?.code).toBe('circular_link');
    expect(deep.path).toContain('40001');

    // Cadena rota (referencia histórica incompleta).
    const broken = walkFamilyPrincipalChain('50001', (n) => (n === '50001' ? '50999' : undefined));
    expect(broken.incomplete).toBe(true);
    expect(broken.cycle).toBe(false);

    // Ciclo largo A→B→C→D→A.
    const long = detectFamilyLinkCycle('41001', '41004', null, {
      lookup: (n) => ({
        41004: '41003',
        41003: '41002',
        41002: '41001',
        41001: '41004',
      }[n] ?? null),
    });
    expect(long?.code).toBe('circular_link');

    expect(lookup('40002')).toBe('40001');
    expect(lookup('40001')).toBeNull();
  });

  it('arma preview válido y exige ack si el titular está inactivo', () => {
    const ok = buildFamilyLinkPreview({
      member: integrante,
      expectedPrincipal: '12086',
      proposedPrincipal: '10009',
      proposedMember: titularOk,
      originHousehold: [integrante],
      destinationHousehold: [titularOk],
      members: [integrante, titularOk],
      reason: 'Reasignación con evidencia de ficha LILA',
    });
    expect(ok.ok).toBe(true);
    expect(ok.wouldChange[0]).toEqual({
      field: 'meta.familyPrincipalNumber',
      from: '12086',
      to: '10009',
    });
    expect(ok.financialNote).toMatch(/sin impacto financiero/i);
    expect(ok.moduleImpact).toBe(FAMILY_LINK_MODULE_IMPACT);

    const inactive = buildFamilyLinkPreview({
      member: integrante,
      expectedPrincipal: '12086',
      proposedPrincipal: '20001',
      proposedMember: titularInactive,
      reason: 'Vínculo provisorio bajo titular inactivo con evidencia',
      ackInactiveTitular: false,
    });
    expect(inactive.ok).toBe(false);
    expect(inactive.errors.some((e) => e.code === 'ack_inactive_required')).toBe(true);

    const inactiveAck = buildFamilyLinkPreview({
      member: integrante,
      expectedPrincipal: '12086',
      proposedPrincipal: '20001',
      proposedMember: titularInactive,
      reason: 'Vínculo provisorio bajo titular inactivo con evidencia',
      ackInactiveTitular: true,
    });
    expect(inactiveAck.ok).toBe(true);
  });

  it('no transfiere deudas al cambiar el puntero: billingAccountMember solo resuelve lookup', () => {
    const after = {
      ...integrante,
      familyPrincipalNumber: '10009',
      outstandingBalance: 70000,
    };
    const account = billingAccountMember(after, [after, titularOk]);
    expect(account?.memberId).toBe('10009');
    expect(after.outstandingBalance).toBe(70000);
    expect(FAMILY_LINK_MODULE_IMPACT.accountHolderLookup.financialTransfer).toBe(false);
    expect(FAMILY_LINK_MODULE_IMPACT.bookings.financialTransfer).toBe(false);
  });

  it('exige frase de doble confirmación exacta', () => {
    const preview = buildFamilyLinkPreview({
      member: integrante,
      expectedPrincipal: '12086',
      proposedPrincipal: '10009',
      proposedMember: titularOk,
      reason: 'Reasignación con evidencia de ficha LILA',
    });
    const phrase = familyLinkConfirmPhrase(preview);
    expect(phrase).toContain('12087');
    expect(phrase).toContain('10009');
    expect(familyLinkMatchesConfirm(preview, phrase)).toBe(true);
    expect(familyLinkMatchesConfirm(preview, 'ok')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildFamilyLinkPreview,
  detectFamilyLinkCycle,
  familyLinkConfirmPhrase,
  familyLinkMatchesConfirm,
  normalizeClubNumber,
} from './familyLinkCorrection';

describe('familyLinkCorrection', () => {
  const integrante = {
    memberId: '12087',
    name: 'Luisiana Mesina',
    status: 'active',
    familyPrincipalNumber: '12086',
    outstandingBalance: 70000,
  };
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

  it('bloquea titular inexistente y ciclo', () => {
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
    expect(detectFamilyLinkCycle('12087', '10009', {
      ...titularOk,
      familyPrincipalNumber: '12087',
    })?.code).toBe('circular_link');
  });

  it('arma preview válido y exige ack si el titular está inactivo', () => {
    const ok = buildFamilyLinkPreview({
      member: integrante,
      expectedPrincipal: '12086',
      proposedPrincipal: '10009',
      proposedMember: titularOk,
      originHousehold: [integrante],
      destinationHousehold: [titularOk],
      reason: 'Reasignación con evidencia de ficha LILA',
    });
    expect(ok.ok).toBe(true);
    expect(ok.wouldChange[0]).toEqual({
      field: 'meta.familyPrincipalNumber',
      from: '12086',
      to: '10009',
    });
    expect(ok.financialNote).toMatch(/sin impacto financiero/i);

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

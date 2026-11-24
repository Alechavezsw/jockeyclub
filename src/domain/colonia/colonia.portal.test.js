import { describe, expect, it } from 'vitest';
import {
  coloniaBadgeForHouseholdMember,
  coloniaEnrollmentBalance,
  coloniaStatusLabel,
  portalEnabledPlans,
  validatePortalEnrollmentWizard,
  buildPortalEnrollmentPayload,
} from './coloniaPortal';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';

describe('coloniaPortal', () => {
  it('no ofrece promo hermanos sin periodicidad', () => {
    expect(portalEnabledPlans({ promotionPeriodicity: null })).toEqual([
      'cuota',
      'temporada',
      'hermano_4',
    ]);
  });

  it('etiqueta estados de portal', () => {
    expect(coloniaStatusLabel('pendiente')).toBe('Pendiente de validación');
    expect(coloniaStatusLabel('pendiente_pago')).toBe('Pendiente de pago');
  });

  it('calcula saldo Colonia sin mezclar cuota social', () => {
    const bal = coloniaEnrollmentBalance({
      charges_total: 200000,
      payments_confirmed: 50000,
      payments_pending: 10000,
    });
    expect(bal.balance).toBe(150000);
    expect(bal.paymentLabel).toBe('Pago en verificación');
  });

  it('marca integrante sin inscripción', () => {
    const badge = coloniaBadgeForHouseholdMember(
      { name: 'Ana', birthDate: '2015-03-01', memberId: '123' },
      [],
      COLONIA_SEASON_2026_2027,
    );
    expect(badge.key).toBe('none');
    expect(badge.label).toBe('Sin inscripción');
  });

  it('valida wizard y arma payload portal', () => {
    const student = {
      fullName: 'Juan Pérez',
      birthDate: '2014-06-15',
      documentNumber: '50111222',
      memberKind: 'socio',
      memberNumber: '1200',
      shirtSize: 'M',
    };
    const guardian = {
      fullName: 'María Pérez',
      phone: '2644000000',
      emergencyContact: 'Abuela 2644111111',
      authorizedPickup: 'Abuela',
      relationship: 'Madre',
    };
    const check = validatePortalEnrollmentWizard({
      step: 10,
      student,
      guardian,
      planKey: 'cuota',
      season: COLONIA_SEASON_2026_2027,
      todayIso: '2026-11-25',
      authorized: true,
    });
    expect(check.ok).toBe(true);
    const payload = buildPortalEnrollmentPayload({
      seasonId: 'season-1',
      student,
      guardian,
      planKey: 'cuota',
      memberId: 'member-1',
      idempotencyKey: 'idem-1',
    });
    expect(payload.student.identity_key).toBe('dni:50111222');
    expect(payload.planKey).toBe('cuota');
  });

  it('bloquea inscripción sin autorización', () => {
    const check = validatePortalEnrollmentWizard({
      step: 3,
      student: { fullName: 'X', birthDate: '2014-01-01' },
      guardian: { fullName: 'Y' },
      authorized: false,
    });
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.code === 'not_authorized')).toBe(true);
  });
});

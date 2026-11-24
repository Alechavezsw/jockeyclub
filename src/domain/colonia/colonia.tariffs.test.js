import { describe, expect, it } from 'vitest';
import { validateColoniaAge } from './coloniaAge';
import { validateEnrollmentDraft } from './coloniaEnrollment';
import {
  evaluatePromotionCharge,
  inscriptionAmount,
  planAmountFor,
  COLONIA_OFFICIAL_TARIFFS_2026_2027,
} from './coloniaTariffs';
import {
  assertColoniaFinanceIsolation,
  buildColoniaEnrollmentsCsv,
  buildColoniaReceipt,
  summarizeColoniaAccount,
} from './coloniaLedger';
import {
  buildColoniaPaymentDraft,
  coloniaMercadoPagoAdapterSpec,
  validateColoniaPaymentInput,
} from './coloniaPayments';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';
import {
  canAccessColonia,
  canAttendColonia,
  canCollectColonia,
  canManageColoniaHealth,
  canViewColoniaFinance,
  allowedAdminTabs,
  allowedAccountingSubtabs,
} from '../auth/roles';

describe('colonia domain', () => {
  it('valida edades 3-15 al inicio de actividades', () => {
    expect(validateColoniaAge('2023-11-30', { activitiesStartOn: '2026-11-30' }).ok).toBe(true); // 3
    expect(validateColoniaAge('2011-11-30', { activitiesStartOn: '2026-11-30' }).ok).toBe(true); // 15
    expect(validateColoniaAge('2024-12-01', { activitiesStartOn: '2026-11-30' }).ok).toBe(false); // 1
    expect(validateColoniaAge('2010-11-29', { activitiesStartOn: '2026-11-30' }).ok).toBe(false); // 16
  });

  it('tarifas oficiales y bloqueo de promociones ambiguas', () => {
    expect(inscriptionAmount()).toBe(50000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'cuota')).toBe(150000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'temporada')).toBe(490000);

    const blocked = evaluatePromotionCharge({
      planKey: 'promo_2',
      season: COLONIA_SEASON_2026_2027,
      siblingCount: 2,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.some((e) => e.code === 'promo_periodicity_undefined')).toBe(true);

    const okMonthly = evaluatePromotionCharge({
      planKey: 'promo_2',
      season: { ...COLONIA_SEASON_2026_2027, promotionPeriodicity: 'monthly' },
      siblingCount: 2,
      memberKinds: ['socio', 'socio'],
    });
    expect(okMonthly.ok).toBe(true);

    const mixed = evaluatePromotionCharge({
      planKey: 'promo_2',
      season: { ...COLONIA_SEASON_2026_2027, promotionPeriodicity: 'season' },
      siblingCount: 2,
      memberKinds: ['socio', 'no_socio'],
    });
    expect(mixed.ok).toBe(false);

    const fifth = evaluatePromotionCharge({
      planKey: 'hermano_4',
      season: { ...COLONIA_SEASON_2026_2027, promotionPeriodicity: 'season' },
      siblingCount: 5,
      memberKinds: ['socio'],
    });
    expect(fifth.errors.some((e) => e.code === 'fifth_sibling_undefined')).toBe(true);
  });

  it('bloquea inscripción duplicada y exige responsable', () => {
    const draft = validateEnrollmentDraft({
      student: {
        fullName: 'Ana Test',
        birthDate: '2018-01-01',
        documentNumber: '50111222',
        memberKind: 'no_socio',
      },
      guardian: { fullName: 'Tutor', phone: '2644000000' },
      planKey: 'cuota',
      existingKeys: ['dni:50111222'],
      todayIso: '2026-11-25',
    });
    expect(draft.ok).toBe(false);
    expect(draft.errors.some((e) => e.code === 'duplicate_enrollment')).toBe(true);
  });

  it('aísla finanzas de Colonia de cuota social', () => {
    expect(() => assertColoniaFinanceIsolation({ affectsSocialDues: true })).toThrow(/cuota social/i);
    expect(() => assertColoniaFinanceIsolation({ chargeScope: 'social' })).toThrow(/cuota social/i);

    const summary = summarizeColoniaAccount({
      charges: [{ amount: 150000, status: 'posted' }, { amount: 50000, status: 'posted' }],
      payments: [
        { amount: 50000, status: 'confirmed' },
        { amount: 20000, status: 'pending' },
      ],
    });
    expect(summary.totalContracted).toBe(200000);
    expect(summary.totalCollected).toBe(50000);
    expect(summary.pendingConfirmation).toBe(20000);
    expect(summary.balanceDue).toBe(150000);
  });

  it('medios de pago: efectivo confirma, transferencia pendiente, MP bloqueado hasta deploy', () => {
    const cash = validateColoniaPaymentInput({
      method: 'efectivo',
      amount: 50000,
      enrollmentId: 'e1',
    });
    expect(cash.ok).toBe(true);
    expect(cash.status).toBe('confirmed');

    const transfer = validateColoniaPaymentInput({
      method: 'transferencia',
      amount: 50000,
      enrollmentId: 'e1',
      externalReference: 'TRX-1',
    });
    expect(transfer.status).toBe('pending');

    const card = validateColoniaPaymentInput({
      method: 'pos',
      amount: 50000,
      enrollmentId: 'e1',
      operatorConfirmed: false,
    });
    expect(card.ok).toBe(false);

    expect(() => buildColoniaPaymentDraft({
      method: 'mercadopago',
      amount: 50000,
      enrollmentId: 'e1',
    })).toThrow(/autorización de despliegue/i);

    expect(coloniaMercadoPagoAdapterSpec().kind).toBe('colonia');
  });

  it('comprobante solo para pagos confirmed; CSV de reportes', () => {
    expect(buildColoniaReceipt({
      payment: { status: 'pending', amount: 1000, method: 'transferencia' },
      student: { fullName: 'A' },
    })).toBeNull();

    const receipt = buildColoniaReceipt({
      payment: {
        id: 'pay-1',
        status: 'confirmed',
        amount: 50000,
        method: 'efectivo',
        confirmed_at: '2026-11-25T12:00:00Z',
      },
      student: { fullName: 'Alumno' },
      guardian: { fullName: 'Tutor' },
      season: { name: '2026/2027', code: '2026-2027' },
    });
    expect(receipt.operationId).toBe('pay-1');
    expect(receipt.amount).toBe(50000);
    expect(receipt.fiscalClaim).toBe(false);

    const csv = buildColoniaEnrollmentsCsv([{
      plan_key: 'cuota',
      status: 'confirmada',
      student: { full_name: 'Ana', document_number: '1', member_kind: 'socio' },
      guardian: { full_name: 'Tutor', phone: '264' },
    }]);
    expect(csv).toContain('Ana');
    expect(csv.split('\n')[0]).toContain('alumno');
  });

  it('permisos: caja cobra; teacher asiste sin cobrar; gate no opera Colonia', () => {
    expect(canCollectColonia('cashier')).toBe(true);
    expect(allowedAdminTabs('cashier')).toContain('operation');
    expect(canAttendColonia('teacher')).toBe(true);
    expect(canCollectColonia('teacher')).toBe(false);
    expect(canViewColoniaFinance('teacher')).toBe(false);
    expect(canManageColoniaHealth('teacher')).toBe(false);
    expect(canManageColoniaHealth('admin')).toBe(true);
    expect(allowedAdminTabs('teacher')).toEqual(['operation']);
    expect(allowedAccountingSubtabs('teacher')).toEqual(['colonia']);
    expect(canAccessColonia('gate')).toBe(false);
    expect(canAccessColonia('admin')).toBe(true);
  });

  it('tarifas oficiales 2026/2027 completas', () => {
    const t = COLONIA_OFFICIAL_TARIFFS_2026_2027;
    expect(t.inscription).toBe(50000);
    expect(t.socio.cuota).toBe(150000);
    expect(t.no_socio.cuota).toBe(180000);
    expect(t.socio.temporada).toBe(390000);
    expect(t.no_socio.temporada).toBe(490000);
    expect(t.socio.promo_2).toBe(280000);
    expect(t.no_socio.promo_2).toBe(340000);
    expect(t.socio.promo_3).toBe(410000);
    expect(t.no_socio.promo_3).toBe(500000);
    expect(t.socio.hermano_4).toBe(0);
  });

  it('inscripción el 30/11/2026 incluida; fuera de ventana rechazada', () => {
    const base = {
      student: {
        fullName: 'Luis',
        birthDate: '2015-01-01',
        documentNumber: '50111999',
        memberKind: 'socio',
        memberNumber: '12001',
      },
      guardian: { fullName: 'Madre', phone: '2644000000' },
      planKey: 'cuota',
      season: COLONIA_SEASON_2026_2027,
    };
    expect(validateEnrollmentDraft({ ...base, todayIso: '2026-11-30' }).ok).toBe(true);
    expect(validateEnrollmentDraft({ ...base, todayIso: '2026-12-01' }).ok).toBe(false);
    expect(validateEnrollmentDraft({
      ...base,
      guardian: { fullName: '', phone: '' },
      todayIso: '2026-11-25',
    }).ok).toBe(false);
  });
});

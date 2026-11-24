import { describe, expect, it } from 'vitest';
import { validateColoniaAge } from './coloniaAge';
import { validateEnrollmentDraft } from './coloniaEnrollment';
import {
  evaluatePromotionCharge,
  inscriptionAmount,
  planAmountFor,
  COLONIA_OFFICIAL_TARIFFS_2026_2027,
} from './coloniaTariffs';
import { assertColoniaFinanceIsolation, summarizeColoniaAccount } from './coloniaLedger';
import {
  buildColoniaPaymentDraft,
  coloniaMercadoPagoAdapterSpec,
  validateColoniaPaymentInput,
} from './coloniaPayments';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';

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
});

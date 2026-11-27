import { describe, expect, it } from 'vitest';
import { COLONIA_OFFICIAL_TARIFFS_2026_2027 } from './coloniaTariffs';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';
import {
  coloniaCuotaInterest,
  coloniaCuotaIsLate,
  coloniaPaymentCapital,
  coloniaEnrollPayChoices,
  quoteColoniaEnrollmentDue,
  quoteColoniaOpenDue,
} from './coloniaLate';

const season = COLONIA_SEASON_2026_2027;

describe('interés de la cuota de Colonia', () => {
  it('el 15 % arranca en diciembre: el 10 no lleva interés y desde el 11 sí', () => {
    expect(coloniaCuotaIsLate('2026-11', '2026-11-27', season)).toBe(false);
    expect(coloniaCuotaInterest(150000, '2026-11', '2026-11-25', season)).toBe(0);
    expect(coloniaCuotaInterest(180000, '2026-11', '2026-11-25', season)).toBe(0);
    expect(coloniaCuotaIsLate('2026-12', '2026-12-10', season)).toBe(false);
    expect(coloniaCuotaIsLate('2026-12', '2026-12-11', season)).toBe(true);
    expect(coloniaCuotaInterest(150000, '2026-12', '2026-12-11', season)).toBe(22500);
    expect(coloniaCuotaInterest(180000, '2026-12', '2026-12-25', season)).toBe(27000);
  });

  it('el cobro de temporada nombra las mismas partes que el plan', () => {
    const offer = coloniaEnrollPayChoices({
      planKey: 'temporada',
      memberKind: 'no_socio',
      pupilCount: 1,
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      paidOn: '2026-11-27',
      season,
    });
    expect(offer.planCapital).toBe(490000);
    expect(offer.inscription).toBe(50000);
    expect(offer.choices.map((row) => [row.label, row.amount])).toEqual([
      ['Plan + inscripción', 540000],
      ['Solo inscripción', 50000],
      ['Solo temporada', 490000],
    ]);
  });

  it('el cuarto hermano no ofrece una inscripción que el plan dice que no cobra', () => {
    const fourth = coloniaEnrollPayChoices({
      planKey: 'hermano_4',
      memberKind: 'no_socio',
      pupilCount: 1,
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      paidOn: '2026-11-27',
      season,
    });
    const three = coloniaEnrollPayChoices({
      planKey: 'promo_3',
      memberKind: 'no_socio',
      pupilCount: 1,
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      paidOn: '2026-11-27',
      season,
    });
    expect(fourth.choices.map((row) => [row.label, row.amount])).toEqual([
      ['Todo', 500000],
    ]);
    expect(three.choices.map((row) => row.amount)).toEqual([550000, 50000, 500000]);
  });

  it('en la inscripción el 15 % va solo sobre la cuota', () => {
    const late = quoteColoniaEnrollmentDue({
      planKey: 'cuota',
      memberKind: 'socio',
      pupilCount: 2,
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      paidOn: '2026-11-25',
      season,
    });
    expect(late).toMatchObject({
      inscription: 100000,
      planCapital: 150000,
      interest: 0,
      total: 250000,
      late: false,
    });

    const onTime = quoteColoniaEnrollmentDue({
      planKey: 'cuota',
      memberKind: 'socio',
      pupilCount: 1,
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      paidOn: '2026-11-10',
      season,
    });
    expect(onTime.interest).toBe(0);
    expect(onTime.total).toBe(200000);
  });

  it('temporada y cuarto hermano no llevan el interés de la cuota', () => {
    const temporada = quoteColoniaEnrollmentDue({
      planKey: 'temporada',
      memberKind: 'socio',
      pupilCount: 1,
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      paidOn: '2026-11-25',
      season,
    });
    expect(temporada.interest).toBe(0);
    expect(temporada.total).toBe(440000);

    const hermano = quoteColoniaEnrollmentDue({
      planKey: 'hermano_4',
      memberKind: 'no_socio',
      pupilCount: 1,
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      paidOn: '2026-11-25',
      season,
    });
    expect(hermano.inscription).toBe(0);
    expect(hermano.interest).toBe(0);
  });

  it('un cobro posterior suma el 15 % de la cuota abierta y el interés no cubre otro mes', () => {
    const open = quoteColoniaOpenDue({
      charges: [
        { concept: 'colonia_inscripcion', amount: 50000, status: 'posted', created_at: '2026-11-08' },
        { concept: 'colonia_cuota', amount: 150000, status: 'posted', created_at: '2026-11-08' },
      ],
      payments: [
        { amount: 50000, status: 'confirmed' },
      ],
      paidOn: '2026-11-25',
      season,
      planKey: 'cuota',
    });
    expect(open).toMatchObject({
      inscription: 0,
      cuota: 150000,
      interest: 0,
      payable: 150000,
    });
    const december = quoteColoniaOpenDue({
      charges: [
        { concept: 'colonia_cuota', amount: 150000, status: 'posted', created_at: '2026-12-08' },
      ],
      payments: [],
      paidOn: '2026-12-11',
      season,
      planKey: 'cuota',
    });
    expect(december.interest).toBe(22500);
    expect(december.payable).toBe(172500);
    expect(coloniaPaymentCapital({
      amount: 172500,
      meta: { interestAmount: 22500 },
    })).toBe(150000);
  });
});

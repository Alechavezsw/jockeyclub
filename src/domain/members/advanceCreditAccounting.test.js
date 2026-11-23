import { describe, expect, it } from 'vitest';
import {
  allocateAdvanceCash,
  assertAdvanceCreditInvariants,
  freeCreditFromStanding,
  imputedCapitalForDue,
  nextDueOnAfter,
  socialTariffForTier,
} from './advanceCreditAccounting';

/** Fixtures congelados (estado post-conciliación prod). No mutan la DB. */
const FIXTURES = {
  '101046': {
    memberNumber: '101046',
    fullName: 'Martin Maximiliano Casas',
    tier: 'socio_familiar',
    outstandingBalance: -7000,
    nextDueDate: '2027-01-10',
    imputations: [
      {
        dueOn: '2026-11-10', capital: 70000, surcharge: 7000, kind: 'cobro',
        paymentId: '57ce56cf-9b2b-4408-81d0-17076ea7e1bd',
      },
      {
        dueOn: '2026-12-10', capital: 70000, surcharge: 0, kind: 'adelanto',
        paymentId: '57ce56cf-9b2b-4408-81d0-17076ea7e1bd',
      },
    ],
    entries: [
      { amount: 147000, kind: 'opening', source: 'opening:x' },
      { amount: -147000, kind: 'payment', source: 'payment:57ce56cf-9b2b-4408-81d0-17076ea7e1bd' },
      { amount: -77000, kind: 'adelanto', source: 'adelanto:57ce56cf-9b2b-4408-81d0-17076ea7e1bd' },
      { amount: 77000, kind: 'ajuste_administrativo', source: 'audit:advance-future-double-credit:20261122:57ce56cf-9b2b-4408-81d0-17076ea7e1bd' },
      { amount: -7000, kind: 'credito_excedente', source: 'audit:101046-december-excess-20261122' },
    ],
  },
  '101612': {
    memberNumber: '101612',
    fullName: 'Maria Florencia García Amor',
    tier: 'socio_familiar',
    outstandingBalance: 0,
    nextDueDate: '2027-01-10',
    imputations: [
      {
        dueOn: '2026-12-10', capital: 70000, surcharge: 0, kind: 'adelanto',
        paymentId: '88616909-e208-4b92-a05c-b7fe569b8110',
      },
    ],
    entries: [
      { amount: -70000, kind: 'adelanto', source: 'adelanto:88616909-e208-4b92-a05c-b7fe569b8110' },
      { amount: 70000, kind: 'ajuste_administrativo', source: 'audit:advance-future-double-credit:20261122:88616909-e208-4b92-a05c-b7fe569b8110' },
    ],
  },
  '101202': {
    memberNumber: '101202',
    fullName: 'Franco Leonel Gaitan',
    tier: 'socio_individual',
    outstandingBalance: 0,
    nextDueDate: '2026-12-10',
    imputations: [
      { dueOn: '2026-09-10', capital: 40000, surcharge: 4000, kind: 'cobro' },
      { dueOn: '2026-10-10', capital: 40000, surcharge: 4000, kind: 'cobro' },
      { dueOn: '2026-11-10', capital: 40000, surcharge: 4000, kind: 'cobro' },
    ],
    entries: [],
  },
  '111621': {
    memberNumber: '111621',
    tier: 'socio_familiar',
    outstandingBalance: 0,
    imputations: [
      { dueOn: '2026-11-10', capital: 70000, surcharge: 0, kind: 'cobro' },
    ],
    entries: [],
  },
  '111628': {
    memberNumber: '111628',
    tier: 'socio_familiar',
    outstandingBalance: 0,
    imputations: [
      { dueOn: '2026-11-10', capital: 70000, surcharge: 0, kind: 'cobro' },
    ],
    entries: [],
  },
  '111649': {
    memberNumber: '111649',
    tier: 'socio_familiar',
    outstandingBalance: 0,
    imputations: [
      { dueOn: '2026-11-10', capital: 70000, surcharge: 0, kind: 'cobro' },
    ],
    entries: [],
  },
  '10508': {
    memberNumber: '10508',
    fullName: 'Gaston Ruben Puebla Macias',
    tier: 'socio_familiar',
    outstandingBalance: -11000,
    nextDueDate: '2026-12-10',
    imputations: [
      { dueOn: '2026-09-10', capital: 70000, surcharge: 7000, kind: 'cobro', paymentId: 'e8427990' },
      { dueOn: '2026-10-10', capital: 70000, surcharge: 7000, kind: 'cobro', paymentId: 'e8427990' },
      { dueOn: '2026-11-10', capital: 60000, surcharge: 6000, kind: 'cobro', paymentId: 'e8427990' },
    ],
    entries: [
      { amount: 620000, kind: 'opening', source: 'opening:x' },
      { amount: -620000, kind: 'payment', source: 'payment:e8427990' },
      { amount: -11000, kind: 'adelanto', source: 'adelanto:e8427990' },
    ],
  },
};

describe('advanceCreditAccounting', () => {
  it('tarifas sociales vigentes', () => {
    expect(socialTariffForTier('socio_familiar')).toBe(70000);
    expect(socialTariffForTier('socio_individual')).toBe(40000);
    expect(nextDueOnAfter('2026-11-10')).toBe('2026-12-10');
    expect(nextDueOnAfter('2026-12-10')).toBe('2027-01-10');
  });

  it('reparte sobrante: cuotas enteras a adelanto y residual a crédito libre', () => {
    const result = allocateAdvanceCash({
      cash: 77000,
      tariff: 70000,
      startDueOn: '2026-12-10',
    });
    expect(result.advances).toEqual([
      { dueOn: '2026-12-10', capital: 70000, surcharge: 0, kind: 'adelanto' },
    ]);
    expect(result.freeCredit).toBe(7000);
    expect(result.lastAdvanceDueOn).toBe('2026-12-10');
  });

  it('no duplica un período ya cubierto por adelanto', () => {
    const result = allocateAdvanceCash({
      cash: 70000,
      tariff: 70000,
      startDueOn: '2026-12-10',
      existingImputations: [
        { dueOn: '2026-12-10', capital: 70000, kind: 'adelanto' },
      ],
    });
    expect(result.advances[0].dueOn).toBe('2027-01-10');
    expect(result.freeCredit).toBe(0);
  });

  it('descuento administrativo no crea crédito libre', () => {
    const result = allocateAdvanceCash({
      cash: 7000,
      tariff: 70000,
      startDueOn: '2026-12-10',
      discount: 7000,
      paidAmount: 70000,
      capitalPaid: 70000,
      surchargePaid: 7000,
    });
    expect(result.advances).toEqual([]);
    expect(result.freeCredit).toBe(0);
  });

  it('crédito libre UI no cuenta adelanto futuro como disponible', () => {
    expect(freeCreditFromStanding({
      outstandingBalance: -77000,
      imputations: [
        { dueOn: '2026-12-10', capital: 70000, kind: 'adelanto' },
      ],
      today: '2026-11-22',
    })).toBe(7000);

    expect(freeCreditFromStanding({
      outstandingBalance: -7000,
      imputations: [
        { dueOn: '2026-12-10', capital: 70000, kind: 'adelanto' },
      ],
      today: '2026-11-22',
    })).toBe(7000);
  });

  it('101046 · Casas: diciembre cubierto y $7.000 de excedente real', () => {
    const snap = FIXTURES['101046'];
    expect(imputedCapitalForDue(snap.imputations, '2026-12-10')).toBe(70000);
    expect(snap.outstandingBalance).toBe(-7000);
    const check = assertAdvanceCreditInvariants(snap);
    expect(check.ok, check.errors.join('; ')).toBe(true);
    expect(freeCreditFromStanding({
      outstandingBalance: snap.outstandingBalance,
      imputations: snap.imputations,
      today: '2026-11-22',
    })).toBe(7000);
  });

  it('101612 · García Amor: diciembre cubierto sin crédito duplicado', () => {
    const snap = FIXTURES['101612'];
    expect(imputedCapitalForDue(snap.imputations, '2026-12-10')).toBe(70000);
    expect(snap.outstandingBalance).toBe(0);
    const check = assertAdvanceCreditInvariants(snap);
    expect(check.ok, check.errors.join('; ')).toBe(true);
  });

  it('101202 · Gaitán: sep/oct/nov individuales a $40.000', () => {
    const snap = FIXTURES['101202'];
    expect(snap.imputations.map((row) => row.capital)).toEqual([40000, 40000, 40000]);
    expect(snap.imputations.every((row) => row.surcharge === 4000)).toBe(true);
    expect(assertAdvanceCreditInvariants(snap).ok).toBe(true);
  });

  it('familiares 111621/628/649: cuota $70.000 sin crédito ficticio', () => {
    for (const id of ['111621', '111628', '111649']) {
      const snap = FIXTURES[id];
      expect(snap.imputations[0].capital).toBe(70000);
      expect(snap.outstandingBalance).toBe(0);
      expect(assertAdvanceCreditInvariants(snap).ok).toBe(true);
    }
  });

  it('10508 · Puebla: preserva pago mixto y excedente', () => {
    const snap = FIXTURES['10508'];
    expect(snap.outstandingBalance).toBe(-11000);
    expect(snap.imputations).toHaveLength(3);
    expect(assertAdvanceCreditInvariants(snap).ok).toBe(true);
  });

  it('detecta doble crédito (regresión prohibida)', () => {
    const bad = {
      tier: 'socio_familiar',
      outstandingBalance: -70000,
      imputations: [
        { dueOn: '2026-12-10', capital: 70000, kind: 'adelanto', paymentId: 'pay-1' },
      ],
      entries: [
        { amount: -70000, kind: 'adelanto', source: 'adelanto:pay-1' },
      ],
    };
    const check = assertAdvanceCreditInvariants(bad);
    expect(check.ok).toBe(false);
    expect(check.errors.some((msg) => /doble crédito/.test(msg))).toBe(true);
  });
});

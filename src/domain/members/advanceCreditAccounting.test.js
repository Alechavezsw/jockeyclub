import { describe, expect, it } from 'vitest';
import {
  ADVANCE_LOOP_LIMIT,
  allocateAdvanceCash,
  assertAdvanceCreditInvariants,
  effectiveSocialAdvanceTariff,
  freeCreditFromStanding,
  imputedCapitalForDue,
  isValidDueOn,
  nextDueOnAfter,
  socialTariffForTier,
} from './advanceCreditAccounting';

/** Fixtures congelados (estado post-conciliación prod). No mutan la DB. */
const FIXTURES = {
  '101046': {
    memberNumber: '101046',
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
    tier: 'socio_individual',
    outstandingBalance: 0,
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
    imputations: [{ dueOn: '2026-11-10', capital: 70000, surcharge: 0, kind: 'cobro' }],
    entries: [],
  },
  '111628': {
    memberNumber: '111628',
    tier: 'socio_familiar',
    outstandingBalance: 0,
    imputations: [{ dueOn: '2026-11-10', capital: 70000, surcharge: 0, kind: 'cobro' }],
    entries: [],
  },
  '111649': {
    memberNumber: '111649',
    tier: 'socio_familiar',
    outstandingBalance: 0,
    imputations: [{ dueOn: '2026-11-10', capital: 70000, surcharge: 0, kind: 'cobro' }],
    entries: [],
  },
  '10508': {
    memberNumber: '10508',
    tier: 'socio_familiar',
    outstandingBalance: -11000,
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
  it('tarifas sociales efectivas (familiar / individual / AMET / exento / tenis aparte)', () => {
    expect(effectiveSocialAdvanceTariff({ tier: 'socio_familiar' })).toBe(70000);
    expect(effectiveSocialAdvanceTariff({ tier: 'socio_individual' })).toBe(40000);
    expect(effectiveSocialAdvanceTariff({ tier: 'socio_familiar_amet' })).toBe(68250);
    expect(effectiveSocialAdvanceTariff({ tier: 'socio_individual_amet' })).toBe(39000);
    expect(effectiveSocialAdvanceTariff({ tier: 'vitalicio' })).toBe(0);
    expect(effectiveSocialAdvanceTariff({ tier: 'comision' })).toBe(0);
    // Tenis no se suma a la tarifa social de anticipo.
    expect(effectiveSocialAdvanceTariff({
      tier: 'socio_familiar',
      cuotaCategories: ['socio_familiar', 'abono_tenis'],
    })).toBe(70000);
    expect(socialTariffForTier('socio_familiar')).toBe(70000);
    expect(nextDueOnAfter('2026-11-10')).toBe('2026-12-10');
    expect(nextDueOnAfter('2026-11-18', { tier: 'socio_familiar_amet' })).toBe('2026-12-18');
    expect(isValidDueOn('2026-12-10')).toBe(true);
    expect(isValidDueOn('1900-01-10')).toBe(false);
  });

  it('reparte $77.000: diciembre $70.000 sin recargo + $7.000 crédito libre', () => {
    const result = allocateAdvanceCash({
      cash: 77000,
      tariff: 70000,
      startDueOn: '2026-12-10',
    });
    expect(result.advances).toEqual([
      { dueOn: '2026-12-10', capital: 70000, surcharge: 0, kind: 'adelanto' },
    ]);
    expect(result.freeCredit).toBe(7000);
    expect(result.advances[0].surcharge).toBe(0);
  });

  it('cubre 10+ períodos futuros sin bucle infinito', () => {
    const result = allocateAdvanceCash({
      cash: 70000 * 12,
      tariff: 70000,
      startDueOn: '2026-12-10',
      loopLimit: ADVANCE_LOOP_LIMIT,
    });
    expect(result.advances).toHaveLength(12);
    expect(result.loops).toBeLessThanOrEqual(ADVANCE_LOOP_LIMIT);
    expect(result.freeCredit).toBe(0);
    expect(result.advances.every((row) => row.surcharge === 0)).toBe(true);
    expect(result.advances.at(-1).dueOn).toBe('2027-11-10');
  });

  it('respeta el tope de iteraciones ante períodos ya cubiertos', () => {
    const existing = [];
    let due = '2026-12-10';
    for (let i = 0; i < 24; i += 1) {
      existing.push({ dueOn: due, capital: 70000, kind: 'adelanto' });
      due = nextDueOnAfter(due);
    }
    const result = allocateAdvanceCash({
      cash: 70000 * 5,
      tariff: 70000,
      startDueOn: '2026-12-10',
      existingImputations: existing,
    });
    expect(result.loops).toBeLessThanOrEqual(ADVANCE_LOOP_LIMIT);
    expect(result.advances.length).toBe(0);
    expect(result.freeCredit).toBe(70000 * 5);
  });

  it('tarifa efectiva desde el socio (sin pasar tariff) y convenio meta', () => {
    const amet = { tier: 'socio_familiar_amet' };
    const byMember = allocateAdvanceCash({
      cash: 68250,
      startDueOn: '2026-12-18',
      member: amet,
    });
    expect(byMember.advances).toEqual([
      { dueOn: '2026-12-18', capital: 68250, surcharge: 0, kind: 'adelanto' },
    ]);
    expect(effectiveSocialAdvanceTariff({
      tier: 'socio_familiar',
      meta: { duesAmount: 55000 },
    })).toBe(55000);
    const convenio = allocateAdvanceCash({
      cash: 55000 + 2000,
      startDueOn: '2026-12-10',
      member: { tier: 'socio_familiar', meta: { duesAmount: 55000 } },
    });
    expect(convenio.advances[0].capital).toBe(55000);
    expect(convenio.freeCredit).toBe(2000);
  });

  it('anticipos con tarifa AMET especial', () => {
    const amet = { tier: 'socio_familiar_amet' };
    const tariff = effectiveSocialAdvanceTariff(amet);
    expect(tariff).toBe(68250);
    const result = allocateAdvanceCash({
      cash: 68250 + 1000,
      tariff,
      startDueOn: '2026-12-18',
      member: amet,
    });
    expect(result.advances).toEqual([
      { dueOn: '2026-12-18', capital: 68250, surcharge: 0, kind: 'adelanto' },
    ]);
    expect(result.freeCredit).toBe(1000);
    expect(result.lastAdvanceDueOn).toBe('2026-12-18');
  });

  it('crédito explícito y saldo negativo no se suman (misma plata)', () => {
    expect(freeCreditFromStanding({
      outstandingBalance: -7000,
      explicitCredit: 7000,
    })).toBe(7000);
    expect(freeCreditFromStanding({
      outstandingBalance: 0,
      explicitCredit: 7000,
    })).toBe(7000);
    expect(freeCreditFromStanding({
      outstandingBalance: -7000,
      explicitCredit: null,
    })).toBe(7000);
    // Deuda en ficha + acarreo explícito: solo el explícito (no suma el negativo).
    expect(freeCreditFromStanding({
      outstandingBalance: 70000,
      explicitCredit: 10000,
    })).toBe(10000);
  });

  it('crédito real $7.000 con diciembre ya cubierto', () => {
    const result = allocateAdvanceCash({
      cash: 77000,
      tariff: 70000,
      startDueOn: '2026-12-10',
    });
    expect(imputedCapitalForDue(result.advances, '2026-12-10')).toBe(70000);
    expect(result.freeCredit).toBe(7000);
    expect(freeCreditFromStanding({ outstandingBalance: -7000 })).toBe(7000);
  });

  it('descuentos nunca generan efectivo ficticio', () => {
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

  it('reintento idempotente no duplica un período ya cubierto', () => {
    const first = allocateAdvanceCash({
      cash: 70000,
      tariff: 70000,
      startDueOn: '2026-12-10',
    });
    const second = allocateAdvanceCash({
      cash: 70000,
      tariff: 70000,
      startDueOn: '2026-12-10',
      existingImputations: first.advances,
    });
    expect(first.advances).toHaveLength(1);
    expect(second.advances[0].dueOn).toBe('2027-01-10');
    expect(imputedCapitalForDue(
      [...first.advances, ...second.advances],
      '2026-12-10',
    )).toBe(70000);
  });

  it('anulaciones: imputaciones voided no cuentan como cobertura', () => {
    const result = allocateAdvanceCash({
      cash: 70000,
      tariff: 70000,
      startDueOn: '2026-12-10',
      existingImputations: [
        { dueOn: '2026-12-10', capital: 70000, kind: 'adelanto', voidedAt: '2026-11-20T12:00:00Z' },
      ],
    });
    expect(result.advances).toEqual([
      { dueOn: '2026-12-10', capital: 70000, surcharge: 0, kind: 'adelanto' },
    ]);
  });

  it('101046 · Casas: diciembre cubierto y $7.000 de excedente real', () => {
    const snap = FIXTURES['101046'];
    expect(imputedCapitalForDue(snap.imputations, '2026-12-10')).toBe(70000);
    expect(snap.imputations.find((row) => row.dueOn === '2026-12-10').surcharge).toBe(0);
    expect(snap.outstandingBalance).toBe(-7000);
    const check = assertAdvanceCreditInvariants(snap);
    expect(check.ok, check.errors.join('; ')).toBe(true);
    expect(freeCreditFromStanding({ outstandingBalance: snap.outstandingBalance })).toBe(7000);
  });

  it('101612 · García Amor: diciembre cubierto sin crédito duplicado', () => {
    const snap = FIXTURES['101612'];
    expect(imputedCapitalForDue(snap.imputations, '2026-12-10')).toBe(70000);
    expect(snap.outstandingBalance).toBe(0);
    expect(assertAdvanceCreditInvariants(snap).ok).toBe(true);
  });

  it('101202 · Gaitán: sep/oct/nov individuales a $40.000', () => {
    const snap = FIXTURES['101202'];
    expect(snap.imputations.map((row) => row.capital)).toEqual([40000, 40000, 40000]);
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

  it('detecta adelanto con recargo (prohibido)', () => {
    const bad = {
      tier: 'socio_familiar',
      outstandingBalance: 0,
      imputations: [
        { dueOn: '2026-12-10', capital: 70000, surcharge: 7000, kind: 'adelanto' },
      ],
      entries: [],
    };
    const check = assertAdvanceCreditInvariants(bad);
    expect(check.ok).toBe(false);
    expect(check.errors.some((msg) => /recargo/.test(msg))).toBe(true);
  });

  it('concurrencia: dos cobros ven el mismo período cubierto y no lo duplican', () => {
    const shared = [];
    const a = allocateAdvanceCash({
      cash: 70000,
      tariff: 70000,
      startDueOn: '2026-12-10',
      existingImputations: shared,
    });
    shared.push(...a.advances);
    const b = allocateAdvanceCash({
      cash: 70000,
      tariff: 70000,
      startDueOn: '2026-12-10',
      existingImputations: shared,
    });
    expect(a.advances[0].dueOn).toBe('2026-12-10');
    expect(b.advances[0].dueOn).toBe('2027-01-10');
    expect(imputedCapitalForDue([...shared, ...b.advances], '2026-12-10')).toBe(70000);
  });

  it('coherencia admin/portal: mismo crédito libre desde ficha', async () => {
    const { memberCreditBalance } = await import('./memberPayments.js');
    const { buildOperationalDuesStanding } = await import('./operationalDuesStanding.js');
    const member = {
      id: 'm-credit',
      number: '101046',
      tier: 'socio_familiar',
      status: 'activo',
      outstandingBalance: -7000,
      duesOpenPeriods: [],
      paymentHistory: [],
    };
    const credit = memberCreditBalance(member);
    const standing = buildOperationalDuesStanding(member, { entries: [
      { amount: -7000, kind: 'credito_excedente', source: 'audit:101046' },
    ] });
    expect(credit).toBe(7000);
    expect(standing.creditBalance).toBe(7000);
    expect(standing.clear).toBe(true);
  });
});

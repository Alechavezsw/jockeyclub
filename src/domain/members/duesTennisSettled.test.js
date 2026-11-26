import { describe, expect, it } from 'vitest';
import {
  collectionTennisPeriodChoices,
  collectionTennisPreview,
  memberCoveredTennisDueOns,
  memberHasTennisAbono,
} from './dues';
import { duesCollectionGate } from './memberPayments';

const TODAY = new Date('2026-11-26T12:00:00-03:00');

function gomez(overrides = {}) {
  return {
    id: 'd6b13d47-7696-4b2b-90f9-ae82f8d434e0',
    memberId: '10935',
    name: 'Miguel Angel Gomez Flores',
    tier: 'socio_familiar',
    status: 'active',
    outstandingBalance: 0,
    nextDueDate: '2026-12-10',
    cuotaCategories: ['ABONO TENIS', 'SOCIO FAMILIAR'],
    paymentHistory: [],
    feeLedgerLines: [
      {
        id: 'nov-tenis',
        date: '2026-11-01',
        type: 'Cuota (ABONO TENIS)',
        description: 'Noviembre del 2026 · Regularización administrativa autorizada 26/11/2026',
        amount: 12000,
        collected: 0,
        pending: 0,
        source: 'liquidation',
      },
    ],
    ...overrides,
  };
}

describe('abono tenis regularizado — socio 10935', () => {
  it('noviembre con pending 0 no se vuelve a cobrar y queda al día', () => {
    const member = gomez();
    expect(memberHasTennisAbono(member)).toBe(true);
    expect(member.cuotaCategories).toContain('ABONO TENIS');
    expect(memberCoveredTennisDueOns(member).has('2026-11-10')).toBe(true);

    const choices = collectionTennisPeriodChoices(member, TODAY);
    expect(choices).toEqual([]);
    expect(collectionTennisPreview(member, TODAY).cash).toBe(0);
    expect(collectionTennisPreview(member, TODAY).clear).toBe(true);

    const gate = duesCollectionGate(member, {
      amount: 12000,
      chargeScope: 'abono_tenis',
      paidOn: TODAY,
    });
    expect(gate.blocked).toBe(true);
    expect(gate.theoretical).toBe(0);
    expect(member.outstandingBalance).toBe(0);
    expect(member.paymentHistory).toEqual([]);
  });

  it('un pago exclusivo de cuota social no marca el tenis como pago', () => {
    const member = gomez({
      feeLedgerLines: [],
      paymentHistory: [{
        id: 'pay-social',
        status: 'paid',
        chargeScope: 'social',
        concept: 'Cuota social · Noviembre de 2026',
        periodDueOns: ['2026-11-10'],
        amount: 70000,
      }],
    });
    expect(memberCoveredTennisDueOns(member).has('2026-11-10')).toBe(false);
    const choices = collectionTennisPeriodChoices(member, TODAY);
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ dueOn: '2026-11-10', capital: 12000, surcharge: 0 });
  });

  it('un remanente se cobra solo, y otro mes pendiente se conserva', () => {
    const member = gomez({
      feeLedgerLines: [
        {
          date: '2026-10-01',
          type: 'Cuota (ABONO TENIS)',
          description: 'Octubre del 2026',
          amount: 12000,
          pending: 12000,
          collected: 0,
        },
        {
          date: '2026-11-01',
          type: 'Cuota (ABONO TENIS)',
          description: 'Noviembre del 2026',
          amount: 12000,
          pending: 5000,
          collected: 7000,
        },
      ],
    });
    const choices = collectionTennisPeriodChoices(member, TODAY);
    expect(choices.map((row) => [row.dueOn, row.capital])).toEqual([
      ['2026-10-10', 12000],
      ['2026-11-10', 5000],
    ]);
    expect(choices.every((row) => row.surcharge === 0)).toBe(true);
    const gate = duesCollectionGate(member, {
      amount: 17000,
      chargeScope: 'abono_tenis',
      paidOn: TODAY,
    });
    expect(gate.blocked).toBe(false);
    expect(duesCollectionGate(member, {
      amount: 17001,
      chargeScope: 'abono_tenis',
      paidOn: TODAY,
    }).blocked).toBe(true);
  });
});

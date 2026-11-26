import { describe, expect, it } from 'vitest';
import { canManageFrozenDuesAgreement } from '../auth/roles';
import { imputeDuesPayment, openPeriodsFromChoices } from './duesImputations';
import { collectionPeriodChoices } from './dues';
import { collectionPreview, duesCollectionGate } from './memberPayments';
import {
  feeLedgerLineIsSocial,
  feeLedgerLineIsSurcharge,
} from './duesCollectObligations';
import {
  assertFrozenCollectionAuthorized,
  frozenAgreementFromDb,
} from './frozenDuesAgreement';

const TODAY = new Date('2026-11-26T12:00:00-03:00');
const PAID_ON = '2026-11-26';

const APPROVED = [
  ['2025-01-10', 35000], ['2025-02-10', 35000], ['2025-03-10', 35000],
  ['2025-04-10', 41000], ['2025-05-10', 41000], ['2025-06-10', 41000],
  ['2025-07-10', 41000], ['2025-08-10', 41000], ['2025-09-10', 41000],
  ['2025-10-10', 50000], ['2025-11-10', 50000], ['2025-12-10', 50000],
  ['2026-01-10', 50000], ['2026-02-10', 50000], ['2026-03-10', 50000],
  ['2026-04-10', 50000],
  ['2026-05-10', 60000], ['2026-06-10', 60000], ['2026-07-10', 60000],
  ['2026-08-10', 60000], ['2026-09-10', 60000],
  ['2026-10-10', 70000],
];

function agreementFor(periods = APPROVED) {
  const rows = periods.map(([dueOn, capital]) => ({
    dueOn,
    capitalAuthorized: capital,
    capitalOpen: capital,
  }));
  return frozenAgreementFromDb({
    id: 'agr-1',
    member_id: '71228a4a-c3b2-4aef-88ee-3ef19055e117',
    status: 'active',
    original_amount: rows.reduce((sum, row) => sum + row.capitalAuthorized, 0),
    no_repricing: true,
    no_surcharge: true,
    authorized_by_label: 'Administración',
    authorized_at: '2026-11-26T15:00:00-03:00',
    note: 'Deuda histórica congelada',
    periods: rows,
  });
}

function ledgerLine(dueOn, capital, description) {
  return {
    id: `fll-${dueOn}`,
    date: `${dueOn.slice(0, 7)}-01`,
    type: 'Cuota (SOCIO FAMILIAR)',
    description: description || `Cuota histórica aprobada ${dueOn.slice(5, 7)}/${dueOn.slice(0, 4)} - importe nominal sin actualización ni recargo`,
    amount: capital,
    collected: 0,
    pending: capital,
    source: 'admin_historical_approved',
  };
}

function usin(periods = APPROVED, extraLines = []) {
  const agreement = agreementFor(periods);
  return {
    id: '71228a4a-c3b2-4aef-88ee-3ef19055e117',
    memberId: '9685',
    name: 'Maximiliano Usin',
    documentNumber: '30932755',
    tier: 'socio_individual',
    status: 'active',
    outstandingBalance: agreement.remainingAmount,
    nextDueDate: '2025-01-10',
    paymentHistory: [],
    duesOpenPeriods: periods.map(([dueOn, capital]) => ({
      dueOn,
      capital,
      capitalOpen: capital,
      lateBase: 0,
    })),
    feeLedgerLines: [
      ...periods.map(([dueOn, capital]) => ledgerLine(dueOn, capital)),
      ...extraLines,
    ],
    frozenDuesAgreement: agreement,
  };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

describe('acuerdo de deuda histórica congelada', () => {
  it('no trata «sin recargo» como una línea de recargo', () => {
    const line = ledgerLine('2025-01-10', 35000);
    expect(feeLedgerLineIsSurcharge(line)).toBe(false);
    expect(feeLedgerLineIsSocial(line)).toBe(true);
    expect(feeLedgerLineIsSurcharge({
      type: 'Recargo de Cuota (FIJO)',
      description: 'Febrero del 2026',
    })).toBe(true);
  });

  it('cobra los 22 períodos a $ 1.071.000, sin recargo ni actualización', () => {
    const member = usin();
    const choices = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    expect(choices).toHaveLength(22);
    expect(choices.every((row) => row.frozenHistorical)).toBe(true);
    expect(sum(choices, 'capital')).toBe(1071000);
    expect(sum(choices, 'surcharge')).toBe(0);
    expect(sum(choices, 'tariffUpdate')).toBe(0);
    expect(choices.find((row) => row.dueOn === '2025-01-10').capital).toBe(35000);
    expect(choices.find((row) => row.dueOn === '2025-04-10').capital).toBe(41000);
    expect(choices.find((row) => row.dueOn === '2026-10-10').capital).toBe(70000);
    const preview = collectionPreview(member, TODAY, { chargeScope: 'social' });
    expect(preview.cash).toBe(1071000);
    expect(preview.surcharge).toBe(0);
    expect(preview.quota).toBe(1071000);
    const schedule = openPeriodsFromChoices(choices, 1071000);
    const imputed = imputeDuesPayment(schedule, 1071000, PAID_ON);
    expect(sum(imputed.allocations, 'capital')).toBe(1071000);
    expect(sum(imputed.allocations, 'surcharge')).toBe(0);
    expect(imputed.allocations.find((row) => row.dueOn === '2026-10-10').surcharge).toBe(0);
  });

  it('cobra una cuota de $ 35.000 y otra de $ 41.000 sin recargo', () => {
    const member = usin();
    const choices = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    for (const dueOn of ['2025-01-10', '2025-04-10']) {
      const row = choices.find((item) => item.dueOn === dueOn);
      const imputed = imputeDuesPayment([row], row.capital, PAID_ON);
      expect(imputed.allocations).toHaveLength(1);
      expect(imputed.allocations[0].capital).toBe(row.capital);
      expect(imputed.allocations[0].surcharge).toBe(0);
      expect(imputed.allocations[0].capitalOpen).toBe(0);
    }
  });

  it('un pago parcial deja el saldo del período', () => {
    const member = usin();
    const row = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' })
      .find((item) => item.dueOn === '2025-01-10');
    const imputed = imputeDuesPayment([row], 10000, PAID_ON);
    expect(imputed.allocations[0]).toMatchObject({
      capital: 10000,
      surcharge: 0,
      capitalOpen: 25000,
    });
    const partial = usin([['2025-01-10', 35000]]);
    partial.frozenDuesAgreement = frozenAgreementFromDb({
      ...partial.frozenDuesAgreement,
      original_amount: 35000,
      periods: [{ dueOn: '2025-01-10', capitalAuthorized: 35000, capitalOpen: 20000 }],
    });
    partial.outstandingBalance = 20000;
    partial.duesOpenPeriods = [{ dueOn: '2025-01-10', capital: 35000, capitalOpen: 20000, lateBase: 0 }];
    partial.feeLedgerLines = [{ ...ledgerLine('2025-01-10', 35000), pending: 20000, collected: 15000 }];
    const left = collectionPeriodChoices(partial, TODAY, { chargeScope: 'social' });
    expect(left).toHaveLength(1);
    expect(left[0].capital).toBe(20000);
    expect(left[0].surcharge).toBe(0);
    expect(left[0].tariffUpdate).toBe(0);
  });

  it('no actualiza el capital histórico a la tarifa vigente', () => {
    const choices = collectionPeriodChoices(usin(), TODAY, { chargeScope: 'social' });
    expect(choices.some((row) => row.capital === 40000 && row.dueOn.startsWith('2025-'))).toBe(false);
    expect(choices.every((row) => row.tariffUpdate === 0)).toBe(true);
  });

  it('un socio sin acuerdo sigue con tarifa vigente y recargo', () => {
    const other = {
      id: 'other',
      memberId: '10001',
      name: 'Socio corriente',
      tier: 'socio_individual',
      status: 'active',
      outstandingBalance: 40000,
      nextDueDate: '2026-10-10',
      paymentHistory: [],
      duesOpenPeriods: [{ dueOn: '2026-10-10', capital: 40000, capitalOpen: 40000, lateBase: 40000 }],
      feeLedgerLines: [{
        id: 'fll-other',
        date: '2026-10-01',
        type: 'Cuota (SOCIO INDIVIDUAL)',
        description: 'Cuota Octubre de 2026',
        amount: 40000,
        collected: 0,
        pending: 40000,
        source: 'fee_period',
      }],
    };
    const choices = collectionPeriodChoices(other, TODAY, { chargeScope: 'social' });
    expect(choices).toHaveLength(1);
    expect(choices[0].frozenHistorical).toBeFalsy();
    expect(choices[0].capital).toBe(40000);
    expect(choices[0].surcharge).toBe(4000);
  });

  it('un mes fuera del acuerdo del mismo socio sigue la regla general', () => {
    const member = usin(APPROVED, [ledgerLine('2026-11-10', 40000, 'Cuota Noviembre de 2026')]);
    const choices = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    const november = choices.find((row) => row.dueOn === '2026-11-10');
    const frozen = choices.filter((row) => row.frozenHistorical);
    expect(choices).toHaveLength(23);
    expect(frozen).toHaveLength(22);
    expect(sum(frozen, 'capital')).toBe(1071000);
    expect(sum(frozen, 'surcharge')).toBe(0);
    expect(november.frozenHistorical).toBeFalsy();
    expect(november.capital).toBe(40000);
    expect(november.surcharge).toBe(4000);
  });

  it('no duplica períodos ni el total al recalcular', () => {
    const member = usin();
    const first = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    const second = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    expect(second).toHaveLength(22);
    expect(sum(second, 'capital')).toBe(sum(first, 'capital'));
    const again = imputeDuesPayment(openPeriodsFromChoices(first, 1071000), 1071000, PAID_ON);
    const twice = imputeDuesPayment(openPeriodsFromChoices(first, 1071000), 1071000, PAID_ON);
    expect(sum(twice.allocations, 'capital')).toBe(sum(again.allocations, 'capital'));
    expect(first[0].capital).toBe(35000);
  });

  it('rechaza capital, recargo o total manipulado y acepta el parcial', () => {
    const member = usin();
    expect(() => assertFrozenCollectionAuthorized(member, {
      schedule: [{ dueOn: '2025-01-10', capital: 999999 }],
      importe: 999999,
    })).toThrow(/supera el importe autorizado/);
    expect(() => assertFrozenCollectionAuthorized(member, {
      schedule: [{ dueOn: '2025-01-10', capital: 35000, surcharge: 3500 }],
      importe: 38500,
    })).toThrow(/no admite recargo/);
    expect(() => assertFrozenCollectionAuthorized(member, {
      schedule: [{ dueOn: '2025-01-10', capital: 40000 }],
      importe: 40000,
    })).toThrow(/supera el importe autorizado/);
    expect(assertFrozenCollectionAuthorized(member, {
      schedule: [{ dueOn: '2025-01-10', capital: 35000, surcharge: 0 }],
      importe: 35000,
    }).ok).toBe(true);
    expect(assertFrozenCollectionAuthorized(member, {
      schedule: [{ dueOn: '2025-01-10', capital: 10000, surcharge: 0 }],
      importe: 10000,
    }).authorized).toBe(10000);
    const gate = duesCollectionGate(member, { amount: 9999999, chargeScope: 'social', paidOn: TODAY });
    expect(gate.blocked).toBe(true);
    expect(duesCollectionGate(member, { amount: 1071000, chargeScope: 'social', paidOn: TODAY }).blocked).toBe(false);
  });

  it('el acuerdo sigue igual después de reconstruirlo como al recargar', () => {
    const stored = JSON.parse(JSON.stringify({
      ...agreementFor(),
      original_amount: 1071000,
      remaining_amount: 1071000,
      paid_amount: 0,
    }));
    const loaded = frozenAgreementFromDb(stored);
    expect(loaded.originalAmount).toBe(1071000);
    expect(loaded.paidAmount).toBe(0);
    expect(loaded.remainingAmount).toBe(1071000);
    expect(loaded.periods).toHaveLength(22);
    expect(loaded.authorizedByLabel).toBe('Administración');
    const member = { ...usin(), frozenDuesAgreement: loaded };
    expect(sum(collectionPeriodChoices(member, TODAY, { chargeScope: 'social' }), 'capital')).toBe(1071000);
  });

  it('solo administración, superadmin o contador pueden crear o modificar el acuerdo', () => {
    expect(canManageFrozenDuesAgreement('admin')).toBe(true);
    expect(canManageFrozenDuesAgreement('superadmin')).toBe(true);
    expect(canManageFrozenDuesAgreement('accountant')).toBe(true);
    expect(canManageFrozenDuesAgreement('cashier')).toBe(false);
    expect(canManageFrozenDuesAgreement('admin_employee')).toBe(false);
    expect(canManageFrozenDuesAgreement('member')).toBe(false);
    expect(canManageFrozenDuesAgreement({ roles: ['cashier'], role: 'member' })).toBe(false);
  });
});

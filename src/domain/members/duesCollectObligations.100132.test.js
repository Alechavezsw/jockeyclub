import { describe, expect, it } from 'vitest';
import {
  collectionPeriodChoices,
  collectionTennisPeriodChoices,
  listAdminOperationalClears,
} from './dues';
import { collectionPreview } from './memberPayments';
import {
  adminPartialReconcileNote,
  periodIsCoveredOperationally,
  periodLedgerStatus,
  PERIOD_STATUS,
} from '../accounting/feeLedgerIntegrity';
import {
  appRequestMatchesExigibleCapital,
  collectionChoicesFromFeeLedger,
  feeLedgerPendingCapital,
  socialExigibleCapitalForCollect,
  totalExigibleCapitalForCollect,
} from './duesCollectObligations';

const TODAY = new Date('2026-11-24T15:00:00-03:00');

const LEDGER_100132 = [
  {
    id: 'oct',
    member_number: '100132',
    line_date: '2026-10-01',
    type_label: 'Cuota (SOCIO FAMILIAR)',
    description: 'Octubre del 2026',
    amount: 70000,
    collected: 70000,
    pending: 0,
    source: 'liquidation_admin_reconciled',
  },
  {
    id: 'nov-social',
    member_number: '100132',
    line_date: '2026-11-01',
    type_label: 'Cuota (SOCIO FAMILIAR)',
    description: 'Noviembre del 2026',
    amount: 70000,
    collected: 28000,
    pending: 42000,
    source: 'liquidation_admin_reconciled',
  },
  {
    id: 'nov-tenis',
    member_number: '100132',
    line_date: '2026-11-01',
    type_label: 'Cuota (ABONO TENIS)',
    description: 'Noviembre del 2026',
    amount: 12000,
    collected: 0,
    pending: 12000,
    source: 'liquidation',
  },
];

function luciano(overrides = {}) {
  return {
    memberId: '100132',
    memberNumber: '100132',
    name: 'Luciano Virhuez',
    tier: 'socio_familiar',
    outstandingBalance: 54000,
    unpaidCapital: 82000, // histórico inconsistente: no debe mandar
    unpaidSurcharges: 0,
    nextDueDate: '2026-12-10',
    cuotaCategories: ['ABONO TENIS', 'SOCIO FAMILIAR'],
    feeLedgerLines: LEDGER_100132,
    meta: {
      unpaidCapital: 82000,
      feeLedgerAdminReconcile: [{
        at: '2026-11-24',
        amount: 70000,
        period: '2026-10',
        reason: 'Contraajuste conciliado 23/11/2026',
        status: 'regularizado',
        newCash: 0,
      }],
      feeLedgerAdminPartialReconcile: [{
        at: '2026-11-24',
        amount: 28000,
        period: '2026-11',
        reason: 'Contraajuste conciliado 23/11/2026',
        status: 'regularizado_parcialmente',
        newCash: 0,
      }],
      october2026LedgerStatus: 'conciliado administrativamente; contraajuste del 23/11/2026; sin ingreso de caja',
    },
    paymentHistory: [],
    duesOpenPeriods: null,
    ...overrides,
  };
}

describe('Imputar / Cobrar cuota — socio 100132 Luciano Virhuez', () => {
  it('exigible total $54.000 (no usa unpaidCapital 82.000)', () => {
    const m = luciano();
    expect(socialExigibleCapitalForCollect(m)).toBe(42000);
    expect(feeLedgerPendingCapital(m, { chargeScope: 'abono_tenis' })).toBe(12000);
    expect(totalExigibleCapitalForCollect(m)).toBe(54000);
    expect(appRequestMatchesExigibleCapital(m, 54000)).toBe(true);
  });

  it('octubre regularizado no vuelve a cobrarse; noviembre social parcial $42.000', () => {
    const m = luciano();
    expect(periodIsCoveredOperationally(m, '2026-10')).toBe(true);
    expect(periodIsCoveredOperationally(m, '2026-11')).toBe(false);
    expect(adminPartialReconcileNote(m, '2026-11')).toBeTruthy();

    const novLine = LEDGER_100132.find((l) => l.id === 'nov-social');
    expect(periodLedgerStatus(m, novLine)).toBe(PERIOD_STATUS.PENDIENTE);

    const social = collectionPeriodChoices(m, TODAY, { chargeScope: 'social' });
    expect(social).toHaveLength(1);
    expect(social[0].dueOn).toBe('2026-11-10');
    expect(social[0].capital).toBe(42000);
    expect(social[0].surcharge).toBe(0);
    expect(social.some((row) => String(row.dueOn).startsWith('2026-10'))).toBe(false);
  });

  it('tenis independiente $12.000; total imputable $54.000 sin reinsuflar $77.000', () => {
    const m = luciano();
    const tennis = collectionTennisPeriodChoices(m, TODAY);
    expect(tennis.some((row) => row.dueOn === '2026-11-10' && row.capital === 12000)).toBe(true);

    const socialPreview = collectionPreview(m, TODAY, {
      periodDueOns: ['2026-11-10'],
      chargeScope: 'social',
    });
    expect(socialPreview.quota).toBe(42000);
    expect(socialPreview.surcharge).toBe(0);
    expect(socialPreview.cash).toBe(42000);

    const ledgerChoices = collectionChoicesFromFeeLedger(m, TODAY);
    expect(ledgerChoices?.[0]?.payable).toBe(42000);
  });

  it('regularización admin aparece como clear operativo; parcial no marca cubierto', () => {
    const clears = listAdminOperationalClears(luciano());
    expect(clears.some((c) => c.dueOn === '2026-10-10' && c.amount === 70000)).toBe(true);
    expect(clears.some((c) => c.dueOn === '2026-11-10' && c.amount === 28000 && c.partial)).toBe(true);
  });

  it('reabrir el formulario conserva la deuda correcta (no 70k+7k)', () => {
    const m = luciano();
    const first = collectionPeriodChoices(m, TODAY, { chargeScope: 'social' });
    const second = collectionPeriodChoices({ ...m }, TODAY, { chargeScope: 'social' });
    expect(first[0].capital).toBe(42000);
    expect(second[0].capital).toBe(42000);
    expect(first[0].surcharge + second[0].surcharge).toBe(0);
  });
});

describe('Impacto otros socios regularizados', () => {
  it('11553 — Claudia: octubre regularizado, noviembre $70.000', () => {
    const m = {
      memberId: '11553',
      memberNumber: '11553',
      name: 'Claudia Patricia Lourdes Morales',
      tier: 'socio_familiar',
      outstandingBalance: 70000,
      unpaidCapital: 0,
      unpaidSurcharges: 0,
      nextDueDate: '2026-12-10',
      duesOpenPeriods: [],
      feeLedgerLines: [
        {
          line_date: '2026-10-01',
          type_label: 'Cuota (SOCIO FAMILIAR)',
          amount: 70000,
          collected: 70000,
          pending: 0,
          source: 'liquidation_admin_reconciled',
        },
        {
          line_date: '2026-11-01',
          type_label: 'Cuota (SOCIO FAMILIAR)',
          amount: 70000,
          collected: 0,
          pending: 70000,
          source: 'liquidation',
        },
      ],
      meta: {
        feeLedgerAdminReconcile: [{
          period: '2026-10',
          amount: 70000,
          status: 'regularizado',
          newCash: 0,
        }],
      },
      paymentHistory: [],
    };
    expect(periodIsCoveredOperationally(m, '2026-10')).toBe(true);
    const choices = collectionPeriodChoices(m, TODAY, { chargeScope: 'social' });
    expect(choices).toHaveLength(1);
    expect(choices[0].dueOn).toBe('2026-11-10');
    expect(choices[0].capital).toBe(70000);
  });

  it('101544 — Gonzalo: saldo $0, sin inventar cobro', () => {
    const m = {
      memberId: '101544',
      memberNumber: '101544',
      name: 'Gonzalo Agustin Diaz Lara',
      tier: 'socio_familiar',
      outstandingBalance: 0,
      unpaidCapital: 0,
      unpaidSurcharges: 0,
      nextDueDate: '2026-12-10',
      duesOpenPeriods: null,
      feeLedgerLines: [
        {
          line_date: '2026-11-01',
          type_label: 'Cuota (SOCIO FAMILIAR)',
          amount: 70000,
          collected: 70000,
          pending: 0,
          source: 'liquidation',
        },
      ],
      paymentHistory: [],
    };
    expect(totalExigibleCapitalForCollect(m)).toBe(0);
    expect(collectionPeriodChoices(m, TODAY, { chargeScope: 'social' })).toEqual([]);
  });
});

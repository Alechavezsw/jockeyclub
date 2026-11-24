import { describe, expect, it } from 'vitest';
import { appMonthlyDebtForMember } from '../accounting/appMonthlyDebts';
import { collectionDiscount, collectionPreview, duesCollectionGate } from './memberPayments';
import { setRuntimeTierCatalog } from './tiers';
import { collectionPeriodChoices, collectionTennisPeriodChoices, duesAmountForMember } from './dues';
import {
  collectionChoicesFromFeeLedger,
  socialExigibleCapitalForCollect,
  unreconciledHistoricalBalance,
} from './duesCollectObligations';

const TODAY = new Date('2026-11-24T15:00:00-03:00');

function line(partial) {
  return {
    member_number: partial.member_number,
    line_date: partial.line_date ?? null,
    type_label: partial.type_label,
    description: partial.description,
    amount: partial.amount,
    collected: partial.collected,
    pending: partial.pending,
    source: partial.source,
  };
}

const SILVIA_LEDGER = [
  line({
    member_number: '10632',
    line_date: '2026-06-01',
    type_label: 'Cuota (SOCIO FAMILIAR)',
    description: 'Junio del 2026',
    amount: 60000,
    collected: 60000,
    pending: 0,
    source: 'lila',
  }),
  line({
    member_number: '10632',
    line_date: '2026-10-01',
    type_label: 'Cuota (SOCIO FAMILIAR)',
    description: 'Octubre del 2026',
    amount: 70000,
    collected: 0,
    pending: 70000,
    source: 'liquidation',
  }),
  line({
    member_number: '10632',
    line_date: '2026-11-01',
    type_label: 'Cuota (SOCIO FAMILIAR)',
    description: 'Noviembre del 2026',
    amount: 70000,
    collected: 0,
    pending: 70000,
    source: 'liquidation',
  }),
  line({
    member_number: '10632',
    line_date: null,
    type_label: 'AJUSTE ADMINISTRATIVO (CONCILIACIÓN CONNECT)',
    description: 'Ajuste administrativo de saldo histórico existente en Connect sin asignación mensual',
    amount: 135000,
    collected: 0,
    pending: 135000,
    source: 'connect_admin_reconciliation_20261123',
  }),
];

const SILVIA_HISTORY = [
  ['10632', '2026-01-01', 'Cuota', 'Enero del 2026', 50000],
  ['10632', '2026-01-01', 'Pago', '', -50000],
  ['10632', '2026-02-01', 'Cuota', 'Febrero del 2026', 50000],
  ['10632', '2026-02-11', 'Recargo de Cuota (FIJO)', 'Febrero del 2026', 2000],
  ['10632', '2026-03-01', 'Cuota', 'Marzo del 2026', 50000],
  ['10632', '2026-03-11', 'Recargo de Cuota (FIJO)', 'Marzo del 2026', 2000],
  ['10632', '2026-04-01', 'Cuota', 'Abril del 2026', 50000],
  ['10632', '2026-04-11', 'Recargo de Cuota (FIJO)', 'Abril del 2026', 2000],
  ['10632', '2026-05-01', 'Cuota', 'Mayo del 2026', 60000],
  ['10632', '2026-05-01', 'Otros', 'Actualizacion de Cuotas Febrero+Marzo+Abril 2026', 30000],
  ['10632', '2026-05-11', 'Recargo de Cuota (FIJO)', 'Mayo del 2026', 2000],
  ['10632', '2026-05-28', 'Pago', 'Cuota Ene+Feb+Mar+Abr+ Mayo 2026 +vto', -248000],
  ['10632', '2026-06-01', 'Cuota', 'Junio del 2026', 60000],
  ['10632', '2026-06-11', 'Recargo de Cuota (FIJO)', 'Junio del 2026', 2000],
  ['10632', '2026-07-01', 'Cuota', 'Julio del 2026', 60000],
  ['10632', '2026-07-11', 'Recargo de Cuota (FIJO)', 'Julio del 2026', 2000],
  ['10632', '2026-08-01', 'Cuota', 'Agosto del 2026', 60000],
  ['10632', '2026-08-10', 'Pago', 'Cuota Junio y Julio', -124000],
  ['10632', '2026-08-11', 'Recargo de Cuota (FIJO)', 'Agosto del 2026', 2000],
  ['10632', '2026-09-01', 'Cuota', 'Septiembre del 2026', 60000],
  ['10632', '2026-09-10', 'Recargo de Cuota (10.00 %)', 'Septiembre del 2026', 6000],
  ['10632', '2026-10-01', 'Cuota', 'Octubre del 2026', 70000],
  ['10632', '2026-10-10', 'Recargo de Cuota (10.00 %)', 'Octubre del 2026', 7000],
];

function silvia(history = null) {
  return {
    memberId: '10632',
    memberNumber: '10632',
    name: 'Silvia Lorena Villalba',
    tier: 'socio_familiar',
    outstandingBalance: 275000,
    unpaidCapital: 260000,
    nextDueDate: null,
    cuotaCategories: ['SOCIO FAMILIAR'],
    feeLedgerLines: SILVIA_LEDGER,
    accessinHistory: history,
    paymentHistory: [],
  };
}

const ALEJANDRA_LEDGER = [
  line({
    member_number: '10697',
    line_date: '2026-10-01',
    type_label: 'Cuota (SOCIO FAMILIAR)',
    description: 'Octubre del 2026',
    amount: 70000,
    collected: 0,
    pending: 70000,
    source: 'liquidation',
  }),
  line({
    member_number: '10697',
    line_date: '2026-11-01',
    type_label: 'Cuota (SOCIO FAMILIAR)',
    description: 'Noviembre del 2026',
    amount: 70000,
    collected: 0,
    pending: 70000,
    source: 'liquidation',
  }),
  line({
    member_number: '10697',
    line_date: null,
    type_label: 'RECARGO CUOTA SOCIAL',
    description: 'Recargo 10% de cuota social Octubre 2026',
    amount: 7000,
    collected: 0,
    pending: 7000,
    source: 'admin-restore-10697-20261124',
  }),
  line({
    member_number: '10697',
    line_date: null,
    type_label: 'RECARGO CUOTA SOCIAL',
    description: 'Recargo 10% de cuota social Noviembre 2026',
    amount: 7000,
    collected: 0,
    pending: 7000,
    source: 'admin-restore-10697-20261124',
  }),
];

function alejandra() {
  return {
    memberId: '10697',
    memberNumber: '10697',
    name: 'Alejandra Valeria Carrizo Villafañe',
    tier: 'socio_familiar',
    outstandingBalance: 154000,
    nextDueDate: '2026-12-10',
    cuotaCategories: ['SOCIO FAMILIAR'],
    feeLedgerLines: ALEJANDRA_LEDGER,
    paymentHistory: [],
  };
}

function luciano() {
  return {
    memberId: '100132',
    memberNumber: '100132',
    name: 'Luciano Virhuez',
    tier: 'socio_familiar',
    outstandingBalance: 54000,
    nextDueDate: '2026-12-10',
    cuotaCategories: ['ABONO TENIS', 'SOCIO FAMILIAR'],
    feeLedgerLines: [
      line({
        member_number: '100132',
        line_date: '2026-11-01',
        type_label: 'Cuota (SOCIO FAMILIAR)',
        description: 'Noviembre del 2026',
        amount: 70000,
        collected: 28000,
        pending: 42000,
        source: 'liquidation_admin_reconciled',
      }),
      line({
        member_number: '100132',
        line_date: '2026-11-01',
        type_label: 'Cuota (ABONO TENIS)',
        description: 'Noviembre del 2026',
        amount: 12000,
        collected: 0,
        pending: 12000,
        source: 'liquidation',
      }),
    ],
    paymentHistory: [],
  };
}

describe('cuota a tarifa vigente, por mes', () => {
  it('10632 verificada en LILA: agosto a noviembre a $77.000, sin sumar otra vez los $135.000', () => {
    const member = silvia(SILVIA_HISTORY);
    const before = member.outstandingBalance;
    const choices = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    expect(choices.map((row) => row.dueOn)).toEqual([
      '2026-08-10',
      '2026-09-10',
      '2026-10-10',
      '2026-11-10',
    ]);
    expect(choices.every((row) => row.capital === 70000 && row.surcharge === 7000 && row.payable === 77000)).toBe(true);
    expect(choices.filter((row) => row.fromAccessinHistory).map((row) => row.dueOn)).toEqual([
      '2026-08-10',
      '2026-09-10',
    ]);
    expect(choices.find((row) => row.dueOn === '2026-08-10').originalCapital).toBe(60000);
    const payable = choices.reduce((sum, row) => sum + row.payable, 0);
    expect(payable).toBe(308000);
    expect(payable - member.outstandingBalance).toBe(33000);
    const held = unreconciledHistoricalBalance(member, TODAY);
    expect(held.explained).toBe(135000);
    expect(held.amount).toBe(0);
    expect(held.selectable).toBe(false);
    expect(socialExigibleCapitalForCollect(member)).toBe(140000);
    expect(member.outstandingBalance).toBe(before);
    const preview = collectionPreview(member, TODAY, { chargeScope: 'social' });
    expect(preview.quota).toBe(280000);
    expect(preview.surcharge).toBe(28000);
    expect(preview.cash).toBe(308000);
    const debt = appMonthlyDebtForMember(member, { today: TODAY });
    expect(debt.months.map((row) => row.dueOn)).toEqual(choices.map((row) => row.dueOn));
    expect(debt.totalDebt).toBe(308000);
    expect(debt.unallocated).toBe(0);
    expect(debt.reconciliationHold).toBe(false);
  });

  it('10632 sin historial no inventa agosto ni septiembre y deja los $135.000 aparte', () => {
    const member = silvia();
    const choices = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    expect(choices.map((row) => row.dueOn)).toEqual(['2026-10-10', '2026-11-10']);
    const held = unreconciledHistoricalBalance(member, TODAY);
    expect(held.amount).toBe(135000);
    expect(held.explained).toBe(0);
    expect(member.outstandingBalance).toBe(275000);
  });

  it('la tarifa del cobro no usa la tarifa histórica del mes', () => {
    const member = {
      memberId: 'amet-1',
      memberNumber: 'amet-1',
      name: 'Socio AMET',
      tier: 'socio_familiar_amet',
      outstandingBalance: 58500,
      cuotaCategories: ['SOCIO FAMILIAR (AMET)'],
      feeLedgerLines: [
        line({
          member_number: 'amet-1',
          line_date: '2026-08-01',
          type_label: 'Cuota (SOCIO FAMILIAR AMET)',
          description: 'Agosto del 2026',
          amount: 58500,
          collected: 0,
          pending: 58500,
          source: 'liquidation',
        }),
      ],
      paymentHistory: [],
    };
    const historical = duesAmountForMember(member, new Date('2026-08-10T12:00:00'), { chargeScope: 'social' });
    const current = duesAmountForMember(member, TODAY, { chargeScope: 'social' });
    expect(current).not.toBe(historical);
    const choices = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    expect(choices).toHaveLength(1);
    expect(choices[0].dueOn).toBe('2026-08-10');
    expect(choices[0].capital).toBe(current);
    expect(choices[0].originalCapital).toBe(58500);
  });

  it('10632 con agosto y septiembre verificados en el libro: cuatro meses y el saldo no se reescribe', () => {
    const member = silvia();
    member.feeLedgerLines = [
      ...['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'].map((date, index) => line({
        member_number: '10632',
        line_date: date,
        type_label: 'Cuota (SOCIO FAMILIAR)',
        description: `Mes ${index}`,
        amount: 70000,
        collected: 0,
        pending: 70000,
        source: 'liquidation',
      })),
    ];
    const choices = collectionChoicesFromFeeLedger(member, TODAY, {
      tariffOf: () => 70000,
    });
    expect(choices).toHaveLength(4);
    expect(choices.every((row) => row.payable === 77000)).toBe(true);
    const payable = choices.reduce((sum, row) => sum + row.payable, 0);
    expect(payable).toBe(308000);
    expect(member.outstandingBalance).toBe(275000);
    expect(payable - member.outstandingBalance).toBe(33000);
  });

  it('10697: octubre y noviembre a $77.000, sin duplicar el recargo ya anotado', () => {
    const choices = collectionPeriodChoices(alejandra(), TODAY, { chargeScope: 'social' });
    expect(choices).toHaveLength(2);
    expect(choices.every((row) => row.capital === 70000 && row.surcharge === 7000 && row.payable === 77000)).toBe(true);
    const preview = collectionPreview(alejandra(), TODAY, { chargeScope: 'social', skipSurcharge: true });
    expect(preview.surcharge).toBe(0);
    expect(preview.quota).toBe(140000);
  });

  it('100132: social $42.000 y tenis $12.000, sin volver a $70.000', () => {
    const member = luciano();
    const social = collectionPeriodChoices(member, TODAY, { chargeScope: 'social' });
    expect(social).toEqual([expect.objectContaining({ dueOn: '2026-11-10', capital: 42000, surcharge: 0 })]);
    const tennis = collectionTennisPeriodChoices(member, TODAY);
    expect(tennis.some((row) => row.capital === 12000)).toBe(true);
    expect(socialExigibleCapitalForCollect(member) + 12000).toBe(54000);
    const mp = collectionPreview(member, TODAY, { chargeScope: 'social' });
    expect(mp.cash).toBe(42000);
    const withHistory = luciano();
    withHistory.accessinHistory = [
      ['100132', '2026-09-01', 'Cuota', 'Septiembre del 2026', 70000],
      ['100132', '2026-09-01', 'Pago', '2026-09-01', -60000],
    ];
    const socialWithHistory = collectionPeriodChoices(withHistory, TODAY, { chargeScope: 'social' });
    expect(socialWithHistory.map((row) => row.dueOn)).toEqual(['2026-11-10']);
    expect(socialWithHistory[0].capital).toBe(42000);
  });

  it('saldo cero y mes cubierto no reabren deuda por un vencimiento viejo', () => {
    const member = {
      memberId: '101544',
      memberNumber: '101544',
      name: 'Gonzalo Agustin Diaz Lara',
      tier: 'socio_familiar',
      outstandingBalance: 0,
      nextDueDate: '2026-06-10',
      feeLedgerLines: [
        line({
          member_number: '101544',
          line_date: '2026-11-01',
          type_label: 'Cuota (SOCIO FAMILIAR)',
          description: 'Noviembre del 2026',
          amount: 70000,
          collected: 70000,
          pending: 0,
          source: 'liquidation',
        }),
      ],
    };
    expect(collectionPeriodChoices(member, TODAY)).toEqual([]);
    expect(appMonthlyDebtForMember(member, { today: TODAY })).toBeNull();
  });

  it('un mes pago no vuelve, y un reintento ve el mismo resultado', () => {
    const open = silvia();
    const first = collectionPeriodChoices(open, TODAY, { chargeScope: 'social' });
    const second = collectionPeriodChoices(open, TODAY, { chargeScope: 'social' });
    expect(second.map((row) => row.payable)).toEqual(first.map((row) => row.payable));
    const paid = silvia();
    paid.feeLedgerLines = paid.feeLedgerLines.map((row) => (
      row.pending > 0 && row.line_date
        ? { ...row, collected: row.amount, pending: 0 }
        : row
    ));
    expect(collectionPeriodChoices(paid, TODAY, { chargeScope: 'social' })).toEqual([]);
    expect(unreconciledHistoricalBalance(paid).amount).toBe(135000);
  });

  it('el descuento baja el cobro y no el capital del mes', () => {
    const preview = collectionPreview(alejandra(), TODAY, { chargeScope: 'social' });
    const discounted = collectionDiscount(preview.cash, { discount: 5000, detail: 'Bonificación de mostrador' });
    expect(preview.quota).toBe(140000);
    expect(discounted.cash).toBe(149000);
  });

  it('10632 cobra los cuatro meses y la diferencia de $33.000 no frena el cobro', () => {
    const member = silvia(SILVIA_HISTORY);
    const gate = duesCollectionGate(member, { amount: 308000, paidOn: TODAY });
    expect(gate.blocked).toBe(false);
    expect(gate.difference).toBe(0);
    expect(gate.theoretical).toBe(308000);
    expect(gate.recordedBalance).toBe(275000);
    expect(member.outstandingBalance).toBe(275000);
  });

  it('10697, 100132 y el saldo cero no quedan trabados por una diferencia de tarifa', () => {
    expect(duesCollectionGate(alejandra(), { amount: 154000, paidOn: TODAY }).blocked).toBe(false);
    expect(duesCollectionGate(alejandra(), {
      amount: 140000,
      paidOn: TODAY,
      skipSurcharge: true,
    }).blocked).toBe(false);
    expect(duesCollectionGate(luciano(), { amount: 42000, paidOn: TODAY }).blocked).toBe(false);
    expect(duesCollectionGate(luciano(), {
      amount: 12000,
      chargeScope: 'abono_tenis',
      paidOn: TODAY,
    }).blocked).toBe(false);
    const clear = {
      memberId: '101544',
      memberNumber: '101544',
      tier: 'socio_familiar',
      outstandingBalance: 0,
      feeLedgerLines: [],
      paymentHistory: [],
    };
    expect(duesCollectionGate(clear, { amount: 70000, paidOn: TODAY }).blocked).toBe(true);
  });

  it('una tarifa editada en el catálogo reemplaza a la oficial, y una tarifa ausente pide revisión', () => {
    setRuntimeTierCatalog([
      { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 75000, isActive: true },
    ]);
    try {
      const choices = collectionPeriodChoices(silvia(SILVIA_HISTORY), TODAY, { chargeScope: 'social' });
      expect(choices.every((row) => row.capital === 75000)).toBe(true);
    } finally {
      setRuntimeTierCatalog([]);
    }
    const member = {
      memberId: 'sin-tarifa',
      memberNumber: 'sin-tarifa',
      tier: 'liga_no_socio',
      outstandingBalance: 50000,
      cuotaCategories: ['LIGA (No socio)'],
      feeLedgerLines: [
        line({
          member_number: 'sin-tarifa',
          line_date: '2026-11-01',
          type_label: 'Cuota (LIGA)',
          description: 'Noviembre del 2026',
          amount: 50000,
          collected: 0,
          pending: 50000,
          source: 'liquidation',
        }),
      ],
      paymentHistory: [],
    };
    const review = duesCollectionGate(member, { amount: 50000, paidOn: TODAY });
    expect(review.needsReview).toBe(true);
    expect(review.blocked).toBe(true);
    expect(review.message).toMatch(/Requiere revisión/);
  });

  it('dos lecturas concurrentes del mismo socio no se pisan', async () => {
    const member = silvia();
    const [left, right] = await Promise.all([
      Promise.resolve(collectionPeriodChoices(member, TODAY, { chargeScope: 'social' })),
      Promise.resolve(collectionPeriodChoices({ ...member, feeLedgerLines: [...member.feeLedgerLines] }, TODAY, { chargeScope: 'social' })),
    ]);
    expect(left.map((row) => row.payable)).toEqual(right.map((row) => row.payable));
    expect(member.outstandingBalance).toBe(275000);
  });
});

import { describe, expect, it } from 'vitest';
import { appMonthlyDebtForMember, memberDuesStandingSummary } from '../accounting/appMonthlyDebts.js';
import { duesStatus } from '../sports/attendance.js';
import { collectionPreview } from './memberPayments.js';
import {
  buildHistoricalReconciliation,
  buildOperationalDuesStanding,
  operationalStandingIsClear,
} from './operationalDuesStanding.js';

const TODAY = new Date('2026-11-21T15:00:00-03:00');

function titular(overrides = {}) {
  return {
    id: 'm-1',
    memberId: '10450',
    memberNumber: '10450',
    name: 'Lucia Paola Ponce Pelaez',
    tier: 'socio_familiar',
    status: 'active',
    outstandingBalance: 0,
    unpaidCapital: 0,
    nextDueDate: '2027-01-10',
    paymentHistory: [],
    duesOpenPeriods: [],
    ...overrides,
  };
}

const ledgerPending = (periodYm, pending, source = 'lila_import') => ({
  id: `fll-${periodYm}`,
  memberNumber: '10450',
  date: `${periodYm}-01`,
  amount: pending,
  collected: 0,
  pending,
  source,
});

describe('operationalDuesStanding — saneamiento 645', () => {
  it('1) saldo $0 con auxiliar histórico pendiente → Al día, exigible $0', () => {
    const member = titular({
      memberId: '10450',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2027-01-10',
    });
    const lines = [ledgerPending('2026-10', 70000), ledgerPending('2026-11', 70000)];
    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      ledgerLines: lines,
    });
    expect(standing.clear).toBe(true);
    expect(standing.seal).toBe('Al día');
    expect(standing.capitalExigible).toBe(0);
    expect(standing.interestExigible).toBe(0);
    expect(standing.totalExigible).toBe(0);
    expect(appMonthlyDebtForMember(member, { today: TODAY })).toBeNull();
    expect(standing.historical.hasDifferences).toBe(true);
    expect(standing.historical.pendingTotal).toBe(140000);
    expect(standing.historical.title).toBe('Conciliación histórica');
    expect(standing.historical.periods.every((p) => p.isExigible === false)).toBe(true);
  });

  it('2) saldo a favor se conserva exacto', () => {
    const member = titular({
      outstandingBalance: -25000,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
    });
    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      ledgerLines: [ledgerPending('2026-09', 70000)],
    });
    expect(standing.kind).toBe('credit');
    expect(standing.creditBalance).toBe(25000);
    expect(standing.totalExigible).toBe(0);
    expect(standing.seal).toBe('Saldo a favor');
    expect(standing.historical.hasDifferences).toBe(true);
  });

  it('3) deuda positiva confirmada se muestra con períodos', () => {
    const member = titular({
      outstandingBalance: 70000,
      unpaidCapital: 70000,
      nextDueDate: '2026-10-10',
      lastPaymentDate: '2026-09-05',
    });
    const standing = buildOperationalDuesStanding(member, { today: TODAY });
    expect(standing.clear).toBe(false);
    expect(standing.totalExigible).toBeGreaterThan(70000);
    expect(standing.capitalExigible).toBe(70000);
    expect(standing.interestExigible).toBe(7000);
    expect(standing.months.length).toBeGreaterThanOrEqual(1);
  });

  it('4) ausencia de next_due_date con ficha 0 no inventa deuda', () => {
    const member = titular({
      outstandingBalance: 0,
      unpaidCapital: null,
      nextDueDate: null,
      lastPaymentDate: null,
    });
    expect(appMonthlyDebtForMember(member, { today: TODAY })).toBeNull();
    const standing = buildOperationalDuesStanding(member, { today: TODAY });
    expect(standing.clear).toBe(true);
    expect(standing.totalExigible).toBe(0);
    expect(standing.seal).toBe('Al día');
  });

  it('5) pago reciente que cubre un período no reabre deuda con ledger abierto', () => {
    const member = titular({
      memberId: '100827',
      memberNumber: '100827',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
      duesCoveredThrough: '2026-11',
      paymentHistory: [{
        id: 'pay-nov',
        paidAt: '2026-11-20',
        amount: 70000,
        periodDueOns: ['2026-11-10'],
        periodLabel: 'Noviembre de 2026',
      }],
    });
    const lines = [
      { ...ledgerPending('2026-10', 70000, 'liquidation'), memberNumber: '100827' },
      {
        id: 'fll-nov',
        memberNumber: '100827',
        date: '2026-11-01',
        amount: 70000,
        collected: 70000,
        pending: 0,
        source: 'dues',
      },
    ];
    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      ledgerLines: lines,
      payments: member.paymentHistory,
    });
    expect(standing.clear).toBe(true);
    expect(standing.totalExigible).toBe(0);
    expect(standing.historical.periods.some((p) => p.periodYm === '2026-10')).toBe(true);
  });

  it('6) regularización administrativa válida (Ponce 10450) permanece Al día', () => {
    const member = titular({
      memberId: '10450',
      memberNumber: '10450',
      name: 'Lucia Paola Ponce Pelaez',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2027-01-10',
      paymentHistory: [{
        id: 'reg-145k',
        paidAt: '2026-11-15',
        amount: 145000,
        concept: 'Regularización administrativa',
        periodLabel: 'Regularización',
        meta: { adminRegularization: true },
      }],
    });
    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      ledgerLines: [ledgerPending('2026-08', 70000), ledgerPending('2026-09', 70000)],
    });
    expect(standing.seal).toBe('Al día');
    expect(standing.totalExigible).toBe(0);
    expect(member.paymentHistory[0].amount).toBe(145000);
  });

  it('7) débito histórico sin comprobante importado no crea deuda exigible', () => {
    const member = titular({
      memberId: '10496',
      memberNumber: '10496',
      name: 'Sergio Walter Puga Guevara',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
      meta: {
        plannedDebit: { brand: 'Visa', amount: 55000, month: '2026-12', status: 'scheduled' },
        unallocatedHistorical: 15000,
      },
    });
    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      ledgerLines: [
        { ...ledgerPending('2026-10', 70000, 'macro_click'), memberNumber: '10496' },
        { ...ledgerPending('2026-11', 70000, 'macro_click'), memberNumber: '10496' },
      ],
    });
    expect(standing.clear).toBe(true);
    expect(standing.totalExigible).toBe(0);
    expect(member.meta.plannedDebit.amount).toBe(55000);
    expect(member.meta.unallocatedHistorical).toBe(15000);
  });

  it('8) baja de tarjeta (Argencard) no da de baja al socio ni inventa deuda', () => {
    const member = titular({
      memberId: '11638',
      memberNumber: '11638',
      name: 'Humberto Romero Federico',
      status: 'active',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
      meta: {
        cardNotes: 'BAJA DEFINITIVA Argencard mayo 2026',
        argencardStatus: 'baja',
      },
    });
    expect(member.status).toBe('active');
    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      ledgerLines: [{ ...ledgerPending('2026-05', 140000, 'lila'), memberNumber: '11638' }],
    });
    expect(standing.seal).toBe('Al día');
    expect(duesStatus(member).ok).toBe(true);
    expect(member.meta.argencardStatus).toBe('baja');
  });

  it('9) nuevo cargo legítimo posterior al saldo cero sí genera deuda', () => {
    const member = titular({
      outstandingBalance: 70000,
      unpaidCapital: 70000,
      nextDueDate: '2026-11-10',
      lastPaymentDate: '2026-10-08',
      duesOpenPeriods: [{ dueOn: '2026-11-10', capital: 70000 }],
    });
    const standing = buildOperationalDuesStanding(member, { today: TODAY });
    expect(standing.clear).toBe(false);
    expect(standing.capitalExigible).toBe(70000);
    expect(standing.totalExigible).toBeGreaterThanOrEqual(70000);
  });

  it('10) grupo familiar con titular al día: dependiente no muestra deuda propia', () => {
    const titularRow = titular({
      memberId: '20001',
      memberNumber: '20001',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
    });
    const dependent = {
      memberId: '20002',
      memberNumber: '20002',
      name: 'Familiar',
      tier: 'adherente',
      status: 'active',
      outstandingBalance: 0,
      familyPrincipalNumber: '20001',
      meta: { familyPrincipalNumber: '20001' },
    };
    const depStanding = buildOperationalDuesStanding(dependent, { today: TODAY });
    expect(depStanding.kind).toBe('dependent');
    expect(depStanding.totalExigible).toBe(0);
    expect(duesStatus(dependent, { members: [titularRow, dependent] }).ok).toBe(true);
  });

  it('11) abono tenis pendiente es independiente de cuota social en cero', () => {
    const member = titular({
      memberId: '12673',
      memberNumber: '12673',
      name: 'Vanesa Castro',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
      cuotaCategories: ['SOCIO FAMILIAR', 'ABONO TENIS'],
    });
    const social = buildOperationalDuesStanding(member, {
      today: TODAY,
      ledgerLines: [
        { ...ledgerPending('2026-10', 70000), memberNumber: '12673' },
        {
          id: 'tenis-oct',
          memberNumber: '12673',
          date: '2026-10-01',
          amount: 12000,
          collected: 0,
          pending: 12000,
          source: 'abono_tenis',
        },
      ],
    });
    expect(social.seal).toBe('Al día');
    expect(social.totalExigible).toBe(0);
    // El auxiliar conserva el pending de tenis para Tesorería; no se cobra como cuota social.
    expect(social.historical.pendingTotal).toBeGreaterThan(0);
  });

  it('12) no hay dobles imputaciones ni cobro solo-ledger con ficha 0', () => {
    const lines = [ledgerPending('2026-10', 70000)];
    const member = titular({
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
      feeLedgerLines: lines,
      paymentHistory: [{
        id: 'p1',
        receiptNumber: 'R-1',
        amount: 70000,
        paidAt: '2026-11-05',
        periodDueOns: ['2026-11-10'],
      }, {
        id: 'p1-dup',
        receiptNumber: 'R-1',
        amount: 70000,
        paidAt: '2026-11-05',
        periodDueOns: ['2026-11-10'],
      }],
    });
    const preview = collectionPreview(member, TODAY);
    expect(preview.cash).toBe(0);
    expect(preview.ledgerDesync?.blockLedgerOnlyCollection).toBe(true);
    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      ledgerLines: lines,
    });
    expect(operationalStandingIsClear(standing)).toBe(true);
    expect(memberDuesStandingSummary(member, { today: TODAY }).clear).toBe(true);
  });
});

describe('buildHistoricalReconciliation', () => {
  it('no marca períodos ledger como exigibles', () => {
    const hist = buildHistoricalReconciliation(
      titular({ outstandingBalance: 0 }),
      { ledgerLines: [ledgerPending('2026-10', 40000)] },
    );
    expect(hist.hasDifferences).toBe(true);
    expect(hist.periods[0].isExigible).toBe(false);
    expect(hist.periods[0].label).toMatch(/conciliación histórica/i);
  });
});

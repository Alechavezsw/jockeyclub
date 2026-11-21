import { describe, expect, it } from 'vitest';
import { appMonthlyDebtForMember, memberDuesStandingSummary } from '../accounting/appMonthlyDebts.js';
import { duesStatus } from '../sports/attendance.js';
import { accessDuesDebt } from '../pool/seasonDuesGate.js';
import {
  getOverdueMembers,
  hasVerifiedOperationalClearEvidence,
  openDuesObligationCapital,
  socialDuesStoredBalance,
} from './dues.js';
import { summarizePaymentHistory } from './paymentHistory.js';
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

const ledgerPending = (periodYm, pending, source = 'lila_import', memberNumber = '10450') => ({
  id: `fll-${memberNumber}-${periodYm}`,
  memberNumber,
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
      { ...ledgerPending('2026-10', 70000, 'liquidation', '100827') },
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

  it('6) regularización administrativa 10450 vía member_dues_entries (no member_payments)', () => {
    // $145.000 de regularización administrativa: asiento en member_dues_entries,
    // no un cobro en member_payments.
    const duesEntries = [{
      id: 'mde-10450-reg',
      memberId: '10450',
      memberNumber: '10450',
      amount: -145000,
      kind: 'ajuste',
      source: 'ajuste:10450:regularizacion-admin-145000',
      createdAt: '2026-11-15T12:00:00-03:00',
      description: 'Regularización administrativa $145.000',
    }];
    const member = titular({
      memberId: '10450',
      memberNumber: '10450',
      name: 'Lucia Paola Ponce Pelaez',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2027-01-10',
      paymentHistory: [],
      duesEntries,
    });
    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      entries: duesEntries,
      ledgerLines: [ledgerPending('2026-08', 70000), ledgerPending('2026-09', 70000)],
    });
    expect(standing.seal).toBe('Al día');
    expect(standing.totalExigible).toBe(0);
    expect(member.paymentHistory).toEqual([]);
    expect(duesEntries[0].amount).toBe(-145000);
    expect(duesEntries[0].kind).toBe('ajuste');
    expect(duesEntries[0].source).toMatch(/regularizacion-admin/);
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
        ledgerPending('2026-10', 70000, 'macro_click', '10496'),
        ledgerPending('2026-11', 70000, 'macro_click', '10496'),
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
      ledgerLines: [ledgerPending('2026-05', 140000, 'lila', '11638')],
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
        ledgerPending('2026-10', 70000, 'lila_import', '12673'),
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

describe('regresión PR #12 — cuatro bloqueos de revisión', () => {
  it('A) open periods con ficha 0 sin pago de respaldo → deuda nueva legítima', () => {
    // Sin paymentHistory: no hay evidencia de cobro → sí exigible.
    const member = titular({
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-11-10',
      lastPaymentDate: '2026-10-05',
      paymentHistory: [],
      duesOpenPeriods: [{ dueOn: '2026-11-10', capital: 70000 }],
    });
    expect(hasVerifiedOperationalClearEvidence(member)).toBe(false);
    expect(openDuesObligationCapital(member)).toBe(70000);
    expect(socialDuesStoredBalance(member)).toBe(70000);
    const debt = appMonthlyDebtForMember(member, { today: TODAY });
    expect(debt).not.toBeNull();
    expect(debt.capital).toBe(70000);
    const standing = buildOperationalDuesStanding(member, { today: TODAY });
    expect(standing.clear).toBe(false);
    expect(standing.totalExigible).toBeGreaterThan(0);
    expect(standing.capitalExigible).toBe(70000);
    expect(standing.seal).not.toBe('Al día');
  });

  it('B) unpaidCapital histórico 0 no oculta deuda nueva con períodos abiertos', () => {
    const member = titular({
      outstandingBalance: 70000,
      unpaidCapital: 0,
      nextDueDate: '2026-11-10',
      lastPaymentDate: '2026-10-08',
      duesOpenPeriods: [{ dueOn: '2026-11-10', capital: 70000 }],
    });
    expect(socialDuesStoredBalance(member)).toBe(70000);
    expect(appMonthlyDebtForMember(member, { today: TODAY })).not.toBeNull();
    const standing = buildOperationalDuesStanding(member, { today: TODAY });
    expect(standing.clear).toBe(false);
    expect(standing.capitalExigible).toBe(70000);
  });

  it('C) unpaidCapital 0 sin períodos abiertos sigue ocultando ficha desfasada (Onsalo)', () => {
    const member = titular({
      memberId: '11147',
      memberNumber: '11147',
      outstandingBalance: 70000,
      unpaidCapital: 0,
      nextDueDate: '2026-10-10',
      lastPaymentDate: '2026-11-01',
      duesOpenPeriods: [],
    });
    expect(socialDuesStoredBalance(member)).toBe(0);
    expect(appMonthlyDebtForMember(member, { today: TODAY })).toBeNull();
    expect(buildOperationalDuesStanding(member, { today: TODAY }).clear).toBe(true);
  });

  it('D) crédito + nueva obligación abierta → deuda neta / no se pierde la obligación', () => {
    const member = titular({
      outstandingBalance: -20000,
      unpaidCapital: 0,
      nextDueDate: '2026-11-10',
      duesOpenPeriods: [{ dueOn: '2026-11-10', capital: 70000 }],
    });
    // Crédito $20.000 reduce la obligación $70.000 → $50.000 exigibles.
    expect(socialDuesStoredBalance(member)).toBe(50000);
    const standing = buildOperationalDuesStanding(member, { today: TODAY });
    expect(standing.clear).toBe(false);
    expect(standing.totalExigible).toBeGreaterThan(0);
    expect(standing.capitalExigible).toBeGreaterThanOrEqual(50000);
  });

  it('E) vencimiento histórico con saldo 0 → no atrasado en portal / acceso / mora', () => {
    const member = titular({
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-06-10',
      lastPaymentDate: '2026-05-01',
      overdueSince: '2026-06-11',
      duesOpenPeriods: [],
      paymentHistory: [{
        id: 'old',
        date: '2026-05-01',
        amount: 70000,
        status: 'paid',
      }],
    });
    const standing = buildOperationalDuesStanding(member, { today: TODAY });
    expect(standing.clear).toBe(true);
    expect(standing.monthsBehind).toBe(0);
    expect(standing.totalExigible).toBe(0);

    const hist = summarizePaymentHistory(member.paymentHistory, member, { today: TODAY });
    expect(hist.outstanding).toBe(0);
    expect(hist.monthsBehind).toBe(0);

    expect(getOverdueMembers([member], TODAY)).toHaveLength(0);
    expect(accessDuesDebt(member, [member], { today: TODAY }).hasDebt).toBe(false);
    expect(duesStatus(member).ok).toBe(true);
  });

  it('F) buildHistoricalReconciliation filtra por número y no mezcla socios', () => {
    const memberA = titular({
      memberId: '10450',
      memberNumber: '10450',
      outstandingBalance: 0,
    });
    const mixedLines = [
      ledgerPending('2026-10', 70000, 'lila_import', '10450'),
      ledgerPending('2026-10', 40000, 'lila_import', '99999'),
      ledgerPending('2026-11', 70000, 'macro_click', '10450'),
      {
        id: 'fll-other',
        member_number: '88888',
        date: '2026-09-01',
        amount: 99999,
        collected: 0,
        pending: 99999,
        source: 'lila_import',
      },
    ];
    const hist = buildHistoricalReconciliation(memberA, { ledgerLines: mixedLines });
    expect(hist.periods).toHaveLength(2);
    expect(hist.pendingTotal).toBe(140000);
    expect(hist.periods.every((p) => ['2026-10', '2026-11'].includes(p.periodYm))).toBe(true);
    expect(hist.periods.some((p) => p.pending === 99999)).toBe(false);
    expect(hist.periods.some((p) => p.pending === 40000)).toBe(false);

    const memberB = titular({
      memberId: '99999',
      memberNumber: '99999',
      outstandingBalance: 0,
    });
    const histB = buildHistoricalReconciliation(memberB, { ledgerLines: mixedLines });
    expect(histB.periods).toHaveLength(1);
    expect(histB.pendingTotal).toBe(40000);
  });

  it('G) cambio rápido entre socios: standing de A no contamina a B en cero', () => {
    const a = titular({
      id: 'db-a',
      memberId: '11111',
      memberNumber: '11111',
      outstandingBalance: 140000,
      unpaidCapital: 140000,
      nextDueDate: '2026-09-10',
      lastPaymentDate: '2026-08-01',
      duesOpenPeriods: [
        { dueOn: '2026-09-10', capital: 70000 },
        { dueOn: '2026-10-10', capital: 70000 },
      ],
    });
    const b = titular({
      id: 'db-b',
      memberId: '22222',
      memberNumber: '22222',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-06-10',
      lastPaymentDate: '2026-05-01',
      duesOpenPeriods: [],
      feeLedgerLines: [ledgerPending('2026-10', 70000, 'lila_import', '22222')],
    });
    const standA = buildOperationalDuesStanding(a, { today: TODAY });
    const standB = buildOperationalDuesStanding(b, {
      today: TODAY,
      ledgerLines: b.feeLedgerLines,
    });
    expect(standA.clear).toBe(false);
    expect(standA.totalExigible).toBeGreaterThan(0);
    expect(standB.clear).toBe(true);
    expect(standB.totalExigible).toBe(0);
    expect(standB.monthsBehind).toBe(0);
    expect(standB.historical.pendingTotal).toBe(70000);
    // Confirmar que las líneas de A no entran en B aunque se pasen mezcladas.
    const mixed = buildHistoricalReconciliation(b, {
      ledgerLines: [
        ...a.duesOpenPeriods.map((row) => ({
          memberNumber: '11111',
          date: row.dueOn,
          amount: row.capital,
          collected: 0,
          pending: row.capital,
          source: 'liquidation',
        })),
        ...b.feeLedgerLines,
      ],
    });
    expect(mixed.pendingTotal).toBe(70000);
  });
});

describe('admin: ficha $0 respaldada no se reabre por períodos abiertos', () => {
  it('100745 Martín Soria: pagos $77.000 + $70.000 → operativo $0; imputación a conciliación', () => {
    const payments = [
      {
        id: 'pay-soria-77k',
        paidAt: '2026-10-15',
        date: '2026-10-15',
        amount: 77000,
        status: 'paid',
        concept: 'Cuota social · Octubre de 2026',
        periodDueOns: ['2026-10-10'],
        periodLabel: 'Octubre de 2026',
        receiptNumber: 'R-100745-77',
      },
      {
        id: 'pay-soria-70k',
        paidAt: '2026-11-10',
        date: '2026-11-10',
        amount: 70000,
        status: 'paid',
        concept: 'Cuota social · Noviembre de 2026',
        periodDueOns: ['2026-11-10'],
        periodLabel: 'Noviembre de 2026',
        receiptNumber: 'R-100745-70',
      },
    ];
    // Períodos auxiliares siguen abiertos por inconsistencia de imputación (no se inventan cobros).
    const member = titular({
      id: 'db-100745',
      memberId: '100745',
      memberNumber: '100745',
      name: 'Martín Soria',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
      lastPaymentDate: '2026-11-10',
      paymentHistory: payments,
      duesOpenPeriods: [
        { dueOn: '2026-10-10', capital: 70000 },
        { dueOn: '2026-11-10', capital: 70000 },
      ],
    });

    expect(hasVerifiedOperationalClearEvidence(member)).toBe(true);
    expect(socialDuesStoredBalance(member)).toBe(0);
    expect(appMonthlyDebtForMember(member, { today: TODAY })).toBeNull();

    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      payments,
      ledgerLines: [
        ledgerPending('2026-10', 70000, 'lila_import', '100745'),
        ledgerPending('2026-11', 70000, 'lila_import', '100745'),
      ],
    });
    expect(standing.clear).toBe(true);
    expect(standing.seal).toBe('Al día');
    expect(standing.totalExigible).toBe(0);
    expect(standing.historical.hasDifferences).toBe(true);
    expect(standing.historical.periods.every((p) => p.isExigible === false)).toBe(true);
    // Comprobantes originales intactos.
    expect(member.paymentHistory.map((p) => p.amount)).toEqual([77000, 70000]);
    expect(member.paymentHistory.map((p) => p.receiptNumber)).toEqual([
      'R-100745-77',
      'R-100745-70',
    ]);
  });

  it('101600 Ramírez: nov $70.000 pago; remanente oct $6.363,64 a validar; operativo $0', () => {
    const payments = [{
      id: 'pay-ramirez-nov',
      paidAt: '2026-11-08',
      date: '2026-11-08',
      amount: 70000,
      status: 'paid',
      concept: 'Cuota social · Noviembre de 2026',
      periodDueOns: ['2026-11-10'],
      periodLabel: 'Noviembre de 2026',
      receiptNumber: 'R-101600-nov',
    }];
    const member = titular({
      id: 'db-101600',
      memberId: '101600',
      memberNumber: '101600',
      name: 'María Florencia Ramírez Pericas',
      outstandingBalance: 0,
      unpaidCapital: 0,
      nextDueDate: '2026-12-10',
      lastPaymentDate: '2026-11-08',
      paymentHistory: payments,
      // Remanente de octubre sin evidencia suficiente para darlo por pagado.
      duesOpenPeriods: [{ dueOn: '2026-10-10', capital: 6363.64, capitalOpen: 6363.64 }],
    });

    expect(hasVerifiedOperationalClearEvidence(member)).toBe(true);
    expect(socialDuesStoredBalance(member)).toBe(0);
    expect(appMonthlyDebtForMember(member, { today: TODAY })).toBeNull();

    const standing = buildOperationalDuesStanding(member, {
      today: TODAY,
      payments,
    });
    expect(standing.clear).toBe(true);
    expect(standing.seal).toBe('Al día');
    expect(standing.totalExigible).toBe(0);
    expect(standing.historical.hasDifferences).toBe(true);
    expect(standing.historical.pendingTotal).toBe(6363.64);
    const oct = standing.historical.periods.find((p) => p.periodYm === '2026-10');
    expect(oct).toBeTruthy();
    expect(oct.pending).toBe(6363.64);
    expect(oct.isExigible).toBe(false);
    expect(oct.label).toMatch(/pendiente de validación/i);
    // No se inventa un pago que cierre el remanente.
    expect(member.paymentHistory).toHaveLength(1);
    expect(member.paymentHistory[0].amount).toBe(70000);
    expect(member.duesOpenPeriods[0].capital).toBe(6363.64);
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

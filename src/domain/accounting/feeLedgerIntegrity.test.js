import { describe, expect, it } from 'vitest';
import {
  PERIOD_STATUS,
  applyAdminLedgerReconciliation,
  detectFeeLedgerFichaAnomalies,
  normalizeLedgerLineForCoveredPeriod,
  periodLedgerStatus,
  shouldBlockLedgerOnlyCollection,
  summarizeFeeLedgerIntegrity,
} from './feeLedgerIntegrity.js';
import { detectMemberDuesAnomalies } from '../members/duesBalanceAudit.js';
import { collectionPreview } from '../members/memberPayments.js';

const nataliaBefore = {
  memberId: '100827',
  memberNumber: '100827',
  name: 'Natalia Gahona',
  tier: 'socio_familiar',
  outstandingBalance: 0,
  nextDueDate: '2026-12-10',
  duesCoveredThrough: '2026-11',
  paymentHistory: [
    {
      id: 'RC-100827-20261120',
      paidAt: '2026-11-20',
      amount: 70000,
      periodDueOns: ['2026-11-10'],
      periodLabel: 'Noviembre de 2026',
    },
  ],
};

const octOpenLine = {
  id: 'fll-oct-100827',
  memberNumber: '100827',
  date: '2026-10-01',
  amount: 70000,
  collected: 0,
  pending: 70000,
  source: 'liquidation',
};

const novPaidLine = {
  id: 'fll-nov-100827',
  memberNumber: '100827',
  date: '2026-11-01',
  amount: 70000,
  collected: 70000,
  pending: 0,
  source: 'dues',
};

describe('feeLedgerIntegrity — Natalia 100827', () => {
  it('estado anterior: ficha 0 + Oct pending + Nov pagado detecta anomalía', () => {
    const findings = detectFeeLedgerFichaAnomalies({
      member: nataliaBefore,
      ledgerLines: [octOpenLine, novPaidLine],
      payments: nataliaBefore.paymentHistory,
    });
    expect(findings.some((row) => row.code === 'ficha_zero_ledger_pending' && row.period === '2026-10')).toBe(true);
    expect(periodLedgerStatus(nataliaBefore, octOpenLine, {
      payments: nataliaBefore.paymentHistory,
    })).toBe(PERIOD_STATUS.EN_REVISION);
    expect(periodLedgerStatus(nataliaBefore, novPaidLine, {
      payments: nataliaBefore.paymentHistory,
    })).toBe(PERIOD_STATUS.PAGADO);
    expect(shouldBlockLedgerOnlyCollection(nataliaBefore, {
      ledgerLines: [octOpenLine, novPaidLine],
      payments: nataliaBefore.paymentHistory,
    })).toBe(true);
  });

  it('tras conciliación admin: Oct cerrado sin inventar pago; Nov pagado; next due Dic', () => {
    const first = applyAdminLedgerReconciliation([octOpenLine, novPaidLine], '2026-10', {
      reason: 'conciliado administrativamente · sin transferencia inventada',
    });
    expect(first.createdPayment).toBe(false);
    expect(first.closed).toBe(1);
    expect(first.amount).toBe(70000);
    const oct = first.lines.find((l) => l.id === 'fll-oct-100827');
    expect(oct.pending).toBe(0);
    expect(oct.collected).toBe(70000);
    expect(oct.source).toMatch(/admin_reconciled/);

    const afterMember = {
      ...nataliaBefore,
      meta: {
        october2026LedgerStatus: 'conciliado administrativamente · sin transferencia inventada',
      },
    };
    const findings = detectFeeLedgerFichaAnomalies({
      member: afterMember,
      ledgerLines: first.lines,
      payments: afterMember.paymentHistory,
    });
    expect(findings.some((row) => row.period === '2026-10' && row.code === 'ficha_zero_ledger_pending')).toBe(false);
    expect(periodLedgerStatus(afterMember, oct, {
      payments: afterMember.paymentHistory,
    })).toBe(PERIOD_STATUS.CONCILIADO_ADMIN);
    expect(afterMember.nextDueDate).toBe('2026-12-10');
    expect(afterMember.outstandingBalance).toBe(0);
  });

  it('idempotencia de conciliación: segundo apply no duplica collected', () => {
    const a = applyAdminLedgerReconciliation([octOpenLine], '2026-10');
    const b = applyAdminLedgerReconciliation(a.lines, '2026-10');
    expect(b.closed).toBe(0);
    expect(b.amount).toBe(0);
    expect(b.lines[0].collected).toBe(70000);
    expect(b.lines[0].pending).toBe(0);
  });

  it('pago concurrente / doble apply no duplica collected en línea ya cerrada', () => {
    const closed = {
      ...octOpenLine,
      collected: 70000,
      pending: 0,
      source: 'dues',
    };
    const again = applyAdminLedgerReconciliation([closed], '2026-10');
    expect(again.closed).toBe(0);
    expect(again.lines[0].collected).toBe(70000);
  });

  it('importación antigua (source lila) vs liquidación: ambas detectables si ficha 0', () => {
    const lila = { ...octOpenLine, id: 'lila-oct', source: 'lila' };
    const liq = { ...octOpenLine, id: 'liq-oct', source: 'liquidation' };
    const a = detectFeeLedgerFichaAnomalies({
      member: nataliaBefore,
      ledgerLines: [lila],
      payments: nataliaBefore.paymentHistory,
    });
    const b = detectFeeLedgerFichaAnomalies({
      member: nataliaBefore,
      ledgerLines: [liq],
      payments: nataliaBefore.paymentHistory,
    });
    expect(a.some((row) => row.code === 'ficha_zero_ledger_pending')).toBe(true);
    expect(b.some((row) => row.code === 'ficha_zero_ledger_pending')).toBe(true);
  });

  it('ausencia de comprobante: admin reconcile OK sin payment inventado', () => {
    const result = applyAdminLedgerReconciliation([octOpenLine], '2026-10', {
      reason: 'ajuste admin sin comprobante',
    });
    expect(result.createdPayment).toBe(false);
    expect(result.lines[0].pending).toBe(0);
  });

  it('cuota realmente pendiente alineada: no bloquea cobro legítimo', () => {
    const member = {
      memberId: '2001',
      memberNumber: '2001',
      name: 'Deudor real',
      outstandingBalance: 70000,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    };
    const line = {
      id: 'fll-real',
      memberNumber: '2001',
      date: '2026-11-01',
      amount: 70000,
      collected: 0,
      pending: 70000,
      source: 'liquidation',
    };
    expect(shouldBlockLedgerOnlyCollection(member, { ledgerLines: [line] })).toBe(false);
    expect(periodLedgerStatus(member, line)).toBe(PERIOD_STATUS.PENDIENTE);
    const preview = collectionPreview(
      {
        ...member,
        tier: 'socio_familiar',
        cuotaCategories: ['SOCIO FAMILIAR'],
        feeLedgerLines: [line],
      },
      new Date('2026-11-20T12:00:00-03:00'),
    );
    expect(preview.ledgerDesync?.blockLedgerOnlyCollection).not.toBe(true);
    expect(preview.cash).toBeGreaterThan(0);
  });

  it('saldo 0 legítimo sin pending ledger: sin anomalía', () => {
    const member = {
      ...nataliaBefore,
      outstandingBalance: 0,
    };
    const findings = detectFeeLedgerFichaAnomalies({
      member,
      ledgerLines: [novPaidLine],
      payments: member.paymentHistory,
    });
    expect(findings.filter((row) => row.code === 'ficha_zero_ledger_pending')).toHaveLength(0);
    expect(shouldBlockLedgerOnlyCollection(member, {
      ledgerLines: [novPaidLine],
      payments: member.paymentHistory,
    })).toBe(false);
  });

  it('liquidación no reabre período ya cubierto', () => {
    const open = {
      id: 'fll-new',
      memberNumber: '100827',
      date: '2026-10-01',
      amount: 70000,
      collected: 0,
      pending: 70000,
      source: 'liquidation',
    };
    const normalized = normalizeLedgerLineForCoveredPeriod(open, nataliaBefore, {
      payments: nataliaBefore.paymentHistory,
    });
    expect(normalized.pending).toBe(0);
    expect(normalized.collected).toBe(70000);
    expect(normalized.source).toBe('liquidation_sync_covered');
  });

  it('duesBalanceAudit incorpora hallazgos de fee_ledger', () => {
    const findings = detectMemberDuesAnomalies(nataliaBefore, {
      ledgerLines: [octOpenLine],
      payments: nataliaBefore.paymentHistory,
    });
    expect(findings.some((row) => row.code === 'ficha_zero_ledger_pending')).toBe(true);
    const summary = summarizeFeeLedgerIntegrity(findings);
    expect(summary.anomalyCount).toBeGreaterThan(0);
    expect(summary.memberNumbers).toContain('100827');
  });

  it('collectionPreview adjunta ledgerDesync y no inventa crédito', () => {
    const preview = collectionPreview(
      {
        ...nataliaBefore,
        tier: 'socio_familiar',
        cuotaCategories: ['SOCIO FAMILIAR'],
        feeLedgerLines: [octOpenLine, novPaidLine],
      },
      new Date('2026-11-20T12:00:00-03:00'),
    );
    expect(preview.ledgerDesync).toBeTruthy();
    expect(preview.ledgerDesync.blockLedgerOnlyCollection).toBe(true);
    expect(preview.creditApplied || 0).toBe(0);
    expect(preview.clear || preview.cash === 0).toBe(true);
  });
});

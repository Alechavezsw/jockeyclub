import { describe, expect, it } from 'vitest';
import { duesPaymentNotice } from './duesPaymentNotice';
import {
  appPaymentRequestPeriodDisplay,
  buildDuesPaymentRequestPeriodPayload,
  resolveDuesPaymentRequestPeriods,
  resolveHistoricalAppPaymentRequestPeriods,
} from './duesPaymentRequestPeriods';

const LEDGER_100132 = [
  {
    line_date: '2026-11-01',
    type_label: 'Cuota (SOCIO FAMILIAR)',
    amount: 70000,
    collected: 28000,
    pending: 42000,
    source: 'liquidation_admin_reconciled',
  },
  {
    line_date: '2026-11-01',
    type_label: 'Cuota (ABONO TENIS)',
    amount: 12000,
    collected: 0,
    pending: 12000,
    source: 'liquidation',
  },
];

describe('duesPaymentRequestPeriods', () => {
  it('no usa next_due_date como período a pagar', () => {
    const resolved = resolveDuesPaymentRequestPeriods({
      periodDueOns: ['2026-11-10'],
      nextAccountDueDate: '2026-12-10',
    });
    expect(resolved.periodDueOns).toEqual(['2026-11-10']);
    expect(resolved.periodLabel).toMatch(/Noviembre de 2026/i);
    expect(resolved.periodDueLabel).toMatch(/noviembre/i);
    expect(resolved.nextAccountDueDate).toBe('2026-12-10');
    expect(resolved.periodDueOns).not.toContain('2026-12-10');
  });

  it('rechaza chargeDue si solo es el próximo de cuenta', () => {
    const resolved = resolveDuesPaymentRequestPeriods({
      chargeDue: '2026-12-10',
      nextAccountDueDate: '2026-12-10',
    });
    expect(resolved.periodDueOns).toEqual([]);
  });

  it('persiste período noviembre en la solicitud de Luciano ($54.000)', () => {
    const payload = buildDuesPaymentRequestPeriodPayload({
      periodDueOns: ['2026-11-10'],
      nextAccountDueDate: '2026-12-10',
      concepts: ['Cuota social', 'Abono tenis'],
      amount: 54000,
    });
    const msg = duesPaymentNotice({
      memberName: 'Luciano Virhuez',
      memberId: '100132',
      amountLabel: '$ 54.000',
      amount: 54000,
      periodDueOns: ['2026-11-10'],
      nextAccountDueDate: '2026-12-10',
      concepts: ['Cuota social', 'Abono tenis'],
      method: 'transferencia',
    });
    expect(msg.content).toMatch(/Período:.*Noviembre de 2026/i);
    expect(msg.content).toMatch(/Vencimiento del período:.*noviembre/i);
    expect(msg.content).toMatch(/Próximo vencimiento de cuenta:.*diciembre/i);
    expect(msg.content).not.toMatch(/Vencimiento: 10 de dic/i);
    expect(msg.meta.periodDueOns).toEqual(['2026-11-10']);
    expect(msg.meta.nextAccountDueDate).toBe('2026-12-10');
    expect(msg.meta.amount).toBe(54000);
    expect(payload.dueLabel).toMatch(/noviembre/i);
  });

  it('histórica sin meta: reconstruye noviembre desde ledger, no diciembre', () => {
    const historic = {
      content: 'Luciano Virhuez envió el comprobante...\nImporte: $ 54.000\nVencimiento: 10 de dic de 2026',
      meta: { kind: 'dues_payment', method: 'transferencia', paymentRequest: true },
    };
    const member = {
      memberNumber: '100132',
      nextDueDate: '2026-12-10',
      outstandingBalance: 54000,
      feeLedgerLines: LEDGER_100132,
    };
    const resolved = resolveHistoricalAppPaymentRequestPeriods(historic, member);
    expect(resolved.periodDueOns).toEqual(['2026-11-10']);
    expect(resolved.periodLabel).toMatch(/Noviembre de 2026/i);
    expect(resolved.nextAccountDueDate).toBe('2026-12-10');

    const display = appPaymentRequestPeriodDisplay(historic, member);
    expect(display.periodLabel).toMatch(/Noviembre de 2026/i);
    expect(display.nextAccountDueLabel).toMatch(/diciembre/i);
  });
});

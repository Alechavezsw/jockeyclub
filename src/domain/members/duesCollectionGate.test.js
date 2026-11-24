import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true }));

const registrarCobro = vi.fn();
const registrarCobroPos = vi.fn();

vi.mock('../../data/repos', async () => {
  const actual = await vi.importActual('../../data/repos');
  return {
    ...actual,
    registrarCobro: (...args) => registrarCobro(...args),
    registrarCobroPos: (...args) => registrarCobroPos(...args),
    findDuesJournalBySourceId: vi.fn(async () => null),
    patchMemberPaymentChargeScope: vi.fn(async () => null),
    quitarRecargoCuota: vi.fn(),
    revertDuesPayment: vi.fn(),
  };
});

import { commitDuesCollection } from './memberPayments';

const TODAY = '2026-11-24';

function payment(partial) {
  return {
    id: 'local-1',
    method: 'efectivo',
    amount: 42000,
    date: TODAY,
    periodDueOns: ['2026-11-10'],
    chargeScope: 'social',
    ...partial,
  };
}

function luciano() {
  return {
    id: 'uuid-100132',
    memberId: '100132',
    memberNumber: '100132',
    tier: 'socio_familiar',
    outstandingBalance: 54000,
    cuotaCategories: ['ABONO TENIS', 'SOCIO FAMILIAR'],
    feeLedgerLines: [
      {
        line_date: '2026-11-01',
        type_label: 'Cuota (SOCIO FAMILIAR)',
        description: 'Noviembre del 2026',
        amount: 70000,
        collected: 28000,
        pending: 42000,
        source: 'liquidation_admin_reconciled',
      },
      {
        line_date: '2026-11-01',
        type_label: 'Cuota (ABONO TENIS)',
        description: 'Noviembre del 2026',
        amount: 12000,
        collected: 0,
        pending: 12000,
        source: 'liquidation',
      },
    ],
    paymentHistory: [],
  };
}

function silvia() {
  return {
    id: 'uuid-10632',
    memberId: '10632',
    memberNumber: '10632',
    tier: 'socio_familiar',
    outstandingBalance: 275000,
    cuotaCategories: ['SOCIO FAMILIAR'],
    accessinHistory: [
      ['10632', '2026-08-01', 'Cuota', 'Agosto del 2026', 60000],
      ['10632', '2026-08-11', 'Recargo de Cuota (FIJO)', 'Agosto del 2026', 2000],
      ['10632', '2026-09-01', 'Cuota', 'Septiembre del 2026', 60000],
      ['10632', '2026-09-10', 'Recargo de Cuota (10.00 %)', 'Septiembre del 2026', 6000],
      ['10632', '2026-10-01', 'Cuota', 'Octubre del 2026', 70000],
      ['10632', '2026-10-10', 'Recargo de Cuota (10.00 %)', 'Octubre del 2026', 7000],
    ],
    feeLedgerLines: [
      {
        line_date: '2026-10-01',
        type_label: 'Cuota (SOCIO FAMILIAR)',
        description: 'Octubre del 2026',
        amount: 70000,
        collected: 0,
        pending: 70000,
        source: 'liquidation',
      },
      {
        line_date: '2026-11-01',
        type_label: 'Cuota (SOCIO FAMILIAR)',
        description: 'Noviembre del 2026',
        amount: 70000,
        collected: 0,
        pending: 70000,
        source: 'liquidation',
      },
      {
        line_date: null,
        type_label: 'AJUSTE ADMINISTRATIVO (CONCILIACIÓN CONNECT)',
        description: 'Ajuste administrativo de saldo histórico',
        amount: 135000,
        collected: 0,
        pending: 135000,
        source: 'connect_admin_reconciliation_20261123',
      },
    ],
    paymentHistory: [],
  };
}

describe('acreditación bloqueada antes de la RPC', () => {
  beforeEach(() => {
    registrarCobro.mockReset();
    registrarCobroPos.mockReset();
  });

  it('10632 acredita los $308.000 y el saldo de ficha no se reescribe antes del cobro', async () => {
    registrarCobro.mockResolvedValue({
      payment: { id: 'pay-10632', amount: 308000, date: TODAY },
      outstandingBalance: 0,
      nextDueDate: '2026-12-10',
      idempotent: false,
      imputations: [],
    });
    const member = silvia();
    const saved = await commitDuesCollection(member, payment({
      amount: 308000,
      method: 'transferencia',
      periodDueOns: ['2026-08-10', '2026-09-10', '2026-10-10', '2026-11-10'],
    }));
    expect(registrarCobro).toHaveBeenCalledTimes(1);
    expect(registrarCobro.mock.calls[0][0].amount).toBe(308000);
    expect(saved.member.outstandingBalance).toBe(0);
    expect(member.outstandingBalance).toBe(275000);
  });

  it('un reintento y dos cobros simultáneos de 100132 no duplican la imputación', async () => {
    const seen = new Map();
    registrarCobro.mockImplementation(async ({ idempotencyKey, amount }) => {
      if (seen.has(idempotencyKey)) {
        return { ...seen.get(idempotencyKey), idempotent: true };
      }
      const saved = {
        payment: { id: 'pay-1', amount, date: TODAY },
        outstandingBalance: 12000,
        nextDueDate: '2026-12-10',
        idempotent: false,
        imputations: [{ dueOn: '2026-11-10', capital: 42000, surcharge: 0 }],
      };
      seen.set(idempotencyKey, saved);
      return saved;
    });
    const member = luciano();
    const draft = payment({ amount: 42000 });
    const [first, second] = await Promise.all([
      commitDuesCollection(member, draft),
      commitDuesCollection(member, draft),
    ]);
    expect(seen.size).toBe(1);
    expect(first.payment.imputations).toEqual(second.payment.imputations);
    expect(first.member.outstandingBalance).toBe(12000);
    expect(second.idempotent || first.idempotent).toBe(true);
  });

  it('la propuesta de conciliación lee el catálogo y no fija la tarifa', () => {
    const proposal = readFileSync(
      new URL('../../../supabase/migrations/20261124223000_dues_historical_month_proposal.sql', import.meta.url),
      'utf8',
    );
    expect(proposal).toMatch(/member_tiers/);
    expect(proposal).toMatch(/monthlyDues/);
    expect(proposal).toMatch(/has_staff_access/);
    expect(proposal).not.toMatch(/when 'socio_familiar' then 70000/);
    expect(proposal).not.toMatch(/update public\.members/i);
  });
});

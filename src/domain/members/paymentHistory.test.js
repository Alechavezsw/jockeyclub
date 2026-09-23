import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getMemberPaymentHistory, summarizePaymentHistory } from './paymentHistory';
import { setRuntimeTierCatalog } from './tiers';

const testCatalog = [
  { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 32000, sortOrder: 1 },
];

beforeEach(() => setRuntimeTierCatalog(testCatalog));
afterEach(() => setRuntimeTierCatalog(null));

describe('summarizePaymentHistory', () => {
  const today = new Date('2026-09-21T12:00:00');
  const member = {
    tier: 'socio_individual',
    outstandingBalance: 0,
    nextDueDate: '2026-10-10',
  };
  const history = [
    {
      id: 'p1',
      date: '2026-08-13',
      amount: 32000,
      method: 'caja',
      status: 'paid',
      concept: 'Cuota social · agosto 2026',
    },
  ];

  it('último pago 13/08 con saldo 0 sigue 1 mes atrasado el 21/09', () => {
    const summary = summarizePaymentHistory(history, member, { today });
    expect(summary.monthsBehind).toBe(1);
    expect(summary.outstanding).toBe(32000);
    expect(summary.nextDue).toBe('2026-09-10');
    expect(summary.lastPayment.date).toBe('2026-08-13');
  });

  it('si no hay catálogo ni pagos, igual calcula mora cobrable', () => {
    const summary = summarizePaymentHistory([], {
      tier: 'socio_familiar',
      outstandingBalance: 0,
      nextDueDate: '2026-08-10',
    }, { today });
    expect(summary.monthsBehind).toBe(2);
    expect(summary.outstanding).toBe(64000);
  });

  it('si la categoría no tiene monto, usa el último pago de cuota', () => {
    const summary = summarizePaymentHistory(history, {
      ...member,
      tier: 'socio_familiar',
    }, { today });
    expect(summary.monthsBehind).toBe(1);
    expect(summary.outstanding).toBe(32000);
  });

  it('junio 14 → 3 meses atrasados el 22/09, sin multiplicar adherentes', () => {
    const today = new Date('2026-09-22T12:00:00');
    const summary = summarizePaymentHistory([
      {
        id: 'p-jun',
        date: '2026-06-14',
        amount: 32000,
        method: 'transferencia',
        status: 'paid',
        concept: 'Cuota social · junio 2026',
      },
    ], {
      tier: 'socio_individual',
      outstandingBalance: 96000,
      lastPaymentDate: '2026-06-14',
      nextDueDate: '2026-07-10',
      adherents: [
        { tier: 'socio_individual', status: 'active' },
        { tier: 'socio_individual', status: 'active' },
      ],
    }, { today });
    expect(summary.monthsBehind).toBe(3);
    expect(summary.outstanding).toBe(96000);
    expect(summary.nextDue).toBe('2026-07-10');
  });
});

describe('getMemberPaymentHistory', () => {
  it('no inventa filas en $0 si el historial viene vacío', () => {
    const rows = getMemberPaymentHistory({
      memberId: '2026887744320988',
      paymentHistory: [],
      yearsActive: 5,
    });
    expect(rows).toEqual([]);
  });
});

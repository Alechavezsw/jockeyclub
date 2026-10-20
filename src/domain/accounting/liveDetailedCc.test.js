import { describe, expect, it } from 'vitest';
import { buildLiveDetailedCc } from './liveDetailedCc';

describe('buildLiveDetailedCc', () => {
  it('arma las líneas con cuota y recargo del mes en mora', () => {
    const detail = buildLiveDetailedCc({
      memberId: '4240',
      name: 'Ana Pérez',
      tier: 'socio_familiar',
      status: 'active',
      lastPaymentDate: '2026-09-13',
      nextDueDate: '2026-10-10',
      outstandingBalance: 77000,
    }, { today: '2026-10-19' });
    expect(detail.totalOwed).toBe(77000);
    expect(detail.lines[0].periodKey).toBe('2026-10');
    expect(detail.lines[0].owed).toBe(77000);
  });

  it('devuelve al día si no hay saldo', () => {
    const detail = buildLiveDetailedCc({
      memberId: '88',
      name: 'Luis',
      tier: 'socio_familiar',
      status: 'active',
      lastPaymentDate: '2026-10-05',
      nextDueDate: '2026-11-10',
      outstandingBalance: 0,
    }, { today: '2026-10-19' });
    expect(detail.standing).toBe('Al día');
    expect(detail.lines).toEqual([]);
    expect(detail.totalOwed).toBe(0);
  });
});

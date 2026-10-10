import { describe, expect, it } from 'vitest';
import { isCurrentMonthDuesUnpaid, seasonDuesGate } from './seasonDuesGate';

const familiar = {
  memberId: '1',
  name: 'Ana Pérez',
  status: 'active',
  tier: 'socio_familiar',
  outstandingBalance: 70000,
  nextDueDate: '2026-12-10',
};

describe('seasonDuesGate', () => {
  it('antes del 10 no corta, aunque deba', () => {
    expect(isCurrentMonthDuesUnpaid(familiar, '2026-12-09')).toBe(false);
    expect(seasonDuesGate(familiar, { today: '2026-12-09' }).blocked).toBe(false);
  });

  it('en temporada, desde el 10, mora bloquea sede y pileta', () => {
    const gate = seasonDuesGate(familiar, { today: '2026-12-10' });
    expect(gate.blocked).toBe(true);
    expect(gate.inSeason).toBe(true);
    expect(gate.reason).toMatch(/mora/i);
  });

  it('fuera de temporada no bloquea', () => {
    expect(seasonDuesGate(familiar, { today: '2026-10-10' }).blocked).toBe(false);
    expect(seasonDuesGate(familiar, { today: '2026-10-10' }).inSeason).toBe(false);
  });

  it('al día entra, vitalicio no paga cuota', () => {
    expect(seasonDuesGate({
      ...familiar,
      outstandingBalance: 0,
      lastPaymentDate: '2026-12-10',
      nextDueDate: '2027-01-10',
    }, { today: '2026-12-15' }).blocked).toBe(false);
    expect(seasonDuesGate({
      memberId: '2',
      tier: 'socio_vitalicio',
      outstandingBalance: 0,
      status: 'active',
    }, { today: '2026-12-15' }).blocked).toBe(false);
  });

  it('se puede apagar la regla', () => {
    expect(seasonDuesGate(familiar, {
      today: '2026-12-15',
      settings: { seasonBlocksUnpaidDues: false },
    }).blocked).toBe(false);
  });
});

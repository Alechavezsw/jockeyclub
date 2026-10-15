import { describe, expect, it } from 'vitest';
import { isCurrentMonthDuesUnpaid, piletaPayAccess, seasonDuesGate } from './seasonDuesGate';

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

describe('piletaPayAccess', () => {
  it('en temporada, mora no puede pagar pileta', () => {
    const access = piletaPayAccess(familiar, { today: '2026-12-15' });
    expect(access.canPay).toBe(false);
    expect(access.label).toMatch(/no puede pagar pileta/i);
  });

  it('después del 10, con saldo, no paga pileta hasta regularizar', () => {
    const access = piletaPayAccess(familiar, { today: '2026-10-14' });
    expect(access.canPay).toBe(false);
    expect(access.detail).toMatch(/mora/i);
  });

  it('con deuda de un mes anterior no paga pileta aunque aún no sea el 10', () => {
    const access = piletaPayAccess({
      ...familiar,
      nextDueDate: '2026-09-10',
    }, { today: '2026-10-05' });
    expect(access.canPay).toBe(false);
  });

  it('al día puede pagar pileta', () => {
    const access = piletaPayAccess({
      ...familiar,
      outstandingBalance: 0,
      lastPaymentDate: '2026-10-01',
      nextDueDate: '2026-11-10',
      status: 'active',
    }, { today: '2026-10-14' });
    expect(access.canPay).toBe(true);
    expect(access.label).toMatch(/puede pagar pileta/i);
  });

  it('suspendido no puede pagar pileta', () => {
    const access = piletaPayAccess({ ...familiar, status: 'suspended' }, { today: '2026-10-14' });
    expect(access.canPay).toBe(false);
  });
});

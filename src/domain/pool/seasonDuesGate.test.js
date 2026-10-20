import { describe, expect, it } from 'vitest';
import { accountHolderOf, isCurrentMonthDuesUnpaid, piletaPayAccess, seasonDuesGate } from './seasonDuesGate';

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
    expect(seasonDuesGate({
      memberId: '8377',
      tier: 'comision',
      cuotaCategories: ['COMISION'],
      outstandingBalance: 1466000,
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

describe('adherente: la mora es la del titular', () => {
  const titular = { ...familiar, memberId: '1001' };
  const adherente = {
    memberId: '1002',
    name: 'Luis Pérez',
    status: 'active',
    tier: 'socio_familiar',
    familyPrincipalNumber: '1001',
    outstandingBalance: 0,
  };
  const members = [titular, adherente];

  it('el titular en mora bloquea la sede a todo el grupo, en temporada', () => {
    const gate = seasonDuesGate(adherente, { today: '2026-12-15', members });
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toMatch(/titular/i);
  });

  it('el adherente no puede pagar pileta si el titular está en mora', () => {
    const access = piletaPayAccess(adherente, { today: '2026-10-14', members });
    expect(access.canPay).toBe(false);
    expect(access.detail).toMatch(/titular/i);
  });

  it('con el titular al día, el adherente entra y paga', () => {
    const alDia = {
      ...titular,
      outstandingBalance: 0,
      lastPaymentDate: '2026-12-10',
      nextDueDate: '2027-01-10',
    };
    expect(seasonDuesGate(adherente, { today: '2026-12-15', members: [alDia, adherente] }).blocked).toBe(false);
    expect(piletaPayAccess(adherente, { today: '2026-12-15', members: [alDia, adherente] }).canPay).toBe(true);
  });

  it('si el titular no está en la lista, no se inventa una mora', () => {
    expect(accountHolderOf(adherente, [adherente])).toBe(adherente);
    expect(seasonDuesGate(adherente, { today: '2026-12-15', members: [adherente] }).blocked).toBe(false);
  });

  it('un titular se evalúa a sí mismo', () => {
    expect(accountHolderOf(titular, members)).toBe(titular);
  });
});

describe('AMET vence el 18', () => {
  const amet = {
    memberId: '1004',
    name: 'Julia Rivas',
    status: 'active',
    tier: 'socio_individual_amet',
    outstandingBalance: 0,
    lastPaymentDate: '2026-11-18',
    nextDueDate: '2026-12-18',
  };

  it('entre el 10 y el 17 no está en mora', () => {
    expect(isCurrentMonthDuesUnpaid(amet, '2026-12-15')).toBe(false);
    expect(seasonDuesGate(amet, { today: '2026-12-15' }).blocked).toBe(false);
  });

  it('desde el 18 sin pagar, sí', () => {
    expect(isCurrentMonthDuesUnpaid(amet, '2026-12-19')).toBe(true);
    expect(seasonDuesGate(amet, { today: '2026-12-19' }).blocked).toBe(true);
  });
});

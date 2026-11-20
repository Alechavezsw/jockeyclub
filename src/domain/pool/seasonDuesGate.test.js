import { describe, expect, it } from 'vitest';
import {
  accessDuesDebt,
  accountHolderOf,
  clubEntryGate,
  hasPriorMonthDuesDebt,
  isCurrentMonthDuesUnpaid,
  piletaPayAccess,
  seasonDuesGate,
} from './seasonDuesGate';

const familiar = {
  memberId: '1',
  name: 'Ana Pérez',
  status: 'active',
  tier: 'socio_familiar',
  outstandingBalance: 70000,
  nextDueDate: '2026-12-10',
};

describe('seasonDuesGate', () => {
  it('el día 10 todavía no corta, aunque deba', () => {
    expect(isCurrentMonthDuesUnpaid(familiar, '2026-12-09')).toBe(false);
    expect(isCurrentMonthDuesUnpaid(familiar, '2026-12-10')).toBe(false);
    expect(seasonDuesGate(familiar, { today: '2026-12-10' }).blocked).toBe(false);
  });

  it('en temporada, desde el 11, mora bloquea sede y pileta', () => {
    const gate = seasonDuesGate(familiar, { today: '2026-12-11' });
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

  it('antes del 10, con solo la cuota del mes en curso, no está en mora de pileta', () => {
    const access = piletaPayAccess({
      ...familiar,
      outstandingBalance: 70000,
      nextDueDate: '2026-11-10',
      lastPaymentDate: '2026-10-10',
    }, { today: '2026-11-09' });
    expect(access.canPay).toBe(true);
    expect(access.mora).toBe(false);
    expect(access.detail).not.toMatch(/mora/i);
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

describe('clubEntryGate', () => {
  it('con deuda de meses anteriores no ingresa', () => {
    const gate = clubEntryGate({
      ...familiar,
      nextDueDate: '2026-09-10',
      outstandingBalance: 140000,
    }, { today: '2026-10-15' });
    expect(gate.blocked).toBe(true);
    expect(gate.hasDebt).toBe(true);
    expect(gate.title).toMatch(/DEUDA/i);
  });

  it('si solo debe el mes corriente (vencido) sí ingresa', () => {
    const gate = clubEntryGate({
      ...familiar,
      outstandingBalance: 70000,
      nextDueDate: '2026-10-10',
      lastPaymentDate: '2026-09-10',
    }, { today: '2026-10-15' });
    expect(gate.blocked).toBe(false);
    expect(gate.hasDebt).toBe(false);
    expect(gate.currentMonthOnly).toBe(true);
  });

  it('en temporada, desde el 11 la mora del mes corriente cierra la sede', () => {
    const gate = clubEntryGate({
      ...familiar,
      outstandingBalance: 70000,
      nextDueDate: '2026-12-10',
    }, { today: '2026-12-15' });
    expect(gate.blocked).toBe(true);
    expect(gate.title).toMatch(/MORA/i);
    expect(gate.season.blocked).toBe(true);
    expect(gate.currentMonthOnly).toBe(true);
  });

  it('en temporada, el día 10 con cuota del mes aún puede ingresar a la sede', () => {
    const gate = clubEntryGate({
      ...familiar,
      outstandingBalance: 70000,
      nextDueDate: '2026-12-10',
    }, { today: '2026-12-10' });
    expect(gate.blocked).toBe(false);
    expect(gate.season.blocked).toBe(false);
  });

  it('al día ingresa', () => {
    const gate = clubEntryGate({
      ...familiar,
      outstandingBalance: 0,
      lastPaymentDate: '2026-10-10',
      nextDueDate: '2026-11-10',
    }, { today: '2026-10-15' });
    expect(gate.blocked).toBe(false);
    expect(gate.hasDebt).toBe(false);
  });

  it('exento ingresa aunque el saldo esté sucio', () => {
    expect(clubEntryGate({
      memberId: '8377',
      tier: 'comision',
      cuotaCategories: ['COMISION'],
      outstandingBalance: 1466000,
      status: 'active',
    }, { today: '2026-10-15' }).blocked).toBe(false);
  });
});

describe('hasPriorMonthDuesDebt', () => {
  it('mes corriente solo no es prior', () => {
    expect(hasPriorMonthDuesDebt({
      ...familiar,
      nextDueDate: '2026-11-10',
      outstandingBalance: 70000,
    }, '2026-11-18')).toBe(false);
  });

  it('nextDue de un mes anterior sí es prior', () => {
    expect(hasPriorMonthDuesDebt({
      ...familiar,
      nextDueDate: '2026-09-10',
      outstandingBalance: 140000,
    }, '2026-11-18')).toBe(true);
  });
});

describe('accessDuesDebt', () => {
  it('exentos no tienen deuda aunque el saldo esté sucio', () => {
    expect(accessDuesDebt({
      memberId: '8377',
      tier: 'comision',
      cuotaCategories: ['COMISION'],
      outstandingBalance: 1466000,
      status: 'active',
    }, [], { today: '2026-10-15' }).hasDebt).toBe(false);
  });

  it('saldo a favor y unpaidCapital 0 son al día', () => {
    expect(accessDuesDebt({
      memberId: '1',
      tier: 'socio_individual',
      outstandingBalance: -5000,
      unpaidCapital: 0,
    }, [], { today: '2026-10-15' }).hasDebt).toBe(false);
  });

  it('adherente hereda deuda prior del titular', () => {
    const titular = {
      ...familiar,
      memberId: '1001',
      nextDueDate: '2026-09-10',
      outstandingBalance: 140000,
    };
    const adherente = {
      memberId: '1002',
      tier: 'socio_familiar',
      familyPrincipalNumber: '1001',
      outstandingBalance: 0,
    };
    const debt = accessDuesDebt(adherente, [titular, adherente], { today: '2026-10-15' });
    expect(debt.hasDebt).toBe(true);
    expect(debt.owed).toBe(140000);
    expect(debt.holder).toBe(titular);
  });

  it('solo mes corriente no bloquea (hasDebt false)', () => {
    const debt = accessDuesDebt({
      ...familiar,
      nextDueDate: '2026-10-10',
      outstandingBalance: 70000,
    }, [], { today: '2026-10-20' });
    expect(debt.hasDebt).toBe(false);
    expect(debt.currentMonthOnly).toBe(true);
    expect(debt.owed).toBe(70000);
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

  it('el día 18 todavía puede pagar al día; desde el 19 sin pagar, sí mora', () => {
    expect(isCurrentMonthDuesUnpaid(amet, '2026-12-18')).toBe(false);
    expect(isCurrentMonthDuesUnpaid(amet, '2026-12-19')).toBe(true);
    expect(seasonDuesGate(amet, { today: '2026-12-19' }).blocked).toBe(true);
  });
});

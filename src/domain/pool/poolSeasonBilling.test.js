import { describe, expect, it } from 'vitest';
import {
  listPoolSeasonHousehold,
  memberHasPoolSeasonPass,
  quoteHouseholdPoolSeason,
  quotePersonPoolSeason,
} from './poolSeasonBilling';
import { mergePoolSettings } from './poolAccess';

const settings = mergePoolSettings({});

describe('mergePoolSettings temporada', () => {
  it('default $90.000, máx 4, menores de 4 libres', () => {
    expect(settings.memberSeasonFee).toBe(90000);
    expect(settings.memberDayFee).toBe(90000);
    expect(settings.maxPayingPerHousehold).toBe(4);
    expect(settings.freeUnderAgeYears).toBe(4);
  });

  it('migra el viejo canon diario $5.000 a temporada $90.000', () => {
    expect(mergePoolSettings({ memberDayFee: 5000 }).memberSeasonFee).toBe(90000);
  });
});

describe('quoteHouseholdPoolSeason', () => {
  const titular = {
    memberId: '100',
    name: 'Ana Titular',
    tier: 'socio_familiar',
    birthDate: '1980-01-15',
    status: 'active',
  };
  const adulto = {
    memberId: '101',
    name: 'Luis Adulto',
    tier: 'socio_familiar',
    familyPrincipalNumber: '100',
    birthDate: '2005-06-01',
    status: 'active',
  };
  const chico = {
    memberId: '102',
    name: 'Mia Chica',
    tier: 'socio_familiar',
    familyPrincipalNumber: '100',
    birthDate: '2018-03-10',
    status: 'active',
  };
  const bebe = {
    memberId: '103',
    name: 'Tomi Bebe',
    tier: 'socio_familiar',
    familyPrincipalNumber: '100',
    birthDate: '2024-08-01',
    status: 'active',
  };
  const quinto = {
    memberId: '104',
    name: 'Quinto',
    tier: 'socio_familiar',
    familyPrincipalNumber: '100',
    birthDate: '2010-01-01',
    status: 'active',
  };

  it('arma el hogar titular + integrantes', () => {
    const people = listPoolSeasonHousehold(titular, [titular, adulto, bebe]);
    expect(people.map((p) => p.memberId)).toEqual(['100', '101', '103']);
  });

  it('cobra $90.000 por persona pagadora; menor de 4 gratis', () => {
    const quote = quoteHouseholdPoolSeason(titular, {
      today: '2026-12-15',
      settings,
      members: [titular, adulto, chico, bebe],
    });
    expect(quote.open).toBe('2026-12-01');
    expect(quote.close).toBe('2027-03-31');
    expect(quote.feePerPerson).toBe(90000);
    const byId = Object.fromEntries(quote.people.map((p) => [p.memberId, p]));
    expect(byId['100'].amount).toBe(90000);
    expect(byId['101'].amount).toBe(90000);
    expect(byId['102'].amount).toBe(90000);
    expect(byId['103'].amount).toBe(0);
    expect(byId['103'].reason).toMatch(/menor/i);
    expect(quote.payingCount).toBe(3);
    expect(quote.total).toBe(270000);
  });

  it('tope 4 personas que pagan; la 5.ª queda libre', () => {
    const quote = quoteHouseholdPoolSeason(titular, {
      today: '2026-12-15',
      settings,
      members: [titular, adulto, chico, quinto, {
        memberId: '105',
        name: 'Sexto adulto',
        familyPrincipalNumber: '100',
        birthDate: '1990-01-01',
      }],
    });
    const payers = quote.people.filter((p) => p.pays);
    const freeCap = quote.people.filter((p) => /tope/i.test(p.reason));
    expect(payers).toHaveLength(4);
    expect(freeCap.length).toBeGreaterThanOrEqual(1);
    expect(quote.total).toBe(360000);
  });

  it('si ya pagó la temporada, el importe a cobrar es 0', () => {
    const accesses = [{
      kind: 'member',
      memberId: '100',
      date: '2026-12-02',
      status: 'active',
      payment: { amount: 90000, scope: 'season', concept: 'Canon pileta temporada' },
    }];
    expect(memberHasPoolSeasonPass(accesses, '100', '2026-12-15', settings)).toBe(true);
    const person = quotePersonPoolSeason(titular, {
      today: '2026-12-15',
      settings,
      members: [titular],
      accesses,
    });
    expect(person.amount).toBe(0);
    expect(person.alreadyPaid).toBe(true);
  });

  it('no duplica miembros del hogar', () => {
    // Even if member appears multiple times in the list, only count once
    const quote = quoteHouseholdPoolSeason(titular, {
      today: '2026-12-15',
      settings,
      members: [titular, adulto, titular, adulto, titular], // duplicates
    });
    const ids = quote.people.map(p => p.memberId);
    // Should only have 2 unique members
    expect(ids).toEqual(['100', '101']);
    expect(quote.payingCount).toBe(2);
    expect(quote.total).toBe(180000);
  });

  it('vitalicio paga canon de pileta (no exento)', () => {
    const vitalicio = {
      memberId: '200',
      name: 'Vitalicio Test',
      tier: 'socio_vitalicio',
      birthDate: '1950-01-01',
      status: 'active',
    };
    const quote = quoteHouseholdPoolSeason(vitalicio, {
      today: '2026-12-15',
      settings,
      members: [vitalicio],
    });
    // Vitalicio still pays pool season fee
    expect(quote.people[0].amount).toBe(90000);
    expect(quote.people[0].pays).toBe(true);
  });

  it('fundador paga canon de pileta (no exento)', () => {
    const fundador = {
      memberId: '201',
      name: 'Fundador Test',
      tier: 'socio_fundador',
      birthDate: '1945-01-01',
      status: 'active',
    };
    const quote = quoteHouseholdPoolSeason(fundador, {
      today: '2026-12-15',
      settings,
      members: [fundador],
    });
    // Fundador still pays pool season fee
    expect(quote.people[0].amount).toBe(90000);
    expect(quote.people[0].pays).toBe(true);
  });

  it('comisión paga canon de pileta (no exento)', () => {
    const comision = {
      memberId: '202',
      name: 'Comisión Test',
      tier: 'comision',
      birthDate: '1960-01-01',
      status: 'active',
    };
    const quote = quoteHouseholdPoolSeason(comision, {
      today: '2026-12-15',
      settings,
      members: [comision],
    });
    // Comisión still pays pool season fee
    expect(quote.people[0].amount).toBe(90000);
    expect(quote.people[0].pays).toBe(true);
  });

  it('$0 attendance no cuenta como pago de temporada', () => {
    const accesses = [{
      kind: 'member',
      memberId: '100',
      date: '2026-12-02',
      status: 'active',
      source: 'attendance',
      payment: { amount: 0, method: 'asistencia', scope: 'attendance', concept: 'Asistencia pileta' },
    }];
    // Attendance should NOT count as a season pass
    expect(memberHasPoolSeasonPass(accesses, '100', '2026-12-15', settings)).toBe(false);
    const person = quotePersonPoolSeason(titular, {
      today: '2026-12-15',
      settings,
      members: [titular],
      accesses,
    });
    // Should still owe the full amount
    expect(person.amount).toBe(90000);
    expect(person.alreadyPaid).toBe(false);
    expect(person.pays).toBe(true);
  });
});

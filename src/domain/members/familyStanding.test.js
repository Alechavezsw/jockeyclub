import { describe, expect, it } from 'vitest';
import {
  familyChildStanding,
  familyDependentShouldLeave,
  hasRegularidadForYear,
  personAgeOn,
  upsertRegularidad,
} from './familyStanding';

const TODAY = new Date('2026-10-20T15:00:00.000Z');

describe('familyStanding', () => {
  it('deja en el grupo al menor de 19', () => {
    const kid = { birthDate: '2010-03-01' };
    expect(personAgeOn(kid.birthDate, TODAY)).toBe(16);
    expect(familyChildStanding(kid, TODAY).kind).toBe('ok');
    expect(familyDependentShouldLeave(kid, TODAY)).toBe(false);
  });

  it('saca al de 19–25 si no hay certificado de regularidad', () => {
    const hijo = { birthDate: '2005-01-01' };
    expect(personAgeOn(hijo.birthDate, TODAY)).toBe(21);
    expect(familyChildStanding(hijo, TODAY)).toMatchObject({
      kind: 'leave',
      reason: 'regularidad',
    });
  });

  it('en octubre pide inicio y fin de año', () => {
    const startOnly = upsertRegularidad({ birthDate: '2005-01-01' }, {
      year: 2026,
      term: 'start',
      present: true,
    });
    expect(hasRegularidadForYear(startOnly, TODAY)).toBe(false);
    const both = upsertRegularidad(startOnly, { year: 2026, term: 'end', present: true });
    expect(hasRegularidadForYear(both, TODAY)).toBe(true);
    expect(familyChildStanding(both, TODAY).kind).toBe('student');
  });

  it('en marzo alcanza con el certificado de inicio', () => {
    const startOnly = upsertRegularidad({ birthDate: '2005-01-01' }, {
      year: 2026,
      term: 'start',
      present: true,
    });
    expect(hasRegularidadForYear(startOnly, new Date('2026-03-12T12:00:00'))).toBe(true);
  });

  it('a los 26 sale aunque tenga certificado', () => {
    const both = upsertRegularidad({ birthDate: '2000-01-01' }, {
      year: 2026,
      term: 'start',
      present: true,
    });
    const withEnd = upsertRegularidad(both, { year: 2026, term: 'end', present: true });
    expect(familyChildStanding(withEnd, TODAY).kind).toBe('leave');
    expect(familyChildStanding(withEnd, TODAY).reason).toBe('age26');
  });
});

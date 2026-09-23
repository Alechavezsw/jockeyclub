import { describe, expect, it } from 'vitest';
import { formatJoinYear, membershipCaption, prettyMembershipName, yearsOnClub } from './membership';

describe('membership display', () => {
  it('limpia el slug de categoría', () => {
    expect(prettyMembershipName('SOCIO INDIVIDUAL')).toBe('Socio Individual');
    expect(prettyMembershipName('socio_individual')).toBe('Socio Individual');
    expect(prettyMembershipName('')).toBe('Socio');
  });

  it('calcula antigüedad desde el alta, no desde yearsActive en 0', () => {
    const today = new Date('2026-09-22T12:00:00');
    expect(yearsOnClub({ joinDate: '2021-04-10', yearsActive: 0 }, today)).toBe(5);
    expect(yearsOnClub({ joinDate: '2026-04-10', yearsActive: 9 }, today)).toBe(0);
    expect(yearsOnClub({ yearsActive: 5 }, today)).toBe(5);
  });

  it('arma el pie de la ficha', () => {
    const today = new Date('2026-09-22T12:00:00');
    expect(membershipCaption({ joinDate: '2021-04-10' }, today)).toBe('5 años en el club');
    expect(formatJoinYear('2021-04-10')).toBe('2021');
    expect(membershipCaption({})).toBe('Categoría de socio');
  });
});

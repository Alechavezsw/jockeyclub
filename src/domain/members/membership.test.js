import { describe, expect, it } from 'vitest';
import {
  effectiveJoinDate,
  formatJoinYear,
  membershipCaption,
  membershipTenureLabel,
  prettyMembershipName,
  shouldOfferVitalicio,
  yearsOnClub,
} from './membership';

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

  it('ignora el placeholder 1900 y no inventa 126 años con nacimiento en 1986', () => {
    const today = new Date('2026-11-07T12:00:00');
    const member = {
      joinDate: '1900-01-01',
      birthDate: '1986-02-17',
      yearsActive: 126,
    };
    expect(effectiveJoinDate(member)).toBeNull();
    expect(yearsOnClub(member, today)).toBe(0);
    expect(membershipTenureLabel(member, today)).toBeNull();
    expect(formatJoinYear('1900-01-01', { birthDate: '1986-02-17' })).toBeNull();
  });

  it('arma el pie de la ficha', () => {
    const today = new Date('2026-09-22T12:00:00');
    expect(membershipCaption({ joinDate: '2021-04-10' }, today)).toBe('5 años en el club');
    expect(formatJoinYear('2021-04-10')).toBe('2021');
    expect(membershipCaption({})).toBe('Categoría de socio');
  });

  it('avisa el paso a vitalicio a los 25 años de club', () => {
    const today = new Date('2026-10-20T12:00:00');
    expect(shouldOfferVitalicio({
      memberId: '1',
      status: 'active',
      tier: 'socio_individual',
      joinDate: '2001-04-10',
    }, today)).toBe(true);
    expect(shouldOfferVitalicio({
      memberId: '2',
      status: 'active',
      tier: 'socio_vitalicio',
      cuotaCategories: ['SOCIO (Vitalicio)'],
      joinDate: '1990-01-01',
    }, today)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { searchSession } from './sessionSearch';

const tabs = ['members', 'dues', 'accounting', 'staff'];
const accountingTabs = ['expenses', 'fixed_expenses', 'member_discounts', 'suppliers', 'cash'];

describe('searchSession', () => {
  it('parte la frase y encuentra secciones y herramientas', () => {
    const titles = searchSession({ query: 'gastos socios', tabs, accountingTabs }).map((row) => row.title);
    expect(titles).toContain('Gastos');
    expect(titles).toContain('Socios');
    expect(titles).toContain('Descuentos extras');
  });

  it('no mezcla socios cuando la frase no es un nombre', () => {
    const rows = searchSession({
      query: 'gastos socios',
      tabs,
      accountingTabs,
      members: [{ memberId: '1', name: 'Manuel Alejandro Chavez' }],
    });
    expect(rows.some((row) => row.kind === 'member')).toBe(false);
  });

  it('encuentra a un socio por nombre parcial', () => {
    const rows = searchSession({
      query: 'manuel chavez',
      tabs,
      accountingTabs,
      members: [{ memberId: '9', name: 'Manuel Alejandro Chavez' }],
    });
    expect(rows[0]?.path).toBe('/panel/members/9');
  });
});

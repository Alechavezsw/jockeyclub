import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operationalListFilter } from '../members/operationalVisibility';
import {
  CLUB_MAIL_PAGE,
  clubMailStaffAllowed,
  collectClubMailReady,
  operationalAudienceFilter,
  takeClubMailTarget,
} from '../../../supabase/functions/_shared/clubMailAudience.ts';

const TODAY = '2026-11-23';

function row(partial) {
  return {
    member_number: partial.memberNumber,
    email: partial.email,
    status: partial.status,
    meta: partial.meta || {},
  };
}

describe('destinatarios de send-club-mail', () => {
  const roster = [
    row({ memberNumber: '1', email: 'titular@club.com', status: 'active' }),
    row({
      memberNumber: '2',
      email: 'familiar@club.com',
      status: 'active',
      meta: { familyPrincipalNumber: '1' },
    }),
    row({
      memberNumber: '3',
      email: 'futuro@club.com',
      status: 'inactive',
      meta: { bajaFecha: '2026-12-01' },
    }),
    row({
      memberNumber: '4',
      email: 'vigente@club.com',
      status: 'active',
      meta: { bajaFecha: TODAY },
    }),
    row({
      memberNumber: '5',
      email: 'inactivo@club.com',
      status: 'inactive',
      meta: { bajaFecha: '2026-10-01' },
    }),
    row({ memberNumber: '6', email: 'Titular@club.com', status: 'active' }),
    row({ memberNumber: '7', email: '', status: 'active' }),
    row({ memberNumber: '8', email: 'alias@lila-jockey.local', status: 'active' }),
    row({ memberNumber: '9', email: 'interno@jockeyclubsj.com', status: 'active' }),
    row({ memberNumber: '10', email: 'laura aldaylaura45@gmail.com', status: 'active' }),
    row({ memberNumber: '11', email: 'roto@gmail.com@gmail.com', status: 'active' }),
  ];

  it('elige titular, familiar y baja futura, y deja afuera la baja vigente', () => {
    const seen = new Set();
    const chosen = roster.flatMap((item) => {
      const target = takeClubMailTarget(item, seen, TODAY);
      return target ? [target.memberNumber] : [];
    });
    expect(chosen).toEqual(['1', '2', '3']);
  });

  it('un correo repetido sale una sola vez y el ausente no entra', () => {
    const { ready } = collectClubMailReady(roster, { today: TODAY });
    expect(ready.map((item) => item.email)).toEqual([
      'titular@club.com',
      'familiar@club.com',
      'futuro@club.com',
    ]);
    expect(ready.some((item) => item.memberNumber === '6')).toBe(false);
    expect(ready.some((item) => item.memberNumber === '7')).toBe(false);
    expect(ready.some((item) => item.memberNumber === '10')).toBe(false);
    expect(ready.some((item) => item.memberNumber === '11')).toBe(false);
  });

  it('el filtro PostgREST cita el patrón y pagina de a 500', () => {
    const filter = operationalAudienceFilter(TODAY);
    expect(filter).toBe(operationalListFilter(new Date('2026-11-23T15:00:00-03:00')));
    expect(filter).toContain('match."');
    expect(filter).toContain('not.match."');
    expect(CLUB_MAIL_PAGE).toBe(500);
  });

  it('la página siguiente no repite los correos del lote anterior', () => {
    const rows = Array.from({ length: 5 }, (_, index) => row({
      memberNumber: String(index + 1),
      email: `socio${index + 1}@club.com`,
      status: 'active',
    }));
    const first = collectClubMailReady(rows, { cap: 2, today: TODAY });
    expect(first.ready).toHaveLength(2);
    expect(first.more).toBe(true);
    const second = collectClubMailReady(rows, { seen: first.seen, cap: 2, today: TODAY });
    expect(second.ready.map((item) => item.memberNumber)).toEqual(['3', '4']);
    const again = second.ready.map((item) => item.email);
    expect(again.some((email) => first.ready.some((item) => item.email === email))).toBe(false);
  });

  it('un socio sin permiso de personal no puede disparar el envío', () => {
    expect(clubMailStaffAllowed(false)).toBe(false);
    expect(clubMailStaffAllowed(null)).toBe(false);
    expect(clubMailStaffAllowed(true)).toBe(true);
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/functions/send-club-mail/index.ts'),
      'utf8',
    );
    expect(source).toContain('has_staff_access');
    expect(source).toContain('clubMailAuthDecision');
    expect(source).toContain('Revisá los destinatarios antes de enviar.');
  });
});

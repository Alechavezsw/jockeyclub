import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clubMailAuthDecision,
  clubMailNumberKeys,
  explainClubMailMember,
} from '../../../supabase/functions/_shared/clubMailAudience.ts';
import {
  CLUB_MAIL_NUMBER_MISS,
  clubMailMemberHits,
  clubMailMemberQuery,
  clubMailSearchMissMessage,
  maskClubMailAddress,
  presentMemberPicker,
  profileEmailDisplay,
  visibleMailboxAddress,
} from './clubMailSearch';

const here = dirname(fileURLToPath(import.meta.url));

describe('búsqueda de socio en comunicados', () => {
  it('trata 8770, 08770 y 008770 como el mismo número', () => {
    for (const typed of ['8770', '08770', '008770']) {
      const parsed = clubMailMemberQuery(typed);
      expect(parsed.kind).toBe('number');
      expect(parsed.canonical).toBe('8770');
      expect(clubMailNumberKeys(typed)).toEqual(expect.arrayContaining(['8770', '08770', '008770']));
    }
    expect(clubMailNumberKeys('008770')).not.toContain('18770');
  });

  it('no normaliza una entrada vacía ni un valor alfanumérico', () => {
    expect(clubMailMemberQuery('')).toEqual({ kind: 'empty', text: '', canonical: '' });
    expect(clubMailMemberQuery('   ')).toEqual({ kind: 'empty', text: '', canonical: '' });
    expect(clubMailSearchMissMessage('')).toBe('');
    const mixed = clubMailMemberQuery('08770a');
    expect(mixed).toEqual({ kind: 'text', text: '08770a', canonical: '08770a' });
    expect(clubMailNumberKeys('08770a')).toEqual([]);
    expect(clubMailSearchMissMessage(mixed)).toBe('No se encontraron socios con ese criterio.');
  });

  it('avisa cuando el número no existe', () => {
    expect(clubMailSearchMissMessage('999999')).toBe(CLUB_MAIL_NUMBER_MISS);
    expect(clubMailSearchMissMessage('000999999')).toBe(CLUB_MAIL_NUMBER_MISS);
  });

  it('un número con ceros es el mismo socio y un recorte no lo es', () => {
    const members = [
      { memberId: '8770', name: 'Sergio Castellino', phone: '2644000000' },
      { memberId: '10012', name: 'Mauricio Villarreal', phone: '2645877065' },
    ];
    for (const typed of ['8770', '08770', '008770']) {
      expect(clubMailMemberHits(members, typed).map((row) => row.memberId)).toEqual(['8770']);
    }
    expect(clubMailMemberHits(members, '877')).toEqual([]);
    expect(clubMailSearchMissMessage('877')).toBe(CLUB_MAIL_NUMBER_MISS);
    expect(clubMailMemberHits(members, '8770').some((row) => row.phone === '2645877065')).toBe(false);
  });

  it('08770a no identifica al socio 8770 y el texto queda igual', () => {
    const members = [
      { memberId: '8770', name: 'Sergio Castellino' },
      { memberId: '08770a', name: 'Otra ficha' },
    ];
    expect(clubMailMemberQuery('08770a')).toEqual({ kind: 'text', text: '08770a', canonical: '08770a' });
    expect(clubMailMemberHits(members, '08770a').map((row) => row.memberId)).toEqual(['08770a']);
    expect(clubMailMemberHits(members, '08770a').some((row) => row.memberId === '8770')).toBe(false);
    expect(clubMailMemberHits(members, 'castellino').map((row) => row.memberId)).toEqual(['8770']);
  });

  it('un identificador con letras se busca tal cual', () => {
    const members = [{ memberId: 'A12', name: 'Ana' }];
    expect(clubMailMemberHits(members, 'A12').map((row) => row.memberId)).toEqual(['A12']);
    expect(clubMailMemberHits(members, 'a12').map((row) => row.memberId)).toEqual(['A12']);
    expect(clubMailMemberHits(members, '12')).toEqual([]);
    expect(clubMailSearchMissMessage('12')).toBe(CLUB_MAIL_NUMBER_MISS);
  });
});

describe('privacidad del correo en Un socio', () => {
  const member = {
    memberId: '8770',
    name: 'Sergio Castellino',
    documentNumber: '10530927',
    email: 'sergio.castellino@example.com',
    phone: '2644000000',
  };

  it('muestra el correo enmascarado y no la dirección completa', () => {
    const card = presentMemberPicker(member);
    expect(card.maskedEmail).toBe('s•••@example.com');
    expect(card.detail).toContain('s•••@example.com');
    expect(card.detail).not.toContain('sergio.castellino@example.com');
    expect(card.hasDeliverableMail).toBe(true);
    expect(maskClubMailAddress('10530927@jockeyclubsj.com')).toBe('1•••@jockeyclubsj.com');
    expect(presentMemberPicker({ ...member, email: '10530927@jockeyclubsj.com' }).hasDeliverableMail).toBe(false);
  });

  it('el redactor no imprime la dirección guardada', () => {
    const source = readFileSync(join(here, '../../components/admin/NoticeComposeCard.jsx'), 'utf8');
    expect(source).not.toContain('.email');
    expect(source).toContain('presentMemberPicker');
    expect(source).toContain('clubMailMemberHits');
    expect(source).not.toContain("memberNumber || '').replace(/\\D/g, '')");
  });

  it('la respuesta de búsqueda enmascara y un usuario sin permiso no consulta', () => {
    const explained = explainClubMailMember({
      member_number: '8770',
      full_name: 'Sergio Castellino',
      email: 'sergio.castellino@example.com',
      status: 'active',
    });
    expect(explained.maskedEmail).toBe('s•••@example.com');
    expect(explained).not.toHaveProperty('email');
    expect(Object.keys(explained).toSorted()).toEqual(['alsoHeldBy', 'maskedEmail', 'memberNumber', 'name', 'reason']);
    expect(JSON.stringify(explained)).not.toContain('sergio.castellino@example.com');
    expect(clubMailAuthDecision({ authorization: '', staff: true }).status).toBe(401);
    expect(clubMailAuthDecision({ authorization: 'Bearer token', staff: false }).status).toBe(403);
    expect(clubMailAuthDecision({ authorization: 'Bearer token', staff: true, staffError: true }).status).toBe(403);
    expect(clubMailAuthDecision({ authorization: 'Bearer token', staff: true }).status).toBe(200);
  });

  it('la bandeja enmascara el correo y la ficha lo muestra entero solo al propio socio', () => {
    expect(visibleMailboxAddress('sergio.castellino@example.com')).toBe('s•••@example.com');
    expect(visibleMailboxAddress('Sergio Castellino')).toBe('Sergio Castellino');
    expect(visibleMailboxAddress('')).toBe('Sin remitente');
    const staff = profileEmailDisplay('sergio.castellino@example.com', { selfService: false });
    expect(staff.text).toBe('s•••@example.com');
    expect(staff.href).toBe('');
    expect(staff.text).not.toContain('sergio.castellino@');
    const own = profileEmailDisplay('sergio.castellino@example.com', { selfService: true });
    expect(own.text).toBe('sergio.castellino@example.com');
    expect(own.href).toBe('mailto:sergio.castellino@example.com');
    const inbox = readFileSync(join(here, '../../components/admin/MessagingTab.jsx'), 'utf8');
    expect(inbox).toContain('visibleMailboxAddress(thread.from)');
    expect(inbox).not.toContain('{thread.from}');
    const profile = readFileSync(join(here, '../../components/admin/MemberProfilePanel.jsx'), 'utf8');
    expect(profile).toContain('profileEmailDisplay');
    expect(profile).toContain('value={editForm[key] || \'\'}');
  });
});

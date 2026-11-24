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
  clubMailMemberQuery,
  clubMailSearchMissMessage,
  maskClubMailAddress,
  presentMemberPicker,
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
  });

  it('la respuesta de búsqueda enmascara y un usuario sin permiso no consulta', () => {
    const explained = explainClubMailMember({
      member_number: '8770',
      full_name: 'Sergio Castellino',
      email: 'sergio.castellino@example.com',
      status: 'active',
    });
    expect(explained.maskedEmail).toBe('s•••@example.com');
    expect(JSON.stringify(explained)).not.toContain('sergio.castellino@example.com');
    expect(clubMailAuthDecision({ authorization: '', staff: true }).status).toBe(401);
    expect(clubMailAuthDecision({ authorization: 'Bearer token', staff: false }).status).toBe(403);
    expect(clubMailAuthDecision({ authorization: 'Bearer token', staff: true, staffError: true }).status).toBe(403);
  });
});

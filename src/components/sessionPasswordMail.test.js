import { describe, expect, it } from 'vitest';
import { mailTargetForUser } from './SessionStatusBar';

describe('mailTargetForUser', () => {
  it('prioriza mail de contacto real', () => {
    expect(mailTargetForUser({
      email: 'ale@jockey.sj',
      contactEmail: 'ale.real@gmail.com',
    })).toBe('ale.real@gmail.com');
  });

  it('no manda a casillas institucionales (@jockey.sj)', () => {
    expect(mailTargetForUser({
      email: 'ale@jockey.sj',
      contactEmail: 'ale@jockey.sj',
    })).toBe('');
  });

  it('ignora contactos @lila-jockey y usa un login real', () => {
    expect(mailTargetForUser({
      email: 'socio@gmail.com',
      contactEmail: 'x@lila-jockey.test',
    })).toBe('socio@gmail.com');
  });

  it('sin mails válidos no inventa destino', () => {
    expect(mailTargetForUser({})).toBe('');
    expect(mailTargetForUser({ email: 'super.admin.jcsj@jockey.sj' })).toBe('');
  });
});

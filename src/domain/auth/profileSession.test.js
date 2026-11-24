import { describe, expect, it } from 'vitest';
import { PROFILE_SESSION_COLUMNS, profileSessionFields } from './profileSession';

describe('sesión de perfil', () => {
  it('no pide columnas que no existen en profiles', () => {
    const columns = PROFILE_SESSION_COLUMNS.split(',').map((column) => column.trim());
    expect(columns).not.toContain('username');
    expect(columns).not.toContain('contact_email');
    expect(columns).toContain('meta');
    expect(columns).toContain('full_name');
  });

  it('lee usuario y mail de contacto desde meta', () => {
    const fields = profileSessionFields({
      full_name: 'Secretaría',
      role: 'superadmin',
      document_number: '20111222',
      discipline_ids: ['tenis'],
      meta: { username: 'secretaria', contactEmail: 'secretaria@example.com' },
    });
    expect(fields.username).toBe('secretaria');
    expect(fields.contactEmail).toBe('secretaria@example.com');
    expect(fields.disciplineIds).toEqual(['tenis']);
  });

  it('no inventa usuario ni mail si meta no los tiene', () => {
    const fields = profileSessionFields({ full_name: 'Secretaría', meta: {} });
    expect(fields.username).toBeNull();
    expect(fields.contactEmail).toBeNull();
    expect(profileSessionFields(null).fullName).toBe('');
  });
});

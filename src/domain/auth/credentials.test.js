import { describe, it, expect } from 'vitest';
import {
  generateUsername,
  generatePassword,
  loginEmailFromUsername,
  buildCredentials,
  portalLoginFromEmail,
} from './credentials';

describe('credentials', () => {
  it('genera usuario a partir de nombre y documento', () => {
    expect(generateUsername({
      firstName: 'Martin Ezequiel',
      lastName: 'Robledo',
      documentNumber: '31004538',
    })).toBe('martin.robledo.4538');
  });

  it('genera contraseña editable y de longitud útil', () => {
    const a = generatePassword(10);
    const b = generatePassword(10);
    expect(a).toHaveLength(10);
    expect(b).toHaveLength(10);
    expect(a).not.toBe(b);
  });

  it('arma email de login institucional', () => {
    expect(loginEmailFromUsername('martin.robledo.4538')).toBe('martin.robledo.4538@jockey.sj');
  });

  it('buildCredentials incluye usuario, clave y email', () => {
    const creds = buildCredentials({ firstName: 'Ana', lastName: 'Pérez', documentNumber: '12345678' });
    expect(creds.username).toContain('ana');
    expect(creds.password.length).toBeGreaterThanOrEqual(8);
    expect(creds.email).toContain('@jockey.sj');
  });

  it('el acceso del socio usa su mail real', () => {
    const login = portalLoginFromEmail(' Alechavez@cosechacreativa.com.ar ');
    expect(login.username).toBe('alechavez@cosechacreativa.com.ar');
    expect(login.email).toBe('alechavez@cosechacreativa.com.ar');
    expect(login.password.length).toBeGreaterThanOrEqual(8);
    expect(portalLoginFromEmail('')).toBeNull();
  });
});

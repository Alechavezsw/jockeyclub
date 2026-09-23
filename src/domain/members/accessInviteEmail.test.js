import { describe, expect, it } from 'vitest';
import { accessInviteHtml, accessInviteSubject, accessInviteText, escapeInviteHtml, joinWelcomeHtml, joinWelcomeText } from './accessInviteEmail';

describe('accessInviteEmail', () => {
  const payload = {
    name: 'Ale Chavez',
    username: 'ale.chavez.8184',
    loginEmail: 'ale.chavez.8184@jockey.sj',
    password: 'Abc12345',
    portalUrl: 'https://club.example/',
  };

  it('arma asunto, texto y HTML con las credenciales', () => {
    expect(accessInviteSubject()).toContain('Jockey Club San Juan');
    const text = accessInviteText(payload);
    expect(text).toContain('Hola Ale Chavez');
    expect(text).toContain('ale.chavez.8184@jockey.sj');
    expect(text).toContain('Abc12345');
    const html = accessInviteHtml({ ...payload, logoUrl: 'https://club.example/logo-jockey-club.png' });
    expect(html).toContain('Entrar al portal');
    expect(html).toContain('#096755');
    expect(html).toContain('https://club.example/logo-jockey-club.png');
  });

  it('escapa HTML en nombre y clave', () => {
    expect(escapeInviteHtml('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
    const html = accessInviteHtml({
      ...payload,
      name: '<script>x</script>',
      password: 'a"b',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('a&quot;b');
  });

  it('la bienvenida no lleva usuario ni contraseña', () => {
    const text = joinWelcomeText({ name: 'Ale Chavez' });
    expect(text).toContain('Recibimos tu solicitud');
    expect(text).not.toContain('Contraseña');
    const html = joinWelcomeHtml({ name: 'Ale Chavez' });
    expect(html).toContain('todavía no es el alta');
    expect(html).not.toContain('Contraseña');
  });
});

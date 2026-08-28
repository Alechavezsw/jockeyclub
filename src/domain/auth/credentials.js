/** Generación de credenciales de portal (usuario + contraseña). */

const LOGIN_DOMAIN = 'jockey.sj';

const PASS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';

function stripDiacritics(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function slugifyUsernamePart(value = '') {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');
}

/** Usuario legible a partir de nombre/apellido/documento. */
export function generateUsername({ firstName = '', lastName = '', documentNumber = '' } = {}) {
  const first = slugifyUsernamePart(firstName).split('.')[0] || 'usuario';
  const last = slugifyUsernamePart(lastName).split('.')[0] || '';
  const docTail = String(documentNumber || '').replace(/\D/g, '').slice(-4);
  const base = [first, last].filter(Boolean).join('.');
  const withDoc = docTail ? `${base}.${docTail}` : base;
  const cleaned = withDoc.replace(/^\.+|\.+$/g, '') || `user.${Date.now().toString(36).slice(-4)}`;
  return cleaned.slice(0, 48);
}

/** Contraseña aleatoria segura (sin ambiguos 0/O/1/l). */
export function generatePassword(length = 10) {
  const size = Math.max(8, Math.min(32, Number(length) || 10));
  const bytes = new Uint32Array(size);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i += 1) bytes[i] = Math.floor(Math.random() * 1e9);
  }
  let out = '';
  for (let i = 0; i < size; i += 1) {
    out += PASS_ALPHABET[bytes[i] % PASS_ALPHABET.length];
  }
  return out;
}

export function loginEmailFromUsername(username = '') {
  const local = slugifyUsernamePart(username).replace(/\./g, '.') || 'usuario';
  return `${local}@${LOGIN_DOMAIN}`;
}

export function usernameFromEmail(email = '') {
  const local = String(email || '').split('@')[0] || '';
  return slugifyUsernamePart(local);
}

export function buildCredentials(input = {}) {
  const username = generateUsername(input);
  const password = generatePassword();
  return {
    username,
    password,
    email: loginEmailFromUsername(username),
  };
}

export { LOGIN_DOMAIN };

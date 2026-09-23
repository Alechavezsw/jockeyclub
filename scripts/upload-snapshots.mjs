/**
 * Sube los snapshots de src/data/seed/*.js al bucket privado `club-snapshots` de
 * Supabase Storage, como <nombre>.json con los mismos exports.
 *
 * La app ya no empaqueta esos archivos: en producción los baja del bucket con la sesión
 * del usuario (src/data/snapshots.js). Correr este script después de regenerarlos con los
 * `npm run import:*`, o la app va a seguir mostrando el corte anterior.
 *
 * Uso:
 *   node scripts/upload-snapshots.mjs --dry-run            (arma los JSON, no sube nada)
 *   node scripts/upload-snapshots.mjs                      (sube todos los que existan)
 *   node scripts/upload-snapshots.mjs accessinCobranzas    (solo los nombrados)
 *
 * Credenciales (nunca van en el repo):
 *   - VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY, del entorno o de .env.
 *   - SUPABASE_SERVICE_ROLE_KEY en el entorno, o bien JC_ADMIN_EMAIL y JC_ADMIN_PASSWORD
 *     de un usuario superadmin (las políticas del bucket solo le dejan escribir a ese rol).
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { SNAPSHOT_BUCKET, SNAPSHOT_NAMES } from '../src/data/snapshotCatalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SEED_DIR = resolve(ROOT, 'src/data/seed');

function envValue(name) {
  if (process.env[name]) return process.env[name].trim();
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
}

function requireEnv(name) {
  const value = envValue(name);
  if (!value) throw new Error(`Falta ${name} (en el entorno o en .env).`);
  return value;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toLocaleString('es-AR', { maximumFractionDigits: 0 })} kB`;
}

async function buildPayloads(names) {
  const payloads = [];
  const missing = [];
  for (const name of names) {
    const file = resolve(SEED_DIR, `${name}.js`);
    if (!existsSync(file)) {
      missing.push(name);
      continue;
    }
    const mod = await import(pathToFileURL(file).href);
    const body = JSON.stringify(Object.fromEntries(Object.entries(mod)));
    payloads.push({ name, body });
  }
  return { payloads, missing };
}

async function connect() {
  const url = requireEnv('VITE_SUPABASE_URL');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  if (serviceKey) {
    console.log('AUTH service role');
    return createClient(url, serviceKey, authOptions);
  }

  const email = process.env.JC_ADMIN_EMAIL?.trim();
  const password = process.env.JC_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Definí SUPABASE_SERVICE_ROLE_KEY, o JC_ADMIN_EMAIL y JC_ADMIN_PASSWORD de un superadmin.'
    );
  }
  const sb = createClient(url, requireEnv('VITE_SUPABASE_ANON_KEY'), authOptions);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`LOGIN_FAIL ${error.message}`);
  console.log('LOGIN_OK', data.user?.email);
  return sb;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const requested = args.filter((arg) => !arg.startsWith('--'));
  const unknown = requested.filter((name) => !SNAPSHOT_NAMES.includes(name));
  if (unknown.length) {
    throw new Error(`Snapshots desconocidos: ${unknown.join(', ')}.\nVálidos: ${SNAPSHOT_NAMES.join(', ')}`);
  }

  const { payloads, missing } = await buildPayloads(requested.length ? requested : SNAPSHOT_NAMES);
  for (const { name, body } of payloads) {
    console.log(`  ${name}.json  ${formatKb(Buffer.byteLength(body))}`);
  }
  if (missing.length) {
    console.warn(`SIN_ARCHIVO (no se suben): ${missing.join(', ')}`);
  }
  if (!payloads.length) throw new Error(`No hay snapshots para subir en ${SEED_DIR}.`);

  if (dryRun) {
    console.log('DRY_RUN_DONE — no se subió nada');
    return;
  }

  const sb = await connect();
  for (const { name, body } of payloads) {
    const { error } = await sb.storage
      .from(SNAPSHOT_BUCKET)
      .upload(`${name}.json`, Buffer.from(body), {
        contentType: 'application/json',
        cacheControl: '300',
        upsert: true,
      });
    if (error) throw new Error(`upload ${name}: ${error.message}`);
    console.log(`UPLOADED ${name}.json`);
  }
  console.log(`UPLOAD_OK ${payloads.length} snapshots en ${SNAPSHOT_BUCKET}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

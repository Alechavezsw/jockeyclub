/**
 * Sube los saldos de cuenta corriente LILA/Accessin a public.members.
 *
 * Es el paso que permite dejar de enviar el snapshot al navegador: hoy
 * src/data/seed/accessinCurrentAccountBalances.js son 1,9 MB con nombre y DNI de
 * ~7.300 socios que viajan en el bundle. Una vez cargado en la base, el cliente lee
 * los saldos de `members` con RLS y el snapshet deja de existir del lado del cliente.
 *
 * No hace falta migración de esquema: `outstanding_balance` es columna propia y el
 * desglose viaja en `members.meta`, que memberFromRow ya expande (src/data/mappers.js).
 *
 * Uso:
 *   node scripts/sync-accessin-balances.mjs --dry-run    (no escribe nada)
 *   node scripts/sync-accessin-balances.mjs
 *
 * Credenciales: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY salen de .env; el usuario
 * operativo, de JC_ADMIN_EMAIL / JC_ADMIN_PASSWORD (mismo patrón que sync-societas-app).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SEED_PATH = resolve(ROOT, 'src/data/seed/accessinCurrentAccountBalances.js');
const PAGE = 1000;
const BATCH = 40;

function loadEnv(name) {
  const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`Falta ${name} en .env`);
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

function memberKey(value) {
  const n = Number.parseInt(String(value ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? String(n) : '';
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function fetchMembers(sb) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('members')
      .select('id, member_number, full_name, outstanding_balance, meta')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/**
 * Devuelve el patch a aplicar, o null si la fila ya está al día.
 * No pisa un saldo operativo distinto de 0: si el club ya cobró y actualizó el saldo
 * en la app, ese valor manda sobre el corte de LILA. Es el mismo criterio que aplicaba
 * applyCurrentAccountBalances del lado del cliente.
 */
function buildPatch(dbRow, lila, asOf) {
  const meta = { ...(dbRow.meta && typeof dbRow.meta === 'object' ? dbRow.meta : {}) };
  if (meta.currentAccountAsOf === asOf) return null; // ya sincronizado con este corte

  const current = Number(dbRow.outstanding_balance);
  const hasOperational = Number.isFinite(current) && current !== 0;

  meta.currentAccountAsOf = asOf;
  meta.unpaidCapital = money(lila.unpaidCapital);
  meta.unpaidSurcharges = money(lila.unpaidSurcharges);
  meta.unpaidInterest = money(lila.unpaidInterest);
  meta.unallocatedBalance = money(lila.unallocated);
  if (lila.accessinId != null) meta.accessinId = lila.accessinId;

  const patch = { meta };
  if (!hasOperational) patch.outstanding_balance = Math.max(0, money(lila.balance));
  return patch;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!existsSync(SEED_PATH)) {
    throw new Error(
      `No existe ${SEED_PATH}.\nGeneralo primero con: npm run import:saldos`
    );
  }
  const seed = await import(`file://${SEED_PATH}`);
  const asOf = seed.ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF;
  const byNumber = seed.ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER || {};
  const snapshot = seed.ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT || {};
  console.log(`seed: corte ${asOf} · ${Object.keys(byNumber).length} socios · ` +
    `${snapshot.withBalance} con saldo · total ${snapshot.totalBalance}`);

  const url = loadEnv('VITE_SUPABASE_URL');
  const anon = loadEnv('VITE_SUPABASE_ANON_KEY');
  const email = process.env.JC_ADMIN_EMAIL || 'admin@jockey.sj';
  const password = process.env.JC_ADMIN_PASSWORD;
  if (!password) throw new Error('Falta JC_ADMIN_PASSWORD en el entorno (la contraseña no va en el repo).');
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`LOGIN_FAIL ${authErr.message}`);
  console.log('LOGIN_OK', auth.user?.email);

  const members = await fetchMembers(sb);
  console.log(`db members=${members.length}`);

  const updates = [];
  let alreadySynced = 0;
  let notInLila = 0;
  let keptOperational = 0;

  for (const row of members) {
    const key = memberKey(row.member_number);
    const lila = key ? byNumber[key] : null;
    if (!lila) { notInLila += 1; continue; }
    const patch = buildPatch(row, lila, asOf);
    if (!patch) { alreadySynced += 1; continue; }
    if (patch.outstanding_balance === undefined) keptOperational += 1;
    updates.push({ id: row.id, member_number: row.member_number, patch });
  }

  const withBalance = updates.filter((u) => Number(u.patch.outstanding_balance) > 0).length;
  console.log(`a actualizar=${updates.length} · con saldo>0=${withBalance} · ` +
    `saldo operativo respetado=${keptOperational} · ya al día=${alreadySynced} · ` +
    `sin match en LILA=${notInLila}`);

  if (!updates.length) { console.log('NADA_QUE_HACER'); return; }

  if (dryRun) {
    console.log('--- muestra (primeras 5) ---');
    for (const u of updates.slice(0, 5)) {
      console.log(`  #${u.member_number}  saldo=${u.patch.outstanding_balance ?? '(sin cambio)'}` +
        `  capital=${u.patch.meta.unpaidCapital} recargos=${u.patch.meta.unpaidSurcharges}` +
        `  interes=${u.patch.meta.unpaidInterest}`);
    }
    console.log('DRY_RUN_DONE — no se escribió nada');
    return;
  }

  let done = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    await Promise.all(slice.map(async ({ id, member_number, patch }) => {
      const { error } = await sb.from('members').update(patch).eq('id', id);
      if (error) throw new Error(`update #${member_number}: ${error.message}`);
    }));
    done += slice.length;
    console.log(`updated ${done}/${updates.length}`);
  }
  console.log('SYNC_OK');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

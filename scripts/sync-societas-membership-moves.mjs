/**
 * Aplica bajas de Societas a public.members (status + meta).
 *
 * Uso:
 *   node scripts/sync-societas-membership-moves.mjs --dry-run
 *   node scripts/sync-societas-membership-moves.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SOCIETAS_MEMBERSHIP_BAJAS } from '../src/data/seed/societasMembershipMoves.js';
import { classifyBajaMotivo, memberMoveKey, uniqueBajas } from '../src/domain/members/membershipMoves.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PAGE = 1000;
const BATCH = 40;

function loadEnv(name) {
  const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`Falta ${name} en .env`);
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

async function fetchMembers(sb) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('members')
      .select('id, member_number, full_name, status, meta')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const bajas = uniqueBajas(SOCIETAS_MEMBERSHIP_BAJAS);
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
  const byDb = new Map();
  for (const m of members) {
    const key = memberMoveKey(m.member_number);
    if (key) byDb.set(key, m);
  }

  const missing = [];
  const already = [];
  const skippedActive = [];
  const updates = [];
  for (const row of bajas) {
    if (/^activ/i.test(String(row.status || '').trim())) {
      skippedActive.push(row);
      continue;
    }
    const db = byDb.get(row.memberId);
    if (!db) {
      missing.push(row);
      continue;
    }
    const kind = classifyBajaMotivo(row.motivo);
    const meta = { ...(db.meta && typeof db.meta === 'object' ? db.meta : {}) };
    const same = db.status === 'inactive'
      && meta.bajaFecha === row.date
      && meta.bajaMotivo === row.motivo;
    if (same) {
      already.push(row.memberId);
      continue;
    }
    updates.push({
      id: db.id,
      member_number: db.member_number,
      name: db.full_name,
      from: db.status,
      patch: {
        status: 'inactive',
        meta: {
          ...meta,
          bajaFecha: row.date || meta.bajaFecha || null,
          bajaMotivo: row.motivo || meta.bajaMotivo || null,
          bajaKind: kind.id,
          bajaKindLabel: kind.label,
          sourceSocietasBajas: true,
          societasBajasAsOf: '2026-09-12',
        },
      },
    });
  }

  const summary = {
    dryRun,
    excel: bajas.length,
    db: members.length,
    updates: updates.length,
    already: already.length,
    skippedActive: skippedActive.length,
    missing: missing.length,
    missingSample: missing.slice(0, 8).map((r) => `${r.memberId} ${r.name}`),
    updateSample: updates.slice(0, 8).map((u) => `${u.member_number} ${u.from}→inactive ${u.name}`),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) {
    console.log('DRY_RUN_DONE');
    return;
  }

  let updated = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    await Promise.all(slice.map(async ({ id, member_number, patch }) => {
      const { error } = await sb.from('members').update(patch).eq('id', id);
      if (error) throw new Error(`update #${member_number}: ${error.message}`);
    }));
    updated += slice.length;
    console.log(`updated ${updated}/${updates.length}`);
  }
  console.log(JSON.stringify({ ok: true, updated }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

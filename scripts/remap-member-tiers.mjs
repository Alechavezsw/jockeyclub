/**
 * Reescribe tiers inventados (TIER_… / cuotas combinadas) a la categoría real.
 *
 *   node scripts/remap-member-tiers.mjs --dry-run
 *   node scripts/remap-member-tiers.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  mergeOfficialTiers,
  resolveStoredMemberTier,
} from '../src/domain/members/tiers.js';

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
      .select('id, member_number, full_name, tier, meta')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
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
  const counts = new Map();
  const updates = [];

  for (const row of members) {
    const next = resolveStoredMemberTier(row.tier, row.meta?.cuotaCategories);
    const from = String(row.tier || '');
    if (next === from) continue;
    updates.push({ id: row.id, member_number: row.member_number, from, to: next });
    const key = `${from} → ${next}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const { data: setting } = await sb.from('app_settings').select('value').eq('key', 'member_tiers').maybeSingle();
  const mergedCatalog = mergeOfficialTiers(Array.isArray(setting?.value) ? setting.value : []);

  console.log(JSON.stringify({
    dryRun,
    members: members.length,
    remaps: updates.length,
    byChange: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
    catalogSize: mergedCatalog.length,
    sample: updates.slice(0, 8).map((u) => `${u.member_number} ${u.from} → ${u.to}`),
  }, null, 2));

  if (dryRun) {
    console.log('DRY_RUN_DONE');
    return;
  }

  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    await Promise.all(slice.map(async ({ id, member_number, to }) => {
      const { error } = await sb.from('members').update({ tier: to }).eq('id', id);
      if (error) throw new Error(`update #${member_number}: ${error.message}`);
    }));
    console.log(`updated ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }

  const { error: setErr } = await sb.from('app_settings').upsert({
    key: 'member_tiers',
    value: mergedCatalog,
    updated_at: new Date().toISOString(),
  });
  if (setErr) throw new Error(`catalog: ${setErr.message}`);

  console.log(JSON.stringify({ ok: true, remapped: updates.length, catalog: mergedCatalog.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

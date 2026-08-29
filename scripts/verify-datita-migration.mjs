/**
 * Verifica conteos y spot-check del padrón datita en public.members.
 * Uso: node scripts/verify-datita-migration.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadEnv(name) {
  const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`Falta ${name} en .env`);
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

async function countDatita(sb) {
  const { count, error } = await sb
    .from('members')
    .select('*', { count: 'exact', head: true })
    .contains('meta', { source: 'datita' });
  if (error) throw error;
  return count || 0;
}

async function fetchByNumbers(sb, numbers) {
  const { data, error } = await sb
    .from('members')
    .select('member_number, full_name, tier, status, document_number, meta, email')
    .in('member_number', numbers);
  if (error) throw error;
  return data || [];
}

async function sampleByTier(sb, tier, limit = 1) {
  const { data, error } = await sb
    .from('members')
    .select('member_number, full_name, tier, status, document_number, meta, email')
    .contains('meta', { source: 'datita' })
    .eq('tier', tier)
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function sampleCuotaMissing(sb) {
  // PostgREST can't easily filter jsonb boolean; scan a page
  const { data, error } = await sb
    .from('members')
    .select('member_number, full_name, tier, status, document_number, meta, email')
    .contains('meta', { source: 'datita' })
    .range(0, 999);
  if (error) throw error;
  return (data || []).find((r) => r.meta?.cuotaMissing) || null;
}

async function tierCounts(sb) {
  const tiers = ['gold', 'platinum', 'royal', 'vitalicio'];
  const out = {};
  for (const tier of tiers) {
    const { count, error } = await sb
      .from('members')
      .select('*', { count: 'exact', head: true })
      .contains('meta', { source: 'datita' })
      .eq('tier', tier);
    if (error) throw error;
    if (count) out[tier] = count;
  }
  return out;
}

async function statusCounts(sb) {
  const statuses = ['active', 'inactive', 'pending', 'suspended'];
  const out = {};
  for (const status of statuses) {
    const { count, error } = await sb
      .from('members')
      .select('*', { count: 'exact', head: true })
      .contains('meta', { source: 'datita' })
      .eq('status', status);
    if (error) throw error;
    if (count) out[status] = count;
  }
  return out;
}

async function main() {
  const url = loadEnv('VITE_SUPABASE_URL');
  const anon = loadEnv('VITE_SUPABASE_ANON_KEY');
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: process.env.JC_ADMIN_EMAIL || 'admin@jockey.sj',
    password: process.env.JC_ADMIN_PASSWORD || 'jockey2026',
  });
  if (authErr) throw authErr;

  const { count: membersTotal } = await sb.from('members').select('*', { count: 'exact', head: true });
  const datitaCount = await countDatita(sb);
  const tiers = await tierCounts(sb);
  const statuses = await statusCounts(sb);

  const [one] = await fetchByNumbers(sb, ['1']);
  const [vitalicio] = await sampleByTier(sb, 'vitalicio');
  const [familiar] = await sampleByTier(sb, 'platinum');
  const sinCuota = await sampleCuotaMissing(sb);

  let stagingSocios = null;
  let stagingCuotas = null;
  const st = await sb.from('socios').select('*', { count: 'exact', head: true });
  if (!st.error) stagingSocios = st.count;
  const sc = await sb.from('socio_cuotas').select('*', { count: 'exact', head: true });
  if (!sc.error) stagingCuotas = sc.count;

  const fmt = (r) => (r ? {
    nro: r.member_number,
    name: r.full_name,
    tier: r.tier,
    status: r.status,
    doc: r.document_number,
    email: r.email,
    cuotaCategories: r.meta?.cuotaCategories || [],
    family: r.meta?.familyGroupName || null,
  } : null);

  const report = {
    membersTotal,
    datitaCount,
    tiers,
    statuses,
    stagingSocios,
    stagingCuotas,
    spot: {
      socio1: fmt(one) || { nro: '1', missing: true },
      vitalicio: fmt(vitalicio),
      familiar: fmt(familiar),
      sinCuota: fmt(sinCuota),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  await sb.auth.signOut();

  if (datitaCount < 5000) {
    console.error(`VERIFY_FAIL: datitaCount=${datitaCount} (esperado ~5046)`);
    process.exitCode = 1;
  } else if (!one) {
    console.error('VERIFY_FAIL: falta socio #1');
    process.exitCode = 1;
  } else {
    console.log('VERIFY_OK');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

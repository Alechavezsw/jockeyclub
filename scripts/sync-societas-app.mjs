/**
 * Cruza datita/societas (Socios con/sin App) contra public.members.
 *
 * Uso:
 *   node scripts/sync-societas-app.mjs --dry-run
 *   node scripts/sync-societas-app.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import {
  deriveMemberTier,
  parseCuotaCategories,
  resolveStoredMemberTier,
  SIN_CATEGORIA_TIER,
} from '../src/domain/members/tiers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const XLSX_PATH = resolve(ROOT, 'datita/societas/Socios con Aplicacion - 2026-09-09.xlsx');
const AS_OF = '2026-09-09';
const PAGE = 1000;
const BATCH = 40;

function loadEnv(name) {
  const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`Falta ${name} en .env`);
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function memberKey(value) {
  const n = Number.parseInt(digits(value), 10);
  return Number.isFinite(n) ? String(n) : '';
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isPlaceholderEmail(email, dni) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return true;
  if (/^\d+@jockeyclubsj\.com$/.test(e)) return true;
  const d = digits(dni);
  return Boolean(d && e === `${d}@jockeyclubsj.com`);
}

function pickEmail(current, next, dni) {
  const a = clean(current);
  const b = clean(next);
  if (!b) return a || null;
  if (!a || isPlaceholderEmail(a, dni)) return b;
  if (isPlaceholderEmail(b, dni) && !isPlaceholderEmail(a, dni)) return a;
  return b;
}

function loadExcelRows() {
  if (!existsSync(XLSX_PATH)) throw new Error(`No está ${XLSX_PATH}`);
  const wb = xlsx.readFile(XLSX_PATH);
  const withApp = xlsx.utils.sheet_to_json(wb.Sheets['Socios con App'] || {}, { defval: '' });
  const withoutApp = xlsx.utils.sheet_to_json(wb.Sheets['Socios sin App'] || {}, { defval: '' });
  const tutors = xlsx.utils.sheet_to_json(wb.Sheets['Tutores con App'] || {}, { defval: '' });
  const byNumber = new Map();

  const push = (row, hasApp) => {
    const memberNumber = memberKey(row['NRO DE SOCIO']);
    if (!memberNumber) return;
    const first = clean(row.NOMBRE);
    const last = clean(row.APELLIDO);
    const next = {
      memberNumber,
      firstName: first,
      lastName: last,
      name: [first, last].filter(Boolean).join(' '),
      documentNumber: digits(row.DNI) || clean(row.DNI),
      email: clean(row.MAIL),
      address: clean(row.DIRECCION),
      cuota: clean(row.CUOTAS),
      hasApp,
    };
    const prev = byNumber.get(memberNumber);
    if (!prev || (hasApp && !prev.hasApp)) byNumber.set(memberNumber, next);
  };

  withApp.forEach((row) => push(row, true));
  withoutApp.forEach((row) => push(row, false));
  return { byNumber, tutors, counts: { withApp: withApp.length, withoutApp: withoutApp.length } };
}

async function fetchMembers(sb) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('members')
      .select('id, member_number, full_name, document_number, email, address, tier, meta')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

function buildPatch(dbRow, excel) {
  const meta = { ...(dbRow.meta && typeof dbRow.meta === 'object' ? dbRow.meta : {}) };
  const documentNumber = digits(dbRow.document_number) || excel.documentNumber || null;
  const email = pickEmail(dbRow.email, excel.email, documentNumber || excel.documentNumber);
  const address = clean(excel.address) || clean(dbRow.address) || null;
  const name = excel.name || clean(dbRow.full_name);
  const cuotaParts = parseCuotaCategories([
    ...(Array.isArray(meta.cuotaCategories) ? meta.cuotaCategories : []),
    excel.cuota,
  ]);
  const tier = resolveStoredMemberTier(dbRow.tier, cuotaParts);

  meta.source = meta.source || 'societas';
  meta.hasSocietasApp = Boolean(excel.hasApp);
  meta.societasAppAsOf = AS_OF;
  if (excel.email) meta.societasEmail = excel.email;
  if (cuotaParts.length) meta.cuotaCategories = cuotaParts;

  const patch = {};
  if (name && name !== clean(dbRow.full_name)) patch.full_name = name;
  if (excel.documentNumber && digits(dbRow.document_number) !== digits(excel.documentNumber)) {
    if (!digits(dbRow.document_number)) patch.document_number = excel.documentNumber;
  }
  if ((email || null) !== (clean(dbRow.email) || null)) patch.email = email;
  if ((address || null) !== (clean(dbRow.address) || null)) patch.address = address;
  if (tier && tier !== dbRow.tier) patch.tier = tier;

  const metaChanged = JSON.stringify(meta) !== JSON.stringify(dbRow.meta || {});
  if (metaChanged) patch.meta = meta;

  return Object.keys(patch).length ? patch : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const excel = loadExcelRows();
  console.log(`excel con_app=${excel.counts.withApp} sin_app=${excel.counts.withoutApp} unicos=${excel.byNumber.size} tutores=${excel.tutors.length}`);

  const url = loadEnv('VITE_SUPABASE_URL');
  const anon = loadEnv('VITE_SUPABASE_ANON_KEY');
  const email = process.env.JC_ADMIN_EMAIL || 'admin@jockey.sj';
  const password = process.env.JC_ADMIN_PASSWORD || 'jockey2026';
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`LOGIN_FAIL ${authErr.message}`);
  console.log('LOGIN_OK', auth.user?.email);

  const members = await fetchMembers(sb);
  const byDb = new Map();
  for (const m of members) {
    const key = memberKey(m.member_number);
    if (key) byDb.set(key, m);
  }
  console.log(`db members=${members.length}`);

  const missingInDb = [];
  const missingInExcel = [];
  const updates = [];
  let alreadyOk = 0;
  let markApp = 0;
  let fillContact = 0;

  for (const [nro, row] of excel.byNumber) {
    const db = byDb.get(nro);
    if (!db) {
      missingInDb.push(row);
      continue;
    }
    const patch = buildPatch(db, row);
    if (!patch) {
      alreadyOk += 1;
      continue;
    }
    if (patch.meta?.hasSocietasApp && !db.meta?.hasSocietasApp) markApp += 1;
    if (patch.email || patch.address || patch.document_number || patch.full_name) fillContact += 1;
    updates.push({ id: db.id, member_number: db.member_number, patch, hasApp: row.hasApp });
  }

  for (const [nro, db] of byDb) {
    if (!excel.byNumber.has(nro)) missingInExcel.push(db.member_number);
  }

  const summary = {
    dryRun,
    excel: excel.counts,
    db: members.length,
    alreadyOk,
    updates: updates.length,
    markApp,
    fillContact,
    missingInDb: missingInDb.length,
    missingInExcel: missingInExcel.length,
    missingInDbSample: missingInDb.slice(0, 8).map((r) => `${r.memberNumber} ${r.name}`),
    missingInExcelSample: missingInExcel.slice(0, 8),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) {
    console.log('DRY_RUN_DONE');
    return;
  }

  let updated = 0;
  let inserted = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    await Promise.all(slice.map(async ({ id, member_number, patch }) => {
      const { error } = await sb.from('members').update(patch).eq('id', id);
      if (error) throw new Error(`update #${member_number}: ${error.message}`);
    }));
    updated += slice.length;
    console.log(`updated ${updated}/${updates.length}`);
  }

  for (let i = 0; i < missingInDb.length; i += BATCH) {
    const slice = missingInDb.slice(i, i + BATCH).map((row) => ({
      member_number: row.memberNumber,
      full_name: row.name || `Socio ${row.memberNumber}`,
      document_type: 'DNI',
      document_number: row.documentNumber || null,
      email: row.email || null,
      address: row.address || null,
      joined_at: '1900-01-01',
      tier: deriveMemberTier(row.cuota, SIN_CATEGORIA_TIER),
      status: 'active',
      outstanding_balance: 0,
      years_active: 0,
      meta: {
        source: 'societas',
        hasSocietasApp: row.hasApp,
        societasAppAsOf: AS_OF,
        societasEmail: row.email || null,
        cuotaCategories: parseCuotaCategories(row.cuota),
        importedAt: new Date().toISOString(),
      },
    }));
    const { error } = await sb.from('members').insert(slice);
    if (error) throw new Error(`insert: ${error.message}`);
    inserted += slice.length;
    console.log(`inserted ${inserted}/${missingInDb.length}`);
  }

  console.log(JSON.stringify({ ok: true, updated, inserted }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

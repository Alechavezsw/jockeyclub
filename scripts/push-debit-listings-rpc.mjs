/**
 * Sube all.json a debit_listings vía RPC import_debit_listings_chunk (anon/authenticated).
 * Uso: node scripts/push-debit-listings-rpc.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA = resolve(__dirname, '_out_debit_listings/all.json');

function envValue(name) {
  if (process.env[name]) return process.env[name].trim();
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
}

const url = envValue('VITE_SUPABASE_URL').replace(/\/+$/, '');
const key = envValue('VITE_SUPABASE_ANON_KEY');
if (!url || !key) throw new Error('Falta VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const rows = JSON.parse(readFileSync(DATA, 'utf8'));
const PAGE = 40;

console.log('Upserting', rows.length, 'rows via RPC…');

for (let i = 0; i < rows.length; i += PAGE) {
  const chunk = rows.slice(i, i + PAGE).map((r) => ({
    id: r.id,
    year: r.year,
    month: r.month,
    sheet_kind: r.sheetKind,
    brand: r.brand,
    section: r.section,
    sort_order: r.sortOrder,
    card_number: r.cardNumber,
    receipt: r.receipt,
    due_date: r.dueDate,
    dues_amount: r.duesAmount,
    abono_amount: r.abonoAmount,
    total_amount: r.totalAmount,
    member_id: r.memberId,
    status_code: r.statusCode,
    holder_name: r.holderName || '',
    note: r.note || '',
    source_sheet: r.sourceSheet || null,
  }));
  const { data, error } = await sb.rpc('import_debit_listings_chunk', { payload: chunk });
  if (error) {
    console.error('Fail at', i, error.message);
    process.exit(1);
  }
  if ((i / PAGE) % 10 === 0 || i + PAGE >= rows.length) {
    console.log(`… ${Math.min(i + PAGE, rows.length)}/${rows.length} (last=${data})`);
  }
}

const { count, error: countErr } = await sb
  .from('debit_listings')
  .select('id', { count: 'exact', head: true });
if (countErr) console.warn('count error (RLS?):', countErr.message);
else console.log('OK count:', count);

/**
 * Sube scripts/_out_debit_listings/all.json a public.debit_listings (service role).
 * Uso: node scripts/push-debit-listings.mjs
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

function requireEnv(name) {
  const value = envValue(name);
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

const url = requireEnv('VITE_SUPABASE_URL').replace(/\/+$/, '');
const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const rows = JSON.parse(readFileSync(DATA, 'utf8'));
console.log('Rows to upsert:', rows.length);

const { error: truncErr } = await sb.from('debit_listings').delete().neq('id', '');
if (truncErr) {
  // fallback truncate via rpc not available — delete all with filter always true
  console.warn('delete warning:', truncErr.message);
}

const PAGE = 500;
let done = 0;
for (let i = 0; i < rows.length; i += PAGE) {
  const chunk = rows.slice(i, i + PAGE).map((row) => ({
    id: row.id,
    year: row.year,
    month: row.month,
    sheet_kind: row.sheetKind,
    brand: row.brand,
    section: row.section,
    sort_order: row.sortOrder,
    card_number: row.cardNumber,
    receipt: row.receipt,
    due_date: row.dueDate,
    dues_amount: row.duesAmount,
    abono_amount: row.abonoAmount,
    total_amount: row.totalAmount,
    member_id: row.memberId,
    status_code: row.statusCode,
    holder_name: row.holderName || '',
    note: row.note || '',
    source_sheet: row.sourceSheet || null,
  }));
  const { error } = await sb.from('debit_listings').upsert(chunk, { onConflict: 'id' });
  if (error) {
    console.error('Batch failed at', i, error.message);
    process.exit(1);
  }
  done += chunk.length;
  if (done % 2000 === 0 || done === rows.length) console.log(`… ${done}/${rows.length}`);
}

const { count, error: countErr } = await sb
  .from('debit_listings')
  .select('id', { count: 'exact', head: true });
if (countErr) console.warn(countErr.message);
else console.log('OK count in table:', count);

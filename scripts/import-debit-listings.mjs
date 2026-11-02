/**
 * Extrae docs/Debitos/Listados de Debitos 2026.xlsx → SQL batches para debit_listings.
 * Uso: node scripts/import-debit-listings.mjs
 * Luego aplicar out/debit_listings/*.sql vía MCP execute_sql (o psql).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  parseDebitListingMatrix,
  parseDebitListingSheetName,
} from '../src/domain/accounting/debitListings.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const xlsxPath = path.join(root, 'docs', 'Debitos', 'Listados de Debitos 2026.xlsx');
const outDir = path.join(root, 'scripts', '_out_debit_listings');

function sqlStr(value) {
  if (value == null || value === '') return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '0';
}

function rowToValues(row) {
  return `(${[
    sqlStr(row.id),
    row.year,
    row.month,
    sqlStr(row.sheetKind),
    sqlStr(row.brand),
    sqlStr(row.section),
    row.sortOrder,
    sqlStr(row.cardNumber),
    sqlStr(row.receipt),
    sqlStr(row.dueDate),
    sqlNum(row.duesAmount),
    sqlNum(row.abonoAmount),
    sqlNum(row.totalAmount),
    sqlStr(row.memberId),
    sqlStr(row.statusCode),
    sqlStr(row.holderName),
    sqlStr(row.note),
    sqlStr(row.sourceSheet),
  ].join(', ')})`;
}

const wb = XLSX.readFile(xlsxPath);
const all = [];
for (const name of wb.SheetNames) {
  const meta = parseDebitListingSheetName(name);
  if (!meta.year || !meta.month) {
    console.warn('skip sheet (no period)', name);
    continue;
  }
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const rows = parseDebitListingMatrix(matrix, meta);
  console.log(name.trim(), '→', rows.length, meta.sheetKind, `${meta.year}-${meta.month}`);
  all.push(...rows);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'all.json'), JSON.stringify(all, null, 0));

const BATCH = 1000;
const files = [];
files.push({
  name: '00_truncate.sql',
  sql: 'truncate table public.debit_listings;',
});

for (let i = 0; i < all.length; i += BATCH) {
  const chunk = all.slice(i, i + BATCH);
  const idx = String(Math.floor(i / BATCH) + 1).padStart(3, '0');
  const sql = [
    'insert into public.debit_listings (',
    '  id, year, month, sheet_kind, brand, section, sort_order,',
    '  card_number, receipt, due_date, dues_amount, abono_amount, total_amount,',
    '  member_id, status_code, holder_name, note, source_sheet',
    ') values',
    chunk.map(rowToValues).join(',\n') + '',
    'on conflict (id) do update set',
    '  brand = excluded.brand,',
    '  section = excluded.section,',
    '  sort_order = excluded.sort_order,',
    '  card_number = excluded.card_number,',
    '  receipt = excluded.receipt,',
    '  due_date = excluded.due_date,',
    '  dues_amount = excluded.dues_amount,',
    '  abono_amount = excluded.abono_amount,',
    '  total_amount = excluded.total_amount,',
    '  member_id = excluded.member_id,',
    '  status_code = excluded.status_code,',
    '  holder_name = excluded.holder_name,',
    '  note = excluded.note,',
    '  source_sheet = excluded.source_sheet,',
    '  updated_at = now();',
  ].join('\n');
  const name = `${idx}_insert.sql`;
  fs.writeFileSync(path.join(outDir, name), sql);
  files.push({ name, sql });
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
  total: all.length,
  batches: files.length - 1,
  files: files.map((f) => f.name),
}, null, 2));

console.log('Wrote', all.length, 'rows in', files.length - 1, 'batches →', outDir);

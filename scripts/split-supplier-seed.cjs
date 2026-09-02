const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, '../datita/contabilidad/cc proveedores/seed-suppliers.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const marker = 'values\n';
const start = sql.indexOf(marker);
const end = sql.lastIndexOf(';\nselect');
if (start < 0 || end < 0) throw new Error('Could not locate values block');
const block = sql.slice(start + marker.length, end);

const rows = [];
let depth = 0;
let current = '';
for (let i = 0; i < block.length; i += 1) {
  const ch = block[i];
  if (ch === '(') depth += 1;
  if (ch === ')') depth -= 1;
  current += ch;
  if (depth === 0 && current.trim()) {
    const trimmed = current.trim().replace(/,$/, '');
    if (trimmed.startsWith('(')) rows.push(trimmed);
    current = '';
  }
}

const dir = path.join(__dirname, '../datita/contabilidad/cc proveedores/batches');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, '00_truncate.sql'), 'truncate table public.suppliers restart identity cascade;');

const batchSize = 50;
let batchCount = 0;
for (let i = 0; i < rows.length; i += batchSize) {
  const chunk = rows.slice(i, i + batchSize).join(',\n');
  const file = path.join(dir, `batch_${String(batchCount).padStart(2, '0')}.sql`);
  fs.writeFileSync(
    file,
    `insert into public.suppliers (name, cuit, category, email, phone, status, notes, meta) values\n${chunk};`
  );
  batchCount += 1;
}

console.log(`Parsed ${rows.length} rows into ${batchCount} batches`);

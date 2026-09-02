const fs = require('fs');
const path = require('path');

const skip = new Set(['Retenciones', 'MC IMPRESIONES', 'ENERGIA SAN JUAN']);
const sql = fs.readFileSync(
  path.join(__dirname, '../datita/contabilidad/cc proveedores/batches/batch_00.sql'),
  'utf8'
);
const start = sql.indexOf('values') + 6;
const body = sql.slice(start).trim().replace(/;$/, '');
const parts = [];
let cur = '';
let depth = 0;
for (const ch of body) {
  if (ch === '(') depth += 1;
  if (ch === ')') depth -= 1;
  cur += ch;
  if (depth === 0 && cur.trim()) {
    parts.push(cur.trim().replace(/,$/, ''));
    cur = '';
  }
}
const kept = parts.filter((p) => {
  const m = p.match(/^\('([^']*)'/);
  return m && !skip.has(m[1]);
});
const out = `insert into public.suppliers (name, cuit, category, email, phone, status, notes, meta) values\n${kept.join(',\n')};`;
fs.writeFileSync(
  path.join(__dirname, '../datita/contabilidad/cc proveedores/batches/batch_00_rest.sql'),
  out
);
console.log(`kept ${kept.length} of ${parts.length}`);

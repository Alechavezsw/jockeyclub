const fs = require('fs');
const path = require('path');

const data = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../datita/contabilidad/cc proveedores/proveedores-parsed.json'),
    'utf8'
  )
);

function esc(s) {
  if (s == null || s === '') return 'null';
  return `'${String(s).replace(/'/g, "''")}'`;
}

function guessCategory(name) {
  const n = String(name || '').toLowerCase();
  if (/forraje|equino|hipic|veterin|caball|fardo/.test(n)) return 'hipica';
  if (/ferreter|pinturer|material|hormigon|ducto|aislante|manten|obra|construc|alumetal|benavidez/.test(n)) {
    return 'mantenimiento';
  }
  if (/super|catering|bodega|farmacia|comida|gastr|marina/.test(n)) return 'gastronomia';
  if (/energia|eco gas|gas|net|internet|servic|municipal|obra social|sindicato|utta|ospat|aadi|sadayc|retencion|gobierno|subsidio/.test(n)) {
    return 'servicios';
  }
  if (/deporte|cancha|tenis|padel|rugby/.test(n)) return 'deportes';
  return 'general';
}

const outDir = path.join(__dirname, '../datita/contabilidad/cc proveedores/batches/full');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '00_delete.sql'), 'delete from public.suppliers;');

const size = 15;
let ci = 0;
for (let i = 0; i < data.length; i += size) {
  const chunk = data.slice(i, i + size);
  const values = chunk
    .map((r) => {
      const name = String(r.name).trim();
      const code = String(r.code || '');
      const balance = Number(r.balance) || 0;
      const trade = r.contact || '';
      const phone = r.phone != null && r.phone !== '' ? String(r.phone).replace(/\.0$/, '') : '';
      const notes = code
        ? `Accessin #${code}${balance ? ` - saldo al 02/09/2026: ${balance}` : ''}`
        : '';
      const meta = JSON.stringify({
        tradeName: trade,
        accessinCode: code,
        openingBalance: balance,
        asOf: '2026-09-02',
        payableAccountId: 'coa-2.1.01',
        source: 'accessin',
      });
      return `(${[
        esc(name),
        esc(r.cuit || null),
        esc(guessCategory(name)),
        esc(r.email || null),
        esc(phone || null),
        "'active'",
        esc(notes),
        `${esc(meta)}::jsonb`,
      ].join(', ')})`;
    })
    .join(',\n');
  const sql = `insert into public.suppliers (name, cuit, category, email, phone, status, notes, meta) values\n${values};`;
  fs.writeFileSync(path.join(outDir, `f${String(ci).padStart(2, '0')}.sql`), sql);
  ci += 1;
}

console.log(`wrote delete + ${ci} insert chunks for ${data.length} suppliers`);

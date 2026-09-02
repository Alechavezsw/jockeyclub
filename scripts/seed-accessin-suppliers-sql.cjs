const fs = require('fs');
const path = require('path');

const suppliers = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../datita/contabilidad/cc proveedores/proveedores-parsed.json'), 'utf8')
);

function esc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''");
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

const values = suppliers.map((s) => {
  const name = esc(s.name);
  const cuit = s.cuit ? `'${esc(s.cuit)}'` : 'null';
  const category = `'${guessCategory(s.name)}'`;
  const email = s.email ? `'${esc(s.email)}'` : 'null';
  const phone = s.phone ? `'${esc(s.phone)}'` : 'null';
  const notes = s.code
    ? `'Accessin #${esc(s.code)}${s.balance ? ` · saldo al 02/09/2026: ${s.balance}` : ''}'`
    : 'null';
  const meta = esc(JSON.stringify({
    tradeName: s.contact || '',
    accessinCode: String(s.code || ''),
    openingBalance: Number(s.balance) || 0,
    asOf: '2026-09-02',
    payableAccountId: 'coa-2.1.01',
  }));
  return `('${name}', ${cuit}, ${category}, ${email}, ${phone}, 'active', ${notes}, '${meta}'::jsonb)`;
});

const sql = [
  'truncate table public.suppliers restart identity cascade;',
  'insert into public.suppliers (name, cuit, category, email, phone, status, notes, meta) values',
  `${values.join(',\n')};`,
  'select count(*)::int as n from public.suppliers;',
].join('\n');

fs.writeFileSync(path.join(__dirname, '../datita/contabilidad/cc proveedores/seed-suppliers.sql'), sql);
console.log(`SQL ready: ${suppliers.length} rows`);

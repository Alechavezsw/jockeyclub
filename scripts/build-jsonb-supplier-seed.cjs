const fs = require('fs');
const path = require('path');
const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../datita/contabilidad/cc proveedores/proveedores-parsed.json'), 'utf8')
);

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

const rows = raw.map((s) => ({
  name: s.name,
  cuit: s.cuit || null,
  category: guessCategory(s.name),
  email: s.email || null,
  phone: s.phone || null,
  status: 'active',
  notes: s.code
    ? `Accessin #${s.code}${s.balance ? ` · saldo al 02/09/2026: ${s.balance}` : ''}`
    : null,
  meta: {
    tradeName: s.contact || '',
    accessinCode: String(s.code || ''),
    openingBalance: Number(s.balance) || 0,
    asOf: '2026-09-02',
    payableAccountId: 'coa-2.1.01',
  },
}));

const json = JSON.stringify(rows).replace(/'/g, "''");
const sql = `insert into public.suppliers (name, cuit, category, email, phone, status, notes, meta)
select
  x.name,
  x.cuit,
  x.category,
  x.email,
  x.phone,
  coalesce(x.status, 'active'),
  x.notes,
  coalesce(x.meta, '{}'::jsonb)
from jsonb_to_recordset('${json}'::jsonb) as x(
  name text,
  cuit text,
  category text,
  email text,
  phone text,
  status text,
  notes text,
  meta jsonb
);`;

fs.writeFileSync(path.join(__dirname, '../datita/contabilidad/cc proveedores/seed-jsonb.sql'), sql);
console.log('rows', rows.length, 'sql chars', sql.length);

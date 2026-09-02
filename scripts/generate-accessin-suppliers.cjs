const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const excelPath = path.join(
  __dirname,
  '../datita/contabilidad/cc proveedores/Accessin - Cuenta Corriente de proveedores al 2026-09-02.xlsx'
);
const outDir = path.join(__dirname, '../src/data/seed');
const outFile = path.join(outDir, 'accessinSuppliers.js');

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

const wb = XLSX.readFile(excelPath);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Balance de proveedores'], { header: 1, defval: null });
const headerIdx = rows.findIndex((r) => r && r[1] === 'PROVEEDOR');
if (headerIdx < 0) throw new Error('No se encontró encabezado PROVEEDOR');

const out = [];
for (let i = headerIdx + 1; i < rows.length; i += 1) {
  const r = rows[i];
  if (!r || r[1] == null || String(r[1]).trim() === '') continue;
  const code = r[0] == null ? '' : String(r[0]).trim();
  const name = String(r[1]).trim().replace(/\s+/g, ' ');
  if (!name) continue;
  const cuit = r[2] ? String(r[2]).trim() : '';
  const email = r[3] ? String(r[3]).trim() : '';
  let phone = r[4] != null && r[4] !== '' ? String(r[4]).trim() : '';
  if (/^\d+\.0$/.test(phone)) phone = phone.replace(/\.0$/, '');
  const contact = r[5] ? String(r[5]).trim() : '';
  const balance = Number(r[6]) || 0;

  out.push({
    id: `sup-acc-${code || `x${out.length}`}`,
    legalName: name,
    tradeName: contact,
    cuit,
    category: guessCategory(name),
    email,
    phone,
    address: '',
    payableAccountId: 'coa-2.1.01',
    notes: code
      ? `Accessin #${code}${balance ? ` · saldo al 02/09/2026: ${balance}` : ''}`
      : '',
    status: 'active',
    accessinCode: code,
    openingBalance: balance,
    createdAt: '2026-09-02T14:28:00.000Z',
  });
}

fs.mkdirSync(outDir, { recursive: true });
const js = [
  '/** Proveedores reales Accessin (CC al 2026-09-02). Auto-generado — no editar a mano. */',
  "export const ACCESSIN_SUPPLIERS_AS_OF = '2026-09-02';",
  '',
  `export const ACCESSIN_SUPPLIERS = ${JSON.stringify(out, null, 2)};`,
  '',
].join('\n');
fs.writeFileSync(outFile, js);
console.log(`Wrote ${out.length} suppliers -> ${outFile}`);

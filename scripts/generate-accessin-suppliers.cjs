const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const sourceDirs = [
  path.join(__dirname, '../datita/contabilidad/cc proveedores'),
  path.join(__dirname, '../datita/Avtualizacion/Contabilidad/cc proveedor'),
];
const outDir = path.join(__dirname, '../src/data/seed');
const outFile = path.join(outDir, 'accessinSuppliers.js');

const MONTHS = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function latestWorkbook() {
  const found = [];
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.xlsx') || name.startsWith('~$')) continue;
      if (!/cuenta corriente de proveedores/i.test(name)) continue;
      found.push(path.join(dir, name));
    }
  }
  found.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  if (!found.length) throw new Error('No hay Excel de cuenta corriente de proveedores');
  return found[found.length - 1];
}

function parseGenerated(rows, fallbackDate) {
  for (const row of rows) {
    const text = String(row?.[1] || '');
    const match = text.match(/Generado el (\d{1,2}) de (\p{L}+) del (\d{4}) a las (\d{1,2}):(\d{2})/u);
    if (!match) continue;
    const month = MONTHS[match[2].toLowerCase()];
    if (!month) continue;
    const year = Number(match[3]);
    const day = Number(match[1]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const utc = new Date(Date.UTC(year, month - 1, day, hour + 3, minute));
    return { isoDate, createdAt: utc.toISOString() };
  }
  return { isoDate: fallbackDate, createdAt: `${fallbackDate}T12:00:00.000Z` };
}

function formatAr(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
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

const excelPath = latestWorkbook();
const fileDate = (path.basename(excelPath).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const wb = XLSX.readFile(excelPath);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Balance de proveedores'], { header: 1, defval: null });
const generated = parseGenerated(rows, fileDate);
const asOf = generated.isoDate || fileDate;
const asOfAr = formatAr(asOf);
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
      ? `Accessin #${code}${balance ? ` · saldo al ${asOfAr}: ${balance}` : ''}`
      : '',
    status: 'active',
    accessinCode: code,
    openingBalance: balance,
    asOf,
    createdAt: generated.createdAt,
  });
}

fs.mkdirSync(outDir, { recursive: true });
const js = [
  `/** Proveedores reales Accessin (CC al ${asOfAr}). Auto-generado — no editar a mano. */`,
  `export const ACCESSIN_SUPPLIERS_AS_OF = '${asOf}';`,
  '',
  `export const ACCESSIN_SUPPLIERS = ${JSON.stringify(out, null, 2)};`,
  '',
].join('\n');
fs.writeFileSync(outFile, js);
console.log(`Wrote ${out.length} suppliers al ${asOf} desde ${path.basename(excelPath)}`);

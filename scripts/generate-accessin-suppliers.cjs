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

function collectWorkbooks(regex) {
  const found = [];
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.xlsx') || name.startsWith('~$')) continue;
      if (!regex.test(name)) continue;
      const dated = name.match(/(\d{4}-\d{2}-\d{2})/);
      found.push({ full: path.join(dir, name), name, date: dated ? dated[1] : '' });
    }
  }
  found.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return found;
}

function contactByCode(filePath) {
  const map = new Map();
  if (!filePath) return map;
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets['Balance de proveedores'];
  if (!sheet) return map;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const headerIdx = rows.findIndex((r) => r && r[1] === 'PROVEEDOR');
  if (headerIdx < 0) return map;
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r || r[0] == null) continue;
    const code = String(r[0]).trim();
    if (!code) continue;
    let phone = r[4] != null && r[4] !== '' ? String(r[4]).trim() : '';
    if (/^\d+\.0$/.test(phone)) phone = phone.replace(/\.0$/, '');
    map.set(code, {
      email: r[3] ? String(r[3]).trim() : '',
      phone,
      contact: r[5] ? String(r[5]).trim() : '',
    });
  }
  return map;
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

const saldosFiles = collectWorkbooks(/saldos de proveedores/i);
const detailFiles = collectWorkbooks(/cuenta corriente de proveedores/i);
const saldosFile = saldosFiles.at(-1);
const detailFile = detailFiles.at(-1);
if (!saldosFile && !detailFile) throw new Error('No hay Excel de proveedores');

const out = [];
let asOf = '';
let asOfAr = '';
let createdAt = '';
let sourceName = '';

if (saldosFile && (!detailFile || saldosFile.date >= detailFile.date)) {
  const contacts = contactByCode(detailFile?.full);
  const wb = XLSX.readFile(saldosFile.full);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const generated = parseGenerated(
    rows.map((row) => [null, (row || []).filter((cell) => cell != null && cell !== '').join(' ')]),
    saldosFile.date,
  );
  asOf = generated.isoDate || saldosFile.date;
  asOfAr = formatAr(asOf);
  createdAt = generated.createdAt;
  sourceName = saldosFile.name;
  const headerIdx = rows.findIndex((r) => r && String(r[1] || '').trim() === 'PROVEEDOR');
  if (headerIdx < 0) throw new Error('No se encontró encabezado PROVEEDOR');
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r || r[1] == null || String(r[1]).trim() === '') continue;
    const code = r[0] == null ? '' : String(r[0]).trim();
    const name = String(r[1]).trim().replace(/\s+/g, ' ');
    if (!name || name === 'PROVEEDOR') continue;
    const extra = contacts.get(code) || {};
    const balance = Number(r[3]) || 0;
    out.push({
      id: `sup-acc-${code || `x${out.length}`}`,
      legalName: name,
      tradeName: extra.contact || '',
      cuit: r[2] ? String(r[2]).trim() : '',
      category: guessCategory(name),
      email: extra.email || '',
      phone: extra.phone || '',
      address: '',
      payableAccountId: 'coa-2.1.01',
      notes: code
        ? `Accessin #${code}${balance ? ` · saldo al ${asOfAr}: ${balance}` : ''}`
        : '',
      status: 'active',
      accessinCode: code,
      openingBalance: balance,
      asOf,
      createdAt,
    });
  }
} else {
  const excelPath = detailFile.full;
  const wb = XLSX.readFile(excelPath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Balance de proveedores'], { header: 1, defval: null });
  const generated = parseGenerated(rows, detailFile.date);
  asOf = generated.isoDate || detailFile.date;
  asOfAr = formatAr(asOf);
  createdAt = generated.createdAt;
  sourceName = detailFile.name;
  const headerIdx = rows.findIndex((r) => r && r[1] === 'PROVEEDOR');
  if (headerIdx < 0) throw new Error('No se encontró encabezado PROVEEDOR');
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
      createdAt,
    });
  }
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
console.log(`Wrote ${out.length} suppliers al ${asOf} desde ${sourceName}`);

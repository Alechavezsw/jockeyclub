const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const sourceDirs = [
  path.join(__dirname, '../datita/contabilidad/cc proveedores/retenciones'),
  path.join(__dirname, '../datita/Avtualizacion/Contabilidad/retenciones'),
];
const outDir = path.join(__dirname, '../src/data/seed');
const outFile = path.join(outDir, 'accessinRetenciones.js');

function latestWorkbook() {
  const found = [];
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.xlsx') || name.startsWith('~$')) continue;
      if (!/resumen retenciones/i.test(name)) continue;
      found.push(path.join(dir, name));
    }
  }
  found.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  if (!found.length) throw new Error('No hay Excel de retenciones');
  return found[found.length - 1];
}

function parseSpanishDate(text) {
  const m = String(text || '').match(/(\d{1,2})\s+de\s+(\w+)\s+del?\s+(\d{4})/i);
  if (!m) return null;
  const months = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
    noviembre: '11', diciembre: '12',
  };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${String(m[1]).padStart(2, '0')}`;
}

function excelDateToIso(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && XLSX.SSF) {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

const excelPath = latestWorkbook();
const fileDate = (path.basename(excelPath).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const wb = XLSX.readFile(excelPath);
const sheet = wb.Sheets['Detalle'] || wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

const headerIdx = rows.findIndex(
  (r) => r && String(r[0]).trim() === '#' && String(r[1] || '').toUpperCase() === 'CLIENTE'
);
if (headerIdx < 0) throw new Error('No se encontró encabezado de retenciones');

let periodFrom = '';
let periodTo = '';
let generatedAt = '';
for (let i = 0; i < headerIdx; i += 1) {
  const t = rows[i] && rows[i][1] != null ? String(rows[i][1]) : '';
  if (/Generado/i.test(t)) {
    generatedAt = parseSpanishDate(t) || fileDate;
  }
  if (/Desde/i.test(t)) periodFrom = parseSpanishDate(t) || '';
  if (/Hasta/i.test(t)) periodTo = parseSpanishDate(t) || '';
}

const items = [];
for (let i = headerIdx + 1; i < rows.length; i += 1) {
  const r = rows[i];
  if (!r || (r[1] == null && r[2] == null && r[7] == null)) continue;
  const lineNumber = r[0] != null && r[0] !== '' ? Number(r[0]) || items.length + 1 : items.length + 1;
  const clientName = r[1] != null ? String(r[1]).trim() : '';
  const supplierName = r[2] != null ? String(r[2]).trim() : '';
  const paymentOrderNumber = r[3] != null ? String(r[3]).trim() : '';
  const paymentOrderAmount = Number(r[4]) || 0;
  const retentionType = r[5] != null ? String(r[5]).trim() : '';
  const retentionDate = excelDateToIso(r[6]);
  const retentionAmount = Number(r[7]) || 0;
  if (!clientName && !supplierName && !retentionAmount) continue;

  items.push({
    id: `ret-acc-${lineNumber}-${paymentOrderNumber || i}`,
    lineNumber,
    clientName,
    supplierName,
    paymentOrderNumber,
    paymentOrderAmount,
    retentionType,
    retentionDate,
    retentionAmount,
    status: 'recorded',
    source: 'accessin',
    asOf: periodTo || fileDate,
    createdAt: generatedAt ? `${generatedAt}T12:00:00.000Z` : new Date().toISOString(),
  });
}

fs.mkdirSync(outDir, { recursive: true });
const js = [
  '/** Retenciones Accessin (Resumen). Auto-generado — no editar a mano. */',
  `export const ACCESSIN_RETENCIONES_AS_OF = '${periodTo || fileDate}';`,
  `export const ACCESSIN_RETENCIONES_PERIOD_FROM = '${periodFrom || ''}';`,
  `export const ACCESSIN_RETENCIONES_PERIOD_TO = '${periodTo || ''}';`,
  `export const ACCESSIN_RETENCIONES_GENERATED_ON = '${generatedAt || periodTo || fileDate}';`,
  '',
  `export const ACCESSIN_RETENCIONES = ${JSON.stringify(items, null, 2)};`,
  '',
].join('\n');
fs.writeFileSync(outFile, js);
console.log(`Wrote ${items.length} retenciones (${periodFrom} a ${periodTo}) desde ${path.basename(excelPath)}`);

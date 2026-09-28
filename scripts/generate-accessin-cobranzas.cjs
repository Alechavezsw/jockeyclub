/**
 * Genera seed de cobranzas Accessin/LILA.
 * Toma el Excel más nuevo entre Avtualizacion/Contabilidad/reporte
 * y el corte histórico.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const sourceDirs = [
  path.join(__dirname, '../datita/Avtualizacion/Contabilidad/reporte'),
  path.join(__dirname, '../datita/contabilidad/reportes de cobranzas'),
];
const outDir = path.join(__dirname, '../src/data/seed');
const outFile = path.join(outDir, 'accessinCobranzas.js');

function collectCobranzasExcels() {
  const files = [];
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.xlsx') || name.startsWith('~$')) continue;
      if (!/Reporte de Cobranzas/i.test(name)) continue;
      const full = path.join(dir, name);
      const dated = name.match(/(\d{4}-\d{2}-\d{2})/);
      files.push({
        name,
        full,
        date: dated ? dated[1] : '',
        mtime: fs.statSync(full).mtimeMs,
      });
    }
  }
  return files.toSorted((a, b) => String(b.date).localeCompare(String(a.date)) || b.mtime - a.mtime);
}

const picked = collectCobranzasExcels()[0];
if (!picked) throw new Error('No hay Excel de Reporte de Cobranzas');
const excelPath = picked.full;

function excelDateToIso(serial) {
  if (serial == null || serial === '') return null;
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}/.test(serial)) return serial.slice(0, 10);
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  const parsed = XLSX.SSF.parse_date_code(n);
  if (!parsed) return null;
  const mm = String(parsed.m).padStart(2, '0');
  const dd = String(parsed.d).padStart(2, '0');
  return `${parsed.y}-${mm}-${dd}`;
}

function cell(v) {
  if (v == null || v === '') return '';
  return String(v).trim();
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function detectPrimaryMethod(row) {
  const pairs = [
    ['efectivo', money(row[10])],
    ['cheques', money(row[11])],
    ['transferencia', money(row[13])],
    ['electronico', money(row[14])],
    ['otros', money(row[15])],
  ];
  const hit = pairs.find(([, amt]) => amt > 0);
  return hit ? hit[0] : 'otros';
}

const METHOD_LABELS = {
  efectivo: 'Efectivo',
  cheques: 'Cheques',
  transferencia: 'Transferencia',
  electronico: 'Electrónico',
  otros: 'Otros',
};

const wb = XLSX.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
const headerIdx = rows.findIndex((r) => r && r[0] === 'Tipo' && r[1] === 'ID Recibo');
if (headerIdx < 0) throw new Error('No se encontró encabezado de cobranzas');

const cobranzas = [];
const byType = {};
const byMethod = {};
let totalAmount = 0;
let minDate = '';
let maxDate = '';

for (let i = headerIdx + 1; i < rows.length; i += 1) {
  const r = rows[i];
  if (!r || !r[0]) continue;
  const type = cell(r[0]);
  const receiptId = cell(r[1]);
  if (!type || !receiptId) continue;

  const date = excelDateToIso(r[2]);
  const amount = money(r[17]);
  const method = detectPrimaryMethod(r);
  const firstName = cell(r[6]);
  const lastName = cell(r[7]);
  const memberName = [lastName, firstName].filter(Boolean).join(', ') || [firstName, lastName].filter(Boolean).join(' ');

  const item = {
    id: `acob-${receiptId}-${i}`,
    type,
    receiptId,
    date,
    month: Number(r[3]) || null,
    year: Number(r[4]) || null,
    memberNumber: cell(r[5]),
    firstName,
    lastName,
    memberName,
    documentNumber: cell(r[8]),
    concept: cell(r[9]),
    cashAmount: money(r[10]),
    checkAmount: money(r[11]),
    checkKind: cell(r[12]),
    transferAmount: money(r[13]),
    electronicAmount: money(r[14]),
    otherAmount: money(r[15]),
    bankName: cell(r[16]),
    amount,
    paymentMethod: method,
    paymentMethodLabel: METHOD_LABELS[method] || method,
    source: 'accessin',
  };
  cobranzas.push(item);

  byType[type] = (byType[type] || 0) + amount;
  byMethod[method] = (byMethod[method] || 0) + amount;
  totalAmount += amount;
  if (date) {
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  }
}

cobranzas.sort((a, b) => {
  const d = String(b.date || '').localeCompare(String(a.date || ''));
  if (d) return d;
  return String(b.receiptId || '').localeCompare(String(a.receiptId || ''));
});

const asOf = picked.date || maxDate || '';
const snapshot = {
  asOf,
  fileName: picked.name,
  generatedAt: asOf ? `${asOf}T00:00:00.000Z` : '',
  periodFrom: minDate,
  periodTo: maxDate,
  count: cobranzas.length,
  totalAmount: Math.round(totalAmount * 100) / 100,
  byType: Object.fromEntries(
    Object.entries(byType).map(([k, v]) => [k, Math.round(v * 100) / 100])
  ),
  byMethod: Object.fromEntries(
    Object.entries(byMethod).map(([k, v]) => [k, Math.round(v * 100) / 100])
  ),
};

fs.mkdirSync(outDir, { recursive: true });
const js = `/** Cobranzas Accessin/LILA ${asOf}. Auto-generado — no editar a mano. */
export const ACCESSIN_COBRANZAS_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_COBRANZAS_METHOD_LABELS = ${JSON.stringify(METHOD_LABELS, null, 2)};
export const ACCESSIN_COBRANZAS_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_COBRANZAS = ${JSON.stringify(cobranzas)};
`;
fs.writeFileSync(outFile, js);
console.log(`Wrote ${cobranzas.length} cobranzas, total ${snapshot.totalAmount} -> ${outFile}`);
console.log(JSON.stringify({
  fileName: picked.name,
  asOf,
  periodFrom: minDate,
  periodTo: maxDate,
  byType: snapshot.byType,
  byMethod: snapshot.byMethod,
}, null, 2));

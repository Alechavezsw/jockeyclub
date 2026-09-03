/**
 * Genera seed de cheques en cartera Accessin/LILA.
 * Source: datita/contabilidad/caja/Cheques/LILA - Cheques en cartera 2026-09-02.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const excelPath = path.join(
  __dirname,
  '../datita/contabilidad/caja/Cheques/LILA - Cheques en cartera 2026-09-02.xlsx'
);
const outDir = path.join(__dirname, '../src/data/seed');
const outFile = path.join(outDir, 'accessinCheques.js');

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

const wb = XLSX.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
const headerIdx = rows.findIndex((r) => r && String(r[0] || '').trim() === '#' && String(r[1] || '').includes('CHEQUE'));
if (headerIdx < 0) throw new Error('No se encontró encabezado de cheques');

const cheques = [];
for (let i = headerIdx + 1; i < rows.length; i += 1) {
  const r = rows[i];
  if (!r) continue;
  const idRaw = r[0];
  const number = cell(r[1]);
  const amount = Number(r[11]);
  // Filas vacías / totales sin número ni monto
  if ((idRaw == null || idRaw === '') && !number && !Number.isFinite(amount)) continue;
  if (!number && !(Number.isFinite(amount) && amount !== 0)) continue;

  const accessinId = idRaw == null || idRaw === '' ? `row-${i}` : idRaw;
  cheques.push({
    id: `achq-${accessinId}`,
    accessinId,
    checkNumber: number,
    bankName: cell(r[2]),
    bankBranch: cell(r[3]),
    issuedByAdmin: /sí|si|true|1|x/i.test(cell(r[4])),
    drawer: cell(r[5]),
    deliveredBy: cell(r[6]),
    enteredAt: excelDateToIso(r[7]),
    exitedAt: excelDateToIso(r[8]),
    collectedAt: excelDateToIso(r[9]),
    dueAt: excelDateToIso(r[10]),
    amount: Number.isFinite(amount) ? amount : 0,
    status: excelDateToIso(r[8]) || excelDateToIso(r[9]) ? 'cleared' : 'in_portfolio',
    source: 'accessin',
  });
}

const inPortfolio = cheques.filter((c) => c.status === 'in_portfolio');
const total = Math.round(inPortfolio.reduce((s, c) => s + (Number(c.amount) || 0), 0) * 100) / 100;

const snapshot = {
  asOf: '2026-09-02',
  generatedAt: '2026-09-02T20:40:00.000Z',
  count: inPortfolio.length,
  total,
  allCount: cheques.length,
};

fs.mkdirSync(outDir, { recursive: true });
const js = `/** Cheques en cartera Accessin/LILA (al 2026-09-02). Auto-generado — no editar a mano. */
export const ACCESSIN_CHEQUES_AS_OF = '2026-09-02';
export const ACCESSIN_CHEQUES_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_CHEQUES = ${JSON.stringify(cheques, null, 2)};
`;
fs.writeFileSync(outFile, js);
console.log(`Wrote ${cheques.length} cheques (in portfolio ${inPortfolio.length}, total ${total}) -> ${outFile}`);

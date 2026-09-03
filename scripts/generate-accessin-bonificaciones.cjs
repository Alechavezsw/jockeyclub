/**
 * Genera seed de bonificaciones Accessin/LILA.
 * Source: datita/contabilidad/bonificaciones/LILA - Bonificaciones 2026-09-03.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const excelPath = path.join(
  __dirname,
  '../datita/contabilidad/bonificaciones/LILA - Bonificaciones 2026-09-03.xlsx'
);
const outFile = path.join(__dirname, '../src/data/seed/accessinBonificaciones.js');

function excelDateToIso(serial) {
  if (serial == null || serial === '') return null;
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}/.test(serial)) return serial.slice(0, 10);
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const parsed = XLSX.SSF.parse_date_code(n);
  if (!parsed) return null;
  return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

const wb = XLSX.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
const headerIdx = rows.findIndex((r) => r && String(r[0] || '').toLowerCase() === 'fecha');
if (headerIdx < 0) throw new Error('No se encontró encabezado de bonificaciones');

const items = [];
for (let i = headerIdx + 1; i < rows.length; i += 1) {
  const r = rows[i];
  if (!r || r[2] == null) continue;
  const memberNumber = String(r[2]).trim();
  const amount = Number(r[6]) || 0;
  const pctRaw = r[7];
  const percentage = pctRaw === '' || pctRaw == null ? null : Number(pctRaw);
  items.push({
    id: `abon-${memberNumber}-${i}`,
    accessinId: i - headerIdx,
    date: excelDateToIso(r[0]),
    familyGroup: r[1] ? String(r[1]).trim() : '',
    memberNumber,
    memberName: r[3] ? String(r[3]).trim() : '',
    documentNumber: r[4] != null ? String(r[4]).trim() : '',
    concept: r[5] ? String(r[5]).trim() : '',
    amount,
    percentage: Number.isFinite(percentage) ? percentage : null,
    reason: r[8] ? String(r[8]).trim() : '',
    appliedBy: r[9] ? String(r[9]).trim() : '',
    category: 'members',
    valueType: Number.isFinite(percentage) ? 'percent' : 'amount',
    value: Number.isFinite(percentage) ? percentage : amount,
    description: (r[8] || r[5] || '').toString().trim(),
    validFrom: excelDateToIso(r[0]),
    validTo: '',
    isActive: true,
    source: 'accessin',
  });
}

const totalAmount = Math.round(items.reduce((s, x) => s + (x.amount || 0), 0) * 100) / 100;
const asOf = '2026-09-03';

const content = `/** Auto-generado desde LILA - Bonificaciones ${asOf}. No editar a mano. */
export const ACCESSIN_BONIFICACIONES_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_BONIFICACIONES_SNAPSHOT = {
  asOf: ${JSON.stringify(asOf)},
  count: ${items.length},
  totalAmount: ${totalAmount},
  uniqueMembers: ${new Set(items.map((i) => i.memberNumber)).size},
};
export const ACCESSIN_BONIFICACIONES = ${JSON.stringify(items)};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, content, 'utf8');
console.log(`Wrote ${items.length} bonificaciones → ${outFile}`);
console.log(`Total ${totalAmount} · socios ${new Set(items.map((i) => i.memberNumber)).size}`);

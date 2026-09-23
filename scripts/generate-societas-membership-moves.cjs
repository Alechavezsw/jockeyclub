/**
 * Seed de altas y bajas Societas.
 * Source: datita/societas/bajas/*.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../datita/societas/bajas');
const outFile = path.join(__dirname, '../src/data/seed/societasMembershipMoves.js');

function cell(value) {
  if (value == null || value === '') return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function memberKey(value) {
  const n = Number.parseInt(digits(value), 10);
  return Number.isFinite(n) ? String(n) : '';
}

function excelDateToIso(serial) {
  if (serial == null || serial === '') return '';
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}/.test(serial)) return serial.slice(0, 10);
  const slash = String(serial).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(Number(slash[2])).padStart(2, '0')}-${String(Number(slash[1])).padStart(2, '0')}`;
  }
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return '';
  const parsed = XLSX.SSF.parse_date_code(n);
  if (!parsed) return '';
  return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

function headerMap(row) {
  const map = {};
  row.forEach((value, idx) => {
    const key = cell(value).toLowerCase();
    if (key) map[key] = idx;
  });
  return map;
}

function col(map, row, ...names) {
  for (const name of names) {
    if (map[name] != null) return row[map[name]];
  }
  return '';
}

function parseSheet(wb, name, dateKeys, extra = {}) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIdx = rows.findIndex((row) => /nro de socio/i.test(cell(row?.[0])));
  if (headerIdx < 0) return [];
  const map = headerMap(rows[headerIdx]);
  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const memberId = memberKey(col(map, row, 'nro de socio'));
    if (!memberId) continue;
    const firstName = cell(col(map, row, 'nombre'));
    const lastName = cell(col(map, row, 'apellido'));
    items.push({
      memberId,
      firstName,
      lastName,
      name: [firstName, lastName].filter(Boolean).join(' '),
      documentNumber: digits(col(map, row, 'dni')) || cell(col(map, row, 'dni')),
      date: excelDateToIso(col(map, row, ...dateKeys)),
      motivo: cell(col(map, row, 'motivo')),
      status: cell(col(map, row, 'estado actual')),
      movimiento: cell(col(map, row, 'movimiento')),
      ...extra,
    });
  }
  return items;
}

function uniqueByKey(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

const files = fs.readdirSync(dir).filter((name) => name.endsWith('.xlsx') && !name.startsWith('~$'));
if (!files.length) throw new Error('No hay Excel de altas y bajas');
const fileName = files.sort().reverse()[0];
const asOf = (fileName.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const wb = XLSX.readFile(path.join(dir, fileName));

const altas = uniqueByKey(
  parseSheet(wb, 'Altas', ['fecha de alta'], { type: 'alta' }),
  (row) => `${row.memberId}|${row.date}|${row.motivo}`,
);
const bajas = uniqueByKey(
  parseSheet(wb, 'Bajas', ['fecha de baja'], { type: 'baja' }),
  (row) => `${row.memberId}|${row.date}|${row.motivo}`,
);

const snapshot = {
  asOf,
  fileName,
  periodFrom: '2026-08-01',
  periodTo: '2026-09-11',
  altas: altas.length,
  bajas: bajas.length,
};

const js = `/** Auto-generado desde Societas ${fileName}. No editar a mano. */
export const SOCIETAS_MEMBERSHIP_MOVES_AS_OF = ${JSON.stringify(asOf)};
export const SOCIETAS_MEMBERSHIP_MOVES_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const SOCIETAS_MEMBERSHIP_ALTAS = ${JSON.stringify(altas)};
export const SOCIETAS_MEMBERSHIP_BAJAS = ${JSON.stringify(bajas)};
`;
fs.writeFileSync(outFile, js);
console.log(`Wrote ${altas.length} altas y ${bajas.length} bajas -> ${outFile}`);

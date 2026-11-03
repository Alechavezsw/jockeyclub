if (process.env.ALLOW_ARCHIVED_IMPORT !== '1') {
  console.error('Archivado: import de Lila, Accessin o Societas. No está en npm. ALLOW_ARCHIVED_IMPORT=1 solo si sabés qué libro pisás.');
  process.exit(1);
}
/**
 * Seed de altas y bajas Societas.
 * Toma solo el Excel más reciente (por fecha en el nombre) entre
 * datita/societas/bajas y datita/Avtualizacion/Socios/Altas y bajas.
 * Cada export es una ventana del período del Resumen, no un acumulado histórico.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const sourceDirs = [
  path.join(__dirname, '../../datita/societas/bajas'),
  path.join(__dirname, '../../datita/Avtualizacion/Socios/Altas y bajas'),
];
const outFile = path.join(__dirname, '../../src/data/seed/societasMembershipMoves.js');

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

function isoFromParts(day, month, year) {
  return `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
}

function parsePeriod(wb) {
  const sheet = wb.Sheets.Resumen;
  if (!sheet) return { from: '', to: '' };
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  for (const row of rows) {
    if (!/per[ií]odo/i.test(cell(row?.[0]))) continue;
    const match = cell(row[1]).match(/(\d{1,2})\/(\d{1,2})\/(\d{4}).*?(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return { from: '', to: '' };
    return {
      from: isoFromParts(match[1], match[2], match[3]),
      to: isoFromParts(match[4], match[5], match[6]),
    };
  }
  return { from: '', to: '' };
}

function collectFiles() {
  const byName = new Map();
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.xlsx') || name.startsWith('~$')) continue;
      const full = path.join(dir, name);
      const prev = byName.get(name);
      if (!prev || fs.statSync(full).mtimeMs >= fs.statSync(prev).mtimeMs) byName.set(name, full);
    }
  }
  return [...byName.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, full]) => full);
}

function pickLatestFile(files) {
  const dated = (name) => (name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  return [...files].sort((a, b) => {
    const baseA = path.basename(a);
    const baseB = path.basename(b);
    const dateCmp = dated(baseB).localeCompare(dated(baseA));
    if (dateCmp !== 0) return dateCmp;
    return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
  })[0];
}

const files = collectFiles();
if (!files.length) throw new Error('No hay Excel de altas y bajas');

const filePath = pickLatestFile(files);
const wb = XLSX.readFile(filePath);
const { from: periodFrom, to: periodTo } = parsePeriod(wb);
const rows = [
  ...parseSheet(wb, 'Altas', ['fecha de alta'], { type: 'alta' }),
  ...parseSheet(wb, 'Bajas', ['fecha de baja'], { type: 'baja' }),
];

const fileName = path.basename(filePath);
const asOf = (fileName.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || periodTo;
const altas = rows.filter((row) => row.type === 'alta');
const bajas = rows.filter((row) => row.type === 'baja');

const snapshot = {
  asOf,
  fileName,
  sources: [fileName],
  periodFrom,
  periodTo,
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
console.log(`Wrote ${altas.length} altas y ${bajas.length} bajas (${periodFrom} a ${periodTo}) desde ${fileName}`);

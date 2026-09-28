/**
 * Seed del Balance Mensual Resumido Accessin/LILA.
 * Toma el Excel más nuevo de Avtualizacion/balances/general resumido
 * y, si no hay, el corte histórico.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const sourceRoots = [
  path.join(__dirname, '../datita/Avtualizacion/Contabilidad/balances/general resumido'),
  path.join(__dirname, '../datita/Avtualizacion/Contabilidad/balances'),
  path.join(__dirname, '../datita/contabilidad/Balances'),
];
const outFile = path.join(__dirname, '../src/data/seed/accessinMonthlyBalanceSummary.js');

const SECTION_HEADERS = [
  'SALDOS DE CAJA',
  'LIQUIDACIÓN',
  'LIQUIDACION',
  'INGRESOS POR TIPO DE ENTRADA',
  'INGRESOS DETALLADOS POR CAJA',
  'EGRESOS POR CATEGORÍA',
  'EGRESOS POR CATEGORIA',
  'EGRESOS DETALLADOS POR CAJA',
  'TOTALES',
];

function collectSummaryExcels() {
  const files = [];
  const seen = new Set();
  const walk = (dir, depth = 0) => {
    if (!fs.existsSync(dir) || depth > 2) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.xlsx') || entry.name.startsWith('~$')) continue;
      if (!/Resumido/i.test(entry.name)) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      const dated = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
      files.push({
        name: entry.name,
        full,
        folder: path.basename(dir),
        date: dated ? dated[1] : '',
        mtime: fs.statSync(full).mtimeMs,
      });
    }
  };
  sourceRoots.forEach((root) => walk(root));
  return files.toSorted((a, b) => String(b.date).localeCompare(String(a.date)) || b.mtime - a.mtime);
}

function cell(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function money(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function slug(value) {
  return cell(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseSpanishMetaDate(raw) {
  const s = cell(raw);
  const m = s.match(/(\d{1,2})\s+de\s+([A-Za-záéíóúÁÉÍÓÚ]+)\s+del\s+(\d{4})/i);
  if (!m) return '';
  const months = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
  };
  const mon = months[m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()];
  if (!mon) return '';
  return `${m[3]}-${mon}-${String(Number(m[1])).padStart(2, '0')}`;
}

function isSectionHeader(label, amount) {
  const u = cell(label).toUpperCase();
  if (SECTION_HEADERS.includes(u)) return true;
  return amount == null && /^[A-ZÁÉÍÓÚÑ0-9 ()/.-]{8,}$/.test(cell(label)) && !/^TOTAL/i.test(label) && !/^Egresos /i.test(label);
}

function lineKind(label, amount) {
  const t = cell(label);
  if (/^TOTAL\b/i.test(t) && !/^TOTALES$/i.test(t)) return 'total';
  if (/\(total\)$/i.test(t) || t === 'Total') return 'subtotal';
  if (isSectionHeader(t, amount)) return 'section';
  return 'item';
}

const picked = collectSummaryExcels()[0];
if (!picked) throw new Error('No hay Excel de Balance Mensual Resumido');

const wb = XLSX.readFile(picked.full);
const sheetName = wb.SheetNames.find((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)) || wb.SheetNames[0];
const mainRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });

let generatedAt = '';
let periodFrom = '';
let periodTo = '';
let client = '';
for (const row of mainRows) {
  const a = cell(row?.[0]);
  if (/^Generado el/i.test(a)) generatedAt = a.replace(/^Generado el\s+/i, '');
  if (/^Cliente:/i.test(a)) client = a.replace(/^Cliente:\s*/i, '');
  if (/Periodo desde/i.test(a)) periodFrom = parseSpanishMetaDate(a);
  if (/Periodo hasta/i.test(a)) periodTo = parseSpanishMetaDate(a);
}

const sections = [];
let current = null;
let lineId = 0;

for (const row of mainRows) {
  const label = cell(row?.[0]);
  if (!label) continue;
  if (/^Generado el|^Cliente:|Periodo /i.test(label)) continue;
  const amount = money(row?.[1]);
  const kind = lineKind(label, amount);
  if (kind === 'section') {
    current = { id: slug(label) || `sec-${sections.length}`, title: label, lines: [] };
    sections.push(current);
    continue;
  }
  if (!current) {
    current = { id: 'resumen', title: 'Resumen', lines: [] };
    sections.push(current);
  }
  current.lines.push({
    id: `mbs-${lineId}`,
    label,
    amount,
    kind,
  });
  lineId += 1;
}

function amountOf(labelRe) {
  for (const section of sections) {
    const hit = section.lines.find((line) => labelRe.test(line.label));
    if (hit && hit.amount != null) return hit.amount;
  }
  return 0;
}

function sumSection(id) {
  const section = sections.find((s) => s.id === id);
  if (!section) return 0;
  return Math.round(section.lines
    .filter((l) => l.kind === 'item' && l.amount != null)
    .reduce((s, l) => s + l.amount, 0) * 100) / 100;
}

const asOf = periodTo || parseSpanishMetaDate(generatedAt) || picked.date || '';
const snapshot = {
  asOf,
  fileName: picked.name,
  sourceFolder: picked.folder,
  complete: false,
  summarized: true,
  client: client || 'Jockey Club San Juan',
  generatedAt,
  periodFrom,
  periodTo,
  periodLabel: periodFrom ? periodFrom.slice(0, 7) : '',
  totalIncome: amountOf(/^TOTAL INGRESOS$/i),
  totalIncomeCash: amountOf(/^TOTAL INGRESOS EN CAJA$/i),
  totalExpenses: amountOf(/^TOTAL EGRESOS$/i),
  totalExpensesCash: amountOf(/^TOTAL EGRESOS EN CAJA$/i),
  cashOnHand: sumSection('saldos_de_caja'),
  closingCash: sumSection('totales'),
};

const body = `/** Auto-generado desde LILA - Balance Mensual Resumido ${asOf}. No editar a mano. */
export const ACCESSIN_MONTHLY_BALANCE_SUMMARY_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_MONTHLY_BALANCE_SUMMARY_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS = ${JSON.stringify(sections)};
`;

fs.writeFileSync(outFile, body);
console.log(`Wrote monthly balance summary ${asOf} folder=${picked.folder} sections=${sections.length}`);
console.log(JSON.stringify({
  fileName: picked.name,
  totalIncome: snapshot.totalIncome,
  totalIncomeCash: snapshot.totalIncomeCash,
  cashOnHand: snapshot.cashOnHand,
  closingCash: snapshot.closingCash,
}, null, 2));

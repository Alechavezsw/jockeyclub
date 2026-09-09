/**
 * Genera seed de cuentas corrientes detalladas (Accessin/LILA).
 * Source: datita/contabilidad/CC detalladas/*.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../datita/contabilidad/CC detalladas');
const outFile = path.join(__dirname, '../src/data/seed/accessinDetailedCurrentAccounts.js');

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function cell(v) {
  if (v == null || v === '') return '';
  return String(v).trim();
}

function padMember(n) {
  return String(n ?? '').replace(/\D/g, '') || '';
}

function parseSpanishMetaDate(raw) {
  const s = cell(raw);
  const m = s.match(/(\d{1,2})\s+de\s+([A-Za-záéíóúÁÉÍÓÚ]+)\s+del\s+(\d{4})/i);
  if (!m) return '';
  const MONTHS = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  };
  const mon = MONTHS[m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()];
  if (!mon) return '';
  return `${m[3]}-${String(mon).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

function parseSlashDate(raw) {
  const s = cell(raw);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

function periodFromIso(iso) {
  if (!/^\d{4}-\d{2}/.test(iso || '')) return { periodKey: '', periodLabel: '' };
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  return {
    periodKey: iso.slice(0, 7),
    periodLabel: `${MONTHS_ES[m - 1] || m} del ${y}`,
  };
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && /Detalle/i.test(f));
if (!files.length) throw new Error('No hay Excel de CC detalladas');

const fileName = files.sort().reverse()[0];
const wb = XLSX.readFile(path.join(dir, fileName));

// --- General ---
const generalAoa = XLSX.utils.sheet_to_json(wb.Sheets.General || wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
let generatedAt = '';
let periodFrom = '';
let periodTo = '';
let totalFeeEntries = 0;
let totalCollected = 0;
for (const r of generalAoa) {
  const a = cell(r?.[0]);
  const b = r?.[1];
  if (/^Generado el/i.test(a)) generatedAt = a.replace(/^Generado el\s+/i, '');
  if (/Periodo desde/i.test(a)) periodFrom = parseSpanishMetaDate(a.replace(/^Periodo desde el\s+/i, ''));
  if (/Periodo hasta/i.test(a)) periodTo = parseSpanishMetaDate(a.replace(/^Periodo hasta el\s+/i, ''));
  if (/Total entradas de cuotas/i.test(a)) totalFeeEntries = money(b);
  if (/Total Recaudado/i.test(a)) totalCollected = money(b);
}

const asOf = periodTo || parseSpanishMetaDate(generatedAt) || (fileName.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';

// --- Cuotas ---
const aoa = XLSX.utils.sheet_to_json(wb.Sheets.Cuotas || wb.Sheets[wb.SheetNames[1]], { header: 1, defval: '' });
const headerIdx = aoa.findIndex((r) => String(r?.[0] || '').trim() === '#' && /NUMERO|NRO/i.test(String(r?.[1] || '')));
if (headerIdx < 0) throw new Error('Sin encabezado de CC detalladas');

const byNumber = {};
let lineCount = 0;
let unpaidLines = 0;
let sumAmount = 0;
let sumPaid = 0;

for (let i = headerIdx + 1; i < aoa.length; i += 1) {
  const r = aoa[i];
  if (!r) continue;
  const accessinId = Number(r[0]);
  const memberNumber = padMember(r[1]);
  if (!memberNumber || !Number.isFinite(accessinId)) continue;

  const firstName = cell(r[2]);
  const lastName = cell(r[3]);
  const descRaw = cell(r[7]);
  const feeDate = /^\d{4}-\d{2}-\d{2}/.test(descRaw) ? descRaw.slice(0, 10) : parseSlashDate(r[8]);
  const { periodKey, periodLabel } = periodFromIso(feeDate || descRaw);
  const amount = money(r[9]);
  const paid = money(r[10]);
  const owed = Math.round((amount - paid) * 100) / 100;

  const line = {
    id: accessinId,
    feeDate,
    periodKey,
    amount,
    paid,
    owed,
  };

  if (!byNumber[memberNumber]) {
    byNumber[memberNumber] = {
      memberNumber,
      firstName,
      lastName,
      memberName: `${firstName} ${lastName}`.trim(),
      dni: cell(r[4]),
      socialFee: cell(r[5]) === '–' ? '' : cell(r[5]),
      feeCategory: cell(r[11]),
      lines: [],
      totalAmount: 0,
      totalPaid: 0,
      totalOwed: 0,
    };
  }
  const bucket = byNumber[memberNumber];
  if (!bucket.socialFee && cell(r[5]) && cell(r[5]) !== '–') bucket.socialFee = cell(r[5]);
  if (!bucket.feeCategory && cell(r[11])) bucket.feeCategory = cell(r[11]);
  bucket.lines.push(line);
  bucket.totalAmount = Math.round((bucket.totalAmount + amount) * 100) / 100;
  bucket.totalPaid = Math.round((bucket.totalPaid + paid) * 100) / 100;
  bucket.totalOwed = Math.round((bucket.totalOwed + Math.max(0, owed)) * 100) / 100;

  lineCount += 1;
  sumAmount += amount;
  sumPaid += paid;
  if (owed > 0.009) unpaidLines += 1;
}

Object.values(byNumber).forEach((m) => {
  m.lines = m.lines.toSorted((a, b) => String(a.feeDate).localeCompare(String(b.feeDate)) || a.id - b.id);
});

const snapshot = {
  asOf,
  asOfLabel: generatedAt || asOf,
  sourceFile: fileName,
  periodFrom,
  periodTo,
  totalFeeEntries: totalFeeEntries || Math.round(sumAmount * 100) / 100,
  totalCollected: totalCollected || Math.round(sumPaid * 100) / 100,
  lineCount,
  memberCount: Object.keys(byNumber).length,
  unpaidLines,
  sumAmount: Math.round(sumAmount * 100) / 100,
  sumPaid: Math.round(sumPaid * 100) / 100,
};

const body = `/** Auto-generado por scripts/generate-accessin-detailed-current-accounts.cjs — no editar a mano. */
export const ACCESSIN_DETAILED_CC_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_DETAILED_CC_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_DETAILED_CC_BY_NUMBER = ${JSON.stringify(byNumber)};
`;

fs.writeFileSync(outFile, body, 'utf8');
console.log(`Wrote ${outFile}`);
console.log(`members=${snapshot.memberCount} lines=${lineCount} unpaid=${unpaidLines} amount=${snapshot.sumAmount} paid=${snapshot.sumPaid}`);

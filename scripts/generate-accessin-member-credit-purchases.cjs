/**
 * Seed de créditos comprados por socios (Accessin/LILA).
 * Source: datita/contabilidad/socios comprados por socios/*.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../datita/contabilidad/socios comprados por socios');
const outFile = path.join(__dirname, '../src/data/seed/accessinMemberCreditPurchases.js');

function cell(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function excelDateToIso(serial) {
  if (serial == null || serial === '') return '';
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}/.test(serial)) return serial.slice(0, 10);
  const slash = String(serial).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
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

const files = fs.readdirSync(dir).filter((name) => name.endsWith('.xlsx') && !name.startsWith('~$'));
if (!files.length) throw new Error('No hay Excel de créditos comprados por socios');
const fileName = files.sort().reverse()[0];
const asOf = (fileName.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const wb = XLSX.readFile(path.join(dir, fileName));
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
const headerIdx = rows.findIndex((row) => /nro de socio/i.test(cell(row?.[0])) && /combo/i.test(cell(row?.[5])));
if (headerIdx < 0) throw new Error('Sin encabezado de créditos comprados');

const items = [];
for (let i = headerIdx + 1; i < rows.length; i += 1) {
  const row = rows[i];
  const memberNumber = digits(row?.[0]);
  if (!memberNumber) continue;
  const firstName = cell(row?.[1]);
  const lastName = cell(row?.[2]);
  const totalAmount = money(row?.[8]);
  const collectedAmount = money(row?.[11]);
  items.push({
    id: `cred-${memberNumber}-${i}`,
    memberNumber,
    firstName,
    lastName,
    memberName: [firstName, lastName].filter(Boolean).join(' '),
    documentNumber: digits(row?.[3]) || cell(row?.[3]),
    purchasedAt: excelDateToIso(row?.[4]),
    combo: cell(row?.[5]),
    credits: Number(row?.[6]) || 0,
    paymentMethod: cell(row?.[7]),
    totalAmount,
    status: cell(row?.[9]),
    collectedAt: excelDateToIso(row?.[10]),
    collectedAmount,
    difference: row?.[12] === '' ? Math.round((totalAmount - collectedAmount) * 100) / 100 : money(row?.[12]),
    source: 'accessin',
  });
}

const snapshot = {
  asOf,
  fileName,
  count: items.length,
  uniqueMembers: new Set(items.map((row) => row.memberNumber)).size,
  totalAmount: Math.round(items.reduce((sum, row) => sum + row.totalAmount, 0) * 100) / 100,
  collectedAmount: Math.round(items.reduce((sum, row) => sum + row.collectedAmount, 0) * 100) / 100,
  difference: Math.round(items.reduce((sum, row) => sum + (Number(row.difference) || 0), 0) * 100) / 100,
  credits: items.reduce((sum, row) => sum + (Number(row.credits) || 0), 0),
};

const js = `/** Auto-generado desde LILA - Créditos comprados por socios ${asOf}. No editar a mano. */
export const ACCESSIN_CREDIT_PURCHASES_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_CREDIT_PURCHASES_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_CREDIT_PURCHASES = ${JSON.stringify(items)};
`;
fs.writeFileSync(outFile, js);
console.log(`Wrote ${items.length} compras, total ${snapshot.totalAmount} -> ${outFile}`);

/**
 * Genera seed de saldos de cuentas corrientes (Accessin/LILA).
 * Source: datita/contabilidad/saldos/*.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../datita/contabilidad/saldos');
const outFile = path.join(__dirname, '../src/data/seed/accessinCurrentAccountBalances.js');

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
  const s = String(n ?? '').replace(/\D/g, '');
  return s || '';
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && /Saldos/i.test(f));
if (!files.length) throw new Error('No hay Excel de saldos en datita/contabilidad/saldos');

const fileName = files.sort().reverse()[0];
const wb = XLSX.readFile(path.join(dir, fileName));
const sheet = wb.Sheets[wb.SheetNames[0]];
const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

const generatedRaw = cell(aoa[0]?.[1] || aoa[0]?.[0]);
const asOfRaw = cell(aoa[1]?.[1] || '');
const headerIdx = aoa.findIndex((r) => String(r?.[0] || '').trim() === '#' && /NRO/i.test(String(r?.[1] || '')));
if (headerIdx < 0) throw new Error('No se encontró encabezado de saldos');

/** Extrae ISO de "03 de Septiembre del 2026" o del nombre del archivo. */
function parseAsOf(label, fallbackName) {
  const m = String(label || '').match(/(\d{1,2})\s+de\s+([A-Za-záéíóúÁÉÍÓÚ]+)\s+del\s+(\d{4})/i);
  const MONTHS = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
  };
  if (m) {
    const mon = MONTHS[m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  const fromName = String(fallbackName || '').match(/(\d{4}-\d{2}-\d{2})/);
  return fromName ? fromName[1] : new Date().toISOString().slice(0, 10);
}

const asOf = parseAsOf(asOfRaw || generatedRaw, fileName);
const byNumber = {};
const rows = [];
let withBalance = 0;
let totalBalance = 0;

for (let i = headerIdx + 1; i < aoa.length; i += 1) {
  const r = aoa[i];
  if (!r) continue;
  const memberNumber = padMember(r[1]);
  if (!memberNumber) continue;

  const unpaidCapital = money(r[7]);
  const unpaidSurcharges = money(r[8]);
  const unpaidInterest = money(r[9]);
  const unallocated = money(r[10]);
  const balance = money(r[11]);
  const firstName = cell(r[2]);
  const lastName = cell(r[3]);

  const item = {
    accessinId: Number(r[0]) || null,
    memberNumber,
    firstName,
    lastName,
    memberName: `${firstName} ${lastName}`.trim(),
    dni: cell(r[4]),
    socialFee: cell(r[5]),
    sportsFee: cell(r[6]) === '–' || cell(r[6]) === '-' ? '' : cell(r[6]),
    unpaidCapital,
    unpaidSurcharges,
    unpaidInterest,
    unallocated,
    balance,
  };

  byNumber[memberNumber] = item;
  rows.push(item);
  if (balance !== 0) {
    withBalance += 1;
    totalBalance += balance;
  }
}

const snapshot = {
  asOf,
  asOfLabel: asOfRaw || generatedRaw || asOf,
  sourceFile: fileName,
  rowCount: rows.length,
  withBalance,
  totalBalance: Math.round(totalBalance * 100) / 100,
};

const body = `/** Auto-generado por scripts/generate-accessin-current-account-balances.cjs — no editar a mano. */
export const ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
/** Mapa nro. socio → saldo CC LILA (fuente de verdad). */
export const ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER = ${JSON.stringify(byNumber)};
`;

fs.writeFileSync(outFile, body, 'utf8');
console.log(`Wrote ${outFile}`);
console.log(`rows=${rows.length} withBalance=${withBalance} total=${snapshot.totalBalance} asOf=${asOf}`);

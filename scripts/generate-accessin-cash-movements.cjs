/**
 * Genera seed de movimientos de caja Accessin desde Excel LILA.
 * Toma el Excel más nuevo entre Avtualizacion/Contabilidad/Movimiento de cajas
 * y el corte histórico.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const sourceDirs = [
  path.join(__dirname, '../datita/Avtualizacion/Contabilidad/Movimiento de cajas'),
  path.join(__dirname, '../datita/contabilidad/caja/movimiento e cajas'),
];
const outDir = path.join(__dirname, '../src/data/seed');
const outFile = path.join(outDir, 'accessinCashMovements.js');
// Corte y cajas van en un archivo aparte: los usa el store del ERP al arrancar, y los
// movimientos (~600 kB) se cargan con import() diferido fuera del chunk de entrada.
const snapshotFile = path.join(outDir, 'accessinCashSnapshot.js');

function collectCashExcels() {
  const files = [];
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.xlsx') || name.startsWith('~$')) continue;
      if (!/Movimientos de caja/i.test(name)) continue;
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

function parseSpanishMetaDate(raw) {
  const s = String(raw || '').trim();
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

const picked = collectCashExcels()[0];
if (!picked) throw new Error('No hay Excel de Movimientos de caja');
const excelPath = picked.full;

const WALLET_META = {
  Efectivo: { id: 'wallet-efectivo', kind: 'cash', label: 'Efectivo', accountId: 'coa-1.1.01' },
  'Mercado Pago (ARS)': { id: 'wallet-mp', kind: 'bank', label: 'Mercado Pago (ARS)', accountId: 'coa-1.1.03' },
  'Banco de San Juan (ARS)': { id: 'wallet-bsj', kind: 'bank', label: 'Banco de San Juan (ARS)', accountId: 'coa-1.1.03' },
  'Banco Macro (ARS)': { id: 'wallet-macro', kind: 'bank', label: 'Banco Macro (ARS)', accountId: 'coa-1.1.03' },
  'Banco Itaú (ARS)': { id: 'wallet-itau', kind: 'bank', label: 'Banco Itaú (ARS)', accountId: 'coa-1.1.03' },
};

function excelDateToIso(serial) {
  if (serial == null || serial === '') return null;
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}/.test(serial)) return serial.slice(0, 10);
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const parsed = XLSX.SSF.parse_date_code(n);
  if (!parsed) return null;
  const mm = String(parsed.m).padStart(2, '0');
  const dd = String(parsed.d).padStart(2, '0');
  return `${parsed.y}-${mm}-${dd}`;
}

function mapMovementType(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (t.includes('efectivo')) return 'income';
  if (t.includes('egreso') || t.includes('pago a') || t.includes('salida')) return 'expense';
  return 'income';
}

const wb = XLSX.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

let generatedAt = '';
let periodFrom = '';
let periodTo = '';
for (const row of rows) {
  const a = String(row?.[0] || '').trim();
  if (/^Generado el/i.test(a)) generatedAt = a.replace(/^Generado el\s+/i, '');
  if (/Periodo desde/i.test(a)) periodFrom = parseSpanishMetaDate(a);
  if (/Periodo hasta/i.test(a)) periodTo = parseSpanishMetaDate(a);
}

const headerIdx = rows.findIndex((r) => r && String(r[0] || '').includes('ID CONCEPTO'));
if (headerIdx < 0) throw new Error('No se encontró encabezado de movimientos de caja');

const body = rows.slice(headerIdx + 1);
const openingRow = body.find((r) => r && String(r[0] || '').startsWith('Saldo al'));
const closingRow = [...body].reverse().find((r) => r && String(r[0] || '').startsWith('Saldo al'));

const openingBalance = Number(openingRow?.[5]) || 0;
const closingBalance = Number(closingRow?.[5]) || 0;

const movements = [];
const periodInflows = {};
const walletsSeen = new Map();

for (const r of body) {
  if (!r || r[0] == null) continue;
  if (typeof r[0] !== 'number') continue;
  const walletName = String(r[2] || '').trim();
  const tipo = String(r[3] || '').trim();
  const description = r[4] == null ? '' : String(r[4]).trim();
  const amount = Number(r[5]) || 0;
  const date = excelDateToIso(r[1]);
  const meta = WALLET_META[walletName] || {
    id: `wallet-${walletName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    kind: 'bank',
    label: walletName || 'Sin caja',
    accountId: 'coa-1.1.03',
  };
  walletsSeen.set(meta.id, { ...meta, name: walletName || meta.label });
  periodInflows[walletName || meta.label] = (periodInflows[walletName || meta.label] || 0) + amount;

  const memberNumber = /^\d+$/.test(description) ? description : '';
  movements.push({
    id: `acm-${r[0]}`,
    accessinId: r[0],
    date,
    walletId: meta.id,
    walletName: walletName || meta.label,
    walletKind: meta.kind,
    typeLabel: tipo || 'Movimiento',
    movementType: mapMovementType(tipo),
    description,
    memberNumber,
    familyGroup: memberNumber ? `G-F ${memberNumber}` : '',
    amount,
    source: 'accessin',
    createdAt: date ? `${date}T12:00:00.000Z` : `${picked.date || periodTo || '2026-09-26'}T12:00:00.000Z`,
  });
}

movements.sort((a, b) => {
  const d = String(b.date || '').localeCompare(String(a.date || ''));
  if (d) return d;
  return (b.accessinId || 0) - (a.accessinId || 0);
});

const cashInflow = periodInflows.Efectivo || 0;
const bankInflow = Object.entries(periodInflows)
  .filter(([k]) => k !== 'Efectivo')
  .reduce((s, [, v]) => s + v, 0);

const registers = [...walletsSeen.values()].map((w) => ({
  id: w.id,
  code: w.id.replace('wallet-', 'CAJA-').toUpperCase(),
  name: w.name || w.label,
  location: w.kind === 'cash' ? 'Efectivo' : 'Bancos / billeteras',
  accountId: w.accountId,
  isActive: true,
  walletKind: w.kind,
  meta: { source: 'accessin' },
}));

const asOf = periodTo || picked.date || parseSpanishMetaDate(generatedAt) || '';
const snapshot = {
  asOf,
  fileName: picked.name,
  generatedAt,
  periodFrom,
  periodTo,
  openingBalance,
  closingBalance,
  cheques: 0,
  periodInflows,
  // Solo datos del Excel: el desglose absoluto Efectivo/Bancos no viene en el reporte.
  // Las tarjetas de Efectivo/Bancos muestran ingresos reales del período.
  cards: {
    efectivo: { label: 'Efectivo', periodInflow: cashInflow, balance: null },
    cheques: { label: 'Cheques en Cartera', periodInflow: 0, balance: 0 },
    bancos: { label: 'Cuentas Bancarias', periodInflow: bankInflow, balance: null },
    total: { label: 'Total Caja', balance: closingBalance },
  },
};

fs.mkdirSync(outDir, { recursive: true });
const snapshotJs = `/** Corte de caja Accessin ${asOf}. Auto-generado — no editar a mano. */
export const ACCESSIN_CASH_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_CASH_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_CASH_REGISTERS = ${JSON.stringify(registers, null, 2)};
`;
const movementsJs = `/** Movimientos de caja Accessin ${asOf}. Auto-generado — no editar a mano. */
export const ACCESSIN_CASH_MOVEMENTS = ${JSON.stringify(movements)};
`;
fs.writeFileSync(snapshotFile, snapshotJs);
fs.writeFileSync(outFile, movementsJs);
console.log(`Wrote ${registers.length} wallets -> ${snapshotFile}`);
console.log(`Wrote ${movements.length} movements -> ${outFile}`);
console.log(JSON.stringify({
  fileName: picked.name,
  asOf,
  periodFrom,
  periodTo,
  openingBalance,
  closingBalance,
  cashInflow,
  bankInflow,
}, null, 2));

/**
 * Genera seed de movimientos de caja Accessin desde Excel LILA.
 * Source: datita/contabilidad/caja/movimiento e cajas/Movimientos de caja - 2026-09-02.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const excelPath = path.join(
  __dirname,
  '../datita/contabilidad/caja/movimiento e cajas/Movimientos de caja - 2026-09-02.xlsx'
);
const outDir = path.join(__dirname, '../src/data/seed');
const outFile = path.join(outDir, 'accessinCashMovements.js');

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
    createdAt: date ? `${date}T12:00:00.000Z` : '2026-09-02T20:28:00.000Z',
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

const snapshot = {
  asOf: '2026-09-02',
  generatedAt: '2026-09-02T20:28:00.000Z',
  periodFrom: '2026-07-02',
  periodTo: '2026-09-02',
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
const js = `/** Movimientos de caja Accessin (jul–sep 2026). Auto-generado — no editar a mano. */
export const ACCESSIN_CASH_AS_OF = '2026-09-02';
export const ACCESSIN_CASH_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_CASH_REGISTERS = ${JSON.stringify(registers, null, 2)};
export const ACCESSIN_CASH_MOVEMENTS = ${JSON.stringify(movements)};
`;
fs.writeFileSync(outFile, js);
console.log(`Wrote ${movements.length} movements, ${registers.length} wallets -> ${outFile}`);
console.log('closing', closingBalance, 'opening', openingBalance);

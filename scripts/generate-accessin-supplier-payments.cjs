/**
 * Genera seed de pagos a proveedores Accessin/LILA.
 * Source: datita/contabilidad/Pago a proveedores/Reporte de Pagos a Proveedores - 2026-09-02.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const excelPath = path.join(
  __dirname,
  '../datita/contabilidad/Pago a proveedores/Reporte de Pagos a Proveedores - 2026-09-02.xlsx'
);
const outDir = path.join(__dirname, '../src/data/seed');
const outFile = path.join(outDir, 'accessinSupplierPayments.js');

const METHOD_LABELS = {
  efectivo: 'Efectivo',
  cheques: 'Cheques',
  transferencia: 'Transferencia',
  debito: 'Débito',
  tarjeta: 'Tarjeta',
  otros: 'Otros',
};

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

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function detectPrimaryMethod(r) {
  const pairs = [
    ['efectivo', money(r[8])],
    ['cheques', money(r[9])],
    ['transferencia', money(r[11])],
    ['debito', money(r[12])],
    ['tarjeta', money(r[13])],
    ['otros', money(r[14])],
  ];
  const hit = pairs.find(([, amt]) => amt > 0);
  return hit ? hit[0] : 'otros';
}

const wb = XLSX.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
const headerIdx = rows.findIndex((r) => r && String(r[0] || '').includes('ID Orden'));
if (headerIdx < 0) throw new Error('No se encontró encabezado de pagos a proveedores');

const payments = [];
const byMethod = {};
let totalAmount = 0;
let minDate = '';
let maxDate = '';

for (let i = headerIdx + 1; i < rows.length; i += 1) {
  const r = rows[i];
  if (!r) continue;
  const orderId = cell(r[0]);
  const supplierName = cell(r[2]);
  const amount = money(r[16]);
  if (!orderId && !supplierName && !amount) continue;

  const date = excelDateToIso(r[1]);
  const method = detectPrimaryMethod(r);
  const item = {
    id: `aspp-${orderId || i}`,
    orderId: orderId || `row-${i}`,
    date,
    supplierName,
    concept: cell(r[3]),
    invoiceNumber: cell(r[4]),
    preparedBy: cell(r[5]),
    authorizedBy: cell(r[6]),
    withdrawnBy: cell(r[7]),
    cashAmount: money(r[8]),
    checkAmount: money(r[9]),
    checkKind: cell(r[10]),
    transferAmount: money(r[11]),
    debitAmount: money(r[12]),
    cardAmount: money(r[13]),
    otherAmount: money(r[14]),
    bankName: cell(r[15]),
    amount,
    paymentMethod: method,
    paymentMethodLabel: METHOD_LABELS[method] || method,
    source: 'accessin',
    status: 'paid',
  };
  payments.push(item);
  byMethod[method] = (byMethod[method] || 0) + amount;
  totalAmount += amount;
  if (date) {
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  }
}

payments.sort((a, b) => {
  const d = String(b.date || '').localeCompare(String(a.date || ''));
  if (d) return d;
  return String(b.orderId || '').localeCompare(String(a.orderId || ''));
});

const snapshot = {
  asOf: '2026-09-02',
  generatedAt: '2026-09-02T00:00:00.000Z',
  periodFrom: minDate || null,
  periodTo: maxDate || null,
  count: payments.length,
  totalAmount: Math.round(totalAmount * 100) / 100,
  byMethod: Object.fromEntries(
    Object.entries(byMethod).map(([k, v]) => [k, Math.round(v * 100) / 100])
  ),
};

fs.mkdirSync(outDir, { recursive: true });
const js = `/** Pagos a proveedores Accessin/LILA (al 2026-09-02). Auto-generado — no editar a mano. */
export const ACCESSIN_SUPPLIER_PAYMENTS_AS_OF = '2026-09-02';
export const ACCESSIN_SUPPLIER_PAYMENTS_METHOD_LABELS = ${JSON.stringify(METHOD_LABELS, null, 2)};
export const ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_SUPPLIER_PAYMENTS = ${JSON.stringify(payments, null, 2)};
`;
fs.writeFileSync(outFile, js);
console.log(`Wrote ${payments.length} payments, total ${snapshot.totalAmount} -> ${outFile}`);

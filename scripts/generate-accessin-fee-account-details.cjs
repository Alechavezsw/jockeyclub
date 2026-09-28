/**
 * Genera seed de detalle de cuentas contables de cuotas (Accessin/LILA).
 * Toma el corte más nuevo de Cuentas contables (socio familiar por concepto,
 * cobro e individuales). Si no hay archivos nuevos, usa el directorio anterior.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const sourceDirs = [
  path.join(__dirname, '../datita/Avtualizacion/Contabilidad/Cuotas/Cuentas contables/socio familiar'),
  path.join(__dirname, '../datita/contabilidad/Cuotas/Detalles de las cuotas'),
];
const outFile = path.join(__dirname, '../src/data/seed/accessinFeeAccountDetails.js');

const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function parseSpanishDate(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  // "06 de julio del 2026" | "01 de marzo del 2025"
  const m = s.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+del?\s+(\d{4})/i);
  if (!m) return '';
  const day = String(Number(m[1])).padStart(2, '0');
  const monKey = m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const month = MONTHS[monKey];
  if (!month) return '';
  return `${m[3]}-${String(month).padStart(2, '0')}-${day}`;
}

function parsePeriodRange(raw) {
  const s = String(raw || '');
  const parts = s.split(/\s*-\s*/);
  if (parts.length < 2) return { from: '', to: '' };
  const left = parts[0].replace(/^per[ií]odo(?: de cobro)?:\s*/i, '').trim();
  const right = parts[1].trim();
  return { from: parseSpanishDate(left), to: parseSpanishDate(right) };
}

function foldHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function headerIndex(headers, name) {
  return headers.findIndex((cell) => foldHeader(cell) === name);
}

function cellText(row, idx) {
  if (idx < 0 || row[idx] == null || row[idx] === '') return '';
  return String(row[idx]).trim();
}

function cellNumber(row, idx) {
  if (idx < 0 || row[idx] == null || row[idx] === '') return null;
  const n = Number(row[idx]);
  return Number.isFinite(n) ? n : null;
}

function periodFromFileName(fileName) {
  const folded = foldHeader(fileName);
  const match = folded.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+del\s+(\d{4})/);
  if (!match) return { periodKey: '', periodLabel: '' };
  const month = MONTHS[match[1]];
  const periodKey = `${match[2]}-${String(month).padStart(2, '0')}`;
  const label = `${match[1].charAt(0).toUpperCase()}${match[1].slice(1)} del ${match[2]}`;
  return { periodKey, periodLabel: label };
}

function collectFiles() {
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.xlsx') && !name.startsWith('~$') && /detalle cuentas contables/i.test(name))
      .map((name) => path.join(dir, name));
    if (files.length) return files;
  }
  return [];
}

function slugAccount(label) {
  return String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseFile(filePath) {
  const fileName = path.basename(filePath);
  const wb = XLSX.readFile(filePath);
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const accountLabel = String(aoa[0]?.[0] || '')
    .replace(/^CUENTA CONTABLE:\s*/i, '')
    .trim();
  const exportDateRaw = String(aoa[1]?.[0] || '').replace(/^Fecha de exportación:\s*/i, '').trim();
  const periodRaw = String(aoa[2]?.[0] || '');
  const range = parsePeriodRange(periodRaw);
  const headerIdx = aoa.findIndex((row) => foldHeader(row?.[0]) === 'dni');
  if (headerIdx < 0) throw new Error(`Sin encabezado DNI en ${fileName}`);
  const headers = aoa[headerIdx];
  const col = {
    dni: headerIndex(headers, 'dni'),
    member: headerIndex(headers, 'numero de socio'),
    first: headerIndex(headers, 'nombre'),
    last: headerIndex(headers, 'apellido'),
    collected: headerIndex(headers, 'fecha de cobro'),
    fee: headerIndex(headers, 'fecha'),
    type: headerIndex(headers, 'tipo'),
    description: headerIndex(headers, 'descripcion'),
    billed: headerIndex(headers, 'importe'),
    due: headerIndex(headers, 'total a pagar'),
    collectedAmount: headerIndex(headers, 'cobrado'),
    pending: headerIndex(headers, 'pendiente'),
  };
  const periodKind = /per[ií]odo de cobro/i.test(periodRaw) || col.billed < 0
    ? 'cobro'
    : 'concepto';
  const named = periodFromFileName(fileName);

  const lines = [];
  let total = 0;
  let billedTotal = 0;
  let pendingTotal = 0;
  let hasSheetTotal = false;
  for (let i = headerIdx + 1; i < aoa.length; i += 1) {
    const row = aoa[i];
    if (!row) continue;
    if (row.some((cell) => foldHeader(cell) === 'totales')) {
      const sheetTotal = cellNumber(row, col.collectedAmount);
      if (sheetTotal != null) {
        total = sheetTotal;
        hasSheetTotal = true;
      }
      continue;
    }
    const memberNumber = cellText(row, col.member);
    if (!memberNumber || foldHeader(memberNumber) === 'totales') continue;
    const collectedAmount = cellNumber(row, col.collectedAmount);
    const billed = cellNumber(row, col.billed);
    const amount = collectedAmount != null ? collectedAmount : (billed || 0);
    const pending = cellNumber(row, col.pending);
    const firstName = cellText(row, col.first);
    const lastName = cellText(row, col.last);
    const feeRaw = cellText(row, col.fee);
    const collectedRaw = cellText(row, col.collected);
    const line = {
      dni: cellText(row, col.dni),
      memberNumber,
      memberName: `${firstName} ${lastName}`.trim(),
      collectedAt: parseSpanishDate(collectedRaw),
      collectedAtLabel: collectedRaw,
      feeDate: parseSpanishDate(feeRaw),
      feeDateLabel: feeRaw,
      type: cellText(row, col.type),
      description: cellText(row, col.description),
      amount,
    };
    if (billed != null) line.billed = billed;
    if (collectedAmount != null) line.collected = collectedAmount;
    if (pending != null) line.pending = pending;
    else if (billed != null) line.pending = Math.round((billed - amount) * 100) / 100;
    const due = cellNumber(row, col.due);
    if (due != null) line.due = due;
    lines.push(line);
    if (billed != null) billedTotal += billed;
    if (line.pending != null) pendingTotal += line.pending;
  }

  if (!hasSheetTotal) total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const tabLabel = periodKind === 'concepto'
    ? `${accountLabel} · concepto`
    : (/familiar/i.test(accountLabel) ? `${accountLabel} · cobro` : accountLabel);

  return {
    id: `fac-${slugAccount(accountLabel)}-${periodKind}-${named.periodKey || 'corte'}`,
    accountLabel,
    tabLabel,
    periodKind,
    periodKey: named.periodKey,
    periodLabel: named.periodLabel,
    exportDate: parseSpanishDate(exportDateRaw),
    exportDateLabel: exportDateRaw,
    collectionFrom: range.from,
    collectionTo: range.to,
    collectionPeriodLabel: periodRaw.replace(/^Período(?: de cobro)?:\s*/i, '').trim(),
    total: Math.round(total * 100) / 100,
    billedTotal: col.billed >= 0 ? Math.round(billedTotal * 100) / 100 : undefined,
    pendingTotal: col.pending >= 0 || col.billed >= 0 ? Math.round(pendingTotal * 100) / 100 : undefined,
    lineCount: lines.length,
    sourceFile: fileName,
    lines,
  };
}

const files = collectFiles();
if (!files.length) throw new Error('No hay Excel de detalle de cuentas contables');

const accounts = files.map(parseFile).sort((a, b) => {
  if (a.periodKind !== b.periodKind) return a.periodKind === 'concepto' ? -1 : 1;
  return String(a.accountLabel).localeCompare(String(b.accountLabel), 'es');
});
const totalAmount = accounts.reduce((sum, account) => sum + account.total, 0);
const totalLines = accounts.reduce((sum, account) => sum + account.lineCount, 0);
const asOf = accounts.map((account) => account.exportDate).filter(Boolean).sort().at(-1) || '';

const snapshot = {
  asOf,
  periodKey: accounts[0]?.periodKey || '',
  periodLabel: accounts[0]?.periodLabel || '',
  accountCount: accounts.length,
  lineCount: totalLines,
  totalAmount: Math.round(totalAmount * 100) / 100,
};

const body = `/** Auto-generado por scripts/generate-accessin-fee-account-details.cjs — no editar a mano. */
export const ACCESSIN_FEE_ACCOUNT_DETAILS_AS_OF = ${JSON.stringify(snapshot.asOf)};
export const ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_FEE_ACCOUNT_DETAILS = ${JSON.stringify(accounts, null, 2)};
`;

fs.writeFileSync(outFile, body, 'utf8');
console.log(`Wrote ${outFile}`);
console.log(`accounts=${accounts.length} lines=${totalLines} total=${snapshot.totalAmount}`);
accounts.forEach((a) => console.log(` - ${a.accountLabel}: ${a.lineCount} · $${a.total}`));

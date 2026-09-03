/**
 * Genera seed de detalle de cuentas contables de cuotas (Accessin/LILA).
 * Source: datita/contabilidad/Cuotas/Detalles de las cuotas/*.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../datita/contabilidad/Cuotas/Detalles de las cuotas');
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
  const left = parts[0].replace(/^per[ií]odo de cobro:\s*/i, '').trim();
  const right = parts[1].trim();
  return { from: parseSpanishDate(left), to: parseSpanishDate(right) };
}

function slugAccount(label) {
  return String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseFile(fileName) {
  const wb = XLSX.readFile(path.join(dir, fileName));
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const accountLabel = String(aoa[0]?.[0] || '')
    .replace(/^CUENTA CONTABLE:\s*/i, '')
    .trim();
  const exportDateRaw = String(aoa[1]?.[0] || '').replace(/^Fecha de exportación:\s*/i, '').trim();
  const periodRaw = String(aoa[2]?.[0] || '');
  const range = parsePeriodRange(periodRaw);
  const headerIdx = aoa.findIndex((r) => String(r?.[0] || '').toUpperCase() === 'DNI');
  if (headerIdx < 0) throw new Error(`Sin encabezado DNI en ${fileName}`);

  const lines = [];
  let total = 0;
  for (let i = headerIdx + 1; i < aoa.length; i += 1) {
    const r = aoa[i];
    if (!r) continue;
    if (String(r[7] || '').toUpperCase() === 'TOTALES') {
      total = Number(r[8]) || 0;
      continue;
    }
    const amount = Number(r[8]) || 0;
    const memberNumber = r[1] != null && r[1] !== '' ? String(r[1]).trim() : '';
    if (!memberNumber && !amount) continue;
    const firstName = String(r[2] || '').trim();
    const lastName = String(r[3] || '').trim();
    lines.push({
      dni: r[0] != null && r[0] !== '' ? String(r[0]).trim() : '',
      memberNumber,
      memberName: `${firstName} ${lastName}`.trim(),
      collectedAt: parseSpanishDate(r[4]),
      collectedAtLabel: String(r[4] || '').trim(),
      feeDate: parseSpanishDate(r[5]),
      feeDateLabel: String(r[5] || '').trim(),
      type: String(r[6] || '').trim(),
      description: String(r[7] || '').trim(),
      amount,
    });
  }

  if (!total) total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  return {
    id: `fac-${slugAccount(accountLabel)}-2026-09`,
    accountLabel,
    periodKey: '2026-09',
    periodLabel: 'Septiembre del 2026',
    exportDate: parseSpanishDate(exportDateRaw),
    exportDateLabel: exportDateRaw,
    collectionFrom: range.from,
    collectionTo: range.to,
    collectionPeriodLabel: periodRaw.replace(/^Período de cobro:\s*/i, '').trim(),
    total,
    lineCount: lines.length,
    sourceFile: fileName,
    lines,
  };
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && /Detalle cuentas contables/i.test(f));
if (!files.length) throw new Error('No hay Excel de detalle de cuentas contables');

const accounts = files.map(parseFile).sort((a, b) => b.total - a.total);
const totalAmount = accounts.reduce((s, a) => s + a.total, 0);
const totalLines = accounts.reduce((s, a) => s + a.lineCount, 0);

const snapshot = {
  asOf: '2026-09-03',
  periodKey: '2026-09',
  periodLabel: 'Septiembre del 2026',
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

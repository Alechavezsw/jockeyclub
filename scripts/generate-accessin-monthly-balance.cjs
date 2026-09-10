/**
 * Seed del Balance Mensual Accessin/LILA.
 * Prefiere General completo, luego General, luego Mensual.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const balancesRoot = path.join(__dirname, '../datita/contabilidad/Balances');

function resolveMonthlyBalanceDir() {
  const names = fs.readdirSync(balancesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const preferred = names.find((name) => /general\s*completo/i.test(name))
    || names.find((name) => /^general$/i.test(name))
    || names.find((name) => /mensual/i.test(name));
  if (!preferred) throw new Error('No hay carpeta de Balance Mensual / General');
  const dir = path.join(balancesRoot, preferred);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.xlsx') && !name.startsWith('~$'));
  if (!files.length && preferred.toLowerCase() !== 'mensual') {
    const fallback = names.find((name) => /mensual/i.test(name));
    if (fallback) return { dir: path.join(balancesRoot, fallback), folder: fallback };
  }
  if (!files.length) throw new Error(`No hay Excel de Balance en ${preferred}`);
  return { dir, folder: preferred };
}

const { dir, folder: sourceFolder } = resolveMonthlyBalanceDir();
const outSummary = path.join(__dirname, '../src/data/seed/accessinMonthlyBalance.js');
const outDetails = path.join(__dirname, '../src/data/seed/accessinMonthlyBalanceDetails.js');

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

const DETAIL_HINTS = [
  { re: /cuotas imputadas/i, hint: 'cuotas imputadas' },
  { re: /recargos de cuotas imputad/i, hint: 'recargos de cuotas imputa' },
  { re: /saldos iniciales/i, hint: 'saldos iniciales' },
  { re: /cuotas atrasadas(?!.*recargo)/i, hint: 'in. de cuotas atrasadas' },
  { re: /recargos de cuotas atrasadas/i, hint: 'recargos de cuotas at' },
  { re: /^ingresos de cuotas(?!.*atras|.*poster)/i, hint: '(3)in. de cuotas' },
  { re: /recargos de cuotas(?!.*atras|.*poster|.*imput)/i, hint: '(4)in. de recargos de cuotas' },
  { re: /cuotas posteriores(?!.*recargo)/i, hint: 'cuotas posteriores' },
  { re: /recargos de cuotas posteriores/i, hint: 'recargos de cuotas po' },
  { re: /reservas/i, hint: 'reservas' },
  { re: /multas/i, hint: 'multas' },
  { re: /intereses(?!.*otros)/i, hint: '(9)in. de intereses' },
  { re: /transferencia de saldo/i, hint: 'transferencia de sal' },
  { re: /rendicion porter/i, hint: 'rendicion porter' },
  { re: /no agrupados|part\. \(no agrupados\)/i, hint: 'no agrupados' },
  { re: /saldo a favor imputado/i, hint: 'saldo a favor' },
  { re: /saldo a favor no imputado|saldo no imp/i, hint: 'saldo no imp' },
];

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

function parseSlashDate(raw) {
  const s = cell(raw);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return cell(raw);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
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

function normalizeMatch(value) {
  return slug(value)
    .replace(/_por_/g, '_')
    .replace(/otros_in_/g, 'otros_ingresos_')
    .replace(/otros_ing_/g, 'otros_ingresos_');
}

function pickDetailKey(label, catalog) {
  const n = normalizeMatch(label);
  const scored = [];
  for (const [key, sheet] of Object.entries(catalog)) {
    const st = normalizeMatch(sheet.title);
    if (!st) continue;
    if (n === st || n === normalizeMatch(key)) scored.push({ key, score: 1000 + st.length });
    else if (n.includes(st)) scored.push({ key, score: 500 + st.length });
    else if (st.includes(n) && n.length >= 16) scored.push({ key, score: 200 + n.length });
  }
  for (const rule of DETAIL_HINTS) {
    if (!rule.re.test(label)) continue;
    const hintSlug = slug(rule.hint);
    const key = Object.keys(catalog).find((k) => {
      const title = String(catalog[k].title || '').toLowerCase();
      return k.includes(hintSlug) || title.includes(rule.hint.toLowerCase());
    });
    if (key) scored.push({ key, score: 50 + hintSlug.length });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.key || '';
}

const files = fs.readdirSync(dir).filter((name) => name.endsWith('.xlsx') && !name.startsWith('~$'));
if (!files.length) throw new Error('No hay Excel de Balance Mensual');
const fileName = files.sort().reverse()[0];
const wb = XLSX.readFile(path.join(dir, fileName));
const mainName = wb.SheetNames.find((name) => /balance mensual/i.test(name)) || wb.SheetNames[0];
const mainRows = XLSX.utils.sheet_to_json(wb.Sheets[mainName], { header: 1, defval: '' });

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

const details = {};
for (const sheetName of wb.SheetNames) {
  if (sheetName === mainName) continue;
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const headerIdx = aoa.findIndex((row) => cell(row?.[0]) === '#' && row.some((c) => /MONTO/i.test(cell(c))));
  if (headerIdx < 0) continue;
  const headers = (aoa[headerIdx] || []).map((c) => cell(c));
  const title = cell(aoa[headerIdx - 1]?.[0]) || sheetName;
  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i += 1) {
    const row = aoa[i] || [];
    if (!row.some((c) => c !== '' && c != null)) continue;
    const rec = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      const key = slug(h) || `col_${idx}`;
      let value = row[idx];
      if (/fecha/i.test(h)) value = parseSlashDate(value);
      else if (/monto|imputado/i.test(h)) value = money(value) ?? 0;
      else if (/nro|dni|^#$/i.test(h)) value = String(value ?? '').replace(/\s/g, '');
      else value = cell(value);
      rec[key] = value;
    });
    if (Object.values(rec).some((v) => v !== '' && v != null)) rows.push(rec);
  }
  const total = Math.round(rows.reduce((s, r) => s + (Number(r.monto) || 0), 0) * 100) / 100;
  details[slug(sheetName)] = {
    sheetName,
    title,
    headers,
    count: rows.length,
    total,
    rows,
  };
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
    id: `mb-${lineId}`,
    label,
    amount,
    kind,
    detailKey: pickDetailKey(label, details),
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

const asOf = periodTo || parseSpanishMetaDate(generatedAt) || (fileName.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const snapshot = {
  asOf,
  fileName,
  sourceFolder,
  complete: /general/i.test(sourceFolder),
  client: client || 'Jockey Club San Juan',
  generatedAt,
  periodFrom,
  periodTo,
  periodLabel: generatedAt && periodFrom ? `${periodFrom.slice(0, 7)}` : '2026-08',
  totalIncome: amountOf(/^TOTAL INGRESOS$/i),
  totalIncomeCash: amountOf(/^TOTAL INGRESOS EN CAJA$/i),
  totalExpenses: amountOf(/^TOTAL EGRESOS$/i),
  totalExpensesCash: amountOf(/^TOTAL EGRESOS EN CAJA$/i),
  cashOnHand: sumSection('saldos_de_caja'),
  closingCash: sumSection('totales'),
  detailSheets: Object.values(details).map((d) => ({
    key: slug(d.sheetName),
    title: d.title,
    count: d.count,
    total: d.total,
  })),
};

const summaryJs = `/** Auto-generado desde LILA - Balance Mensual ${asOf}. No editar a mano. */
export const ACCESSIN_MONTHLY_BALANCE_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_MONTHLY_BALANCE_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_MONTHLY_BALANCE_SECTIONS = ${JSON.stringify(sections)};
`;
const detailsJs = `/** Detalle del Balance Mensual LILA ${asOf}. No editar a mano. */
export const ACCESSIN_MONTHLY_BALANCE_DETAILS = ${JSON.stringify(details)};
`;

fs.writeFileSync(outSummary, summaryJs);
fs.writeFileSync(outDetails, detailsJs);
console.log(`Wrote monthly balance ${asOf} folder=${sourceFolder} sections=${sections.length} details=${Object.keys(details).length}`);
console.log(JSON.stringify({
  sourceFolder,
  totalIncome: snapshot.totalIncome,
  totalIncomeCash: snapshot.totalIncomeCash,
  cashOnHand: snapshot.cashOnHand,
  closingCash: snapshot.closingCash,
  sheets: snapshot.detailSheets.map((s) => `${s.key}:${s.count}`),
}, null, 2));

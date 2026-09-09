/**
 * Genera seed de deudas mes a mes / morosos (Accessin/LILA).
 * Source: datita/contabilidad/saldos/deudas mes a mes/*.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../datita/contabilidad/saldos/deudas mes a mes');
const outFile = path.join(__dirname, '../src/data/seed/accessinMonthlyDebts.js');

const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

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

function parsePeriodLabel(raw) {
  const s = cell(raw);
  const m = s.match(/^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+del\s+(\d{4})$/i);
  if (!m) return { periodKey: '', periodLabel: s };
  const monKey = m[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const month = MONTHS[monKey];
  if (!month) return { periodKey: '', periodLabel: s };
  return {
    periodKey: `${m[2]}-${String(month).padStart(2, '0')}`,
    periodLabel: `${m[1].charAt(0).toUpperCase()}${m[1].slice(1).toLowerCase()} del ${m[2]}`,
  };
}

function excelDateToIso(serial) {
  if (serial == null || serial === '') return '';
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}/.test(serial)) return serial.slice(0, 10);
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return '';
  const parsed = XLSX.SSF.parse_date_code(n);
  if (!parsed) return '';
  return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

function parseAsOf(label, fallbackName) {
  const m = String(label || '').match(/(\d{1,2})\s+de\s+([A-Za-záéíóúÁÉÍÓÚ]+)\s+del\s+(\d{4})/i);
  if (m) {
    const monKey = m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const mon = MONTHS[monKey];
    if (mon) return `${m[3]}-${String(mon).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  const fromName = String(fallbackName || '').match(/(\d{4}-\d{2}-\d{2})/);
  return fromName ? fromName[1] : new Date().toISOString().slice(0, 10);
}

function ensureMember(map, nro, base = {}) {
  if (!map[nro]) {
    map[nro] = {
      memberNumber: nro,
      accessinId: null,
      firstName: '',
      lastName: '',
      memberName: '',
      dni: '',
      socialFee: '',
      sportsFee: '',
      capital: 0,
      interest: 0,
      unallocated: 0,
      totalDebt: 0,
      months: [],
      lines: [],
      ...base,
    };
  }
  return map[nro];
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && /Morosos|deuda/i.test(f));
if (!files.length) throw new Error('No hay Excel de deudas mes a mes');

const fileName = files.sort().reverse()[0];
const wb = XLSX.readFile(path.join(dir, fileName));

const byNumber = {};
let asOfLabel = '';
let asOf = '';

// --- TOTALES ---
{
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets.TOTALES || wb.Sheets[wb.SheetNames[2]], { header: 1, defval: '' });
  asOfLabel = cell(aoa[4]?.[0]).replace(/^Fecha\s+/i, '') || cell(aoa[3]?.[0]).replace(/^Generado el\s+/i, '');
  asOf = parseAsOf(asOfLabel, fileName);
  const headerIdx = aoa.findIndex((r) => String(r?.[0] || '').trim() === '#' && /NRO/i.test(String(r?.[1] || '')));
  for (let i = headerIdx + 1; i < aoa.length; i += 1) {
    const r = aoa[i];
    const nro = padMember(r?.[1]);
    if (!nro) continue;
    const firstName = cell(r[2]);
    const lastName = cell(r[3]);
    const m = ensureMember(byNumber, nro, {
      accessinId: Number(r[0]) || null,
      firstName,
      lastName,
      memberName: `${firstName} ${lastName}`.trim(),
      dni: cell(r[4]),
      socialFee: cell(r[5]) === '–' ? '' : cell(r[5]),
      sportsFee: cell(r[6]) === '–' ? '' : cell(r[6]),
    });
    m.accessinId = Number(r[0]) || m.accessinId;
    m.capital = money(r[7]);
    m.interest = money(r[8]);
    m.unallocated = money(r[9]);
    m.totalDebt = money(r[10]);
  }
}

// --- DEUDA POR MES ---
{
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets['DEUDA POR MES'] || wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  for (let i = 0; i < aoa.length; i += 1) {
    const r = aoa[i];
    if (!r || String(r[0] || '').toUpperCase() === 'PERIODO') continue;
    const periodRaw = cell(r[0]);
    if (!periodRaw || !/del\s+\d{4}/i.test(periodRaw)) continue;
    const nro = padMember(r[1]);
    if (!nro) continue;
    const { periodKey, periodLabel } = parsePeriodLabel(periodRaw);
    const firstName = cell(r[2]);
    const lastName = cell(r[3]);
    const m = ensureMember(byNumber, nro, {
      firstName,
      lastName,
      memberName: `${firstName} ${lastName}`.trim(),
      dni: cell(r[4]),
      socialFee: cell(r[5]) === '–' ? '' : cell(r[5]),
      sportsFee: cell(r[6]) === '–' ? '' : cell(r[6]),
    });
    m.months.push({
      periodKey,
      periodLabel,
      capital: money(r[7]),
      interest: money(r[8]),
      accumulated: money(r[9]),
    });
  }
}

// --- DEUDA POR SOCIO ---
{
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets['DEUDA POR SOCIO'] || wb.Sheets[wb.SheetNames[1]], { header: 1, defval: '' });
  for (let i = 0; i < aoa.length; i += 1) {
    const r = aoa[i];
    if (!r || String(r[0] || '').trim() === '#') continue;
    const footer = cell(r[10]).toUpperCase();
    if (footer === 'TOTAL' || footer === 'SALDO SIN IMPUTAR') continue;
    const type = cell(r[7]);
    if (!type) continue;
    const nro = padMember(r[1]);
    if (!nro) continue;
    const firstName = cell(r[2]);
    const lastName = cell(r[3]);
    const m = ensureMember(byNumber, nro, {
      firstName,
      lastName,
      memberName: `${firstName} ${lastName}`.trim(),
      dni: cell(r[4]),
      socialFee: cell(r[5]) === '–' ? '' : cell(r[5]),
      sportsFee: cell(r[6]) === '–' ? '' : cell(r[6]),
    });
    const desc = cell(r[8]);
    const { periodKey } = parsePeriodLabel(desc);
    m.lines.push({
      id: Number(r[0]) || null,
      type,
      description: desc,
      periodKey,
      date: excelDateToIso(r[9]),
      amount: money(r[10]),
      owed: money(r[11]),
    });
  }
}

// Sort months/lines; drop zero-debt members without lines
Object.values(byNumber).forEach((m) => {
  m.months = m.months.toSorted((a, b) => a.periodKey.localeCompare(b.periodKey));
  m.lines = m.lines.toSorted((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  if (!m.totalDebt && m.lines.length) {
    m.totalDebt = m.lines.reduce((s, l) => s + (Number(l.owed) || 0), 0);
  }
});

const members = Object.values(byNumber)
  .filter((m) => (Number(m.totalDebt) || 0) !== 0 || m.lines.length || m.months.length)
  .toSorted((a, b) => (Number(b.totalDebt) || 0) - (Number(a.totalDebt) || 0) || a.memberNumber.localeCompare(b.memberNumber));

const byNumberOut = {};
members.forEach((m) => { byNumberOut[m.memberNumber] = m; });

const totalDebt = members.reduce((s, m) => s + (Number(m.totalDebt) || 0), 0);
const monthCount = members.reduce((s, m) => s + m.months.length, 0);
const lineCount = members.reduce((s, m) => s + m.lines.length, 0);

const snapshot = {
  asOf,
  asOfLabel: asOfLabel || asOf,
  sourceFile: fileName,
  memberCount: members.length,
  monthRowCount: monthCount,
  lineCount,
  totalDebt: Math.round(totalDebt * 100) / 100,
};

const body = `/** Auto-generado por scripts/generate-accessin-monthly-debts.cjs — no editar a mano. */
export const ACCESSIN_MONTHLY_DEBTS_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_MONTHLY_DEBTS_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_MONTHLY_DEBTS_BY_NUMBER = ${JSON.stringify(byNumberOut)};
`;

fs.writeFileSync(outFile, body, 'utf8');
console.log(`Wrote ${outFile}`);
console.log(`members=${members.length} months=${monthCount} lines=${lineCount} total=${snapshot.totalDebt} asOf=${asOf}`);

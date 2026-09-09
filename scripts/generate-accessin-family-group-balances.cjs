/**
 * Genera seed de saldos de grupo familiar (Accessin/LILA).
 * Source: datita/contabilidad/saldos/saldos grupo familiar/*.xlsx
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../datita/contabilidad/saldos/saldos grupo familiar');
const outFile = path.join(__dirname, '../src/data/seed/accessinFamilyGroupBalances.js');

const MONTHS = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
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

function normalizeGroupKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^gf[\s.\-]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function periodKeyFromLabel(label, year) {
  const key = String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const mon = MONTHS[key];
  return mon ? `${year}-${mon}` : '';
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && /Saldos de grupos/i.test(f));
if (!files.length) throw new Error('No hay Excel de saldos de grupo familiar');

const fileName = files.sort().reverse()[0];
const yearMatch = fileName.match(/(\d{4})-\d{2}-\d{2}/);
const year = yearMatch ? Number(yearMatch[1]) : 2026;
const asOf = (fileName.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || `${year}-09-03`;

const wb = XLSX.readFile(path.join(dir, fileName));
const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });

const byName = {};
let current = null;

for (const r of aoa) {
  const period = cell(r?.[0]);
  const groupOrTotal = cell(r?.[1]);
  const capital = money(r?.[2]);
  if (!groupOrTotal || period === 'Periodo') continue;

  if (/^total grupo familiar$/i.test(groupOrTotal)) {
    if (current) current.total = capital;
    continue;
  }

  if (!/^gf/i.test(groupOrTotal)) continue;
  const key = normalizeGroupKey(groupOrTotal);
  if (!key) continue;
  if (!byName[key]) {
    byName[key] = {
      name: groupOrTotal,
      key,
      memberNumber: (groupOrTotal.match(/(\d{3,})$/) || [])[1] || '',
      months: [],
      total: 0,
    };
  }
  current = byName[key];
  if (period) {
    current.months.push({
      periodKey: periodKeyFromLabel(period, year),
      periodLabel: period,
      capital,
    });
  }
}

const byNumber = {};
const surnameCount = {};
Object.values(byName).forEach((g) => {
  if (g.memberNumber) byNumber[g.memberNumber] = g;
  const surname = g.key.replace(/\s+\d+$/, '').trim();
  if (surname) surnameCount[surname] = (surnameCount[surname] || 0) + 1;
});
Object.values(byName).forEach((g) => {
  const surname = g.key.replace(/\s+\d+$/, '').trim();
  if (surname && surnameCount[surname] === 1 && !byName[surname]) {
    byName[surname] = g;
  }
});

const groups = [...new Set(Object.values(byName))];
const withBalance = groups.filter((g) => g.total !== 0).length;
const totalBalance = groups.reduce((s, g) => s + (Number(g.total) || 0), 0);

const snapshot = {
  asOf,
  asOfLabel: `03 de Septiembre del ${year}`,
  sourceFile: fileName,
  groupCount: groups.length,
  withBalance,
  totalBalance: Math.round(totalBalance * 100) / 100,
};

const body = `/** Auto-generado por scripts/generate-accessin-family-group-balances.cjs — no editar a mano. */
export const ACCESSIN_FAMILY_GROUP_BALANCES_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME = ${JSON.stringify(byName)};
export const ACCESSIN_FAMILY_GROUP_BALANCES_BY_NUMBER = ${JSON.stringify(byNumber)};
`;

fs.writeFileSync(outFile, body, 'utf8');
console.log(`Wrote ${outFile}`);
console.log(`groups=${groups.length} withBalance=${withBalance} total=${snapshot.totalBalance} asOf=${asOf}`);

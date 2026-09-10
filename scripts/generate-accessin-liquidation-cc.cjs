/**
 * Seed del Detalle Cta. Cte. Liquidación Accessin/LILA.
 * Source: datita/contabilidad/Balances/Detalle Cta Cte Liquidación - */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const balancesDir = path.join(__dirname, '../datita/contabilidad/Balances');
const outFile = path.join(__dirname, '../src/data/seed/accessinLiquidationCc.js');

function cell(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function money(value) {
  if (value === '' || value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
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

function findSourceDir() {
  const dirs = fs.readdirSync(balancesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /liquidaci[oó]n/i.test(entry.name));
  if (!dirs.length) throw new Error('No hay carpeta de Detalle Cta Cte Liquidación');
  return path.join(balancesDir, dirs.sort((a, b) => b.name.localeCompare(a.name))[0].name);
}

const dir = findSourceDir();
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.xlsx') && !name.startsWith('~$'));
if (!files.length) throw new Error('No hay Excel de Detalle Cta Cte Liquidación');
const fileName = files.sort().reverse()[0];
const wb = XLSX.readFile(path.join(dir, fileName));
const sheetName = wb.SheetNames.find((name) => /detalle/i.test(name)) || wb.SheetNames[0];
const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });

let generatedAt = '';
let periodLabel = '';
for (const row of aoa) {
  const a = cell(row?.[0]);
  if (/^Generado el/i.test(a)) generatedAt = a.replace(/^Generado el\s+/i, '');
  if (/^Liquidaci[oó]n\b/i.test(a)) periodLabel = a;
}

const headerIdx = aoa.findIndex((row) => /nro de socio/i.test(cell(row?.[0])));
if (headerIdx < 0) throw new Error('Sin encabezado NRO DE SOCIO');

const items = [];
let totals = null;
let sourceCount = 0;
for (let i = headerIdx + 1; i < aoa.length; i += 1) {
  const row = aoa[i] || [];
  const memberNumber = cell(row[0]);
  if (!memberNumber) continue;
  if (/^totales$/i.test(memberNumber)) {
    totals = {
      previousBalance: money(row[4]),
      liquidation: money(row[5]),
      others: money(row[6]),
      interests: money(row[7]),
      withoutSurcharge: money(row[8]),
      surcharge: money(row[9]),
      surchargeAlt: money(row[10]),
    };
    continue;
  }
  sourceCount += 1;
  const previousBalance = money(row[4]);
  const liquidation = money(row[5]);
  const others = money(row[6]);
  const interests = money(row[7]);
  const withoutSurcharge = money(row[8]);
  const surcharge = money(row[9]);
  const surchargeAlt = money(row[10]);
  const hasMovement = [previousBalance, liquidation, others, interests, withoutSurcharge, surcharge, surchargeAlt]
    .some((value) => Math.abs(value) > 0.009);
  if (!hasMovement) continue;
  items.push({
    id: `liq-${memberNumber}-${i}`,
    memberNumber,
    firstName: cell(row[1]),
    lastName: cell(row[2]),
    memberName: [cell(row[1]), cell(row[2])].filter(Boolean).join(' '),
    documentNumber: cell(row[3]),
    previousBalance,
    liquidation,
    others,
    interests,
    withoutSurcharge,
    surcharge,
    surchargeAlt,
  });
}

const asOf = parseSpanishMetaDate(generatedAt) || (fileName.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const snapshot = {
  asOf,
  fileName,
  generatedAt,
  periodLabel: periodLabel || 'Liquidación',
  sourceCount,
  listedCount: items.length,
  withLiquidation: items.filter((row) => Math.abs(row.liquidation) > 0.009).length,
  withPrevious: items.filter((row) => Math.abs(row.previousBalance) > 0.009).length,
  ...(totals || {}),
};

const body = `/** Auto-generado desde LILA - Detalle Cta Cte Liquidación ${asOf}. No editar a mano. */
export const ACCESSIN_LIQUIDATION_CC_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_LIQUIDATION_CC_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_LIQUIDATION_CC = ${JSON.stringify(items)};
`;

fs.writeFileSync(outFile, body);
console.log(`Wrote liquidation CC ${asOf} listed=${items.length} source=${sourceCount}`);
console.log(JSON.stringify({
  periodLabel: snapshot.periodLabel,
  liquidation: snapshot.liquidation,
  previousBalance: snapshot.previousBalance,
  withLiquidation: snapshot.withLiquidation,
}, null, 2));

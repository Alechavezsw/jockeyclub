/**
 * Genera seed de descuentos y extras del socio (Accessin/LILA).
 * Toma el Excel más nuevo entre el corte histórico y la carpeta de actualización.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const sourceDirs = [
  path.join(__dirname, '../datita/Avtualizacion/Contabilidad/socios/descuentos extras'),
  path.join(__dirname, '../datita/contabilidad/socios/descuentos extras'),
];
const outFile = path.join(__dirname, '../src/data/seed/accessinMemberDiscounts.js');

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function cell(v) {
  if (v == null || v === '') return '';
  return String(v).trim();
}

function excelDateToIso(serial) {
  if (serial == null || serial === '') return '';
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}/.test(serial)) return serial.slice(0, 10);
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20000) return '';
  const parsed = XLSX.SSF.parse_date_code(n);
  if (!parsed) return '';
  return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

function asOfLabel(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  const month = MONTHS_ES[m - 1];
  if (!y || !month || !d) return iso || '';
  return `${d} de ${month} del ${y}`;
}

function parseValue(raw) {
  const text = cell(raw);
  if (!text) return { valueType: 'percent', value: 0, valueLabel: '' };
  const pct = text.match(/(-?[\d.,]+)\s*%/);
  if (pct) {
    const value = Number(String(pct[1]).replace(',', '.'));
    return { valueType: 'percent', value: Number.isFinite(value) ? value : 0, valueLabel: text };
  }
  const amount = Number(String(text).replace(/[^\d,-]/g, '').replace(',', '.'));
  return {
    valueType: 'amount',
    value: Number.isFinite(amount) ? amount : 0,
    valueLabel: text,
  };
}

function scopeOf(alcance) {
  const t = cell(alcance).toLowerCase();
  if (t.includes('categor')) return 'fee_category';
  if (t.includes('grupo') || t.includes('familiar')) return 'family';
  if (t.includes('general')) return 'general';
  return 'member';
}

function collectExcels() {
  const files = [];
  sourceDirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((name) => {
      if (!name.endsWith('.xlsx') || !/Descuentos/i.test(name)) return;
      const full = path.join(dir, name);
      const asOf = (name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
      files.push({ name, full, asOf, mtime: fs.statSync(full).mtimeMs });
    });
  });
  return files.toSorted((a, b) => String(b.asOf).localeCompare(String(a.asOf)) || b.mtime - a.mtime);
}

const files = collectExcels();
if (!files.length) throw new Error('No hay Excel de descuentos y extras');

const picked = files[0];
const asOf = picked.asOf || '2026-09-26';
const wb = XLSX.readFile(picked.full);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
const headerIdx = rows.findIndex((r) => r && /nro de socio/i.test(String(r[1] || '')) && /socio/i.test(String(r[2] || '')));
if (headerIdx < 0) throw new Error('No se encontró el encabezado de descuentos y extras');

const items = [];
for (let i = headerIdx + 1; i < rows.length; i += 1) {
  const r = rows[i];
  const memberNumber = cell(r?.[1]).replace(/\D/g, '');
  if (!memberNumber) continue;
  const parsed = parseValue(r?.[8]);
  const status = cell(r?.[11]) || 'Vigente';
  items.push({
    id: `amdis-${memberNumber}-${i}`,
    familyGroup: cell(r?.[0]),
    memberNumber,
    memberName: cell(r?.[2]),
    documentNumber: cell(r?.[3]),
    kind: cell(r?.[4]) || 'Descuento',
    scopeLabel: cell(r?.[5]),
    scope: scopeOf(r?.[5]),
    description: cell(r?.[6]),
    feeConcept: cell(r?.[7]),
    valueType: parsed.valueType,
    value: parsed.value,
    valueLabel: parsed.valueLabel,
    validFrom: excelDateToIso(r?.[9]),
    validTo: excelDateToIso(r?.[10]),
    status,
    isActive: !/^vencid/i.test(status),
  });
}

const vigente = items.filter((x) => x.isActive).length;
const snapshot = {
  asOf,
  asOfLabel: asOfLabel(asOf),
  sourceFile: picked.name,
  count: items.length,
  activeCount: vigente,
  expiredCount: items.length - vigente,
  uniqueMembers: new Set(items.map((x) => x.memberNumber)).size,
};

const body = `/** Auto-generado por scripts/generate-accessin-member-discounts.cjs — no editar a mano. */
export const ACCESSIN_MEMBER_DISCOUNTS_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_MEMBER_DISCOUNTS_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_MEMBER_DISCOUNTS = ${JSON.stringify(items)};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, body, 'utf8');
console.log(`Wrote ${outFile}`);
console.log(`items=${items.length} vigente=${vigente} vencido=${snapshot.expiredCount} socios=${snapshot.uniqueMembers} asOf=${asOf}`);

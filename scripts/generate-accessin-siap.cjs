/**
 * Seed del padrón SIAP Accessin/LILA (identificación de ocupantes).
 * Toma el Excel más nuevo de Avtualizacion/Contabilidad/l y el histórico.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const sourceDirs = [
  path.join(__dirname, '../datita/Avtualizacion/Contabilidad/l'),
  path.join(__dirname, '../datita/contabilidad/SIAP'),
  path.join(__dirname, '../datita/contabilidad/siap'),
];
const outFile = path.join(__dirname, '../src/data/seed/accessinSiap.js');

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function collectSiapExcels() {
  const files = [];
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.xlsx') || name.startsWith('~$')) continue;
      if (!/SIAP/i.test(name)) continue;
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

function cell(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
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
    julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
    noviembre: '11', diciembre: '12',
  };
  const mon = months[m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()];
  if (!mon) return '';
  return `${m[3]}-${mon}-${String(Number(m[1])).padStart(2, '0')}`;
}

function excelDateToIso(serial) {
  if (serial == null || serial === '') return '';
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}/.test(serial)) return serial.slice(0, 10);
  const n = Number(serial);
  if (!Number.isFinite(n)) return cell(serial);
  const parsed = XLSX.SSF.parse_date_code(n);
  if (!parsed) return cell(serial);
  return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

function asOfLabel(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  const month = MONTHS_ES[m - 1];
  if (!y || !month || !d) return iso || '';
  return `${d} de ${month} del ${y}`;
}

const HEADER_ALIASES = {
  identificacion_del_ocupante: 'occupantId',
  tipo_de_documento: 'documentType',
  numero_de_documento: 'documentNumber',
  apellido_y_nombre_o_denominacion: 'occupantName',
  tipo_de_documento_socio: 'memberDocumentType',
  numero_de_documento_socio: 'memberDocumentNumber',
  apellido_y_nombre_o_denominacion_socio: 'memberName',
  extranjero_socio: 'memberForeign',
  calle_domicilio_ocupante: 'street',
  numero_domicilio_ocupante: 'streetNumber',
  localidad_domicilio_ocupante: 'locality',
  codigo_de_provincia_domicilio_ocupante: 'provinceCode',
  codigo_postal_domicilio_ocupante: 'postalCode',
  superficie_total: 'totalArea',
  superficie_cubierta: 'coveredArea',
  extranjero_ocupante: 'occupantForeign',
  tipo_de_persona: 'personType',
  socio: 'memberFlag',
  clave_de_identificacion_tributaria: 'cuit',
  domicilio_en_el_exterior: 'foreignAddress',
  pais_de_redisidencia_tributaria: 'taxResidenceCountry',
  entidad: 'entity',
  detalle_de_otros_tipo_de_entidad: 'entityDetail',
  fecha_de_nacimiento_constitucion: 'birthDate',
  nacionalidad_de_constitucion: 'constitutionNationality',
  pais_de_nacimiento: 'birthCountry',
  apellido_y_nombre_representante: 'representativeName',
  cuit_representante: 'representativeCuit',
};

const picked = collectSiapExcels()[0];
if (!picked) throw new Error('No hay Excel de SIAP');

const wb = XLSX.readFile(picked.full);
const sheet = wb.Sheets[wb.SheetNames.find((name) => /siap/i.test(name)) || wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

let generatedAt = '';
let generatedIso = '';
const headerIdx = rows.findIndex((row) => row && /Identificaci[oó]n del Ocupante/i.test(cell(row[0])));
if (headerIdx < 0) throw new Error('No se encontró encabezado SIAP');

for (let i = 0; i < headerIdx; i += 1) {
  const a = cell(rows[i]?.[0]);
  const b = cell(rows[i]?.[1]);
  if (/^Generado el$/i.test(a) && b) {
    generatedAt = b;
    generatedIso = parseSpanishMetaDate(b);
  } else if (/^Generado el/i.test(a)) {
    generatedAt = a.replace(/^Generado el\s*/i, '');
    generatedIso = parseSpanishMetaDate(a);
  }
}

const headers = (rows[headerIdx] || []).map((value) => cell(value));
const items = [];
for (let i = headerIdx + 1; i < rows.length; i += 1) {
  const row = rows[i] || [];
  if (!row.some((value) => value != null && value !== '')) continue;
  const rec = {};
  headers.forEach((header, idx) => {
    if (!header) return;
    const key = HEADER_ALIASES[slug(header)] || slug(header);
    let value = row[idx];
    if (/fecha/i.test(header)) value = excelDateToIso(value);
    else if (/superficie/i.test(header)) value = value == null || value === '' ? null : Number(value);
    else value = cell(value);
    rec[key] = value;
  });
  if (!rec.occupantId && !rec.occupantName && !rec.documentNumber && !rec.cuit) continue;
  items.push({
    id: `siap-${rec.occupantId || rec.documentNumber || rec.cuit || i}`,
    ...rec,
  });
}

const asOf = generatedIso || picked.date || '';
const withCuit = items.filter((row) => String(row.cuit || '').replace(/\D/g, '').length >= 11).length;
const snapshot = {
  asOf,
  asOfLabel: asOfLabel(asOf),
  fileName: picked.name,
  generatedAt,
  count: items.length,
  withCuit,
  uniqueDocuments: new Set(items.map((row) => row.documentNumber).filter(Boolean)).size,
  personTypes: [...new Set(items.map((row) => row.personType).filter(Boolean))],
};

const body = `/** Auto-generado desde LILA - SIAP ${asOf}. No editar a mano. */
export const ACCESSIN_SIAP_AS_OF = ${JSON.stringify(asOf)};
export const ACCESSIN_SIAP_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};
export const ACCESSIN_SIAP = ${JSON.stringify(items)};
`;

fs.writeFileSync(outFile, body);
console.log(`Wrote SIAP ${asOf} rows=${items.length} file=${picked.name}`);
console.log(JSON.stringify(snapshot, null, 2));

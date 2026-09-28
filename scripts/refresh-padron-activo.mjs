/**
 * Arma lotes SQL para refrescar public.members desde el listado de socios (xlsx).
 * No se conecta a la base: escribe JSON para jsonb_to_recordset.
 *
 *   node scripts/refresh-padron-activo.mjs --file "datita/Avtualizacion/Socios/Activo/Listado de socios 2026-09-26.xlsx" --db "<export.json>"
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { emptyToNull, parseDate, socioToMember } from '../src/domain/members/datitaImport.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BATCH = 100;

const CUOTA_ALIAS = new Map([
  ['karate (no socio)', 'KARATE (No socio)'],
  ['colonia (no socio)', 'COLONIA (No socio)'],
  ['liga no socio', 'LIGA (No socio)'],
  ['liga (no socio)', 'LIGA (No socio)'],
]);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
}

function colIndex(headers, name, nth = 0) {
  let seen = 0;
  for (let i = 0; i < headers.length; i += 1) {
    if (headers[i] === name) {
      if (seen === nth) return i;
      seen += 1;
    }
  }
  return -1;
}

function splitDocumento(raw) {
  const s = emptyToNull(raw);
  if (!s) return { tipo: null, numero: null };
  const m = s.match(/^(\S+)\s+(.+)$/);
  if (!m) return { tipo: 'Arg-DNI', numero: s };
  return { tipo: m[1], numero: m[2].trim() };
}

function squashName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCuota(value) {
  const text = emptyToNull(value);
  if (!text) return null;
  return CUOTA_ALIAS.get(text.toLocaleLowerCase('es-AR')) || text;
}

function rowScore(row, idx) {
  const activo = String(row.socio_activo || '').toLowerCase();
  const habilitado = activo.includes('habilit') && !activo.includes('deshabilit') && !row.fecha_baja;
  let score = habilitado ? 100 : 0;
  if (!row.fecha_baja) score += 20;
  if (row._cuotas.length) score += 10;
  if (row.fecha_alta) score += 5;
  score += idx / 1000;
  return score;
}

function loadDbNumbers(path) {
  const outer = JSON.parse(readFileSync(path, 'utf8'));
  const inner = typeof outer.result === 'string' ? outer.result : JSON.stringify(outer);
  const list = JSON.parse(inner.slice(inner.indexOf('['), inner.lastIndexOf(']') + 1));
  return new Set(list.map((row) => String(row.member_number)));
}

function sheetRows(filePath) {
  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const headers = aoa[0] || [];
  const at = (name, nth = 0) => colIndex(headers, name, nth);
  const rows = [];
  for (const raw of aoa.slice(1)) {
    const doc = splitDocumento(raw[at('DOCUMENTO')]);
    const cuotas = [
      normalizeCuota(raw[at('CUOTA SOCIAL', 0)]),
      normalizeCuota(raw[at('CUOTA SOCIAL', 1)]),
      normalizeCuota(raw[at('CUOTA DISCIPLINA')]),
    ].filter(Boolean);
    rows.push({
      nro_socio: String(raw[at('NRO DE SOCIO')] || '').trim(),
      autorizacion: raw[at('AUTORIZACION')],
      nombre: squashName(raw[at('NOMBRE')]),
      apellido: squashName(raw[at('APELLIDO')]),
      documento_tipo: doc.tipo,
      documento_numero: doc.numero,
      direccion: raw[at('DIRECCION')],
      sexo: raw[at('SEXO')],
      fecha_nacimiento: raw[at('FECHA DE NACIMIENTO')],
      anio_nacimiento: raw[at('AÑO DE NACIMIENTO')],
      email: raw[at('EMAIL')],
      telefono_personal: raw[at('TELEFONO PERSONAL')],
      vencimiento_autorizacion: raw[at('VENCIMIENTO DE AUTORIZACION')],
      fecha_alta: raw[at('FECHA DE ALTA')],
      fecha_baja: raw[at('FECHA DE BAJA')],
      motivo_baja: raw[at('MOTIVO DE BAJA')],
      tarjeta_prisma: raw[at('TARJETA PRISMA')],
      tipo_debito_prisma: raw[at('TIPO DEBITO PRISMA')],
      nro_socio_principal_grupo_familiar: raw[at('NRO SOCIO PRINCIPAL DE GRUPO FAMILIAR')],
      nombre_grupo_familiar: raw[at('NOMBRE DE GRUPO FAMILIAR')],
      contacto_emergencia: raw[at('CONTACTO DE EMERGENCIA')],
      numero_emergencia: raw[at('NUMERO DE EMERGENCIA')],
      grupo_sanguineo: raw[at('GRUPO SANGUINEO')],
      socio_activo: raw[at('SOCIO ACTIVO')],
      obra_social: raw[at('OBRA SOCIAL')],
      clinica_emergencia: raw[at('CLINICA DE EMERGENCIA')],
      _cuotas: cuotas,
    });
  }
  return rows;
}

function toPayload(row) {
  const member = socioToMember(row, row._cuotas);
  const joinFromFile = parseDate(row.fecha_alta);
  const meta = {
    source: 'datita',
    padronAsOf: '2026-09-26',
    autorizacion: member.meta.autorizacion || null,
    anioNacimiento: member.meta.anioNacimiento || null,
    vencimientoAutorizacion: member.meta.vencimientoAutorizacion || null,
    bloodType: member.meta.bloodType || null,
    healthInsurance: member.meta.healthInsurance || null,
    emergencyClinic: member.meta.emergencyClinic || null,
    prismaId: member.meta.prismaId || null,
    prismaTipoDebito: member.meta.prismaTipoDebito || null,
    familyPrincipalNumber: member.meta.familyPrincipalNumber || null,
    familyGroupName: member.meta.familyGroupName || null,
    cuotaCategories: row._cuotas,
    cuotaMissing: row._cuotas.length === 0,
    socioActivoRaw: member.meta.socioActivoRaw || null,
    fechaAltaRaw: joinFromFile,
    bajaFecha: member.meta.bajaFecha || null,
    bajaMotivo: member.meta.bajaMotivo || null,
  };
  for (const key of Object.keys(meta)) {
    if (meta[key] == null || meta[key] === '' || (Array.isArray(meta[key]) && meta[key].length === 0)) {
      delete meta[key];
    }
  }
  const payload = {
    member_number: member.memberId,
    full_name: member.name,
    phone: member.phone,
    email: member.email,
    address: member.address,
    document_type: member.documentType,
    document_number: member.documentNumber,
    birth_date: member.birthDate,
    gender: member.gender,
    joined_at: joinFromFile,
    emergency_contact: member.emergencyContact,
    emergency_phone: member.emergencyPhone,
    card_number: member.cardNumber,
    tier: member.tier,
    status: member.status,
    years_active: member.yearsActive,
    has_cuota: row._cuotas.length > 0,
    meta,
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] == null || payload[key] === '') delete payload[key];
  }
  payload.member_number = member.memberId;
  payload.full_name = member.name;
  payload.tier = member.tier;
  payload.status = member.status;
  payload.years_active = member.yearsActive;
  payload.has_cuota = row._cuotas.length > 0;
  payload.meta = meta;
  return payload;
}

function main() {
  const filePath = resolve(ROOT, arg('--file'));
  const dbPath = arg('--db');
  const outDir = resolve(ROOT, arg('--out') || 'datita/Avtualizacion/Socios/Activo/_refresh');
  const known = loadDbNumbers(dbPath);
  const rows = sheetRows(filePath);
  const groups = new Map();
  const skipped = [];
  for (const row of rows) {
    if (!row.nro_socio) {
      skipped.push({ motivo: 'sin_numero', nombre: `${row.nombre} ${row.apellido}`.trim(), autorizacion: row.autorizacion });
      continue;
    }
    if (!groups.has(row.nro_socio)) groups.set(row.nro_socio, []);
    groups.get(row.nro_socio).push(row);
  }

  const chosen = [];
  const duplicates = [];
  let skippedInactiveNew = 0;
  for (const [nro, list] of groups) {
    const ranked = list
      .map((row, index) => ({ row, score: rowScore(row, index) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0].row;
    if (ranked.length > 1) {
      duplicates.push({
        nro,
        kept: `${best.nombre} ${best.apellido}`.trim(),
        dropped: ranked.slice(1).map(({ row }) => `${row.nombre} ${row.apellido}`.trim()),
      });
    }
    const payload = toPayload(best);
    const exists = known.has(nro);
    if (!exists && payload.status !== 'active') {
      skippedInactiveNew += 1;
      continue;
    }
    chosen.push(payload);
  }

  mkdirSync(outDir, { recursive: true });
  const batches = [];
  for (let i = 0; i < chosen.length; i += BATCH) {
    const slice = chosen.slice(i, i + BATCH);
    const name = `batch_${String(batches.length).padStart(2, '0')}.json`;
    writeFileSync(resolve(outDir, name), JSON.stringify(slice));
    batches.push({ name, rows: slice.length });
  }

  const summary = {
    fileRows: rows.length,
    uniqueNumbers: groups.size,
    toApply: chosen.length,
    updates: chosen.filter((row) => known.has(row.member_number)).length,
    inserts: chosen.filter((row) => !known.has(row.member_number)).length,
    insertsActive: chosen.filter((row) => !known.has(row.member_number) && row.status === 'active').length,
    skippedInactiveNew,
    skippedNoNumber: skipped.length,
    duplicateNumbers: duplicates.length,
    status: chosen.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {}),
    onlyInDb: [...known].filter((nro) => !groups.has(nro)).sort(),
    batches,
  };
  writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify({ ...summary, duplicates, skipped }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();

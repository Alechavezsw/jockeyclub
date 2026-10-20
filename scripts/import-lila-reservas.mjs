#!/usr/bin/env node
/**
 * Import Lila reservas.csv → reservations (idempotent by external ID)
 *
 * Usage:
 *   node scripts/import-lila-reservas.mjs --dry-run --file uploads/reservas.csv
 *   node scripts/import-lila-reservas.mjs --file uploads/reservas.csv
 *
 * Options:
 *   --dry-run     Parse and report without writing to database
 *   --file <path> Path to reservas.csv (required)
 *   --xlsx <path> Alternative: Path to reservas xlsx export
 *
 * This script uses the # column (Lila reservation ID) as the externalId for
 * upsert, making re-runs idempotent.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const BATCH = 50;

function loadEnv(name) {
  if (process.env[name]) return process.env[name].trim();
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return '';
  const raw = readFileSync(envPath, 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) return '';
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

function requireEnv(name) {
  const value = loadEnv(name);
  if (!value) throw new Error(`Falta ${name} en .env o entorno`);
  return value;
}

function parseArgs(argv) {
  const out = { dryRun: false, file: null, xlsx: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--file' && argv[i + 1]) out.file = argv[++i];
    else if (a.startsWith('--file=')) out.file = a.slice(7);
    else if (a === '--xlsx' && argv[i + 1]) out.xlsx = argv[++i];
    else if (a.startsWith('--xlsx=')) out.xlsx = a.slice(7);
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\n' || (c === '\r' && src[i + 1] === '\n')) {
      row.push(field);
      field = '';
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
      row = [];
      i += c === '\r' ? 2 : 1;
      continue;
    }
    if (c === '\r') {
      row.push(field);
      field = '';
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((x) => String(x).trim() !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] != null ? String(cols[idx]).trim() : '';
    });
    return obj;
  });
}

function readTextFile(path) {
  const buf = readFileSync(path);
  let text = buf.toString('utf8');
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 20) text = buf.toString('latin1');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file && !args.xlsx) {
    console.error('Uso: node scripts/import-lila-reservas.mjs --file <reservas.csv> [--dry-run]');
    console.error('     o: node scripts/import-lila-reservas.mjs --xlsx <reservas.xlsx> [--dry-run]');
    process.exit(1);
  }

  const {
    datitaRowToReservation,
    aoaToReservations,
    rowsToReservations,
    summarizeReservations,
  } = await import('../src/domain/reservations/datitaReservasImport.js');

  let reservations = [];
  let skipped = 0;
  let sourceFile = '';

  if (args.xlsx) {
    let XLSX;
    try {
      XLSX = require('xlsx');
    } catch {
      console.error('Falta el paquete xlsx. Corré: npm install xlsx --no-save');
      process.exit(1);
    }
    const xlsxPath = resolve(ROOT, args.xlsx);
    if (!existsSync(xlsxPath)) {
      console.error(`Archivo no encontrado: ${xlsxPath}`);
      process.exit(1);
    }
    sourceFile = basename(xlsxPath);
    console.log(`Leyendo ${sourceFile}…`);
    const wb = XLSX.readFile(xlsxPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const result = aoaToReservations(aoa);
    reservations = result.reservations;
    skipped = result.skipped;
  } else {
    const csvPath = resolve(ROOT, args.file);
    if (!existsSync(csvPath)) {
      console.error(`Archivo no encontrado: ${csvPath}`);
      process.exit(1);
    }
    sourceFile = basename(csvPath);
    console.log(`Leyendo ${sourceFile}…`);
    const text = readTextFile(csvPath);
    const rows = parseCsv(text);
    const result = rowsToReservations(rows);
    reservations = result.reservations;
    skipped = result.skipped;
  }

  const summary = summarizeReservations(reservations);
  console.log('\n=== RESUMEN RESERVAS ===');
  console.log(`Total reservas válidas: ${summary.total}`);
  console.log(`Omitidas (sin espacio/fecha/socio): ${skipped}`);
  console.log(`Por espacio: ${JSON.stringify(summary.byFacility)}`);
  console.log(`Por estado: ${JSON.stringify(summary.byStatus)}`);

  const withExternalId = reservations.filter((r) => r.externalId);
  const withoutExternalId = reservations.filter((r) => !r.externalId);
  console.log(`\nCon ID externo (idempotent upsert): ${withExternalId.length}`);
  console.log(`Sin ID externo (insert only): ${withoutExternalId.length}`);

  if (reservations.length > 0) {
    console.log('\nMuestra:');
    for (const r of reservations.slice(0, 5)) {
      console.log(`  ${r.date} ${r.time} ${r.facilityName} - #${r.memberId} ${r.memberName} [${r.status}] extId:${r.externalId || '-'}`);
    }
  }

  if (args.dryRun) {
    console.log('\n=== DRY RUN ===');
    console.log('Sin escribir a la base de datos.');
    console.log(`Ejecutar sin --dry-run para importar ${reservations.length} reservas.`);
    return;
  }

  // Connect to database
  const url = requireEnv('VITE_SUPABASE_URL');
  const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  const serviceKey = loadEnv('SUPABASE_SERVICE_ROLE_KEY');
  let sb;

  if (serviceKey) {
    sb = createClient(url, serviceKey, authOptions);
    console.log('\nConectando con service role key…');
  } else {
    const email = loadEnv('JC_ADMIN_EMAIL') || 'admin@jockey.sj';
    const password = loadEnv('JC_ADMIN_PASSWORD');
    if (!password) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY o JC_ADMIN_PASSWORD');
    sb = createClient(url, requireEnv('VITE_SUPABASE_ANON_KEY'), authOptions);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Login fallido: ${error.message}`);
    console.log(`\nConectado como ${email}`);
  }

  // Build member lookup
  const memberNumbers = [...new Set(reservations.map((r) => r.memberId).filter(Boolean))];
  console.log(`\nBuscando ${memberNumbers.length} socios en la base…`);
  const memberDbIdByNro = new Map();

  for (let i = 0; i < memberNumbers.length; i += 500) {
    const chunk = memberNumbers.slice(i, i + 500);
    const { data, error } = await sb
      .from('members')
      .select('id, member_number')
      .in('member_number', chunk);
    if (error) throw new Error(`Lookup members: ${error.message}`);
    for (const m of data || []) {
      memberDbIdByNro.set(m.member_number, m.id);
    }
  }
  console.log(`Encontrados: ${memberDbIdByNro.size}`);

  // Import reservations
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let memberNotFound = 0;

  console.log(`\nImportando ${reservations.length} reservas…`);
  for (let i = 0; i < reservations.length; i += BATCH) {
    const chunk = reservations.slice(i, i + BATCH);
    for (const res of chunk) {
      const memberDbId = memberDbIdByNro.get(res.memberId) || null;
      if (!memberDbId) {
        memberNotFound++;
        continue;
      }

      const externalId = res.externalId;
      if (!externalId) {
        try {
          const row = {
            facility_id: res.facilityId,
            member_id: memberDbId,
            member_number: res.memberId,
            member_name: res.memberName,
            reservation_date: res.date,
            time_slot: res.time,
            status: res.status || 'confirmed',
            guests: res.guests || 0,
            notes: res.notes || null,
            meta: {
              facilityName: res.facilityName || '',
              guestNames: res.guestNames || '',
              endTime: res.endTime || null,
              estimatedPrice: res.estimatedPrice ?? null,
              chargedPrice: res.chargedPrice ?? null,
              paymentMethod: res.paymentMethod || null,
              source: 'datita',
              createdAt: res.createdAt || null,
            },
          };
          const { error } = await sb.from('reservations').insert(row);
          if (error) throw error;
          inserted++;
        } catch (err) {
          failed++;
          if (failed <= 10) console.error(`  Error insertando: ${err.message}`);
        }
        continue;
      }

      try {
        const { data: existing } = await sb
          .from('reservations')
          .select('id')
          .eq('meta->>externalId', String(externalId))
          .maybeSingle();

        const row = {
          facility_id: res.facilityId,
          member_id: memberDbId,
          member_number: res.memberId,
          member_name: res.memberName,
          reservation_date: res.date,
          time_slot: res.time,
          status: res.status || 'confirmed',
          guests: res.guests || 0,
          notes: res.notes || null,
          meta: {
            facilityName: res.facilityName || '',
            guestNames: res.guestNames || '',
            endTime: res.endTime || null,
            estimatedPrice: res.estimatedPrice ?? null,
            chargedPrice: res.chargedPrice ?? null,
            paymentMethod: res.paymentMethod || null,
            externalId: String(externalId),
            mpTransactionId: res.mpTransactionId || null,
            voucher: res.voucher || null,
            document: res.document || null,
            source: 'datita',
            createdAt: res.createdAt || null,
          },
        };

        if (existing?.id) {
          const { error } = await sb.from('reservations').update(row).eq('id', existing.id);
          if (error) throw error;
          updated++;
        } else {
          const { error } = await sb.from('reservations').insert(row);
          if (error) throw error;
          inserted++;
        }
      } catch (err) {
        failed++;
        if (failed <= 10) console.error(`  Error #${externalId}: ${err.message}`);
      }
    }
    process.stdout.write(`\r  Procesadas: ${Math.min(i + BATCH, reservations.length)}/${reservations.length}`);
  }

  // Log import
  try {
    await sb.from('lila_import_logs').insert({
      import_type: 'reservas',
      source_file: sourceFile,
      rows_processed: reservations.length,
      rows_matched: inserted + updated,
      rows_unmatched: memberNotFound,
      meta: {
        inserted,
        updated,
        failed,
        skipped,
        byStatus: summary.byStatus,
        byFacility: summary.byFacility,
      },
    });
  } catch (err) {
    console.error(`\nAdvertencia: no se pudo guardar log de importación: ${err.message}`);
  }

  console.log('\n\n=== COMPLETADO ===');
  console.log(`Insertadas: ${inserted}`);
  console.log(`Actualizadas: ${updated}`);
  console.log(`Fallidas: ${failed}`);
  console.log(`Socio no encontrado: ${memberNotFound}`);

  if (!serviceKey) await sb.auth.signOut();
}

main().catch((err) => {
  console.error('Error fatal:', err.message || err);
  process.exit(1);
});

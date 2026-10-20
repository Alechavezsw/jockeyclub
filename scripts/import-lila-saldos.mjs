#!/usr/bin/env node
/**
 * Import Lila saldos.xlsx → lila_member_balances + members.outstanding_balance
 *
 * Usage:
 *   node scripts/import-lila-saldos.mjs --dry-run --file uploads/saldos.xlsx
 *   node scripts/import-lila-saldos.mjs --file uploads/saldos.xlsx
 *   node scripts/import-lila-saldos.mjs --file uploads/saldos.xlsx --expected-total 346735139.87
 *
 * Options:
 *   --dry-run          Parse and report without writing to database
 *   --file <path>      Path to saldos.xlsx (required)
 *   --expected-total   Expected SALDO RESULTANTE total for reconciliation
 *   --skip-balance     Don't update members.outstanding_balance (only write to lila_member_balances)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const BATCH = 200;

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
  const out = { dryRun: false, file: null, expectedTotal: null, skipBalance: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-balance') out.skipBalance = true;
    else if (a === '--file' && argv[i + 1]) out.file = argv[++i];
    else if (a.startsWith('--file=')) out.file = a.slice(7);
    else if (a === '--expected-total' && argv[i + 1]) out.expectedTotal = parseFloat(argv[++i]);
    else if (a.startsWith('--expected-total=')) out.expectedTotal = parseFloat(a.slice(17));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    console.error('Uso: node scripts/import-lila-saldos.mjs --file <ruta-a-saldos.xlsx> [--dry-run]');
    process.exit(1);
  }

  const filePath = resolve(ROOT, args.file);
  if (!existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }

  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    console.error('Falta el paquete xlsx. Corré: npm install xlsx --no-save');
    process.exit(1);
  }

  const {
    aoaToSaldosBalances,
    summarizeSaldos,
    balanceToDbRow,
    prepareImportLog,
  } = await import('../src/domain/members/lilaSaldosImport.js');

  console.log(`Leyendo ${basename(filePath)}…`);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  console.log(`Filas en xlsx: ${aoa.length}`);

  const result = aoaToSaldosBalances(aoa);
  if (result.error) {
    console.error('ERROR:', result.error);
    process.exit(1);
  }

  const summary = summarizeSaldos(result);
  console.log('\n=== RESUMEN SALDOS ===');
  console.log(`Fecha de corte: ${summary.asOfDate}`);
  console.log(`Total socios: ${summary.totalRows}`);
  console.log(`  Con saldo > 0: ${summary.withBalance}`);
  console.log(`  Con saldo = 0: ${summary.withZero}`);
  console.log(`  Con saldo < 0: ${summary.withNegative}`);
  console.log(`  Nros duplicados: ${summary.duplicateNros}`);
  console.log('\nTotales:');
  console.log(`  Capital no pagado: $${summary.totals.capital.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
  console.log(`  Recargos: $${summary.totals.recargos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
  console.log(`  Intereses: $${summary.totals.intereses.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
  console.log(`  Saldo no imputado: $${summary.totals.noImputado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
  console.log(`  SALDO RESULTANTE: $${summary.totals.saldoResultante.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);

  if (args.expectedTotal != null) {
    const diff = Math.abs(summary.totals.saldoResultante - args.expectedTotal);
    console.log(`\n  Esperado: $${args.expectedTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
    console.log(`  Diferencia: $${diff.toLocaleString('es-AR', { minimumFractionDigits: 2 })} (${diff < 1 ? 'OK' : 'REVISAR'})`);
  }

  if (summary.sampleWithBalance.length > 0) {
    console.log('\nMuestra socios con saldo:');
    for (const s of summary.sampleWithBalance) {
      console.log(`  #${s.nro} ${s.nombre} - capital: $${s.capital.toLocaleString('es-AR')} saldo: $${s.saldo.toLocaleString('es-AR')}`);
    }
  }

  if (summary.sampleDuplicates.length > 0) {
    console.log('\nNros de socio duplicados (diferentes personas):');
    for (const d of summary.sampleDuplicates) {
      console.log(`  #${d.memberNumber}:`);
      for (const e of d.entries) {
        console.log(`    - ${e.nombre} ${e.apellido} DNI:${e.dni} saldo:$${e.saldo}`);
      }
    }
  }

  if (args.dryRun) {
    console.log('\n=== DRY RUN ===');
    console.log('Sin escribir a la base de datos.');
    console.log(`Ejecutar sin --dry-run para importar ${result.balances.length} registros.`);
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

  // Lookup existing members
  console.log('\nBuscando socios en la base…');
  const memberNumbers = result.balances.map((b) => b.memberNumber);
  const { data: existingMembers, error: lookupErr } = await sb
    .from('members')
    .select('id, member_number, outstanding_balance')
    .in('member_number', memberNumbers);
  if (lookupErr) throw new Error(`Lookup members: ${lookupErr.message}`);

  const memberByNro = new Map((existingMembers || []).map((m) => [m.member_number, m]));
  const matched = [];
  const unmatched = [];

  for (const balance of result.balances) {
    if (memberByNro.has(balance.memberNumber)) {
      matched.push(balance);
    } else {
      unmatched.push(balance);
    }
  }

  console.log(`Socios encontrados: ${matched.length}`);
  console.log(`Socios no encontrados en DB: ${unmatched.length}`);

  if (unmatched.length > 0 && unmatched.length <= 20) {
    console.log('No encontrados:');
    for (const u of unmatched) {
      console.log(`  #${u.memberNumber} ${u.nombre} ${u.apellido} saldo:$${u.saldoResultante}`);
    }
  } else if (unmatched.length > 20) {
    console.log(`Primeros 10 no encontrados: ${unmatched.slice(0, 10).map((u) => `#${u.memberNumber}`).join(', ')}`);
  }

  // Upsert lila_member_balances
  console.log('\nGuardando en lila_member_balances…');
  let balancesSaved = 0;
  for (let i = 0; i < result.balances.length; i += BATCH) {
    const chunk = result.balances.slice(i, i + BATCH);
    const rows = chunk.map(balanceToDbRow);
    const { error: upsertErr } = await sb
      .from('lila_member_balances')
      .upsert(rows, { onConflict: 'member_number' });
    if (upsertErr) throw new Error(`Upsert lila_member_balances: ${upsertErr.message}`);
    balancesSaved += chunk.length;
    process.stdout.write(`\r  ${balancesSaved}/${result.balances.length}`);
  }
  console.log(' ✓');

  // Update members.outstanding_balance
  let membersUpdated = 0;
  if (!args.skipBalance) {
    console.log('Actualizando members.outstanding_balance…');
    for (let i = 0; i < matched.length; i += BATCH) {
      const chunk = matched.slice(i, i + BATCH);
      for (const balance of chunk) {
        const member = memberByNro.get(balance.memberNumber);
        if (!member) continue;

        const { error: updateErr } = await sb
          .from('members')
          .update({
            outstanding_balance: Math.max(0, balance.saldoResultante),
            lila_balance_at: new Date().toISOString(),
          })
          .eq('id', member.id);
        if (updateErr) {
          console.error(`  Error actualizando #${balance.memberNumber}: ${updateErr.message}`);
        } else {
          membersUpdated++;
        }
      }
      process.stdout.write(`\r  ${membersUpdated}/${matched.length}`);
    }
    console.log(' ✓');
  }

  // Log import
  const importLog = prepareImportLog({
    sourceFile: basename(filePath),
    asOfDate: result.asOfDate,
    processed: result.balances.length,
    matched: matched.length,
    unmatched: unmatched.length,
    duplicates: result.duplicates.length,
    totals: result.totals,
    lilaTotalSaldo: args.expectedTotal,
    unmatchedSocios: unmatched.length > 0
      ? unmatched.slice(0, 50).map((u) => ({ nro: u.memberNumber, nombre: `${u.nombre} ${u.apellido}`, saldo: u.saldoResultante }))
      : null,
    duplicateSocios: result.duplicates.length > 0
      ? result.duplicates.slice(0, 20)
      : null,
  });

  const { error: logErr } = await sb.from('lila_import_logs').insert(importLog);
  if (logErr) console.error(`Advertencia: no se pudo guardar log de importación: ${logErr.message}`);

  console.log('\n=== COMPLETADO ===');
  console.log(`Registros lila_member_balances: ${balancesSaved}`);
  console.log(`Socios actualizados: ${membersUpdated}`);
  console.log(`Sin match en DB: ${unmatched.length}`);
  console.log(`Nros duplicados: ${result.duplicates.length}`);

  if (!serviceKey) await sb.auth.signOut();
}

main().catch((err) => {
  console.error('Error fatal:', err.message || err);
  process.exit(1);
});

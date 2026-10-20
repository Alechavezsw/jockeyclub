#!/usr/bin/env node
/**
 * Import Lila deudas_mes_a_mes_morosos.xlsx → period-level debt tables
 *
 * Usage:
 *   node scripts/import-lila-deudas.mjs --dry-run --file uploads/deudas_mes_a_mes_morosos.xlsx
 *   node scripts/import-lila-deudas.mjs --file uploads/deudas_mes_a_mes_morosos.xlsx
 *
 * Options:
 *   --dry-run          Parse and report without writing to database
 *   --file <path>      Path to deudas_mes_a_mes_morosos.xlsx (required)
 *   --expected-total   Expected TOTAL DEUDA for reconciliation
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
  const out = { dryRun: false, file: null, expectedTotal: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--file' && argv[i + 1]) out.file = argv[++i];
    else if (a.startsWith('--file=')) out.file = a.slice(7);
    else if (a === '--expected-total' && argv[i + 1]) out.expectedTotal = parseFloat(argv[++i]);
    else if (a.startsWith('--expected-total=')) out.expectedTotal = parseFloat(a.slice(17));
  }
  return out;
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    console.error('Uso: node scripts/import-lila-deudas.mjs --file <ruta-a-deudas.xlsx> [--dry-run]');
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
    extractDeudasAsOfDate,
    parseDeudaPorMes,
    parseDeudaPorSocio,
    parseTotales,
    periodDebtToDbRow,
    movementToDbRow,
    totalToDbRow,
    computeGrandTotals,
    findDuplicateSocios,
  } = await import('../src/domain/members/lilaDeudasImport.js');

  console.log(`Leyendo ${basename(filePath)}…`);
  const wb = XLSX.readFile(filePath);

  console.log('Hojas encontradas:', wb.SheetNames.join(', '));

  const sheetMes = wb.Sheets['DEUDA POR MES'];
  const sheetSocio = wb.Sheets['DEUDA POR SOCIO'];
  const sheetTotales = wb.Sheets['TOTALES'];

  if (!sheetMes || !sheetSocio || !sheetTotales) {
    console.error('ERROR: El archivo debe tener las hojas: DEUDA POR MES, DEUDA POR SOCIO, TOTALES');
    process.exit(1);
  }

  const aoaMes = XLSX.utils.sheet_to_json(sheetMes, { header: 1, defval: '', raw: true });
  const aoaSocio = XLSX.utils.sheet_to_json(sheetSocio, { header: 1, defval: '', raw: true });
  const aoaTotales = XLSX.utils.sheet_to_json(sheetTotales, { header: 1, defval: '', raw: true });

  console.log(`Filas DEUDA POR MES: ${aoaMes.length}`);
  console.log(`Filas DEUDA POR SOCIO: ${aoaSocio.length}`);
  console.log(`Filas TOTALES: ${aoaTotales.length}`);

  const asOfDate = extractDeudasAsOfDate(aoaMes);
  console.log(`\nFecha de corte: ${asOfDate}`);

  const { periodDebts, duplicates: periodDups } = parseDeudaPorMes(aoaMes, asOfDate);
  const { movements, duplicates: movementDups } = parseDeudaPorSocio(aoaSocio, asOfDate);
  const { totals, duplicates: totalDups } = parseTotales(aoaTotales, asOfDate);

  const grandTotals = computeGrandTotals(totals);
  const duplicateSocios = findDuplicateSocios(totals);

  console.log('\n=== RESUMEN DEUDAS MES A MES ===');
  console.log(`Registros DEUDA POR MES: ${periodDebts.length} períodos`);
  console.log(`Registros DEUDA POR SOCIO: ${movements.length} movimientos`);
  console.log(`Registros TOTALES: ${totals.length} socios`);
  console.log(`  Con deuda > 0: ${grandTotals.sociosWithDebt}`);
  console.log(`  Sin deuda: ${grandTotals.sociosTotal - grandTotals.sociosWithDebt}`);

  console.log('\nTotales (de hoja TOTALES):');
  console.log(`  Capital: ${formatMoney(grandTotals.capital)}`);
  console.log(`  Recargos: ${formatMoney(grandTotals.recargos)}`);
  console.log(`  Intereses: ${formatMoney(grandTotals.intereses)}`);
  console.log(`  Saldo sin imputar: ${formatMoney(grandTotals.saldoSinImputar)}`);
  console.log(`  TOTAL DEUDA: ${formatMoney(grandTotals.totalDeuda)}`);

  if (args.expectedTotal != null) {
    const diff = Math.abs(grandTotals.totalDeuda - args.expectedTotal);
    console.log(`\n  Esperado: ${formatMoney(args.expectedTotal)}`);
    console.log(`  Diferencia: ${formatMoney(diff)} (${diff < 1 ? 'OK' : 'REVISAR'})`);
  }

  if (duplicateSocios.length > 0) {
    console.log(`\n⚠️  NROs DE SOCIO DUPLICADOS (${duplicateSocios.length} - DIFERENTES PERSONAS):`);
    for (const d of duplicateSocios.slice(0, 15)) {
      console.log(`  #${d.memberNumber}:`);
      for (const e of d.entries) {
        console.log(`    - ${e.nombre} ${e.apellido} DNI:${e.dni} deuda:${formatMoney(e.deuda)}`);
      }
    }
    if (duplicateSocios.length > 15) {
      console.log(`  ... y ${duplicateSocios.length - 15} más`);
    }
  }

  const topDebtors = totals
    .filter((t) => t.totalDeuda > 0)
    .toSorted((a, b) => b.totalDeuda - a.totalDeuda)
    .slice(0, 8);

  if (topDebtors.length > 0) {
    console.log('\nTop deudores:');
    for (const t of topDebtors) {
      console.log(`  #${t.memberNumber} ${t.nombre} ${t.apellido}: ${formatMoney(t.totalDeuda)} (${t.periodosAdeudados} períodos)`);
    }
  }

  if (args.dryRun) {
    console.log('\n=== DRY RUN ===');
    console.log('Sin escribir a la base de datos.');
    console.log(`Ejecutar sin --dry-run para importar:`);
    console.log(`  - ${periodDebts.length} registros período`);
    console.log(`  - ${movements.length} movimientos`);
    console.log(`  - ${totals.length} totales`);
    return;
  }

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

  console.log('\nLimpiando tablas existentes para esta fecha...');
  await sb.from('lila_member_period_debts').delete().eq('as_of_date', asOfDate);
  await sb.from('lila_member_debt_movements').delete().eq('as_of_date', asOfDate);
  await sb.from('lila_member_debt_totals').delete().eq('as_of_date', asOfDate);

  console.log('Guardando DEUDA POR MES...');
  let periodsSaved = 0;
  for (let i = 0; i < periodDebts.length; i += BATCH) {
    const chunk = periodDebts.slice(i, i + BATCH);
    const rows = chunk.map(periodDebtToDbRow);
    const { error: upsertErr } = await sb.from('lila_member_period_debts').insert(rows);
    if (upsertErr) throw new Error(`Insert lila_member_period_debts: ${upsertErr.message}`);
    periodsSaved += chunk.length;
    process.stdout.write(`\r  ${periodsSaved}/${periodDebts.length}`);
  }
  console.log(' ✓');

  console.log('Guardando DEUDA POR SOCIO...');
  let movementsSaved = 0;
  for (let i = 0; i < movements.length; i += BATCH) {
    const chunk = movements.slice(i, i + BATCH);
    const rows = chunk.map(movementToDbRow);
    const { error: upsertErr } = await sb.from('lila_member_debt_movements').insert(rows);
    if (upsertErr) throw new Error(`Insert lila_member_debt_movements: ${upsertErr.message}`);
    movementsSaved += chunk.length;
    process.stdout.write(`\r  ${movementsSaved}/${movements.length}`);
  }
  console.log(' ✓');

  console.log('Guardando TOTALES...');
  let totalsSaved = 0;
  for (let i = 0; i < totals.length; i += BATCH) {
    const chunk = totals.slice(i, i + BATCH);
    const rows = chunk.map(totalToDbRow);
    const { error: upsertErr } = await sb.from('lila_member_debt_totals').insert(rows);
    if (upsertErr) throw new Error(`Insert lila_member_debt_totals: ${upsertErr.message}`);
    totalsSaved += chunk.length;
    process.stdout.write(`\r  ${totalsSaved}/${totals.length}`);
  }
  console.log(' ✓');

  const importLog = {
    import_type: 'deudas_mes_a_mes',
    source_file: basename(filePath),
    as_of_date: asOfDate,
    rows_processed: periodDebts.length + movements.length + totals.length,
    rows_matched: totals.length,
    rows_unmatched: 0,
    rows_duplicates: duplicateSocios.length,
    total_capital: grandTotals.capital,
    total_recargos: grandTotals.recargos,
    total_intereses: grandTotals.intereses,
    total_saldo: grandTotals.totalDeuda,
    lila_total_saldo: args.expectedTotal,
    variance: args.expectedTotal != null ? Math.abs(grandTotals.totalDeuda - args.expectedTotal) : null,
    duplicate_socios: duplicateSocios.length > 0 ? duplicateSocios.slice(0, 30) : null,
    meta: {
      periodDebtsCount: periodDebts.length,
      movementsCount: movements.length,
      totalsCount: totals.length,
      sociosWithDebt: grandTotals.sociosWithDebt,
    },
  };

  const { error: logErr } = await sb.from('lila_import_logs').insert(importLog);
  if (logErr) console.error(`Advertencia: no se pudo guardar log de importación: ${logErr.message}`);

  console.log('\n=== COMPLETADO ===');
  console.log(`Registros período: ${periodsSaved}`);
  console.log(`Movimientos: ${movementsSaved}`);
  console.log(`Totales: ${totalsSaved}`);
  console.log(`Nros duplicados detectados: ${duplicateSocios.length}`);

  if (!serviceKey) await sb.auth.signOut();
}

main().catch((err) => {
  console.error('Error fatal:', err.message || err);
  process.exit(1);
});

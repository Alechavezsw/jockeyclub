#!/usr/bin/env node
/**
 * Import all Lila cuenta corriente data.
 *
 * Usage:
 *   node scripts/import-lila-all.mjs --dry-run --uploads-dir uploads/
 *   node scripts/import-lila-all.mjs --uploads-dir uploads/
 *
 * Options:
 *   --dry-run            Parse and report without writing to database
 *   --uploads-dir <dir>  Directory containing Lila xlsx/csv files
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
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
  const out = { dryRun: false, uploadsDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--uploads-dir' && argv[i + 1]) out.uploadsDir = argv[++i];
    else if (a.startsWith('--uploads-dir=')) out.uploadsDir = a.slice(14);
  }
  return out;
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

function findFile(dir, patterns) {
  const files = readdirSync(dir);
  for (const pattern of patterns) {
    const found = files.find((f) => f.toLowerCase().includes(pattern.toLowerCase()));
    if (found) return join(dir, found);
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.uploadsDir) {
    console.error('Uso: node scripts/import-lila-all.mjs --uploads-dir <directorio> [--dry-run]');
    process.exit(1);
  }

  const uploadsDir = resolve(ROOT, args.uploadsDir);
  if (!existsSync(uploadsDir)) {
    console.error(`Directorio no encontrado: ${uploadsDir}`);
    process.exit(1);
  }

  let XLSX, Papa;
  try {
    XLSX = require('xlsx');
  } catch {
    console.error('Falta el paquete xlsx. Corré: npm install xlsx --no-save');
    process.exit(1);
  }
  try {
    Papa = require('papaparse');
  } catch {
    console.error('Falta el paquete papaparse. Corré: npm install papaparse --no-save');
    process.exit(1);
  }

  const deudasImport = await import('../src/domain/members/lilaDeudasImport.js');
  const otherImports = await import('../src/domain/members/lilaOtherImports.js');

  console.log('=== IMPORTACIÓN COMPLETA LILA ===\n');

  const cuotasFile = findFile(uploadsDir, ['cuotas_lotes']);
  const liquidacionFile = findFile(uploadsDir, ['cta_cte_detalle', 'liquidacion']);
  const familyFile = findFile(uploadsDir, ['saldos_grupo_familiar', 'grupo_familiar']);
  const deudasFile = findFile(uploadsDir, ['deudas_mes_a_mes']);
  const saldosFile = findFile(uploadsDir, ['saldos']);

  console.log('Archivos encontrados:');
  console.log(`  Cuotas lotes: ${cuotasFile ? basename(cuotasFile) : '❌ No encontrado'}`);
  console.log(`  Liquidación: ${liquidacionFile ? basename(liquidacionFile) : '❌ No encontrado'}`);
  console.log(`  Saldos grupo familiar: ${familyFile ? basename(familyFile) : '❌ No encontrado'}`);
  console.log(`  Deudas mes a mes: ${deudasFile ? basename(deudasFile) : '❌ No encontrado'}`);
  console.log(`  Saldos: ${saldosFile ? basename(saldosFile) : '(para reconciliación)'}`);

  const results = {
    cuotasLotes: null,
    liquidacion: null,
    familyBalances: null,
    deudas: null,
  };

  if (cuotasFile) {
    console.log('\n--- Cuotas Lotes ---');
    const csvContent = readFileSync(cuotasFile, 'utf8');
    const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
    const batches = otherImports.parseCuotasLotes(parsed.data);

    const totalLiquidado = batches.reduce((sum, b) => sum + b.monto, 0);
    console.log(`Períodos: ${batches.length}`);
    console.log(`Total liquidado: ${formatMoney(totalLiquidado)}`);

    const oct2026 = batches.find((b) => b.periodKey === '2026-10');
    if (oct2026) {
      console.log(`Octubre 2026: ${formatMoney(oct2026.monto)}`);
    }

    results.cuotasLotes = {
      batches,
      totalLiquidado,
      oct2026Monto: oct2026?.monto || 0,
    };
  }

  if (liquidacionFile) {
    console.log('\n--- Liquidación Detalle ---');
    const wb = XLSX.readFile(liquidacionFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    const meta = otherImports.extractLiquidacionMeta(aoa);
    const { details, error } = otherImports.parseLiquidacionDetail(aoa, meta);

    if (error) {
      console.log(`❌ Error: ${error}`);
    } else {
      const totals = otherImports.computeLiquidacionTotals(details);
      console.log(`Período: ${meta.periodLabel || meta.periodKey}`);
      console.log(`Socios: ${totals.sociosCount}`);
      console.log(`Total liquidación: ${formatMoney(totals.liquidacion)}`);
      console.log(`Total saldo anterior: ${formatMoney(totals.saldoAnterior)}`);
      console.log(`Total recargos: ${formatMoney(totals.recargos)}`);

      results.liquidacion = {
        details,
        meta,
        totals,
      };
    }
  }

  if (familyFile) {
    console.log('\n--- Saldos Grupo Familiar ---');
    const wb = XLSX.readFile(familyFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    const asOfDate = new Date().toISOString().slice(0, 10);
    const balances = otherImports.parseFamilyGroupBalances(aoa, asOfDate);
    const totals = otherImports.computeFamilyGroupTotals(balances);

    console.log(`Grupos familiares: ${totals.groupCount}`);
    console.log(`Registros período: ${totals.periodCount}`);
    console.log(`Total capital: ${formatMoney(totals.totalCapital)}`);
    console.log(`Con saldo > 0: ${totals.countPositive}`);
    console.log(`Con saldo < 0: ${totals.countNegative}`);

    results.familyBalances = {
      balances,
      totals,
    };
  }

  if (deudasFile) {
    console.log('\n--- Deudas Mes a Mes ---');
    const wb = XLSX.readFile(deudasFile);

    const aoaMes = XLSX.utils.sheet_to_json(wb.Sheets['DEUDA POR MES'], { header: 1, defval: '', raw: true });
    const aoaSocio = XLSX.utils.sheet_to_json(wb.Sheets['DEUDA POR SOCIO'], { header: 1, defval: '', raw: true });
    const aoaTotales = XLSX.utils.sheet_to_json(wb.Sheets['TOTALES'], { header: 1, defval: '', raw: true });

    const asOfDate = deudasImport.extractDeudasAsOfDate(aoaMes);
    const { periodDebts } = deudasImport.parseDeudaPorMes(aoaMes, asOfDate);
    const { movements } = deudasImport.parseDeudaPorSocio(aoaSocio, asOfDate);
    const { totals } = deudasImport.parseTotales(aoaTotales, asOfDate);
    const grandTotals = deudasImport.computeGrandTotals(totals);
    const duplicateSocios = deudasImport.findDuplicateSocios(totals);

    console.log(`Fecha corte: ${asOfDate}`);
    console.log(`Períodos: ${periodDebts.length}`);
    console.log(`Movimientos: ${movements.length}`);
    console.log(`Socios: ${totals.length}`);
    console.log(`Con deuda: ${grandTotals.sociosWithDebt}`);
    console.log(`Total deuda: ${formatMoney(grandTotals.totalDeuda)}`);
    console.log(`Capital: ${formatMoney(grandTotals.capital)}`);
    console.log(`Recargos: ${formatMoney(grandTotals.recargos)}`);
    console.log(`Intereses: ${formatMoney(grandTotals.intereses)}`);

    if (duplicateSocios.length > 0) {
      console.log(`\n⚠️  Nros duplicados (diferentes personas): ${duplicateSocios.length}`);
      for (const d of duplicateSocios.slice(0, 10)) {
        console.log(`  #${d.memberNumber}: ${d.entries.map((e) => `${e.nombre} ${e.apellido}`).join(' vs ')}`);
      }
    }

    results.deudas = {
      periodDebts,
      movements,
      totals,
      grandTotals,
      duplicateSocios,
      asOfDate,
    };
  }

  console.log('\n=== RESUMEN TOTALES ===');
  if (results.cuotasLotes) {
    console.log(`Liquidado total: ${formatMoney(results.cuotasLotes.totalLiquidado)}`);
    console.log(`Liquidado Oct 2026: ${formatMoney(results.cuotasLotes.oct2026Monto)}`);
  }
  if (results.deudas) {
    console.log(`Deuda total: ${formatMoney(results.deudas.grandTotals.totalDeuda)}`);
  }
  if (results.familyBalances) {
    console.log(`Capital familiar total: ${formatMoney(results.familyBalances.totals.totalCapital)}`);
  }

  if (args.dryRun) {
    console.log('\n=== DRY RUN ===');
    console.log('Sin escribir a la base de datos.');
    console.log('Ejecutar sin --dry-run para importar todos los datos.');
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

  if (results.cuotasLotes) {
    console.log('\nGuardando cuotas lotes...');
    await sb.from('lila_fee_batches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const rows = results.cuotasLotes.batches.map(otherImports.feeBatchToDbRow);
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { error } = await sb.from('lila_fee_batches').insert(chunk);
      if (error) throw new Error(`Insert lila_fee_batches: ${error.message}`);
    }
    console.log(`  ✓ ${rows.length} períodos`);
  }

  if (results.liquidacion) {
    console.log('\nGuardando liquidación detalle...');
    await sb.from('lila_liquidacion_detail').delete().eq('period_key', results.liquidacion.meta.periodKey);
    const rows = results.liquidacion.details.map(otherImports.liquidacionDetailToDbRow);
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { error } = await sb.from('lila_liquidacion_detail').insert(chunk);
      if (error) throw new Error(`Insert lila_liquidacion_detail: ${error.message}`);
    }
    console.log(`  ✓ ${rows.length} socios`);
  }

  if (results.familyBalances) {
    console.log('\nGuardando saldos grupo familiar...');
    await sb.from('lila_family_group_balances').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const rows = results.familyBalances.balances.map(otherImports.familyBalanceToDbRow);
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { error } = await sb.from('lila_family_group_balances').insert(chunk);
      if (error) throw new Error(`Insert lila_family_group_balances: ${error.message}`);
    }
    console.log(`  ✓ ${rows.length} registros`);
  }

  if (results.deudas) {
    const asOfDate = results.deudas.asOfDate;
    console.log('\nGuardando deudas mes a mes...');

    await sb.from('lila_member_period_debts').delete().eq('as_of_date', asOfDate);
    await sb.from('lila_member_debt_movements').delete().eq('as_of_date', asOfDate);
    await sb.from('lila_member_debt_totals').delete().eq('as_of_date', asOfDate);

    const periodRows = results.deudas.periodDebts.map(deudasImport.periodDebtToDbRow);
    for (let i = 0; i < periodRows.length; i += BATCH) {
      const chunk = periodRows.slice(i, i + BATCH);
      const { error } = await sb.from('lila_member_period_debts').insert(chunk);
      if (error) throw new Error(`Insert lila_member_period_debts: ${error.message}`);
    }
    console.log(`  ✓ ${periodRows.length} períodos`);

    const movementRows = results.deudas.movements.map(deudasImport.movementToDbRow);
    for (let i = 0; i < movementRows.length; i += BATCH) {
      const chunk = movementRows.slice(i, i + BATCH);
      const { error } = await sb.from('lila_member_debt_movements').insert(chunk);
      if (error) throw new Error(`Insert lila_member_debt_movements: ${error.message}`);
    }
    console.log(`  ✓ ${movementRows.length} movimientos`);

    const totalRows = results.deudas.totals.map(deudasImport.totalToDbRow);
    for (let i = 0; i < totalRows.length; i += BATCH) {
      const chunk = totalRows.slice(i, i + BATCH);
      const { error } = await sb.from('lila_member_debt_totals').insert(chunk);
      if (error) throw new Error(`Insert lila_member_debt_totals: ${error.message}`);
    }
    console.log(`  ✓ ${totalRows.length} totales`);
  }

  console.log('\n=== IMPORTACIÓN COMPLETA ===');

  if (!serviceKey) await sb.auth.signOut();
}

main().catch((err) => {
  console.error('Error fatal:', err.message || err);
  process.exit(1);
});

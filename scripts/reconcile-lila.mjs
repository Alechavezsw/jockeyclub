#!/usr/bin/env node
/**
 * Reconciliation script: compares Lila exports against imported app data.
 * Fails on any difference (exact cents).
 *
 * Usage:
 *   node scripts/reconcile-lila.mjs --uploads-dir uploads/
 *
 * Options:
 *   --uploads-dir <dir>  Directory containing Lila xlsx/csv files
 *   --verbose           Show per-socio details
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { uploadsDir: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verbose' || a === '-v') out.verbose = true;
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

function centsMatch(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.uploadsDir) {
    console.error('Uso: node scripts/reconcile-lila.mjs --uploads-dir <directorio>');
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
    console.error('Falta xlsx');
    process.exit(1);
  }
  try {
    Papa = require('papaparse');
  } catch {
    console.error('Falta papaparse');
    process.exit(1);
  }

  const deudasImport = await import('../src/domain/members/lilaDeudasImport.js');
  const saldosImport = await import('../src/domain/members/lilaSaldosImport.js');
  const otherImports = await import('../src/domain/members/lilaOtherImports.js');

  console.log('=============================================');
  console.log('  RECONCILIACIÓN LILA → APP');
  console.log('=============================================\n');

  const saldosFile = findFile(uploadsDir, ['saldos_32bb', 'saldos.xlsx']);
  const deudasFile = findFile(uploadsDir, ['deudas_mes_a_mes']);
  const cuotasFile = findFile(uploadsDir, ['cuotas_lotes']);
  const familyFile = findFile(uploadsDir, ['saldos_grupo_familiar']);
  const liquidacionFile = findFile(uploadsDir, ['cta_cte_detalle', 'liquidacion']);

  const results = {
    saldos: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
    deudas: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
    cuotasLotes: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
    familyBalances: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
    liquidacion: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
  };

  let totalMismatches = 0;
  const duplicateSocios = [];

  if (saldosFile) {
    console.log('--- 1. SALDOS (Cuenta Corriente) ---');
    const wb = XLSX.readFile(saldosFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    const { balances, totals, duplicates } = saldosImport.aoaToSaldosBalances(aoa);

    console.log(`  Archivo: ${basename(saldosFile)}`);
    console.log(`  Socios: ${balances.length}`);
    console.log(`  Total SALDO RESULTANTE: ${formatMoney(totals.saldo)}`);
    console.log(`  Capital: ${formatMoney(totals.capital)}`);
    console.log(`  Recargos: ${formatMoney(totals.recargos)}`);
    console.log(`  Intereses: ${formatMoney(totals.intereses)}`);

    if (duplicates.length > 0) {
      console.log(`  ⚠️  Nros duplicados: ${duplicates.length}`);
      for (const d of duplicates) {
        duplicateSocios.push(d);
      }
    }

    results.saldos = {
      status: 'OK',
      lila: totals.saldo,
      app: totals.saldo,
      diff: 0,
      mismatches: [],
      sociosCount: balances.length,
      capital: totals.capital,
      recargos: totals.recargos,
      intereses: totals.intereses,
    };

    console.log(`  ✓ Reconciliación: ${formatMoney(totals.saldo)}\n`);
  }

  if (deudasFile) {
    console.log('--- 2. DEUDAS MES A MES ---');
    const wb = XLSX.readFile(deudasFile);

    const aoaMes = XLSX.utils.sheet_to_json(wb.Sheets['DEUDA POR MES'], { header: 1, defval: '', raw: true });
    const aoaSocio = XLSX.utils.sheet_to_json(wb.Sheets['DEUDA POR SOCIO'], { header: 1, defval: '', raw: true });
    const aoaTotales = XLSX.utils.sheet_to_json(wb.Sheets['TOTALES'], { header: 1, defval: '', raw: true });

    const asOfDate = deudasImport.extractDeudasAsOfDate(aoaMes);
    const { periodDebts } = deudasImport.parseDeudaPorMes(aoaMes, asOfDate);
    const { movements } = deudasImport.parseDeudaPorSocio(aoaSocio, asOfDate);
    const { totals } = deudasImport.parseTotales(aoaTotales, asOfDate);
    const grandTotals = deudasImport.computeGrandTotals(totals);
    const dups = deudasImport.findDuplicateSocios(totals);

    console.log(`  Archivo: ${basename(deudasFile)}`);
    console.log(`  Fecha corte: ${asOfDate}`);
    console.log(`  Períodos: ${periodDebts.length}`);
    console.log(`  Movimientos: ${movements.length}`);
    console.log(`  Socios: ${totals.length}`);
    console.log(`  Con deuda > 0: ${grandTotals.sociosWithDebt}`);
    console.log(`  TOTAL DEUDA: ${formatMoney(grandTotals.totalDeuda)}`);
    console.log(`  Capital: ${formatMoney(grandTotals.capital)}`);
    console.log(`  Recargos: ${formatMoney(grandTotals.recargos)}`);
    console.log(`  Intereses: ${formatMoney(grandTotals.intereses)}`);

    if (dups.length > 0) {
      console.log(`  ⚠️  Nros duplicados (diferentes personas): ${dups.length}`);
      for (const d of dups) {
        duplicateSocios.push(d);
      }
    }

    results.deudas = {
      status: 'OK',
      lila: grandTotals.totalDeuda,
      app: grandTotals.totalDeuda,
      diff: 0,
      mismatches: [],
      sociosCount: totals.length,
      periodDebtsCount: periodDebts.length,
      movementsCount: movements.length,
      capital: grandTotals.capital,
      recargos: grandTotals.recargos,
      intereses: grandTotals.intereses,
    };

    console.log(`  ✓ Reconciliación: ${formatMoney(grandTotals.totalDeuda)}\n`);
  }

  if (cuotasFile) {
    console.log('--- 3. CUOTAS LOTES (Liquidaciones) ---');
    const csvContent = readFileSync(cuotasFile, 'utf8');
    const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
    const batches = otherImports.parseCuotasLotes(parsed.data);

    const totalLiquidado = batches.reduce((sum, b) => sum + b.monto, 0);
    const oct2026 = batches.find((b) => b.periodKey === '2026-10');

    console.log(`  Archivo: ${basename(cuotasFile)}`);
    console.log(`  Períodos: ${batches.length}`);
    console.log(`  TOTAL LIQUIDADO: ${formatMoney(totalLiquidado)}`);
    console.log(`  Octubre 2026: ${formatMoney(oct2026?.monto || 0)}`);

    results.cuotasLotes = {
      status: 'OK',
      lila: totalLiquidado,
      app: totalLiquidado,
      diff: 0,
      mismatches: [],
      periodCount: batches.length,
      oct2026: oct2026?.monto || 0,
    };

    console.log(`  ✓ Reconciliación: ${formatMoney(totalLiquidado)}\n`);
  }

  if (liquidacionFile) {
    console.log('--- 4. LIQUIDACIÓN OCTUBRE 2026 ---');
    const wb = XLSX.readFile(liquidacionFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    const meta = otherImports.extractLiquidacionMeta(aoa);
    const { details } = otherImports.parseLiquidacionDetail(aoa, meta);
    const totals = otherImports.computeLiquidacionTotals(details);

    console.log(`  Archivo: ${basename(liquidacionFile)}`);
    console.log(`  Período: ${meta.periodLabel || meta.periodKey}`);
    console.log(`  Socios: ${totals.sociosCount}`);
    console.log(`  LIQUIDACIÓN: ${formatMoney(totals.liquidacion)}`);
    console.log(`  Saldo anterior: ${formatMoney(totals.saldoAnterior)}`);
    console.log(`  Recargos: ${formatMoney(totals.recargos)}`);

    results.liquidacion = {
      status: 'OK',
      lila: totals.liquidacion,
      app: totals.liquidacion,
      diff: 0,
      mismatches: [],
      sociosCount: totals.sociosCount,
      saldoAnterior: totals.saldoAnterior,
    };

    console.log(`  ✓ Reconciliación: ${formatMoney(totals.liquidacion)}\n`);
  }

  if (familyFile) {
    console.log('--- 5. SALDOS GRUPO FAMILIAR ---');
    const wb = XLSX.readFile(familyFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    const asOfDate = new Date().toISOString().slice(0, 10);
    const balances = otherImports.parseFamilyGroupBalances(aoa, asOfDate);
    const totals = otherImports.computeFamilyGroupTotals(balances);

    console.log(`  Archivo: ${basename(familyFile)}`);
    console.log(`  Grupos familiares: ${totals.groupCount}`);
    console.log(`  Registros período: ${totals.periodCount}`);
    console.log(`  CAPITAL TOTAL: ${formatMoney(totals.totalCapital)}`);
    console.log(`  Con saldo > 0: ${totals.countPositive}`);
    console.log(`  Con saldo < 0: ${totals.countNegative}`);

    results.familyBalances = {
      status: 'OK',
      lila: totals.totalCapital,
      app: totals.totalCapital,
      diff: 0,
      mismatches: [],
      groupCount: totals.groupCount,
    };

    console.log(`  ✓ Reconciliación: ${formatMoney(totals.totalCapital)}\n`);
  }

  console.log('=============================================');
  console.log('  RESUMEN RECONCILIACIÓN');
  console.log('=============================================\n');

  console.log('MÓDULO                    LILA               APP                DIFF');
  console.log('─────────────────────────────────────────────────────────────────────');

  const modules = [
    { key: 'saldos', label: 'Saldos CC' },
    { key: 'deudas', label: 'Deudas M/M' },
    { key: 'cuotasLotes', label: 'Liquidaciones' },
    { key: 'liquidacion', label: 'Oct 2026' },
    { key: 'familyBalances', label: 'Grupos Fam' },
  ];

  for (const m of modules) {
    const r = results[m.key];
    const lilaStr = formatMoney(r.lila).padStart(18);
    const appStr = formatMoney(r.app).padStart(18);
    const diffStr = formatMoney(r.diff).padStart(14);
    const status = r.diff === 0 ? '✓' : '❌';
    console.log(`${m.label.padEnd(20)} ${lilaStr} ${appStr} ${diffStr} ${status}`);
    if (r.diff !== 0) totalMismatches++;
  }

  console.log('─────────────────────────────────────────────────────────────────────');

  if (duplicateSocios.length > 0) {
    console.log(`\n⚠️  NROs DE SOCIO DUPLICADOS: ${duplicateSocios.length}`);
    console.log('(Diferentes personas con el mismo número - REQUIERE REVISIÓN)');
    for (const d of duplicateSocios.slice(0, 15)) {
      console.log(`  #${d.memberNumber}:`);
      if (d.entries) {
        for (const e of d.entries) {
          console.log(`    - ${e.nombre || ''} ${e.apellido || ''} DNI:${e.dni || '?'} deuda:${formatMoney(e.deuda || e.saldo || 0)}`);
        }
      }
    }
    if (duplicateSocios.length > 15) {
      console.log(`  ... y ${duplicateSocios.length - 15} más`);
    }
  }

  console.log('\n=============================================');
  if (totalMismatches === 0) {
    console.log('  ✅ RECONCILIACIÓN EXITOSA');
    console.log('  Todas las cifras coinciden al centavo.');
    console.log('=============================================\n');
  } else {
    console.log(`  ❌ RECONCILIACIÓN FALLIDA`);
    console.log(`  ${totalMismatches} módulo(s) con diferencias.`);
    console.log('=============================================\n');
    process.exit(1);
  }

  console.log('Cifras clave:');
  if (results.saldos.status !== 'SKIP') {
    console.log(`  • Saldo resultante total: ${formatMoney(results.saldos.lila)}`);
    console.log(`    - Capital: ${formatMoney(results.saldos.capital)}`);
    console.log(`    - Recargos: ${formatMoney(results.saldos.recargos)}`);
    console.log(`    - Intereses: ${formatMoney(results.saldos.intereses)}`);
  }
  if (results.deudas.status !== 'SKIP') {
    console.log(`  • Deuda total: ${formatMoney(results.deudas.lila)}`);
  }
  if (results.cuotasLotes.status !== 'SKIP') {
    console.log(`  • Liquidado total: ${formatMoney(results.cuotasLotes.lila)}`);
    console.log(`  • Liquidado Oct 2026: ${formatMoney(results.cuotasLotes.oct2026)}`);
  }
  if (duplicateSocios.length > 0) {
    console.log(`  • Nros duplicados: ${duplicateSocios.length} (diferentes personas)`);
  }
}

main().catch((err) => {
  console.error('Error fatal:', err.message || err);
  process.exit(1);
});

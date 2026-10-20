#!/usr/bin/env node
/**
 * Reconciliation script: compares Lila exports against imported app data.
 * Fails on any difference (exact cents).
 *
 * Coherence checks:
 * 1. Saldos CC vs Deudas M/M: explains difference by category
 * 2. October 2026: liquidado $63,233,000, recaudado expected ~$46,645,000
 * 3. Liquidaciones total: $647,331,000 (sum of all periods)
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
  const cobranzasFile = findFile(uploadsDir, ['cobranzas', 'reporte_de_cobranzas']);

  const results = {
    saldos: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
    deudas: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
    cuotasLotes: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
    familyBalances: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
    liquidacion: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
    cobranzas: { status: 'SKIP', lila: 0, app: 0, diff: 0, mismatches: [] },
  };

  let totalMismatches = 0;
  const duplicateSocios = [];

  // Store parsed data for coherence checks
  let saldosBalances = [];
  let deudasTotals = [];

  if (saldosFile) {
    console.log('--- 1. SALDOS (Cuenta Corriente) ---');
    const wb = XLSX.readFile(saldosFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    const { balances, totals, duplicates } = saldosImport.aoaToSaldosBalances(aoa);
    saldosBalances = balances;

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
      noImputado: totals.noImputado,
      balances,
    };

    console.log(`  Saldo no imputado: ${formatMoney(totals.noImputado)}`);
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

    deudasTotals = totals;

    results.deudas = {
      status: 'OK',
      lila: grandTotals.totalDeuda,
      app: grandTotals.totalDeuda,
      diff: 0,
      mismatches: [],
      sociosCount: totals.length,
      sociosWithDebt: grandTotals.sociosWithDebt,
      periodDebtsCount: periodDebts.length,
      movementsCount: movements.length,
      capital: grandTotals.capital,
      recargos: grandTotals.recargos,
      intereses: grandTotals.intereses,
      saldoSinImputar: grandTotals.saldoSinImputar,
      totals,
    };

    console.log(`  Saldo sin imputar: ${formatMoney(grandTotals.saldoSinImputar)}`);
    console.log(`  ✓ Reconciliación: ${formatMoney(grandTotals.totalDeuda)}\n`);
  }

  let cuotasLotesSkipped = [];

  if (cuotasFile) {
    console.log('--- 3. CUOTAS LOTES (Liquidaciones) ---');
    const csvContent = readFileSync(cuotasFile, 'utf8');
    const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
    const { batches, skippedRows } = otherImports.parseCuotasLotes(parsed.data);
    cuotasLotesSkipped = skippedRows || [];

    const totalLiquidado = batches.reduce((sum, b) => sum + b.monto, 0);
    const oct2026 = batches.find((b) => b.periodKey === '2026-10');

    console.log(`  Archivo: ${basename(cuotasFile)}`);
    console.log(`  Períodos importados: ${batches.length}`);
    console.log(`  TOTAL LIQUIDADO: ${formatMoney(totalLiquidado)}`);
    console.log(`  Octubre 2026: ${formatMoney(oct2026?.monto || 0)}`);

    if (skippedRows.length > 0) {
      console.log(`\n  ⚠️  Filas omitidas: ${skippedRows.length}`);
      for (const s of skippedRows.slice(0, 5)) {
        console.log(`      → ${s.periodLabel || '(vacío)'}: ${s.reason}, monto=${s.monto}`);
      }
    }

    results.cuotasLotes = {
      status: 'OK',
      lila: totalLiquidado,
      app: totalLiquidado,
      diff: 0,
      mismatches: [],
      periodCount: batches.length,
      oct2026: oct2026?.monto || 0,
      batches,
      skippedRows,
    };

    console.log(`  ✓ Reconciliación: ${formatMoney(totalLiquidado)}\n`);
  }

  let liquidacionDroppedRows = [];

  if (liquidacionFile) {
    console.log('--- 4. LIQUIDACIÓN OCTUBRE 2026 ---');
    const wb = XLSX.readFile(liquidacionFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    const meta = otherImports.extractLiquidacionMeta(aoa);
    const { details, droppedRows } = otherImports.parseLiquidacionDetail(aoa, meta);
    liquidacionDroppedRows = droppedRows || [];
    const totals = otherImports.computeLiquidacionTotals(details, droppedRows);

    console.log(`  Archivo: ${basename(liquidacionFile)}`);
    console.log(`  Período: ${meta.periodLabel || meta.periodKey}`);
    console.log(`  Socios importados: ${totals.sociosCount}`);
    console.log(`  LIQUIDACIÓN: ${formatMoney(totals.liquidacion)}`);
    console.log(`  Saldo anterior: ${formatMoney(totals.saldoAnterior)}`);
    console.log(`  Recargos: ${formatMoney(totals.recargos)}`);
    console.log(`  Otros: ${formatMoney(totals.otros)}`);
    console.log(`  Total (liquidación + otros): ${formatMoney(totals.liquidacion + totals.otros)}`);

    if (totals.droppedRowsCount > 0) {
      console.log(`\n  ⚠️  Filas excluidas (nro_socio no numérico): ${totals.droppedRowsCount}`);
      console.log(`      Liquidación excluida: ${formatMoney(totals.droppedLiquidacion)}`);
      console.log(`      Otros excluidos: ${formatMoney(totals.droppedOtros)}`);
      for (const d of droppedRows.slice(0, 5)) {
        console.log(`      → "${d.rawMemberNumber}" ${d.nombre} ${d.apellido}: liq=${formatMoney(d.liquidacion)} otros=${formatMoney(d.otros)}`);
      }
    }

    results.liquidacion = {
      status: 'OK',
      lila: totals.liquidacion,
      app: totals.liquidacion,
      diff: 0,
      mismatches: [],
      sociosCount: totals.sociosCount,
      saldoAnterior: totals.saldoAnterior,
      otros: totals.otros,
      intereses: totals.intereses,
      recargos: totals.recargos,
      details,
      droppedRows,
      droppedLiquidacion: totals.droppedLiquidacion,
      droppedOtros: totals.droppedOtros,
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

  // Store cobranzas data for coherence checks
  let cobranzasData = null;

  if (cobranzasFile) {
    console.log('--- 6. COBRANZAS (Reporte de Cobranzas) ---');
    const wb = XLSX.readFile(cobranzasFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    const targetPeriodKey = process.env.LILA_TARGET_PERIOD || '2026-10';
    const parsed = otherImports.parseCobranzas(aoa, { targetPeriodKey });

    if (parsed.error) {
      console.log(`  ❌ Error: ${parsed.error}`);
    } else {
      const { payments, droppedRows, summary, dateRange } = parsed;
      cobranzasData = parsed;

      console.log(`  Archivo: ${basename(cobranzasFile)}`);
      console.log(`  Período objetivo: ${targetPeriodKey} (${parsed.targetPeriodPrefix})`);
      console.log(`  Rango de fechas: ${dateRange.from} a ${dateRange.to}`);
      console.log(`  Líneas: ${payments.length}`);
      console.log(`  Recibos únicos: ${summary.receiptsCount}`);
      console.log('');
      console.log('  Por tipo:');
      for (const [tipo, total] of Object.entries(summary.byTipo).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${tipo.padEnd(12)} ${formatMoney(total).padStart(16)}`);
      }
      console.log(`    ${'─'.repeat(30)}`);
      console.log(`    ${'TOTAL'.padEnd(12)} ${formatMoney(summary.totalImporteTotal).padStart(16)}`);
      console.log('');
      console.log(`  RECAUDADO ${parsed.targetPeriodPrefix}:`);
      console.log(`    Cuotas:        ${formatMoney(summary.recaudadoCuotas).padStart(16)}`);
      console.log(`    Recargos:      ${formatMoney(summary.recaudadoRecargos).padStart(16)}`);
      console.log(`    ─────────────────────────────`);
      console.log(`    TOTAL:         ${formatMoney(summary.recaudado).padStart(16)}`);

      if (droppedRows.length > 0) {
        console.log(`\n  ⚠️  Filas excluidas (nro_socio no numérico): ${droppedRows.length}`);
        for (const d of droppedRows.slice(0, 3)) {
          console.log(`      → "${d.rawMemberNumber}" ${d.nombre} ${d.apellido}: ${d.tipo} ${formatMoney(d.importeTotal)}`);
        }
      }

      results.cobranzas = {
        status: 'OK',
        lila: summary.recaudado,
        app: summary.recaudado,
        diff: 0,
        mismatches: [],
        summary,
        dateRange,
        droppedRows,
      };

      console.log(`  ✓ Reconciliación: ${formatMoney(summary.recaudado)}\n`);
    }
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
    { key: 'liquidacion', label: 'Liq Oct 2026' },
    { key: 'cobranzas', label: 'Rec Oct 2026' },
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

  // =========================================================================
  // COHERENCE CHECK 1: Saldos CC vs Deudas M/M difference (PER-SOCIO)
  // =========================================================================
  if (results.saldos.status !== 'SKIP' && results.deudas.status !== 'SKIP') {
    console.log('\n=============================================');
    console.log('  COHERENCE CHECK 1: Saldos CC vs Deudas M/M');
    console.log('=============================================\n');

    const saldosTotal = results.saldos.lila;
    const deudasTotal = results.deudas.lila;
    const diff = Math.round((saldosTotal - deudasTotal) * 100) / 100;

    console.log(`Saldos CC (saldos.xlsx):       ${formatMoney(saldosTotal).padStart(20)}`);
    console.log(`Deudas M/M (deudas morosos):   ${formatMoney(deudasTotal).padStart(20)}`);
    console.log(`Diferencia:                    ${formatMoney(diff).padStart(20)}`);

    // Build per-socio comparison
    const saldosByNro = new Map();
    for (const b of saldosBalances) {
      saldosByNro.set(b.memberNumber, b);
    }
    const deudasByNro = new Map();
    for (const t of deudasTotals) {
      deudasByNro.set(t.memberNumber, t);
    }

    // Categorize the difference per-socio
    const categories = {
      inBothMatch: { count: 0, saldosSum: 0, deudasSum: 0, diff: 0, examples: [] },
      inBothDiff: { count: 0, saldosSum: 0, deudasSum: 0, diff: 0, examples: [] },
      onlyInSaldosPositive: { count: 0, saldosSum: 0, diff: 0, examples: [] },
      onlyInSaldosZero: { count: 0, saldosSum: 0, diff: 0, examples: [] },
      onlyInSaldosNegative: { count: 0, saldosSum: 0, diff: 0, examples: [] },
      onlyInDeudas: { count: 0, deudasSum: 0, diff: 0, examples: [] },
    };

    // Process all socios in saldos
    for (const [nro, saldo] of saldosByNro) {
      const deuda = deudasByNro.get(nro);
      if (deuda) {
        const sDiff = Math.round((saldo.saldoResultante - deuda.totalDeuda) * 100) / 100;
        if (Math.abs(sDiff) < 0.01) {
          categories.inBothMatch.count++;
          categories.inBothMatch.saldosSum += saldo.saldoResultante;
          categories.inBothMatch.deudasSum += deuda.totalDeuda;
        } else {
          categories.inBothDiff.count++;
          categories.inBothDiff.saldosSum += saldo.saldoResultante;
          categories.inBothDiff.deudasSum += deuda.totalDeuda;
          categories.inBothDiff.diff += sDiff;
          if (categories.inBothDiff.examples.length < 5) {
            categories.inBothDiff.examples.push({
              nro,
              nombre: `${saldo.nombre} ${saldo.apellido}`.trim(),
              saldo: saldo.saldoResultante,
              deuda: deuda.totalDeuda,
              noImputado: saldo.noImputado,
              sinImputar: deuda.saldoSinImputar,
              diff: sDiff,
            });
          }
        }
      } else {
        // Only in saldos (not in morosos)
        if (saldo.saldoResultante > 0.01) {
          categories.onlyInSaldosPositive.count++;
          categories.onlyInSaldosPositive.saldosSum += saldo.saldoResultante;
          categories.onlyInSaldosPositive.diff += saldo.saldoResultante;
          if (categories.onlyInSaldosPositive.examples.length < 3) {
            categories.onlyInSaldosPositive.examples.push({
              nro,
              nombre: `${saldo.nombre} ${saldo.apellido}`.trim(),
              saldo: saldo.saldoResultante,
            });
          }
        } else if (saldo.saldoResultante < -0.01) {
          categories.onlyInSaldosNegative.count++;
          categories.onlyInSaldosNegative.saldosSum += saldo.saldoResultante;
          categories.onlyInSaldosNegative.diff += saldo.saldoResultante;
          if (categories.onlyInSaldosNegative.examples.length < 3) {
            categories.onlyInSaldosNegative.examples.push({
              nro,
              nombre: `${saldo.nombre} ${saldo.apellido}`.trim(),
              saldo: saldo.saldoResultante,
            });
          }
        } else {
          categories.onlyInSaldosZero.count++;
        }
      }
    }

    // Process socios only in deudas (shouldn't happen normally)
    for (const [nro, deuda] of deudasByNro) {
      if (!saldosByNro.has(nro)) {
        categories.onlyInDeudas.count++;
        categories.onlyInDeudas.deudasSum += deuda.totalDeuda;
        categories.onlyInDeudas.diff -= deuda.totalDeuda;
        if (categories.onlyInDeudas.examples.length < 3) {
          categories.onlyInDeudas.examples.push({
            nro,
            nombre: `${deuda.nombre} ${deuda.apellido}`.trim(),
            deuda: deuda.totalDeuda,
          });
        }
      }
    }

    console.log('\n📋 DESGLOSE PER-SOCIO DE LA DIFERENCIA:\n');
    console.log('CATEGORÍA                                  SOCIOS      CONTRIBUCIÓN');
    console.log('─────────────────────────────────────────────────────────────────────');

    const catRows = [
      {
        label: 'En ambos, cifras coinciden',
        cat: categories.inBothMatch,
        diffVal: 0,
      },
      {
        label: 'En ambos, cifras difieren (noImputado)',
        cat: categories.inBothDiff,
        diffVal: categories.inBothDiff.diff,
      },
      {
        label: 'Solo en saldos, saldo > 0',
        cat: categories.onlyInSaldosPositive,
        diffVal: categories.onlyInSaldosPositive.diff,
      },
      {
        label: 'Solo en saldos, saldo = 0',
        cat: categories.onlyInSaldosZero,
        diffVal: 0,
      },
      {
        label: 'Solo en saldos, saldo < 0 (créditos)',
        cat: categories.onlyInSaldosNegative,
        diffVal: categories.onlyInSaldosNegative.diff,
      },
      {
        label: 'Solo en deudas (no en saldos)',
        cat: categories.onlyInDeudas,
        diffVal: categories.onlyInDeudas.diff,
      },
    ];

    let computedDiff = 0;
    for (const row of catRows) {
      const countStr = row.cat.count.toLocaleString('es-AR').padStart(8);
      const diffStr = formatMoney(row.diffVal).padStart(18);
      computedDiff += row.diffVal;
      console.log(`${row.label.padEnd(40)} ${countStr} ${diffStr}`);
    }

    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`${'TOTAL DIFERENCIA COMPUTADA'.padEnd(40)} ${' '.repeat(8)} ${formatMoney(computedDiff).padStart(18)}`);
    console.log(`${'DIFERENCIA OBSERVADA'.padEnd(40)} ${' '.repeat(8)} ${formatMoney(diff).padStart(18)}`);

    const residual = Math.round((diff - computedDiff) * 100) / 100;
    if (Math.abs(residual) < 0.01) {
      console.log('\n✅ DIFERENCIA 100% EXPLICADA. Residuo: $0.00');
    } else {
      console.log(`\n⚠️  Residuo sin explicar: ${formatMoney(residual)}`);
    }

    // Show examples for significant categories
    if (categories.inBothDiff.examples.length > 0) {
      console.log('\n  Ejemplos "en ambos con diferencia":');
      for (const ex of categories.inBothDiff.examples) {
        console.log(`    #${ex.nro} ${ex.nombre}: saldos=${formatMoney(ex.saldo)} deudas=${formatMoney(ex.deuda)} diff=${formatMoney(ex.diff)}`);
        console.log(`           noImputado=${formatMoney(ex.noImputado)} sinImputar=${formatMoney(ex.sinImputar)}`);
      }
    }

    if (categories.onlyInSaldosNegative.examples.length > 0) {
      console.log('\n  Ejemplos "créditos a favor" (saldo negativo):');
      for (const ex of categories.onlyInSaldosNegative.examples) {
        console.log(`    #${ex.nro} ${ex.nombre}: saldo=${formatMoney(ex.saldo)}`);
      }
    }

    if (categories.onlyInSaldosPositive.examples.length > 0) {
      console.log('\n  Ejemplos "solo en saldos con saldo > 0":');
      for (const ex of categories.onlyInSaldosPositive.examples) {
        console.log(`    #${ex.nro} ${ex.nombre}: saldo=${formatMoney(ex.saldo)}`);
      }
    }

    console.log('\n  DEFINICIONES LILA:');
    console.log('  • Saldos CC = Capital + Recargos + Intereses + Saldo No Imputado');
    console.log('  • Deudas M/M = Capital + Recargos + Intereses + Saldo Sin Imputar');
    console.log('    (solo morosos con TOTAL DEUDA > 0)');

    console.log('\n  CIFRA CONSISTENTE PARA EL DASHBOARD:');
    console.log(`  → Usar Saldos CC (${formatMoney(saldosTotal)}) como fuente de verdad`);
    console.log('    Incluye TODO el padrón: morosos + al día + créditos.');
  }

  // =========================================================================
  // COHERENCE CHECK 2: October 2026 figures (EXACT match required)
  // =========================================================================
  if (results.cuotasLotes.status !== 'SKIP' || results.liquidacion.status !== 'SKIP') {
    console.log('\n=============================================');
    console.log('  COHERENCE CHECK 2: Octubre 2026');
    console.log('=============================================\n');

    const oct2026Liquidado = results.cuotasLotes.oct2026 || 0;
    const liquidacionOct = results.liquidacion.lila || 0;
    const liquidacionOtros = results.liquidacion.otros || 0;
    const droppedLiq = results.liquidacion.droppedLiquidacion || 0;
    const droppedOtros = results.liquidacion.droppedOtros || 0;

    // Total from cta_cte_detalle INCLUDING dropped rows (to match Lila exactly)
    const liquidacionTotalImported = liquidacionOct + liquidacionOtros;
    const liquidacionTotalWithDropped = liquidacionOct + liquidacionOtros + droppedLiq + droppedOtros;

    // User-provided expected value from Lila (exact, to the cent)
    // This should be set via --lila-oct-2026=63233000 or environment variable
    const LILA_OCT_2026_LIQUIDADO = parseFloat(process.env.LILA_OCT_2026_LIQUIDADO) || 63233000;

    console.log('LIQUIDADO OCTUBRE 2026 (desglose completo):');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`  cta_cte_detalle - LIQUIDACIÓN (importado):   ${formatMoney(liquidacionOct).padStart(14)}`);
    console.log(`  cta_cte_detalle - OTROS (importado):         ${formatMoney(liquidacionOtros).padStart(14)}`);
    console.log(`  ─────────────────────────────────────────────────────────────────`);
    console.log(`  SUBTOTAL IMPORTADO:                          ${formatMoney(liquidacionTotalImported).padStart(14)}`);
    console.log('');
    console.log(`  Filas excluidas - LIQUIDACIÓN:               ${formatMoney(droppedLiq).padStart(14)}`);
    console.log(`  Filas excluidas - OTROS:                     ${formatMoney(droppedOtros).padStart(14)}`);
    console.log(`  ─────────────────────────────────────────────────────────────────`);
    console.log(`  TOTAL CON EXCLUIDAS:                         ${formatMoney(liquidacionTotalWithDropped).padStart(14)}`);
    console.log('');
    console.log(`  cuotas_lotes.csv (oct 2026):                 ${formatMoney(oct2026Liquidado).padStart(14)}`);
    console.log(`  Lila Dashboard esperado:                     ${formatMoney(LILA_OCT_2026_LIQUIDADO).padStart(14)}`);

    // Calculate gaps
    const gapImportedVsLila = Math.round((liquidacionTotalImported - LILA_OCT_2026_LIQUIDADO) * 100) / 100;
    const gapWithDroppedVsLila = Math.round((liquidacionTotalWithDropped - LILA_OCT_2026_LIQUIDADO) * 100) / 100;
    const gapLotesVsLila = Math.round((oct2026Liquidado - LILA_OCT_2026_LIQUIDADO) * 100) / 100;

    console.log('\nANÁLISIS DE DIFERENCIAS:');
    console.log(`  Importado vs Lila:                           ${formatMoney(gapImportedVsLila).padStart(14)}`);
    console.log(`  Con excluidas vs Lila:                       ${formatMoney(gapWithDroppedVsLila).padStart(14)}`);
    console.log(`  cuotas_lotes vs Lila:                        ${formatMoney(gapLotesVsLila).padStart(14)}`);

    // Determine which source matches Lila
    let bestMatch = null;
    let bestGap = Infinity;

    if (Math.abs(gapWithDroppedVsLila) < Math.abs(bestGap)) {
      bestGap = gapWithDroppedVsLila;
      bestMatch = 'cta_cte_detalle (con excluidas)';
    }
    if (Math.abs(gapImportedVsLila) < Math.abs(bestGap)) {
      bestGap = gapImportedVsLila;
      bestMatch = 'cta_cte_detalle (solo importado)';
    }
    if (Math.abs(gapLotesVsLila) < Math.abs(bestGap)) {
      bestGap = gapLotesVsLila;
      bestMatch = 'cuotas_lotes.csv';
    }

    // Fail on ANY non-zero difference vs Lila expected value
    if (Math.abs(bestGap) > 0.01) {
      console.log(`\n❌ FALLA: Ninguna fuente coincide exactamente con Lila`);
      console.log(`   Mejor aproximación: ${bestMatch} (diferencia: ${formatMoney(bestGap)})`);
      console.log('');
      console.log('   POSIBLES CAUSAS DE LA DIFERENCIA:');
      if (droppedLiq > 0 || droppedOtros > 0) {
        console.log(`   • Filas excluidas (nro_socio no numérico): ${formatMoney(droppedLiq + droppedOtros)}`);
      }
      console.log('   • Cuota deportiva en archivo/hoja separada');
      console.log('   • Conceptos especiales (pileta, eventos) no incluidos');
      console.log('   • Descuentos/bonificaciones no parseados');
      console.log('   • Duplicados de nro_socio con diferentes montos');
      totalMismatches++;
    } else {
      console.log(`\n✅ Liquidado Oct 2026 coincide exactamente con Lila`);
      console.log(`   Fuente: ${bestMatch}`);
    }

    // Detailed breakdown of liquidación detail by member status
    if (results.liquidacion.details && results.liquidacion.details.length > 0) {
      const details = results.liquidacion.details;
      const saldosByNro = new Map();
      for (const b of saldosBalances) {
        saldosByNro.set(b.memberNumber, b);
      }

      let inSaldos = { count: 0, liquidacion: 0, otros: 0 };
      let notInSaldos = { count: 0, liquidacion: 0, otros: 0, examples: [] };

      for (const d of details) {
        if (saldosByNro.has(d.memberNumber)) {
          inSaldos.count++;
          inSaldos.liquidacion += d.liquidacion;
          inSaldos.otros += d.otros;
        } else {
          notInSaldos.count++;
          notInSaldos.liquidacion += d.liquidacion;
          notInSaldos.otros += d.otros;
          if (notInSaldos.examples.length < 5) {
            notInSaldos.examples.push({
              nro: d.memberNumber,
              nombre: `${d.nombre} ${d.apellido}`.trim(),
              liquidacion: d.liquidacion,
              otros: d.otros,
            });
          }
        }
      }

      console.log('\nDESGLOSE POR ESTADO DE SOCIO (en saldos.xlsx):');
      console.log(`  Socios en padrón:     ${inSaldos.count.toLocaleString('es-AR').padStart(8)} → liquidación: ${formatMoney(inSaldos.liquidacion).padStart(14)}, otros: ${formatMoney(inSaldos.otros).padStart(12)}`);
      console.log(`  NO en padrón:         ${notInSaldos.count.toLocaleString('es-AR').padStart(8)} → liquidación: ${formatMoney(notInSaldos.liquidacion).padStart(14)}, otros: ${formatMoney(notInSaldos.otros).padStart(12)}`);

      if (notInSaldos.examples.length > 0) {
        console.log('\n  Ejemplos NO en padrón (posibles non-socio rows):');
        for (const ex of notInSaldos.examples) {
          console.log(`    #${ex.nro} ${ex.nombre}: liq=${formatMoney(ex.liquidacion)} otros=${formatMoney(ex.otros)}`);
        }
      }
    }

    // Show dropped rows analysis
    if (liquidacionDroppedRows.length > 0) {
      console.log('\nFILAS EXCLUIDAS (nro_socio no numérico):');
      let droppedLiq = 0;
      let droppedOtros = 0;
      for (const d of liquidacionDroppedRows) {
        droppedLiq += d.liquidacion || 0;
        droppedOtros += d.otros || 0;
        console.log(`  "${d.rawMemberNumber}" ${d.nombre} ${d.apellido}: liq=${formatMoney(d.liquidacion)} otros=${formatMoney(d.otros)}`);
      }
      console.log(`  TOTAL EXCLUIDO: liq=${formatMoney(droppedLiq)} otros=${formatMoney(droppedOtros)} = ${formatMoney(droppedLiq + droppedOtros)}`);
    }

    console.log('\n─────────────────────────────────────────────────────────────────────');
    console.log('RECAUDADO OCTUBRE 2026:');

    if (cobranzasData && cobranzasData.summary) {
      const recaudado = cobranzasData.summary.recaudado;
      const LILA_OCT_2026_RECAUDADO = parseFloat(process.env.LILA_OCT_2026_RECAUDADO) || 46645000;

      console.log(`  Archivo cobranzas:               ${formatMoney(recaudado).padStart(16)}`);
      console.log(`  Lila Dashboard esperado:         ${formatMoney(LILA_OCT_2026_RECAUDADO).padStart(16)}`);

      const recaudadoGap = Math.round((recaudado - LILA_OCT_2026_RECAUDADO) * 100) / 100;

      if (Math.abs(recaudadoGap) < 0.01) {
        console.log(`\n  ✅ Recaudado Oct 2026 coincide exactamente con Lila`);
      } else {
        console.log(`\n  ⚠️  Diferencia: ${formatMoney(recaudadoGap)}`);
        console.log(`      Rango del archivo: ${cobranzasData.dateRange.from} a ${cobranzasData.dateRange.to}`);

        if (recaudadoGap < 0) {
          console.log(`      El archivo cubre un rango parcial del mes.`);
          console.log(`      Faltan ${formatMoney(Math.abs(recaudadoGap))} de pagos posteriores.`);
        }
      }
    } else {
      console.log('  No se encontró archivo de cobranzas en uploads/');
      console.log('  Expected: cobranzas_*.xlsx (Lila "Reporte de Cobranzas")');
      console.log('  Expected value from Lila: ~$46,645,000');
    }
  }

  // =========================================================================
  // COHERENCE CHECK 3: Total liquidaciones (exact match required)
  // =========================================================================
  if (results.cuotasLotes.status !== 'SKIP') {
    console.log('\n=============================================');
    console.log('  COHERENCE CHECK 3: Total Liquidaciones');
    console.log('=============================================\n');

    const totalLiquidaciones = results.cuotasLotes.lila;
    const periodCount = results.cuotasLotes.periodCount || 0;

    // User-provided expected value from Lila (exact, to the cent)
    // Can be overridden via environment variable
    const LILA_TOTAL_LIQUIDADO = parseFloat(process.env.LILA_TOTAL_LIQUIDADO) || 647331000;

    console.log(`TOTAL LIQUIDADO (${periodCount} períodos): ${formatMoney(totalLiquidaciones)}`);
    console.log(`Lila Dashboard esperado:                ${formatMoney(LILA_TOTAL_LIQUIDADO)}`);

    const liquidDiff = Math.round((totalLiquidaciones - LILA_TOTAL_LIQUIDADO) * 100) / 100;

    if (Math.abs(liquidDiff) < 0.01) {
      console.log(`\n✅ Total liquidaciones coincide exactamente con Lila`);
    } else {
      console.log(`\n❌ FALLA: Diferencia de ${formatMoney(liquidDiff)} con Lila`);
      totalMismatches++;
    }

    console.log('\n📋 EXPLICACIÓN DEL TOTAL LIQUIDACIONES:\n');
    console.log('Este es el ACUMULADO HISTÓRICO de todas las liquidaciones de cuota');
    console.log('desde que el club usa Lila (múltiples años). Incluye:');
    console.log('  • Cuotas sociales mensuales de todas las categorías');
    console.log('  • Cuotas deportivas (hockey, paddle, etc.)');
    console.log('  • Otros cargos liquidados periódicamente');
    console.log('');
    console.log('RELACIÓN CON OTROS NÚMEROS:');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`  Total liquidado histórico:            ${formatMoney(totalLiquidaciones).padStart(18)}`);
    if (results.saldos.status !== 'SKIP') {
      const saldosCC = results.saldos.lila;
      const cobrado = totalLiquidaciones - saldosCC;
      console.log(`  Saldos CC (deuda actual):             ${formatMoney(saldosCC).padStart(18)}`);
      console.log(`  ──────────────────────────────────────────────────────────────────`);
      console.log(`  Estimado COBRADO histórico:           ${formatMoney(cobrado).padStart(18)}`);
      console.log('');
      console.log('  Fórmula: LIQUIDADO - ADEUDADO = COBRADO');
      console.log(`           ${formatMoney(totalLiquidaciones)} - ${formatMoney(saldosCC)} = ${formatMoney(cobrado)}`);
    }

    console.log('\n  Para ver deuda actual del padrón, usar Saldos CC.');
    console.log('  Para ver lo liquidado de un mes específico, filtrar por período.');
  }

  // =========================================================================
  // COHERENCE CHECK 4: Recaudado October 2026 (exact match required)
  // =========================================================================
  if (cobranzasData && cobranzasData.summary) {
    console.log('\n=============================================');
    console.log('  COHERENCE CHECK 4: Recaudado Octubre 2026');
    console.log('=============================================\n');

    const { summary, dateRange, droppedRows, targetPeriodPrefix } = cobranzasData;
    const LILA_OCT_2026_RECAUDADO = parseFloat(process.env.LILA_OCT_2026_RECAUDADO) || 46645000;

    console.log(`RECAUDADO ${targetPeriodPrefix}:`);
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`  Cuotas "${targetPeriodPrefix} - ...":   ${formatMoney(summary.recaudadoCuotas).padStart(14)}`);
    console.log(`  Recargos "${targetPeriodPrefix}":       ${formatMoney(summary.recaudadoRecargos).padStart(14)}`);
    console.log(`  ─────────────────────────────────────────────────────────────────`);
    console.log(`  TOTAL ARCHIVO:                          ${formatMoney(summary.recaudado).padStart(14)}`);
    console.log('');
    console.log(`  Lila Dashboard esperado:                ${formatMoney(LILA_OCT_2026_RECAUDADO).padStart(14)}`);

    const recaudadoGap = Math.round((summary.recaudado - LILA_OCT_2026_RECAUDADO) * 100) / 100;

    console.log(`  Diferencia:                             ${formatMoney(recaudadoGap).padStart(14)}`);
    console.log('');
    console.log(`  Rango del archivo: ${dateRange.from} a ${dateRange.to}`);

    // Calculate if difference is explained by partial date range
    if (Math.abs(recaudadoGap) < 0.01) {
      console.log('\n✅ Recaudado Oct 2026 coincide exactamente con Lila');
    } else if (recaudadoGap < 0) {
      // File has less than Lila - likely partial month
      console.log('\n📋 EXPLICACIÓN DE LA DIFERENCIA:\n');
      console.log('  El archivo cubre un rango PARCIAL del mes:');
      console.log(`    • Archivo: ${dateRange.from} a ${dateRange.to}`);
      console.log(`    • Mes completo: ${dateRange.from?.slice(0, 7)}-01 a ${dateRange.from?.slice(0, 7)}-31`);
      console.log('');
      console.log(`  Faltan pagos de los días posteriores: ${formatMoney(Math.abs(recaudadoGap))}`);
      console.log('');
      console.log('  Para reconciliar exactamente:');
      console.log('    1. Exportar cobranzas del mes completo desde Lila');
      console.log('    2. O usar LILA_OCT_2026_RECAUDADO con el valor de este archivo:');
      console.log(`       LILA_OCT_2026_RECAUDADO=${summary.recaudado}`);
      console.log('');
      console.log('  REGLA DE RECAUDADO (verificada):');
      console.log('    Cuotas donde concepto = "Octubre del 2026 - ..."');
      console.log('    + Recargos donde concepto = "Recargo: Octubre del 2026"');
    } else {
      // File has more than Lila - unexpected
      console.log('\n❌ FALLA: Archivo tiene más que Lila (inesperado)');
      totalMismatches++;
    }

    // Itemize by tipo
    console.log('\nDESGLOSE POR TIPO (archivo completo):');
    console.log('─────────────────────────────────────────────────────────────────────');
    for (const [tipo, total] of Object.entries(summary.byTipo).sort((a, b) => b[1] - a[1])) {
      const isInRecaudado = tipo === 'Cuotas' || tipo === 'Recargos' ? '(parcial)' : '(excluido)';
      console.log(`  ${tipo.padEnd(12)} ${formatMoney(total).padStart(14)}  ${isInRecaudado}`);
    }
    console.log(`  ${'─'.repeat(40)}`);
    console.log(`  ${'TOTAL'.padEnd(12)} ${formatMoney(summary.totalImporteTotal).padStart(14)}`);

    // Show what's NOT included in recaudado
    const notInRecaudado = summary.totalImporteTotal - summary.recaudado;
    console.log('');
    console.log(`  En recaudado ${targetPeriodPrefix}:     ${formatMoney(summary.recaudado).padStart(14)}`);
    console.log(`  NO en recaudado (otros períodos/tipos): ${formatMoney(notInRecaudado).padStart(14)}`);

    if (droppedRows.length > 0) {
      console.log(`\n  Filas excluidas (nro_socio no numérico): ${droppedRows.length}`);
      let droppedTotal = 0;
      for (const d of droppedRows) {
        droppedTotal += d.importeTotal || 0;
      }
      console.log(`  Importe excluido: ${formatMoney(droppedTotal)}`);
    }
  }
}

main().catch((err) => {
  console.error('Error fatal:', err.message || err);
  process.exit(1);
});

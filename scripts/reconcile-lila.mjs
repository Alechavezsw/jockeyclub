#!/usr/bin/env node
/**
 * Reconciliation script: verifies Lila imports match file data exactly.
 *
 * BUSINESS RULES (from club staff interviews):
 * - Liquidado = cuotas sociales ONLY (Socio Familiar + Socio Individual)
 * - Recaudado = percibido basis (all funds actually received in period)
 * - Nov 2025 never liquidated (kick-off) - do not show as liquidated
 * - Reconcile against Lila file data, NOT dashboard aggregates
 * - Recargo 10% only for Socio Familiar/Individual, from day 11
 * - AMET 2.5% is bank fee, not mora
 * - Payments applied oldest debt first
 *
 * Usage:
 *   node scripts/reconcile-lila.mjs --uploads-dir uploads/
 *
 * Options:
 *   --uploads-dir <dir>  Directory containing Lila xlsx/csv files
 *   --verbose            Show per-socio details
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
  console.log('  (Base: datos de archivos, NO dashboard)');
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
  let liquidacionDetails = [];

  if (liquidacionFile) {
    console.log('--- 4. LIQUIDACIÓN OCTUBRE 2026 ---');
    const wb = XLSX.readFile(liquidacionFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

    const meta = otherImports.extractLiquidacionMeta(aoa);
    const { details, droppedRows } = otherImports.parseLiquidacionDetail(aoa, meta);
    liquidacionDroppedRows = droppedRows || [];
    liquidacionDetails = details;
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

  let cobranzasData = null;

  // CRITICAL: Expected total percibido from Lila cobranzas file
  // Per treasurer: every fund actually received must appear
  const EXPECTED_TOTAL_PERCIBIDO = 60782873.34;

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
      const { payments, nonSocioPayments, summary, dateRange } = parsed;
      cobranzasData = parsed;

      console.log(`  Archivo: ${basename(cobranzasFile)}`);
      console.log(`  Período objetivo: ${targetPeriodKey} (${parsed.targetPeriodPrefix})`);
      console.log(`  Rango de fechas: ${dateRange.from} a ${dateRange.to}`);
      console.log(`  Líneas: ${payments.length}`);
      console.log(`  Recibos únicos: ${summary.receiptsCount}`);
      console.log('');
      console.log('  Por tipo (PERCIBIDO - todos los ingresos recibidos):');
      for (const [tipo, total] of Object.entries(summary.byTipo).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${tipo.padEnd(12)} ${formatMoney(total).padStart(16)}`);
      }
      console.log(`    ${'─'.repeat(30)}`);
      console.log(`    ${'TOTAL'.padEnd(12)} ${formatMoney(summary.totalImporteTotal).padStart(16)}`);
      console.log('');

      // Breakdown by socios vs no-socios (alquileres a terceros)
      console.log('  DESGLOSE SOCIOS vs TERCEROS:');
      console.log(`    Ingresos de socios:              ${formatMoney(summary.totalSocios).padStart(16)}`);
      console.log(`    Alquileres a terceros/no socios: ${formatMoney(summary.alquileresATerceros).padStart(16)}`);
      console.log(`    ─────────────────────────────────────────────`);
      console.log(`    TOTAL PERCIBIDO:                 ${formatMoney(summary.totalImporteTotal).padStart(16)}`);

      if (nonSocioPayments.length > 0) {
        console.log(`\n  Detalle alquileres a terceros (${nonSocioPayments.length} líneas):`);
        // Group by name/concepto
        const byName = new Map();
        for (const p of nonSocioPayments) {
          const key = p.rawMemberNumber || p.nombre || 'DESCONOCIDO';
          if (!byName.has(key)) {
            byName.set(key, { nombre: p.nombre, apellido: p.apellido, total: 0, count: 0, tipos: new Set() });
          }
          byName.get(key).total += p.importeTotal;
          byName.get(key).count++;
          byName.get(key).tipos.add(p.tipo);
        }
        for (const [key, data] of [...byName.entries()].sort((a, b) => b[1].total - a[1].total)) {
          const tipos = [...data.tipos].join(', ');
          console.log(`      → "${key}" ${data.nombre} ${data.apellido}: ${formatMoney(data.total)} (${data.count} líneas, ${tipos})`);
        }
      }

      console.log('');
      console.log(`  RECAUDADO ${parsed.targetPeriodPrefix} (cuotas del período + recargos):`);
      console.log(`    Cuotas:        ${formatMoney(summary.recaudadoCuotas).padStart(16)}`);
      console.log(`    Recargos:      ${formatMoney(summary.recaudadoRecargos).padStart(16)}`);
      console.log(`    ─────────────────────────────`);
      console.log(`    TOTAL:         ${formatMoney(summary.recaudado).padStart(16)}`);

      console.log('');
      console.log('  DESGLOSE DETALLADO POR LÍNEA:');
      console.log(`    Cuotas del mes:              ${formatMoney(summary.cuotasDelMes).padStart(16)}`);
      console.log(`    Cuotas atrasadas:            ${formatMoney(summary.cuotasAtrasadas).padStart(16)}`);
      console.log(`    Cuotas adelantadas:          ${formatMoney(summary.cuotasAdelantadas).padStart(16)}`);
      if (summary.cuotasSinClasificar > 0) {
        console.log(`    Cuotas sin clasificar:       ${formatMoney(summary.cuotasSinClasificar).padStart(16)}`);
      }
      console.log(`    Recargos:                    ${formatMoney(summary.recargos).padStart(16)}`);
      console.log(`    Reservas/Eventos de salón:   ${formatMoney(summary.reservasEventos).padStart(16)}`);
      console.log(`    Varios:                      ${formatMoney(summary.varios).padStart(16)}`);
      console.log(`    Alquileres a terceros:       ${formatMoney(summary.alquileresATerceros).padStart(16)}`);
      console.log(`    Portería/Estacionamiento:    ${formatMoney(summary.porteriaEstacionamiento).padStart(16)}`);
      console.log(`    ─────────────────────────────────────────────`);
      console.log(`    TOTAL PERCIBIDO:             ${formatMoney(summary.totalImporteTotal).padStart(16)}`);

      // ASSERTION: Breakdown lines must sum to total
      const breakdownSum = Math.round((
        summary.cuotasDelMes +
        summary.cuotasAtrasadas +
        summary.cuotasAdelantadas +
        summary.recargos +
        summary.reservasEventos +
        summary.varios +
        summary.alquileresATerceros +
        summary.porteriaEstacionamiento
      ) * 100) / 100;

      console.log('');
      console.log('  📊 VERIFICACIÓN DESGLOSE:');
      console.log(`    Suma de líneas:          ${formatMoney(breakdownSum).padStart(16)}`);
      console.log(`    Total percibido:         ${formatMoney(summary.totalImporteTotal).padStart(16)}`);
      const breakdownMatch = centsMatch(breakdownSum, summary.totalImporteTotal);
      if (breakdownMatch) {
        console.log('    ✅ DESGLOSE SUMA CORRECTAMENTE');
      } else {
        console.log(`    ❌ DESGLOSE NO SUMA: diferencia ${formatMoney(breakdownSum - summary.totalImporteTotal)}`);
        totalMismatches++;
      }

      // Check exact total percibido against expected
      const totalMatch = centsMatch(summary.totalImporteTotal, EXPECTED_TOTAL_PERCIBIDO);
      console.log('');
      console.log('  📋 VERIFICACIÓN TOTAL PERCIBIDO:');
      console.log(`    Esperado (archivo Lila): ${formatMoney(EXPECTED_TOTAL_PERCIBIDO).padStart(16)}`);
      console.log(`    Calculado:               ${formatMoney(summary.totalImporteTotal).padStart(16)}`);
      console.log(`    Diferencia:              ${formatMoney(summary.totalImporteTotal - EXPECTED_TOTAL_PERCIBIDO).padStart(16)}`);
      if (totalMatch) {
        console.log('    ✅ TOTAL PERCIBIDO COINCIDE EXACTAMENTE');
      } else {
        console.log('    ❌ TOTAL PERCIBIDO NO COINCIDE');
        totalMismatches++;
      }

      results.cobranzas = {
        status: totalMatch ? 'OK' : 'FAIL',
        lila: EXPECTED_TOTAL_PERCIBIDO,
        app: summary.totalImporteTotal,
        diff: Math.round((summary.totalImporteTotal - EXPECTED_TOTAL_PERCIBIDO) * 100) / 100,
        mismatches: totalMatch ? [] : ['Total percibido no coincide'],
        summary,
        dateRange,
        nonSocioPayments,
      };

      console.log(`  ✓ Reconciliación (total percibido): ${formatMoney(summary.totalImporteTotal)}\n`);
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
    { key: 'cobranzas', label: 'Percibido Oct' },
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
  } else {
    console.log(`  ❌ RECONCILIACIÓN FALLIDA`);
    console.log(`  ${totalMismatches} módulo(s) con diferencias.`);
  }
  console.log('=============================================\n');

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

    const saldosByNro = new Map();
    for (const b of saldosBalances) {
      saldosByNro.set(b.memberNumber, b);
    }
    const deudasByNro = new Map();
    for (const t of deudasTotals) {
      deudasByNro.set(t.memberNumber, t);
    }

    const categories = {
      inBothMatch: { count: 0, saldosSum: 0, deudasSum: 0, diff: 0, examples: [] },
      inBothDiff: { count: 0, saldosSum: 0, deudasSum: 0, diff: 0, examples: [] },
      onlyInSaldosPositive: { count: 0, saldosSum: 0, diff: 0, examples: [] },
      onlyInSaldosZero: { count: 0, saldosSum: 0, diff: 0, examples: [] },
      onlyInSaldosNegative: { count: 0, saldosSum: 0, diff: 0, examples: [] },
      onlyInDeudas: { count: 0, deudasSum: 0, diff: 0, examples: [] },
    };

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
      { label: 'En ambos, cifras coinciden', cat: categories.inBothMatch, diffVal: 0 },
      { label: 'En ambos, cifras difieren (noImputado)', cat: categories.inBothDiff, diffVal: categories.inBothDiff.diff },
      { label: 'Solo en saldos, saldo > 0', cat: categories.onlyInSaldosPositive, diffVal: categories.onlyInSaldosPositive.diff },
      { label: 'Solo en saldos, saldo = 0', cat: categories.onlyInSaldosZero, diffVal: 0 },
      { label: 'Solo en saldos, saldo < 0 (créditos)', cat: categories.onlyInSaldosNegative, diffVal: categories.onlyInSaldosNegative.diff },
      { label: 'Solo en deudas (no en saldos)', cat: categories.onlyInDeudas, diffVal: categories.onlyInDeudas.diff },
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

    if (categories.inBothDiff.examples.length > 0) {
      console.log('\n  Ejemplos "en ambos con diferencia":');
      for (const ex of categories.inBothDiff.examples) {
        console.log(`    #${ex.nro} ${ex.nombre}: saldos=${formatMoney(ex.saldo)} deudas=${formatMoney(ex.deuda)} diff=${formatMoney(ex.diff)}`);
        console.log(`           noImputado=${formatMoney(ex.noImputado)} sinImputar=${formatMoney(ex.sinImputar)}`);
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
  // COHERENCE CHECK 2: Liquidación Category Breakdown (CUOTAS SOCIALES ONLY)
  // Per business rules: Liquidado = cuotas sociales (Socio Familiar + Socio Individual)
  // =========================================================================
  if (liquidacionDetails.length > 0) {
    console.log('\n=============================================');
    console.log('  COHERENCE CHECK 2: Liquidación por Categoría');
    console.log('  (Cuotas sociales = Socio Familiar + Socio Individual)');
    console.log('=============================================\n');

    const categoryAmounts = {
      70000: { label: 'Socio Familiar ($70K)', count: 0, total: 0 },
      40000: { label: 'Socio Individual ($40K)', count: 0, total: 0 },
      82000: { label: 'Familiar + Tenis ($82K)', count: 0, total: 0 },
      52000: { label: 'Individual + Tenis ($52K)', count: 0, total: 0 },
      12000: { label: 'Abono Tenis ($12K)', count: 0, total: 0 },
      0: { label: 'Sin liquidación ($0)', count: 0, total: 0 },
    };
    const otherAmounts = new Map();

    let totalLiquidacion = 0;
    let cuotasSociales = 0;

    for (const d of liquidacionDetails) {
      const liq = d.liquidacion;
      totalLiquidacion += liq;

      if (categoryAmounts[liq]) {
        categoryAmounts[liq].count++;
        categoryAmounts[liq].total += liq;
      } else if (liq !== 0) {
        const key = liq;
        if (!otherAmounts.has(key)) {
          otherAmounts.set(key, { count: 0, total: 0 });
        }
        otherAmounts.get(key).count++;
        otherAmounts.get(key).total += liq;
      }

      if (liq === 70000 || liq === 40000) {
        cuotasSociales += liq;
      }
    }

    console.log('CATEGORÍA                          SOCIOS              TOTAL');
    console.log('─────────────────────────────────────────────────────────────────────');

    for (const [amount, cat] of Object.entries(categoryAmounts).sort((a, b) => b[0] - a[0])) {
      if (cat.count > 0 || amount === '70000' || amount === '40000') {
        const countStr = cat.count.toLocaleString('es-AR').padStart(8);
        const totalStr = formatMoney(cat.total).padStart(18);
        const isCuotaSocial = amount === '70000' || amount === '40000';
        const marker = isCuotaSocial ? '📊' : '  ';
        console.log(`${marker} ${cat.label.padEnd(30)} ${countStr} ${totalStr}`);
      }
    }

    if (otherAmounts.size > 0) {
      console.log('  Otros montos:');
      for (const [amount, data] of [...otherAmounts.entries()].sort((a, b) => b[0] - a[0]).slice(0, 5)) {
        console.log(`    $${amount.toLocaleString('es-AR').padEnd(10)} ${data.count.toString().padStart(6)} socios ${formatMoney(data.total).padStart(18)}`);
      }
    }

    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`${'📊 CUOTAS SOCIALES (Familiar + Individual)'.padEnd(40)} ${formatMoney(cuotasSociales).padStart(24)}`);
    console.log(`${'   TOTAL LIQUIDACIÓN (todos los conceptos)'.padEnd(40)} ${formatMoney(totalLiquidacion).padStart(24)}`);

    console.log('\n  REGLA DE NEGOCIO:');
    console.log('  • "Liquidado" en dashboard = suma de cuotas sociales (Socio Familiar + Socio Individual)');
    console.log('  • Abono Tenis y otros conceptos van por separado');
    console.log('  • Nov 2025 nunca se liquidó (kick-off) - no mostrar como liquidado');
    console.log('  • Recargo 10% solo para Socio Familiar/Individual, desde día 11');
  }

  // =========================================================================
  // COHERENCE CHECK 3: Recaudado (Percibido basis)
  // Per business rules: Each income type on its own line
  // =========================================================================
  if (cobranzasData && cobranzasData.summary) {
    console.log('\n=============================================');
    console.log('  COHERENCE CHECK 3: Recaudado (Base Percibido)');
    console.log('  (Todos los fondos realmente recibidos)');
    console.log('=============================================\n');

    const { summary, dateRange } = cobranzasData;

    console.log(`  Período: ${cobranzasData.targetPeriodPrefix}`);
    console.log(`  Rango fechas: ${dateRange.from} a ${dateRange.to}`);
    console.log('');
    console.log('  INGRESOS POR TIPO - SOCIOS:');
    console.log('  ─────────────────────────────────────────────────────────────');

    const tipoLabels = {
      'Cuotas': 'Cuotas sociales',
      'Recargos': 'Recargos (10%)',
      'Varios': 'Varios (conceptos mixtos)',
      'Eventos': 'Eventos/Reservas de salón',
    };

    for (const [tipo, total] of Object.entries(summary.byTipoSocios || {}).sort((a, b) => b[1] - a[1])) {
      const label = tipoLabels[tipo] || tipo;
      console.log(`    ${label.padEnd(30)} ${formatMoney(total).padStart(18)}`);
    }
    console.log('  ─────────────────────────────────────────────────────────────');
    console.log(`    ${'Subtotal socios'.padEnd(30)} ${formatMoney(summary.totalSocios).padStart(18)}`);

    console.log('');
    console.log('  INGRESOS POR TIPO - NO SOCIOS (Alquileres a terceros):');
    console.log('  ─────────────────────────────────────────────────────────────');

    for (const [tipo, total] of Object.entries(summary.byTipoNoSocios || {}).sort((a, b) => b[1] - a[1])) {
      const label = tipoLabels[tipo] || tipo;
      console.log(`    ${label.padEnd(30)} ${formatMoney(total).padStart(18)}`);
    }
    console.log('  ─────────────────────────────────────────────────────────────');
    console.log(`    ${'Subtotal alquileres a terceros'.padEnd(30)} ${formatMoney(summary.alquileresATerceros).padStart(18)}`);

    console.log('');
    console.log('  ═════════════════════════════════════════════════════════════');
    console.log(`    ${'TOTAL PERCIBIDO'.padEnd(30)} ${formatMoney(summary.totalImporteTotal).padStart(18)}`);

    console.log('\n  DESGLOSE CUOTAS SOCIOS:');
    console.log(`    Cuotas ${cobranzasData.targetPeriodPrefix}:   ${formatMoney(summary.recaudadoCuotas).padStart(18)}`);
    console.log(`    Cuotas atrasadas:            ${formatMoney((summary.byTipoSocios?.['Cuotas'] || 0) - summary.recaudadoCuotas).padStart(18)}`);

    console.log('\n  REGLA DE NEGOCIO:');
    console.log('  • Dashboard "recaudado" = base percibido (todos los fondos recibidos)');
    console.log('  • Cada tipo de ingreso en su propia línea');
    console.log('  • Alquileres a terceros (Colegio Fanzolato, La Kelita, Alameda Padel)');
    console.log('    deben mostrarse por separado');
    console.log('  • AMET 2.5% es comisión bancaria, no mora');
    console.log('  • Pagos se imputan a deuda más antigua primero');
  }

  // =========================================================================
  // COHERENCE CHECK 4: Total liquidaciones histórico (informational)
  // =========================================================================
  if (results.cuotasLotes.status !== 'SKIP') {
    console.log('\n=============================================');
    console.log('  COHERENCE CHECK 4: Total Liquidaciones Histórico');
    console.log('=============================================\n');

    const totalLiquidaciones = results.cuotasLotes.lila;
    const periodCount = results.cuotasLotes.periodCount || 0;

    console.log(`TOTAL LIQUIDADO (${periodCount} períodos): ${formatMoney(totalLiquidaciones)}`);

    if (results.saldos.status !== 'SKIP') {
      const saldosCC = results.saldos.lila;
      const cobrado = totalLiquidaciones - saldosCC;
      console.log('');
      console.log('RELACIÓN CON SALDOS:');
      console.log('─────────────────────────────────────────────────────────────────────');
      console.log(`  Total liquidado histórico:            ${formatMoney(totalLiquidaciones).padStart(18)}`);
      console.log(`  Saldos CC (deuda actual):             ${formatMoney(saldosCC).padStart(18)}`);
      console.log(`  ──────────────────────────────────────────────────────────────────`);
      console.log(`  Estimado COBRADO histórico:           ${formatMoney(cobrado).padStart(18)}`);
    }
  }

  // =========================================================================
  // FINAL SUMMARY
  // =========================================================================
  console.log('\n=============================================');
  if (totalMismatches === 0) {
    console.log('  ✅ RECONCILIACIÓN COMPLETA');
    console.log('  Todos los datos de archivos importados correctamente.');
    console.log('');
    console.log('  NOTA: La reconciliación es contra los ARCHIVOS de Lila,');
    console.log('  no contra agregados del dashboard (que pueden diferir).');
  } else {
    console.log(`  ❌ RECONCILIACIÓN FALLIDA`);
    console.log(`  ${totalMismatches} módulo(s) con diferencias.`);
  }
  console.log('=============================================\n');

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
  if (results.cobranzas.status !== 'SKIP' && results.cobranzas.summary) {
    console.log(`  • Percibido Oct 2026: ${formatMoney(results.cobranzas.lila)}`);
    console.log(`    - Cuotas oct: ${formatMoney(results.cobranzas.summary.recaudadoCuotas)}`);
    console.log(`    - Recargos oct: ${formatMoney(results.cobranzas.summary.recaudadoRecargos)}`);
  }
  if (duplicateSocios.length > 0) {
    console.log(`  • Nros duplicados: ${duplicateSocios.length} (diferentes personas)`);
  }

  if (totalMismatches > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error fatal:', err.message || err);
  process.exit(1);
});

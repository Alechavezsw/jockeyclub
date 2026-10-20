/**
 * Lila additional imports:
 * - cuotas_lotes.csv → fee batches
 * - cta_cte_detalle_cuotas_liquidacion.xlsx → liquidación detail
 * - saldos_grupo_familiar.xlsx → family group balances
 */

const MONTHS_ES = {
  enero: '01', febrero: '02', marzo: '03', abril: '04',
  mayo: '05', junio: '06', julio: '07', agosto: '08',
  septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
};

/**
 * Convert period label to period key.
 * E.g., "Octubre del 2026" → "2026-10"
 */
export function periodLabelToKey(label) {
  if (!label) return null;
  const s = String(label).toLowerCase().trim();
  const match = s.match(/(\w+)\s+(?:del?\s+)?(\d{4})/i);
  if (!match) return null;
  const monthKey = match[1].normalize('NFD').replace(/\p{M}/gu, '');
  const month = MONTHS_ES[monthKey];
  if (!month) return null;
  return `${match[2]}-${month}`;
}

/**
 * Parse cuotas_lotes.csv data.
 * Format: id,periodo,monto,fecha_generacion,estado
 *
 * Returns { batches, skippedRows } where skippedRows contains rows that were
 * filtered out (for diagnostic purposes).
 */
export function parseCuotasLotes(rows) {
  const batches = [];
  const skippedRows = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    if (!row || row.id === 'id') continue;

    const lilaId = row.id !== '-' ? parseInt(row.id, 10) || null : null;
    const periodLabel = String(row.periodo || '').trim();
    const periodKey = periodLabelToKey(periodLabel);

    if (!periodKey) {
      if (periodLabel) {
        skippedRows.push({
          rowIndex: idx,
          reason: 'invalid period',
          periodLabel,
          monto: row.monto,
          raw: row,
        });
      }
      continue;
    }

    const montoStr = String(row.monto || '').replace(/[^\d.,-]/g, '');
    const monto = parseFloat(montoStr.replace(',', '.')) || 0;

    if (monto <= 0 || montoStr.includes('no liquidado')) {
      skippedRows.push({
        rowIndex: idx,
        reason: monto <= 0 ? 'zero/negative monto' : 'no liquidado',
        periodLabel,
        periodKey,
        monto,
        raw: row,
      });
      continue;
    }

    const fechaGen = row.fecha_generacion || null;
    const estado = String(row.estado || 'Procesada').trim();

    batches.push({
      lilaBatchId: lilaId,
      periodKey,
      periodLabel,
      monto,
      fechaGeneracion: fechaGen,
      estado,
    });
  }

  return { batches, skippedRows };
}

/**
 * Transform fee batch to DB row.
 */
export function feeBatchToDbRow(batch) {
  return {
    lila_batch_id: batch.lilaBatchId,
    period_key: batch.periodKey,
    period_label: batch.periodLabel,
    monto: batch.monto,
    fecha_generacion: batch.fechaGeneracion,
    estado: batch.estado,
  };
}

/**
 * Extract as-of date and period from liquidación metadata.
 */
export function extractLiquidacionMeta(aoa) {
  let periodKey = null;
  let periodLabel = null;
  let asOfDate = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < Math.min(aoa?.length || 0, 10); i++) {
    const row = aoa[i] || [];
    for (const cell of row) {
      const s = String(cell || '');

      const liquidMatch = s.match(/Liquidaci[oó]n\s+(\w+)\s+(?:del?\s+)?(\d{4})/i);
      if (liquidMatch) {
        const monthKey = liquidMatch[1].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
        const month = MONTHS_ES[monthKey];
        if (month) {
          periodKey = `${liquidMatch[2]}-${month}`;
          periodLabel = `${liquidMatch[1]} del ${liquidMatch[2]}`;
        }
      }

      const dateMatch = s.match(/Generado el\s+(\d{1,2})\s+de\s+(\w+)\s+del?\s+(\d{4})/i);
      if (dateMatch) {
        const day = dateMatch[1].padStart(2, '0');
        const monthKey = dateMatch[2].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
        const month = MONTHS_ES[monthKey];
        if (month) {
          asOfDate = `${dateMatch[3]}-${month}-${day}`;
        }
      }
    }
  }

  return { periodKey, periodLabel, asOfDate };
}

/**
 * Find header row in liquidación sheet.
 */
export function findLiquidacionHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa?.length || 0, 15); i++) {
    const row = aoa[i] || [];
    const col0 = String(row[0] || '').toUpperCase();
    if (col0.includes('NRO') && col0.includes('SOCIO')) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse liquidación detail sheet.
 * Columns: NRO DE SOCIO, NOMBRE, APELLIDO, DNI, SALDO ANTERIOR, LIQUIDACIÓN, OTROS, INTERESES, SIN RECARGOS, RECARGO1, RECARGO2
 *
 * Returns details (valid rows), droppedRows (non-numeric nro_socio), and error.
 */
export function parseLiquidacionDetail(aoa, meta) {
  const headerIdx = findLiquidacionHeaderRow(aoa);
  if (headerIdx < 0) {
    return { details: [], droppedRows: [], error: 'No se encontró la fila de encabezado' };
  }

  const details = [];
  const droppedRows = [];

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const rawMemberNumber = row[0] != null ? String(row[0]).trim() : '';

    // Skip empty rows
    if (!rawMemberNumber) {
      continue;
    }

    const nombre = String(row[1] || '').trim();
    const apellido = String(row[2] || '').trim();
    const dni = row[3] != null ? String(row[3]).replace(/\D/g, '') : null;

    const saldoAnterior = parseFloat(row[4]) || 0;
    const liquidacion = parseFloat(row[5]) || 0;
    const otros = parseFloat(row[6]) || 0;
    const intereses = parseFloat(row[7]) || 0;
    const sinRecargos = parseFloat(row[8]) || 0;
    const recargo1 = parseFloat(row[9]) || 0;
    const recargo2 = parseFloat(row[10]) || 0;

    // Check if this is a non-numeric member number (non-socio row)
    if (!/^\d+$/.test(rawMemberNumber)) {
      droppedRows.push({
        rawMemberNumber,
        nombre,
        apellido,
        dni,
        saldoAnterior,
        liquidacion,
        otros,
        intereses,
        sinRecargos,
        recargo1,
        recargo2,
        reason: 'non-numeric nro_socio',
        rowIndex: i,
      });
      continue;
    }

    details.push({
      memberNumber: rawMemberNumber,
      nombre,
      apellido,
      dni,
      saldoAnterior,
      liquidacion,
      otros,
      intereses,
      sinRecargos,
      recargo1,
      recargo2,
      periodKey: meta.periodKey,
      asOfDate: meta.asOfDate,
    });
  }

  return { details, droppedRows, error: null };
}

/**
 * Transform liquidación detail to DB row.
 */
export function liquidacionDetailToDbRow(record) {
  return {
    member_number: record.memberNumber,
    nombre: record.nombre,
    apellido: record.apellido,
    dni: record.dni,
    saldo_anterior: record.saldoAnterior,
    liquidacion: record.liquidacion,
    otros: record.otros,
    intereses: record.intereses,
    sin_recargos: record.sinRecargos,
    recargo_1: record.recargo1,
    recargo_2: record.recargo2,
    period_key: record.periodKey,
    as_of_date: record.asOfDate,
  };
}

/**
 * Compute liquidación totals.
 */
export function computeLiquidacionTotals(details, droppedRows = []) {
  let sumLiquidacion = 0;
  let sumSaldoAnterior = 0;
  let sumOtros = 0;
  let sumIntereses = 0;
  let sumRecargos = 0;
  let countWithLiquidacion = 0;

  for (const d of details) {
    sumSaldoAnterior += d.saldoAnterior;
    sumLiquidacion += d.liquidacion;
    sumOtros += d.otros;
    sumIntereses += d.intereses;
    sumRecargos += d.recargo1 + d.recargo2;
    if (d.liquidacion !== 0) countWithLiquidacion++;
  }

  // Also compute dropped rows totals
  let droppedLiquidacion = 0;
  let droppedOtros = 0;
  for (const d of droppedRows) {
    droppedLiquidacion += d.liquidacion || 0;
    droppedOtros += d.otros || 0;
  }

  return {
    saldoAnterior: Math.round(sumSaldoAnterior * 100) / 100,
    liquidacion: Math.round(sumLiquidacion * 100) / 100,
    otros: Math.round(sumOtros * 100) / 100,
    intereses: Math.round(sumIntereses * 100) / 100,
    recargos: Math.round(sumRecargos * 100) / 100,
    sociosCount: details.length,
    sociosWithLiquidacion: countWithLiquidacion,
    droppedRowsCount: droppedRows.length,
    droppedLiquidacion: Math.round(droppedLiquidacion * 100) / 100,
    droppedOtros: Math.round(droppedOtros * 100) / 100,
  };
}

/**
 * Convert month-only period label to period key with year fallback.
 * E.g., "Octubre" → "2026-10", "Septiembre" → "2026-09"
 */
function monthOnlyToKey(label, defaultYear = '2026') {
  if (!label) return null;
  const s = String(label).toLowerCase().trim();
  const normalized = s.normalize('NFD').replace(/\p{M}/gu, '');
  const month = MONTHS_ES[normalized];
  if (!month) return null;
  return `${defaultYear}-${month}`;
}

/**
 * Parse saldos_grupo_familiar.xlsx.
 * Format: Periodo | Grupo Familiar | Capital
 * Periods are month-only (e.g., "Octubre"), year is inferred from asOfDate.
 */
export function parseFamilyGroupBalances(aoa, asOfDate) {
  const balances = [];
  const groupTotals = new Map();
  const defaultYear = asOfDate?.slice(0, 4) || '2026';

  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const col0 = String(row[0] || '').trim();
    const col1 = String(row[1] || '').trim();
    const col2 = row[2];

    if (col0.toUpperCase() === 'PERIODO') {
      continue;
    }

    if (col1 === 'Total grupo familiar') {
      continue;
    }

    if (!col1 || !col1.startsWith('GF -')) {
      continue;
    }

    const groupName = col1;
    const periodLabel = col0;
    let periodKey = periodLabelToKey(periodLabel);
    if (!periodKey) {
      periodKey = monthOnlyToKey(periodLabel, defaultYear);
    }
    const capital = parseFloat(col2) || 0;

    if (periodKey) {
      balances.push({
        groupName,
        periodKey,
        periodLabel,
        capital,
        isTotal: false,
        asOfDate,
      });
    }
  }

  for (const b of balances) {
    const existing = groupTotals.get(b.groupName) || 0;
    groupTotals.set(b.groupName, existing + b.capital);
  }

  for (const [groupName, total] of groupTotals) {
    balances.push({
      groupName,
      periodKey: 'TOTAL',
      periodLabel: 'Total',
      capital: total,
      isTotal: true,
      asOfDate,
    });
  }

  return balances;
}

/**
 * Transform family group balance to DB row.
 */
export function familyBalanceToDbRow(record) {
  return {
    group_name: record.groupName,
    period_key: record.periodKey,
    period_label: record.periodLabel,
    capital: record.capital,
    is_total: record.isTotal,
    as_of_date: record.asOfDate,
  };
}

/**
 * Compute family group totals.
 */
export function computeFamilyGroupTotals(balances) {
  const nonTotals = balances.filter((b) => !b.isTotal);
  const groups = new Set(balances.map((b) => b.groupName));

  let sumCapital = 0;
  let countPositive = 0;
  let countNegative = 0;

  for (const b of nonTotals) {
    sumCapital += b.capital;
    if (b.capital > 0) countPositive++;
    if (b.capital < 0) countNegative++;
  }

  return {
    groupCount: groups.size,
    periodCount: nonTotals.length,
    totalCapital: Math.round(sumCapital * 100) / 100,
    countPositive,
    countNegative,
  };
}

// =============================================================================
// COBRANZAS (RECAUDADO) - Lila "Reporte de Cobranzas" import
// =============================================================================

/**
 * Find header row in cobranzas sheet.
 * Header is "Tipo | ID Recibo | Fecha | Mes | Año | NRO DE SOCIO | ..."
 */
export function findCobranzasHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa?.length || 0, 15); i++) {
    const row = aoa[i] || [];
    const col0 = String(row[0] || '').trim();
    const col1 = String(row[1] || '').trim();
    if (col0 === 'Tipo' && col1 === 'ID Recibo') {
      return i;
    }
  }
  return -1;
}

/**
 * Parse Lila "Reporte de Cobranzas" export (XLSX).
 *
 * File format (header on row 8, 0-indexed):
 *   Col 0: Tipo (Cuotas, Recargos, Varios, Eventos)
 *   Col 1: ID Recibo
 *   Col 2: Fecha (Excel serial date)
 *   Col 3: Mes
 *   Col 4: Año
 *   Col 5: NRO DE SOCIO
 *   Col 6: NOMBRE
 *   Col 7: APELLIDO
 *   Col 8: DNI
 *   Col 9: Concepto
 *   Col 10-16: Payment method columns (do not sum - repeat per receipt line)
 *   Col 17: Importe total
 *
 * @param {Array} aoa - Array of arrays from XLSX
 * @param {Object} options - { targetPeriodKey: '2026-10' }
 * @returns {{ payments: Array, droppedRows: Array, summary: Object, dateRange: Object }}
 */
export function parseCobranzas(aoa, options = {}) {
  const { targetPeriodKey = '2026-10' } = options;
  const headerIdx = findCobranzasHeaderRow(aoa);

  if (headerIdx < 0) {
    return {
      payments: [],
      droppedRows: [],
      summary: null,
      dateRange: null,
      error: 'No se encontró la fila de encabezado (Tipo | ID Recibo)',
    };
  }

  const payments = [];
  const droppedRows = [];
  let minDate = null;
  let maxDate = null;

  // Extract target month/year for period matching
  const [targetYear, targetMonth] = targetPeriodKey.split('-');
  const targetMonthName = {
    '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
    '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
    '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
  }[targetMonth] || '';
  const targetPeriodPrefix = `${targetMonthName} del ${targetYear}`;

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const tipo = String(row[0] || '').trim();

    if (!tipo) continue;

    const reciboId = String(row[1] || '').trim();
    const excelDate = row[2];
    const mes = row[3];
    const anio = row[4];
    const memberNumber = row[5] != null ? String(row[5]).trim() : '';
    const nombre = String(row[6] || '').trim();
    const apellido = String(row[7] || '').trim();
    const dni = row[8] != null ? String(row[8]).replace(/\D/g, '') : null;
    const concepto = String(row[9] || '').trim();
    const importeTotal = parseFloat(row[17]) || 0;

    // Parse Excel date
    let fecha = null;
    if (typeof excelDate === 'number') {
      const date = new Date((excelDate - 25569) * 86400 * 1000);
      if (!Number.isNaN(date.getTime())) {
        fecha = date.toISOString().slice(0, 10);
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }
    }

    // Check if member number is valid
    if (!memberNumber || !/^\d+$/.test(memberNumber)) {
      if (tipo && importeTotal !== 0) {
        droppedRows.push({
          rowIndex: i,
          tipo,
          reciboId,
          rawMemberNumber: memberNumber,
          nombre,
          apellido,
          concepto,
          importeTotal,
          reason: 'non-numeric nro_socio',
        });
      }
      continue;
    }

    // Determine if this payment counts toward target period recaudado
    // Rule: Cuotas where concepto starts with "Octubre del 2026" (or target period)
    //       + Recargos where concepto contains "Octubre del 2026"
    const isTargetPeriodCuota = tipo === 'Cuotas' && concepto.startsWith(targetPeriodPrefix);
    const isTargetPeriodRecargo = tipo === 'Recargos' && concepto.includes(targetPeriodPrefix);
    const countsForRecaudado = isTargetPeriodCuota || isTargetPeriodRecargo;

    payments.push({
      tipo,
      reciboId,
      fecha,
      mes,
      anio,
      memberNumber,
      nombre,
      apellido,
      dni,
      concepto,
      importeTotal,
      countsForRecaudado,
      isTargetPeriodCuota,
      isTargetPeriodRecargo,
    });
  }

  // Compute summary by tipo and recaudado
  const summary = {
    byTipo: {},
    recaudado: 0,
    recaudadoCuotas: 0,
    recaudadoRecargos: 0,
    totalImporteTotal: 0,
    paymentsCount: payments.length,
    receiptsCount: new Set(payments.map(p => p.reciboId)).size,
  };

  for (const p of payments) {
    summary.byTipo[p.tipo] = (summary.byTipo[p.tipo] || 0) + p.importeTotal;
    summary.totalImporteTotal += p.importeTotal;

    if (p.countsForRecaudado) {
      summary.recaudado += p.importeTotal;
      if (p.isTargetPeriodCuota) summary.recaudadoCuotas += p.importeTotal;
      if (p.isTargetPeriodRecargo) summary.recaudadoRecargos += p.importeTotal;
    }
  }

  // Round to avoid floating point issues
  summary.recaudado = Math.round(summary.recaudado * 100) / 100;
  summary.recaudadoCuotas = Math.round(summary.recaudadoCuotas * 100) / 100;
  summary.recaudadoRecargos = Math.round(summary.recaudadoRecargos * 100) / 100;
  summary.totalImporteTotal = Math.round(summary.totalImporteTotal * 100) / 100;

  const dateRange = {
    from: minDate ? minDate.toISOString().slice(0, 10) : null,
    to: maxDate ? maxDate.toISOString().slice(0, 10) : null,
  };

  return {
    payments,
    droppedRows,
    summary,
    dateRange,
    targetPeriodKey,
    targetPeriodPrefix,
    error: null,
  };
}

/**
 * Compute cobranzas totals with dropped rows analysis.
 */
export function computeCobranzasTotals(summary, droppedRows = []) {
  let droppedRecaudado = 0;
  let droppedCuotas = 0;
  let droppedRecargos = 0;

  for (const d of droppedRows) {
    const concepto = d.concepto || '';
    const importe = d.importeTotal || 0;

    // Check if dropped row would have counted for recaudado
    // (same logic as in parseCobranzas)
    if (d.tipo === 'Cuotas' && concepto.match(/^(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre) del \d{4}/)) {
      droppedRecaudado += importe;
      droppedCuotas += importe;
    }
    if (d.tipo === 'Recargos' && concepto.match(/Recargo:.*del \d{4}/)) {
      droppedRecaudado += importe;
      droppedRecargos += importe;
    }
  }

  return {
    ...summary,
    droppedRowsCount: droppedRows.length,
    droppedRecaudado: Math.round(droppedRecaudado * 100) / 100,
    droppedCuotas: Math.round(droppedCuotas * 100) / 100,
    droppedRecargos: Math.round(droppedRecargos * 100) / 100,
  };
}

/**
 * Transform cobranza payment to DB row.
 */
export function cobranzaToDbRow(payment, asOfDate) {
  return {
    tipo: payment.tipo,
    recibo_id: payment.reciboId,
    fecha: payment.fecha,
    mes: payment.mes,
    anio: payment.anio,
    member_number: payment.memberNumber,
    nombre: payment.nombre,
    apellido: payment.apellido,
    dni: payment.dni,
    concepto: payment.concepto,
    importe_total: payment.importeTotal,
    counts_for_recaudado: payment.countsForRecaudado,
    as_of_date: asOfDate,
  };
}

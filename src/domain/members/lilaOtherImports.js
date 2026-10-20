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
 */
export function parseCuotasLotes(rows) {
  const batches = [];

  for (const row of rows) {
    if (!row || row.id === 'id') continue;

    const lilaId = row.id !== '-' ? parseInt(row.id, 10) || null : null;
    const periodLabel = String(row.periodo || '').trim();
    const periodKey = periodLabelToKey(periodLabel);

    if (!periodKey) continue;

    const montoStr = String(row.monto || '').replace(/[^\d.,\-]/g, '');
    const monto = parseFloat(montoStr.replace(',', '.')) || 0;

    if (monto <= 0 || montoStr.includes('no liquidado')) continue;

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

  return batches;
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
 */
export function parseLiquidacionDetail(aoa, meta) {
  const headerIdx = findLiquidacionHeaderRow(aoa);
  if (headerIdx < 0) {
    return { details: [], error: 'No se encontró la fila de encabezado' };
  }

  const details = [];

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const memberNumber = row[0] != null ? String(row[0]).trim() : '';

    if (!memberNumber || !/^\d+$/.test(memberNumber)) {
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

    details.push({
      memberNumber,
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

  return { details, error: null };
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
export function computeLiquidacionTotals(details) {
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

  return {
    saldoAnterior: Math.round(sumSaldoAnterior * 100) / 100,
    liquidacion: Math.round(sumLiquidacion * 100) / 100,
    otros: Math.round(sumOtros * 100) / 100,
    intereses: Math.round(sumIntereses * 100) / 100,
    recargos: Math.round(sumRecargos * 100) / 100,
    sociosCount: details.length,
    sociosWithLiquidacion: countWithLiquidacion,
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

/**
 * Lila deudas_mes_a_mes_morosos.xlsx → period-level debt import.
 * Parses three sheets:
 * - DEUDA POR MES: per-period per-socio breakdown
 * - DEUDA POR SOCIO: movement-level detail
 * - TOTALES: summary per socio
 */

const MONTHS_ES = {
  enero: '01', febrero: '02', marzo: '03', abril: '04',
  mayo: '05', junio: '06', julio: '07', agosto: '08',
  septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
};

/**
 * Extract as-of date from metadata rows.
 * E.g., "Fecha 20 de Octubre del 2026" → "2026-10-20"
 */
export function extractDeudasAsOfDate(aoa) {
  for (let i = 0; i < Math.min(aoa?.length || 0, 10); i++) {
    const row = aoa[i] || [];
    for (const cell of row) {
      const s = String(cell || '').toLowerCase();
      const match = s.match(/fecha\s+(\d{1,2})\s+de\s+(\w+)\s+del?\s+(\d{4})/i);
      if (match) {
        const day = match[1].padStart(2, '0');
        const monthKey = match[2].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
        const month = MONTHS_ES[monthKey];
        if (month) {
          return `${match[3]}-${month}-${day}`;
        }
      }
    }
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Convert period label to period key (YYYY-MM format).
 * E.g., "Febrero del 2025" → "2025-02"
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
 * Parse DEUDA POR MES sheet: per-period per-socio breakdown.
 * Structure: header row per socio, then period rows, then summary rows.
 */
export function parseDeudaPorMes(aoa, asOfDate) {
  const results = [];
  const duplicates = [];
  const seenKeys = new Map();
  let currentSocio = null;

  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const col0 = String(row[0] || '').trim();
    const col1 = String(row[1] || '').trim();

    if (col0 === 'PERIODO' && col1.toUpperCase().includes('NRO')) {
      continue;
    }

    const memberNumber = row[1] != null ? String(row[1]).trim() : '';
    if (!memberNumber || !/^\d+$/.test(memberNumber)) {
      continue;
    }

    const periodLabel = col0;
    const periodKey = periodLabelToKey(periodLabel);

    if (!periodKey) {
      currentSocio = {
        memberNumber,
        nombre: String(row[2] || '').trim(),
        apellido: String(row[3] || '').trim(),
        dni: row[4] != null ? String(row[4]).replace(/\D/g, '') : null,
        cuotaSocial: String(row[5] || '').trim(),
        categoriaDivision: String(row[6] || '').trim(),
      };
      continue;
    }

    const capital = parseFloat(row[7]) || 0;
    const recargos = parseFloat(row[8]) || 0;
    const intereses = parseFloat(row[9]) || 0;
    const deudaAcumulada = parseFloat(row[10]) || 0;

    if (capital === 0 && recargos === 0 && intereses === 0) {
      continue;
    }

    const uniqueKey = `${memberNumber}:${periodKey}`;
    if (seenKeys.has(uniqueKey)) {
      duplicates.push({
        memberNumber,
        periodKey,
        existing: seenKeys.get(uniqueKey),
        duplicate: { capital, recargos, intereses, deudaAcumulada },
      });
      continue;
    }

    const record = {
      memberNumber,
      periodKey,
      periodLabel,
      nombre: currentSocio?.nombre || String(row[2] || '').trim(),
      apellido: currentSocio?.apellido || String(row[3] || '').trim(),
      dni: currentSocio?.dni || (row[4] != null ? String(row[4]).replace(/\D/g, '') : null),
      cuotaSocial: currentSocio?.cuotaSocial || String(row[5] || '').trim(),
      categoriaDivision: currentSocio?.categoriaDivision || String(row[6] || '').trim(),
      capital,
      recargos,
      intereses,
      deudaAcumulada,
      asOfDate,
    };

    seenKeys.set(uniqueKey, record);
    results.push(record);
  }

  return { periodDebts: results, duplicates };
}

/**
 * Parse DEUDA POR SOCIO sheet: movement-level detail.
 */
export function parseDeudaPorSocio(aoa, asOfDate) {
  const results = [];
  const duplicates = [];
  const seenKeys = new Map();
  let currentSocio = null;

  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const col0 = String(row[0] || '').trim();

    if (col0 === '#') {
      continue;
    }

    const lilaRowId = row[0] != null && row[0] !== '' ? String(row[0]) : null;
    const memberNumber = row[1] != null ? String(row[1]).trim() : '';

    if (!memberNumber || !/^\d+$/.test(memberNumber)) {
      continue;
    }

    const typeLabel = String(row[7] || '').trim();
    const description = String(row[8] || '').trim();
    const montoLabel = String(row[10] || '').trim();

    if (montoLabel === 'SALDO SIN IMPUTAR' || montoLabel === 'TOTAL') {
      continue;
    }

    if (!typeLabel || !lilaRowId) {
      currentSocio = {
        memberNumber,
        nombre: String(row[2] || '').trim(),
        apellido: String(row[3] || '').trim(),
        dni: row[4] != null ? String(row[4]).replace(/\D/g, '') : null,
        cuotaSocial: String(row[5] || '').trim(),
        categoriaDivision: String(row[6] || '').trim(),
      };
      continue;
    }

    const rawDate = row[9];
    let movementDate = null;
    if (typeof rawDate === 'number') {
      const epoch = new Date((rawDate - 25569) * 86400 * 1000);
      if (!Number.isNaN(epoch.getTime())) {
        movementDate = epoch.toISOString().slice(0, 10);
      }
    }

    const monto = parseFloat(row[10]) || 0;
    const adeudado = parseFloat(row[11]) || 0;

    const uniqueKey = `${memberNumber}:${lilaRowId}`;
    if (seenKeys.has(uniqueKey)) {
      duplicates.push({ memberNumber, lilaRowId });
      continue;
    }

    const record = {
      memberNumber,
      lilaRowId,
      nombre: currentSocio?.nombre || String(row[2] || '').trim(),
      apellido: currentSocio?.apellido || String(row[3] || '').trim(),
      dni: currentSocio?.dni || (row[4] != null ? String(row[4]).replace(/\D/g, '') : null),
      cuotaSocial: currentSocio?.cuotaSocial || String(row[5] || '').trim(),
      categoriaDivision: currentSocio?.categoriaDivision || String(row[6] || '').trim(),
      typeLabel,
      description,
      movementDate,
      monto,
      adeudado,
      asOfDate,
    };

    seenKeys.set(uniqueKey, record);
    results.push(record);
  }

  return { movements: results, duplicates };
}

/**
 * Parse TOTALES sheet: summary per socio.
 */
export function parseTotales(aoa, asOfDate) {
  const results = [];
  const duplicates = [];
  const seenMembers = new Map();

  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const col0 = String(row[0] || '').trim();

    if (col0 === '#') {
      continue;
    }

    const lilaRowId = row[0] != null && row[0] !== '' ? String(row[0]) : null;
    const memberNumber = row[1] != null ? String(row[1]).trim() : '';

    if (!memberNumber || !/^\d+$/.test(memberNumber)) {
      continue;
    }

    if (seenMembers.has(memberNumber)) {
      duplicates.push({
        memberNumber,
        existing: seenMembers.get(memberNumber),
        duplicate: {
          nombre: String(row[2] || '').trim(),
          apellido: String(row[3] || '').trim(),
        },
      });
      continue;
    }

    const periodos = parseInt(row[7], 10) || 0;
    const capital = parseFloat(row[8]) || 0;
    const recargos = parseFloat(row[9]) || 0;
    const intereses = parseFloat(row[10]) || 0;
    const saldoSinImputar = parseFloat(row[11]) || 0;
    const totalDeuda = parseFloat(row[12]) || 0;

    const record = {
      memberNumber,
      lilaRowId,
      nombre: String(row[2] || '').trim(),
      apellido: String(row[3] || '').trim(),
      dni: row[4] != null ? String(row[4]).replace(/\D/g, '') : null,
      cuotaSocial: String(row[5] || '').trim(),
      categoriaDivision: String(row[6] || '').trim(),
      periodosAdeudados: periodos,
      capital,
      recargos,
      intereses,
      saldoSinImputar,
      totalDeuda,
      asOfDate,
    };

    seenMembers.set(memberNumber, record);
    results.push(record);
  }

  return { totals: results, duplicates };
}

/**
 * Transform period debt to DB row.
 */
export function periodDebtToDbRow(record) {
  return {
    member_number: record.memberNumber,
    period_key: record.periodKey,
    period_label: record.periodLabel,
    nombre: record.nombre,
    apellido: record.apellido,
    dni: record.dni,
    cuota_social: record.cuotaSocial,
    categoria_division: record.categoriaDivision,
    capital: record.capital,
    recargos: record.recargos,
    intereses: record.intereses,
    deuda_acumulada: record.deudaAcumulada,
    as_of_date: record.asOfDate,
  };
}

/**
 * Transform movement to DB row.
 */
export function movementToDbRow(record) {
  return {
    member_number: record.memberNumber,
    lila_row_id: record.lilaRowId,
    nombre: record.nombre,
    apellido: record.apellido,
    dni: record.dni,
    cuota_social: record.cuotaSocial,
    categoria_division: record.categoriaDivision,
    type_label: record.typeLabel,
    description: record.description,
    movement_date: record.movementDate,
    monto: record.monto,
    adeudado: record.adeudado,
    as_of_date: record.asOfDate,
  };
}

/**
 * Transform total to DB row.
 */
export function totalToDbRow(record) {
  return {
    member_number: record.memberNumber,
    lila_row_id: record.lilaRowId,
    nombre: record.nombre,
    apellido: record.apellido,
    dni: record.dni,
    cuota_social: record.cuotaSocial,
    categoria_division: record.categoriaDivision,
    periodos_adeudados: record.periodosAdeudados,
    capital: record.capital,
    recargos: record.recargos,
    intereses: record.intereses,
    saldo_sin_imputar: record.saldoSinImputar,
    total_deuda: record.totalDeuda,
    as_of_date: record.asOfDate,
  };
}

/**
 * Compute grand totals from TOTALES data.
 */
export function computeGrandTotals(totals) {
  let sumCapital = 0;
  let sumRecargos = 0;
  let sumIntereses = 0;
  let sumSaldoSinImputar = 0;
  let sumTotalDeuda = 0;
  let countWithDebt = 0;

  for (const t of totals) {
    sumCapital += t.capital;
    sumRecargos += t.recargos;
    sumIntereses += t.intereses;
    sumSaldoSinImputar += t.saldoSinImputar;
    sumTotalDeuda += t.totalDeuda;
    if (t.totalDeuda > 0) countWithDebt++;
  }

  return {
    capital: Math.round(sumCapital * 100) / 100,
    recargos: Math.round(sumRecargos * 100) / 100,
    intereses: Math.round(sumIntereses * 100) / 100,
    saldoSinImputar: Math.round(sumSaldoSinImputar * 100) / 100,
    totalDeuda: Math.round(sumTotalDeuda * 100) / 100,
    sociosWithDebt: countWithDebt,
    sociosTotal: totals.length,
  };
}

/**
 * Find duplicate nro_socio (different people with same number).
 */
export function findDuplicateSocios(totals) {
  const byNumber = new Map();
  const duplicates = [];

  for (const t of totals) {
    const key = t.memberNumber;
    if (byNumber.has(key)) {
      const existing = byNumber.get(key);
      if (existing.dni !== t.dni || existing.nombre !== t.nombre || existing.apellido !== t.apellido) {
        duplicates.push({
          memberNumber: key,
          entries: [
            { nombre: existing.nombre, apellido: existing.apellido, dni: existing.dni, deuda: existing.totalDeuda },
            { nombre: t.nombre, apellido: t.apellido, dni: t.dni, deuda: t.totalDeuda },
          ],
        });
      }
    } else {
      byNumber.set(key, t);
    }
  }

  return duplicates;
}

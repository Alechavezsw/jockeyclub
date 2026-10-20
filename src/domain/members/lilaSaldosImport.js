/**
 * Lila saldos.xlsx → cuenta corriente import.
 * Parses the saldos export and prepares balance data for import.
 */

/**
 * Expected columns in Lila saldos.xlsx (row 2 is headers):
 * #, NRO DE SOCIO, NOMBRE, APELLIDO, DNI, CUOTA SOCIAL, CUOTA DEPORTIVA,
 * CAPITAL NO PAGADO A LA FECHA, RECARGOS NO PAGADOS A LA FECHA,
 * INTERESES NO PAGADOS A LA FECHA, SALDO NO IMPUTADO A LA FECHA,
 * SALDO RESULTANTE AL YYYY-MM-DD
 */
export const SALDOS_HEADERS = [
  '#',
  'NRO DE SOCIO',
  'NOMBRE',
  'APELLIDO',
  'DNI',
  'CUOTA SOCIAL',
  'CUOTA DEPORTIVA',
  'CAPITAL NO PAGADO A LA FECHA',
  'RECARGOS NO PAGADOS A LA FECHA',
  'INTERESES NO PAGADOS A LA FECHA',
  'SALDO NO IMPUTADO A LA FECHA',
  'SALDO RESULTANTE',
];

/**
 * Find the header row index in an AOA (array of arrays).
 * Returns -1 if not found.
 */
export function findSaldosHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa?.length || 0, 10); i++) {
    const row = aoa[i] || [];
    const col0 = String(row[0] || '').trim();
    const col1 = String(row[1] || '').trim().toUpperCase();
    if (col0 === '#' && col1.includes('NRO') && col1.includes('SOCIO')) {
      return i;
    }
  }
  return -1;
}

/**
 * Extract the as-of date from the export metadata rows.
 * E.g., "Saldo al 20 de Octubre del 2026" → "2026-10-20"
 */
export function extractAsOfDate(aoa) {
  const MONTHS_ES = {
    enero: '01', febrero: '02', marzo: '03', abril: '04',
    mayo: '05', junio: '06', julio: '07', agosto: '08',
    septiembre: '09', setiembre: '09', octubre: '10',
    noviembre: '11', diciembre: '12',
  };

  for (let i = 0; i < Math.min(aoa?.length || 0, 5); i++) {
    const row = aoa[i] || [];
    for (const cell of row) {
      const s = String(cell || '').toLowerCase();
      const match = s.match(/saldo\s+al\s+(\d{1,2})\s+de\s+(\w+)\s+del?\s+(\d{4})/i);
      if (match) {
        const day = match[1].padStart(2, '0');
        const monthKey = match[2].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
        const month = MONTHS_ES[monthKey];
        if (month) {
          return `${match[3]}-${month}-${day}`;
        }
      }
      const isoMatch = s.match(/(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) {
        return isoMatch[1];
      }
    }
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse a single saldos row into a balance record.
 */
export function parseSaldosRow(row, asOfDate) {
  const lilaRowId = row[0] != null ? String(row[0]) : null;
  const memberNumber = row[1] != null ? String(row[1]).trim() : null;
  if (!memberNumber || !/^\d+$/.test(memberNumber)) {
    return null;
  }

  const nombre = String(row[2] || '').trim();
  const apellido = String(row[3] || '').trim();
  const dni = row[4] != null ? String(row[4]).replace(/\D/g, '') : null;
  const cuotaSocial = String(row[5] || '').trim();
  const cuotaDeportiva = String(row[6] || '').trim();

  const capital = parseFloat(row[7]) || 0;
  const recargos = parseFloat(row[8]) || 0;
  const intereses = parseFloat(row[9]) || 0;
  const noImputado = parseFloat(row[10]) || 0;
  const saldoResultante = parseFloat(row[11]) || 0;

  return {
    memberNumber,
    lilaRowId,
    nombre,
    apellido,
    dni,
    cuotaSocial,
    cuotaDeportiva,
    capital,
    recargos,
    intereses,
    noImputado,
    saldoResultante,
    asOfDate,
  };
}

/**
 * Parse saldos AOA into balance records.
 * Returns { balances, duplicates, totals, asOfDate }
 */
export function aoaToSaldosBalances(aoa) {
  const headerIdx = findSaldosHeaderRow(aoa);
  if (headerIdx < 0) {
    return {
      balances: [],
      duplicates: [],
      totals: { capital: 0, recargos: 0, intereses: 0, noImputado: 0, saldo: 0 },
      asOfDate: null,
      error: 'No se encontró la fila de encabezado (# / NRO DE SOCIO).',
    };
  }

  const asOfDate = extractAsOfDate(aoa);
  const balancesByNro = new Map();
  const duplicates = [];
  const totals = { capital: 0, recargos: 0, intereses: 0, noImputado: 0, saldo: 0 };

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row[0] == null) continue;

    const balance = parseSaldosRow(row, asOfDate);
    if (!balance) continue;

    totals.capital += balance.capital;
    totals.recargos += balance.recargos;
    totals.intereses += balance.intereses;
    totals.noImputado += balance.noImputado;
    totals.saldo += balance.saldoResultante;

    if (balancesByNro.has(balance.memberNumber)) {
      const existing = balancesByNro.get(balance.memberNumber);
      duplicates.push({
        memberNumber: balance.memberNumber,
        entries: [
          { nombre: existing.nombre, apellido: existing.apellido, dni: existing.dni, saldo: existing.saldoResultante },
          { nombre: balance.nombre, apellido: balance.apellido, dni: balance.dni, saldo: balance.saldoResultante },
        ],
      });
      if (balance.saldoResultante !== 0) {
        balancesByNro.set(balance.memberNumber, balance);
      }
    } else {
      balancesByNro.set(balance.memberNumber, balance);
    }
  }

  return {
    balances: [...balancesByNro.values()],
    duplicates,
    totals,
    asOfDate,
    error: null,
  };
}

/**
 * Summarize saldos for dry-run display.
 */
export function summarizeSaldos(result) {
  const { balances, duplicates, totals, asOfDate } = result;
  const withBalance = balances.filter((b) => b.saldoResultante > 0);
  const withZero = balances.filter((b) => b.saldoResultante === 0);
  const withNegative = balances.filter((b) => b.saldoResultante < 0);

  return {
    asOfDate,
    totalRows: balances.length,
    withBalance: withBalance.length,
    withZero: withZero.length,
    withNegative: withNegative.length,
    duplicateNros: duplicates.length,
    totals: {
      capital: totals.capital,
      recargos: totals.recargos,
      intereses: totals.intereses,
      noImputado: totals.noImputado,
      saldoResultante: totals.saldo,
    },
    sampleWithBalance: withBalance.slice(0, 5).map((b) => ({
      nro: b.memberNumber,
      nombre: `${b.nombre} ${b.apellido}`.trim(),
      capital: b.capital,
      recargos: b.recargos,
      saldo: b.saldoResultante,
    })),
    sampleDuplicates: duplicates.slice(0, 5),
  };
}

/**
 * Transform balance record to lila_member_balances DB row.
 */
export function balanceToDbRow(balance) {
  return {
    member_number: balance.memberNumber,
    lila_row_id: balance.lilaRowId,
    nombre: balance.nombre,
    apellido: balance.apellido,
    dni: balance.dni,
    cuota_social: balance.cuotaSocial,
    cuota_deportiva: balance.cuotaDeportiva,
    capital_no_pagado: balance.capital,
    recargos_no_pagados: balance.recargos,
    intereses_no_pagados: balance.intereses,
    saldo_no_imputado: balance.noImputado,
    saldo_resultante: balance.saldoResultante,
    as_of_date: balance.asOfDate,
  };
}

/**
 * Prepare import log record.
 */
export function prepareImportLog({
  sourceFile,
  asOfDate,
  processed,
  matched,
  unmatched,
  duplicates,
  totals,
  lilaTotalSaldo,
  unmatchedSocios,
  duplicateSocios,
  status = 'completed',
  errorMessage = null,
}) {
  const variance = lilaTotalSaldo != null
    ? Math.abs(totals.saldo - lilaTotalSaldo)
    : null;

  return {
    import_type: 'saldos',
    source_file: sourceFile || null,
    as_of_date: asOfDate,
    rows_processed: processed,
    rows_matched: matched,
    rows_unmatched: unmatched,
    rows_duplicates: duplicates,
    total_capital: totals.capital,
    total_recargos: totals.recargos,
    total_intereses: totals.intereses,
    total_saldo: totals.saldo,
    lila_total_saldo: lilaTotalSaldo,
    variance,
    unmatched_socios: unmatchedSocios || null,
    duplicate_socios: duplicateSocios || null,
    status,
    error_message: errorMessage,
  };
}

/**
 * Build monthly debts view from Lila imported data.
 * This uses the imported DEUDA POR MES / DEUDA POR SOCIO data for exact matching with Lila.
 */

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function formatAsOfLabel(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} de ${MONTHS_ES[m - 1]?.toLowerCase() || ''} de ${y}`;
}

function standingFromDebt(totalDeuda, periodosAdeudados) {
  if (totalDeuda <= 0) return 'Al día';
  if (periodosAdeudados >= 2) return 'En mora';
  if (periodosAdeudados === 1) return 'Vencida';
  return 'Con saldo';
}

/**
 * Build monthly debts data structure from Lila imports.
 *
 * @param {Object} options
 * @param {Array} options.debtTotals - From listLilaDebtTotals()
 * @param {Array} options.periodDebts - From listLilaPeriodDebts()
 * @param {Array} options.movements - From listLilaDebtMovements()
 * @returns {Object} Compatible with buildAppMonthlyDebts output
 */
export function buildLilaMonthlyDebts({
  debtTotals = [],
  periodDebts = [],
  movements = [],
} = {}) {
  const periodDebtsByMember = new Map();
  for (const pd of periodDebts) {
    const list = periodDebtsByMember.get(pd.memberNumber) || [];
    list.push(pd);
    periodDebtsByMember.set(pd.memberNumber, list);
  }

  const movementsByMember = new Map();
  for (const mv of movements) {
    const list = movementsByMember.get(mv.memberNumber) || [];
    list.push(mv);
    movementsByMember.set(mv.memberNumber, list);
  }

  const byNumber = {};
  let monthRowCount = 0;
  let lineCount = 0;
  let totalDebt = 0;
  let asOfDate = null;

  for (const t of debtTotals) {
    if (!asOfDate && t.asOfDate) asOfDate = t.asOfDate;

    const memberPeriods = periodDebtsByMember.get(t.memberNumber) || [];
    const memberMovements = movementsByMember.get(t.memberNumber) || [];

    const months = memberPeriods.map((pd) => ({
      periodKey: pd.periodKey,
      periodLabel: pd.periodLabel,
      capital: pd.capital,
      interest: pd.recargos + pd.intereses,
      accumulated: pd.deudaAcumulada,
    }));

    const lines = memberMovements.map((mv) => ({
      id: mv.lilaRowId,
      type: mv.typeLabel,
      description: mv.description,
      date: mv.movementDate,
      amount: Math.abs(mv.monto),
      owed: mv.adeudado,
    }));

    const record = {
      memberNumber: t.memberNumber,
      memberName: `${t.nombre || ''} ${t.apellido || ''}`.trim(),
      firstName: t.nombre || '',
      lastName: t.apellido || '',
      dni: t.dni || '',
      socialFee: t.cuotaSocial || '',
      sportsFee: '',
      status: 'active',
      standing: standingFromDebt(t.totalDeuda, t.periodosAdeudados),
      monthsBehind: t.periodosAdeudados,
      totalDebt: t.totalDeuda,
      capital: t.capital,
      interest: t.recargos + t.intereses,
      unallocated: t.saldoSinImputar,
      months,
      lines,
    };

    if (t.totalDeuda > 0 || months.length > 0) {
      byNumber[t.memberNumber] = record;
      monthRowCount += months.length;
      lineCount += lines.length;
      totalDebt += t.totalDeuda;
    }
  }

  return {
    asOf: asOfDate,
    asOfLabel: formatAsOfLabel(asOfDate),
    memberCount: Object.keys(byNumber).length,
    monthRowCount,
    lineCount,
    totalDebt: Math.round(totalDebt * 100) / 100,
    byNumber,
    source: 'lila',
  };
}

/**
 * List unique periods from Lila data.
 */
export function listLilaDebtPeriods(byNumber) {
  const periods = new Map();
  for (const record of Object.values(byNumber || {})) {
    for (const m of record.months || []) {
      if (m.periodKey && !periods.has(m.periodKey)) {
        periods.set(m.periodKey, {
          periodKey: m.periodKey,
          periodLabel: m.periodLabel,
        });
      }
    }
  }
  return [...periods.values()].toSorted((a, b) =>
    String(a.periodKey).localeCompare(String(b.periodKey))
  );
}

/**
 * List debtors from Lila data, filtered by query and period.
 */
export function listLilaMonthlyDebtors({ byNumber = {}, query = '', periodKey = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const list = [];

  for (const record of Object.values(byNumber)) {
    if (periodKey !== 'all') {
      const hasPeriod = (record.months || []).some((m) => m.periodKey === periodKey);
      if (!hasPeriod) continue;
    }

    if (q) {
      const hay =
        String(record.memberNumber || '').toLowerCase().includes(q) ||
        String(record.memberName || '').toLowerCase().includes(q) ||
        String(record.dni || '').includes(q);
      if (!hay) continue;
    }

    list.push(record);
  }

  return list.toSorted((a, b) => b.totalDebt - a.totalDebt);
}

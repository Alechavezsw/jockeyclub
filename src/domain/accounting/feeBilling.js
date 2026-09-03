/** Liquidación mensual de cuotas (Accessin / LILA). */

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Períodos 2026 alineados al export LILA (montos de liquidación). */
export const ACCESSIN_FEE_PERIODS = [
  { id: 'fp-814', accessinId: 814, year: 2026, month: 1, amount: 64545500, generatedAt: '2025-12-31', status: 'processed' },
  { id: 'fp-849', accessinId: 849, year: 2026, month: 2, amount: 63881200, generatedAt: '2026-01-31', status: 'processed' },
  { id: 'fp-920', accessinId: 920, year: 2026, month: 3, amount: 65210450, generatedAt: '2026-02-28', status: 'processed' },
  { id: 'fp-978', accessinId: 978, year: 2026, month: 4, amount: 66120300, generatedAt: '2026-03-31', status: 'processed' },
  { id: 'fp-1042', accessinId: 1042, year: 2026, month: 5, amount: 64890100, generatedAt: '2026-04-30', status: 'processed' },
  { id: 'fp-1110', accessinId: 1110, year: 2026, month: 6, amount: 65550000, generatedAt: '2026-05-31', status: 'processed' },
  { id: 'fp-1188', accessinId: 1188, year: 2026, month: 7, amount: 67022000, generatedAt: '2026-06-30', status: 'processed' },
  { id: 'fp-1255', accessinId: 1255, year: 2026, month: 8, amount: 68214500, generatedAt: '2026-07-31', status: 'processed' },
  { id: 'fp-1311', accessinId: 1311, year: 2026, month: 9, amount: 90993502.07, generatedAt: '2026-08-31', status: 'processed', hasAccountDetails: true },
  { id: 'fp-2026-10', accessinId: null, year: 2026, month: 10, amount: 0, generatedAt: null, status: 'pending' },
  { id: 'fp-2026-11', accessinId: null, year: 2026, month: 11, amount: 0, generatedAt: null, status: 'pending' },
  { id: 'fp-2026-12', accessinId: null, year: 2026, month: 12, amount: 0, generatedAt: null, status: 'pending' },
];

export function periodLabel(period) {
  if (!period) return '—';
  const name = MONTHS_ES[(Number(period.month) || 1) - 1] || period.month;
  return `${name} del ${period.year}`;
}

export function formatPeriodGeneratedAt(iso) {
  if (!iso) return '—';
  try {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const day = d;
    const month = MONTHS_ES[m - 1];
    return `${day} de ${month} del ${y}`;
  } catch {
    return iso;
  }
}

export function periodStatusLabel(status) {
  if (status === 'processed') return 'Procesada';
  if (status === 'cancelled') return 'Anulada';
  return 'Cuotas no liquidadas';
}

export function feePeriodsForYear(list = ACCESSIN_FEE_PERIODS, year = new Date().getFullYear()) {
  return (list || [])
    .filter((p) => Number(p.year) === Number(year))
    .toSorted((a, b) => a.month - b.month);
}

export function resolveFeePeriods(loaded) {
  if (!Array.isArray(loaded) || !loaded.length) return [...ACCESSIN_FEE_PERIODS];
  const byId = new Map(ACCESSIN_FEE_PERIODS.map((p) => [p.id, p]));
  loaded.forEach((p) => {
    if (p?.id && byId.has(p.id)) {
      const seed = byId.get(p.id);
      byId.set(p.id, {
        ...seed,
        ...p,
        // Preferir montos/detalle Accessin del seed cuando existen
        amount: seed.hasAccountDetails ? seed.amount : (p.amount ?? seed.amount),
        hasAccountDetails: seed.hasAccountDetails || p.hasAccountDetails,
      });
    } else if (p?.id) byId.set(p.id, p);
  });
  return [...byId.values()].toSorted((a, b) => (a.year - b.year) || (a.month - b.month));
}

/** Liquidar un período pendiente: suma cuotas de socios activos. */
export function liquidateFeePeriod(list = [], periodId, members = [], today = new Date()) {
  const period = (list || []).find((p) => p.id === periodId);
  if (!period) throw new Error('Período no encontrado.');
  if (period.status === 'processed') throw new Error('El período ya está liquidado.');

  const active = (members || []).filter((m) => m && m.status !== 'inactive');
  let total = 0;
  const memberUpdates = active.map((m) => {
    const dues = Number(m.monthlyDues) || Number(m.duesAmount) || 0;
    // fallback: usar outstanding balance generator amount if present in tier fields
    const amount = dues > 0 ? dues : 0;
    total += amount;
    return {
      memberId: m.memberId,
      addAmount: amount,
    };
  });

  // Si no hay montos por socio, marcar liquidado con monto 0 (plantilla lista para cargar)
  const iso = today.toISOString().slice(0, 10);
  const nextPeriod = {
    ...period,
    status: 'processed',
    amount: total,
    generatedAt: iso,
    accessinId: period.accessinId || Number(String(Date.now()).slice(-4)),
    updatedAt: new Date().toISOString(),
  };

  return {
    periods: (list || []).map((p) => (p.id === periodId ? nextPeriod : p)),
    memberUpdates,
    period: nextPeriod,
  };
}

import { duesPayableForMember, isMemberBillingActive } from '../members/dues';

/** Liquidación mensual de cuotas (Accessin / LILA). */

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Períodos 2026 tal como están en Lila (Cuotas), al 29 de septiembre de 2026. */
export const ACCESSIN_FEE_PERIODS = [
  { id: 'fp-814', accessinId: 814, year: 2026, month: 1, amount: 64545500, generatedAt: '2025-12-31', status: 'processed' },
  { id: 'fp-849', accessinId: 849, year: 2026, month: 2, amount: 66554250, generatedAt: '2026-01-13', status: 'processed' },
  { id: 'fp-920', accessinId: 920, year: 2026, month: 3, amount: 64170500, generatedAt: '2026-02-18', status: 'processed' },
  { id: 'fp-971', accessinId: 971, year: 2026, month: 4, amount: 64611750, generatedAt: '2026-03-06', status: 'processed' },
  { id: 'fp-1055', accessinId: 1055, year: 2026, month: 5, amount: 77514500, generatedAt: '2026-04-27', status: 'processed' },
  { id: 'fp-1155', accessinId: 1155, year: 2026, month: 6, amount: 70342500, generatedAt: '2026-06-01', status: 'processed' },
  { id: 'fp-1195', accessinId: 1195, year: 2026, month: 7, amount: 61075000, generatedAt: '2026-06-29', status: 'processed' },
  { id: 'fp-1287', accessinId: 1287, year: 2026, month: 8, amount: 57441000, generatedAt: '2026-08-03', status: 'processed' },
  { id: 'fp-1311', accessinId: 1311, year: 2026, month: 9, amount: 57843000, generatedAt: '2026-08-14', status: 'processed', hasAccountDetails: true },
  { id: 'fp-1382', accessinId: 1382, year: 2026, month: 10, amount: 67677000, generatedAt: null, status: 'draft' },
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
    const day = String(d).padStart(2, '0');
    const month = MONTHS_ES[m - 1];
    return `${day} de ${month} del ${y}`;
  } catch {
    return iso;
  }
}

export function periodStatusLabel(status) {
  if (status === 'processed') return 'Procesada';
  if (status === 'draft') return 'Borrador';
  if (status === 'cancelled') return 'Anulada';
  return 'Cuotas no liquidados';
}

export function feePeriodsForYear(list = ACCESSIN_FEE_PERIODS, year = new Date().getFullYear()) {
  return (list || [])
    .filter((p) => Number(p.year) === Number(year))
    .toSorted((a, b) => a.month - b.month);
}

export function resolveFeePeriods(loaded) {
  if (!Array.isArray(loaded) || !loaded.length) return [...ACCESSIN_FEE_PERIODS];
  const byId = new Map(ACCESSIN_FEE_PERIODS.map((p) => [p.id, { ...p }]));
  const officialMonths = new Set(ACCESSIN_FEE_PERIODS.map((p) => `${p.year}-${p.month}`));
  loaded.forEach((p) => {
    if (!p?.id) return;
    const monthKey = `${Number(p.year)}-${Number(p.month)}`;
    if (officialMonths.has(monthKey)) return;
    if (byId.has(p.id)) return;
    byId.set(p.id, p);
  });
  return [...byId.values()].toSorted((a, b) => (a.year - b.year) || (a.month - b.month));
}

/** Liquidar un período pendiente: suma cuotas de socios activos. */
export function liquidateFeePeriod(list = [], periodId, members = [], today = new Date()) {
  const period = (list || []).find((p) => p.id === periodId);
  if (!period) throw new Error('Período no encontrado.');
  if (period.status === 'processed') throw new Error('El período ya está liquidado.');

  const active = (members || []).filter((m) => m && isMemberBillingActive(m));
  let total = 0;
  const memberUpdates = active.map((m) => {
    const periodDate = new Date(Number(period.year), (Number(period.month) || 1) - 1, 10, 12, 0, 0, 0);
    const dueOn = `${period.year}-${String(period.month).padStart(2, '0')}-10`;
    const amount = duesPayableForMember(m, { paidOn: today, dueOn, on: periodDate });
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

import { duesPayableForMember, isMemberBillingActive } from '../members/dues';
import { feePackForPeriod } from './feePackConcepts';

/** Liquidación mensual de cuotas (Accessin / LILA). */

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Períodos 2026 tal como están en Lila (Cuotas). Enero a septiembre: corte del 30 de septiembre de 2026 a las 08:47. Octubre: liquidación procesada, al 1 de octubre de 2026. */
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
  { id: 'fp-1382', accessinId: 1382, year: 2026, month: 10, amount: 63233000, generatedAt: '2026-09-09', status: 'processed' },
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
  const byId = new Map(ACCESSIN_FEE_PERIODS.map((p) => [p.id, { ...p }]));
  const officialByMonth = new Map(
    ACCESSIN_FEE_PERIODS.map((p) => [`${p.year}-${p.month}`, p.id]),
  );
  if (!Array.isArray(loaded) || !loaded.length) {
    return [...byId.values()].toSorted((a, b) => (a.year - b.year) || (a.month - b.month));
  }
  loaded.forEach((p) => {
    if (!p) return;
    const monthKey = `${Number(p.year)}-${Number(p.month)}`;
    const officialId = (p.id && byId.has(p.id) ? p.id : null) || officialByMonth.get(monthKey);
    if (officialId) {
      const official = byId.get(officialId);
      const edited = Boolean(p.pack)
        || (Array.isArray(p.lines) && p.lines.length > 0);
      const promotes = p.status === 'processed' && official.status !== 'processed';
      if (promotes || edited) {
        byId.set(officialId, {
          ...official,
          status: p.status === 'processed' ? 'processed' : official.status,
          amount: Number(p.amount) > 0 ? Number(p.amount) : official.amount,
          generatedAt: p.generatedAt || official.generatedAt,
          lines: Array.isArray(p.lines) && p.lines.length ? p.lines : official.lines,
          pack: p.pack ? p.pack : official.pack,
        });
      }
      return;
    }
    if (!p.id || byId.has(p.id)) return;
    byId.set(p.id, p);
  });
  return [...byId.values()].toSorted((a, b) => (a.year - b.year) || (a.month - b.month));
}

/** True cuando el período liquidado no está así en el corte de Lila y hay que guardarlo. */
export function feePeriodNeedsClosure(period) {
  if (!period) return false;
  if (period.pack) return true;
  if (period.status !== 'processed') return false;
  const base = ACCESSIN_FEE_PERIODS.find((p) => p.id === period.id)
    || ACCESSIN_FEE_PERIODS.find((p) => (
      Number(p.year) === Number(period.year) && Number(p.month) === Number(period.month)
    ));
  if (!base) return true;
  return base.status !== 'processed'
    || String(base.generatedAt || '') !== String(period.generatedAt || '')
    || Number(base.amount) !== Number(period.amount);
}

/**
 * Cierra un período como las liquidaciones ya procesadas de Lila.
 * Si el mes tiene desglose importado, se conserva ese total y no se imputan cuotas nuevas.
 * Sin desglose, suma las cuotas de los socios activos.
 */
export function liquidateFeePeriod(list = [], periodId, members = [], today = new Date()) {
  const period = (list || []).find((p) => p.id === periodId);
  if (!period) throw new Error('Período no encontrado.');
  if (period.status === 'processed') throw new Error('El período ya está liquidado.');

  const pack = feePackForPeriod(period);
  const iso = today.toISOString().slice(0, 10);
  if (pack) {
    const nextPeriod = {
      ...period,
      status: 'processed',
      amount: Number(pack.total) || Number(period.amount) || 0,
      generatedAt: iso,
      updatedAt: new Date().toISOString(),
    };
    return {
      periods: (list || []).map((p) => (p.id === periodId ? nextPeriod : p)),
      memberUpdates: [],
      period: nextPeriod,
    };
  }

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

const EXPENSE_CATEGORIES = [
  'Sueldos y Jornales',
  'Cargas Sociales',
  'Gastos de Administración',
  'Tasas y Servicios',
  'Mantenimiento y Reparaciones',
  'Otros Ingresos',
];

export { EXPENSE_CATEGORIES };

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthStart(period) {
  const year = Number(period?.year) || new Date().getFullYear();
  const month = Number(period?.month) || 1;
  return `${year}-${pad2(month)}-01`;
}

export function parseLilaDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/(\d{1,2}) de ([A-Za-zÁÉÍÓÚáéíóúñ]+) del (\d{4})/);
  if (!match) return '';
  const month = MONTHS_ES.findIndex((name) => name.toLowerCase() === match[2].toLowerCase());
  if (month < 0) return '';
  return `${match[3]}-${pad2(month + 1)}-${pad2(match[1])}`;
}

function parseRateNumber(value) {
  const n = Number(String(value ?? '').replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

function roundUnit(amount, draft) {
  const n = Number(amount) || 0;
  if (!draft?.isRounded) return n;
  if (draft.roundingOption === 'diez') return Math.round(n / 10) * 10;
  return Math.round(n);
}

export function feePeriodIsClosed(period) {
  return period?.status === 'processed' || period?.status === 'cancelled';
}

/** Borrador del formulario de edición, igual para cualquier período abierto. */
export function packEditorFromPeriod(period, liquidation = null) {
  const pack = period?.pack?.concepts?.length ? period.pack : null;
  const base = feePackForPeriod({ ...period, pack: null });
  const rows = liquidation?.rows?.length
    ? liquidation.rows
    : (base?.concepts || []).map((row) => ({
      identifier: row.id,
      name: row.label,
      holders: row.holders,
      unit: row.amount,
    }));
  const surchargeSource = pack?.surcharges || base?.surcharges || [];
  return {
    imputeDate: pack?.imputeDate || monthStart(period),
    paymentTicketDueDate: pack?.paymentTicketDueDate || '',
    imputeOverpayments: pack ? pack.imputeOverpayments !== false : true,
    isRounded: Boolean(pack?.isRounded),
    roundingOption: pack?.roundingOption || 'peso',
    concepts: rows.map((row) => ({
      id: String(row.identifier || row.id || ''),
      label: row.name || row.label || '',
      holders: Number(row.holders) || 0,
      amount: Number(row.unit ?? row.amount) || 0,
    })),
    surcharges: surchargeSource.map((row) => ({
      date: parseLilaDate(row.date),
      category: row.category || '',
      type: row.type === 'fixed' ? 'fixed' : 'percentage',
      value: parseRateNumber(row.value ?? row.rate),
    })),
    alerts: Array.isArray(pack?.alerts) ? pack.alerts.map((row) => ({ date: row.date || '' })) : [],
    expenses: Array.isArray(pack?.expenses) ? pack.expenses.map((row) => ({
      concept: row.concept || '',
      category: row.category || EXPENSE_CATEGORIES[0],
      amount: Number(row.amount) || 0,
      receiptNumber: row.receiptNumber || '',
      receiptDate: row.receiptDate || '',
    })) : [],
  };
}

/**
 * Guarda el desglose editado. No imputa cuotas a los socios:
 * solo actualiza el período (total, conceptos, recargos y gastos).
 */
export function applyFeePackEdit(period, draft) {
  if (!period) throw new Error('Período no encontrado.');
  if (feePeriodIsClosed(period)) throw new Error('El período está cerrado.');
  const concepts = (draft?.concepts || []).map((row) => {
    const holders = Number(row.holders) || 0;
    const amount = roundUnit(row.amount, draft);
    return {
      id: String(row.id || ''),
      label: row.label || '',
      holders,
      amount,
      total: holders * amount,
    };
  });
  const expenses = (draft?.expenses || [])
    .filter((row) => String(row.concept || '').trim() || Number(row.amount))
    .map((row) => ({
      concept: String(row.concept || '').trim(),
      category: row.category || EXPENSE_CATEGORIES[0],
      amount: Number(row.amount) || 0,
      receiptNumber: String(row.receiptNumber || '').trim(),
      receiptDate: row.receiptDate || '',
    }));
  const expenseTotal = expenses.reduce((sum, row) => sum + row.amount, 0);
  const total = concepts.reduce((sum, row) => sum + row.total, 0) + expenseTotal;
  const surcharges = (draft?.surcharges || [])
    .filter((row) => row.category || row.date)
    .map((row) => {
      const value = Number(row.value) || 0;
      const type = row.type === 'fixed' ? 'fixed' : 'percentage';
      return {
        date: formatPeriodGeneratedAt(row.date),
        category: row.category || '',
        type,
        value,
        rate: type === 'fixed' ? String(value) : `${value.toFixed(2)} %`,
      };
    });
  const base = feePackForPeriod({ accessinId: period.accessinId, year: period.year, month: period.month });
  const pack = {
    id: base?.id || period.accessinId || null,
    title: base?.title || `Liquidación - ${periodLabel(period)}`,
    total,
    concepts,
    surcharges,
    imputeDate: draft?.imputeDate || null,
    paymentTicketDueDate: draft?.paymentTicketDueDate || null,
    imputeOverpayments: draft?.imputeOverpayments !== false,
    isRounded: Boolean(draft?.isRounded),
    roundingOption: draft?.roundingOption === 'diez' ? 'diez' : 'peso',
    alerts: (draft?.alerts || []).filter((row) => row.date).map((row) => ({ date: row.date })),
    expenses,
  };
  return {
    ...period,
    amount: total,
    pack,
    lines: concepts.map((row) => ({
      identifier: row.id,
      name: row.label,
      holders: row.holders,
      unit: row.amount,
      total: row.total,
    })),
  };
}

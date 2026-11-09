import {
  dbMemberIsDuesExempt,
  duesAmountForTier,
  duesChargeSlicesForMember,
  duesDueDayForMember,
  isDuesExemptMember,
  isMemberBillingActive,
} from '../members/dues';
import { attachHouseholdToMembers, isTitularMember } from '../members/households';
import {
  DUES_LATE_TIER_IDS,
  getTierAccessinCategoryId,
  getTierDisplayName,
  isFeePackLiquidationTier,
  parseCuotaCategories,
  slugifyTierId,
} from '../members/tiers';
import { addDaysISODate, todayISODateAR, todayAR } from '../../lib/arDate';
import { money } from '../money';
import { feePackForPeriod } from './feePackConcepts';
import { resolveDiscountRules } from './discountApplication';

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
  { id: 'fp-2026-11', accessinId: 1461, year: 2026, month: 11, amount: 0, generatedAt: null, status: 'draft', source: 'app' },
  { id: 'fp-2026-12', accessinId: null, year: 2026, month: 12, amount: 0, generatedAt: null, status: 'draft', source: 'app' },
];

/** Desde noviembre 2026 las cuotas las liquida esta app. Octubre y lo anterior es el corte de LILA. */
export const APP_DUES_FROM = Object.freeze({ year: 2026, month: 11 });

export function feePeriodMonthIndex(period) {
  return (Number(period?.year) || 0) * 12 + (Number(period?.month) || 0);
}

export function appOwnsFeePeriod(period) {
  if (!period) return false;
  return feePeriodMonthIndex(period) >= (APP_DUES_FROM.year * 12 + APP_DUES_FROM.month);
}

function calendarMonthIndex(today = new Date()) {
  const when = today instanceof Date ? today : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  return (when.getFullYear() * 12) + (when.getMonth() + 1);
}

/**
 * Vacío si se puede liquidar. Hasta octubre quedó en LILA.
 * Se puede liquidar el mes en curso o el siguiente (borrador armado el mes anterior),
 * igual que en Accessin con fecha de imputación del 1°.
 */
export function feePeriodLiquidateBlock(period, today = new Date()) {
  if (!period) return 'Período no encontrado.';
  if (period.status === 'processed') return 'El período ya está liquidado.';
  if (period.status === 'pending') return 'El período ya fue generado (pendiente hasta las 00 h).';
  if (period.status === 'cancelled') return 'El período está anulado.';
  if (!appOwnsFeePeriod(period)) return 'Hasta octubre de 2026 la liquidación quedó en LILA.';
  const current = calendarMonthIndex(today);
  const target = feePeriodMonthIndex(period);
  if (target !== current && target !== current + 1) {
    return 'Solo se liquida el mes en curso o el mes siguiente.';
  }
  return '';
}

/**
 * Vacío si se puede armar/actualizar el borrador desde el padrón.
 * Se puede cargar el mes en curso o el mes siguiente (durante el mes anterior).
 */
export function feePeriodPrepareBlock(period, today = new Date()) {
  if (!period) return 'Período no encontrado.';
  if (period.status === 'processed') return 'El período ya está liquidado.';
  if (period.status === 'pending') return 'El período ya fue generado (pendiente hasta las 00 h).';
  if (period.status === 'cancelled') return 'El período está anulado.';
  if (!appOwnsFeePeriod(period)) return 'Hasta octubre de 2026 la liquidación quedó en LILA.';
  const current = calendarMonthIndex(today);
  const target = feePeriodMonthIndex(period);
  if (target !== current && target !== current + 1) {
    return 'Solo se carga el borrador del mes en curso o del mes siguiente.';
  }
  return '';
}

/** Día (AR) desde el cual la liquidación generada queda disponible / pasa a Procesada. */
export function feePeriodAvailableFrom(today = new Date()) {
  return addDaysISODate(todayISODateAR(today), 1);
}

export function feePeriodIsPending(period) {
  return period?.status === 'pending';
}

export function feePeriodIsAvailable(period, today = new Date()) {
  if (!period) return false;
  if (period.status === 'processed') return true;
  if (period.status !== 'pending') return false;
  const from = String(period.availableAt || period.pack?.availableAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return false;
  return todayISODateAR(today) >= from;
}

/**
 * Recargos LILA del mes: 10 % sobre socio familiar e individual, fecha día 10.
 * AMET / vitalicio / fundador / comisión no llevan este recargo.
 */
export function defaultFeePackSurcharges(period) {
  const year = Number(period?.year);
  const month = Number(period?.month);
  if (!year || !month) return [];
  const dueIso = `${year}-${String(month).padStart(2, '0')}-10`;
  const date = formatPeriodGeneratedAt(dueIso);
  return [
    {
      date,
      category: 'SOCIO FAMILIAR',
      type: 'percentage',
      value: 10,
      rate: '10.00 %',
    },
    {
      date,
      category: 'SOCIO INDIVIDUAL',
      type: 'percentage',
      value: 10,
      rate: '10.00 %',
    },
  ];
}

function resolvePackSurcharges(period, pack = null, base = null) {
  if (Array.isArray(pack?.surcharges) && pack.surcharges.length) return pack.surcharges;
  if (Array.isArray(base?.surcharges) && base.surcharges.length) return base.surcharges;
  return defaultFeePackSurcharges(period);
}

/**
 * Arma o actualiza el borrador desde el padrón vivo (altas/bajas al día).
 * No imputa deudas: eso ocurre al liquidar.
 * `meta.discountRules` = bonificaciones / descuentos extras (si omitís, usa runtime).
 */
export function prepareFeePeriodDraft(list = [], periodId, members = [], today = new Date(), meta = {}) {
  const period = (list || []).find((p) => p.id === periodId);
  if (!period) throw new Error('Período no encontrado.');
  const block = feePeriodPrepareBlock(period, today);
  if (block) throw new Error(block);

  const when = today instanceof Date ? today : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  const iso = todayAR(when);
  const periodDate = new Date(Number(period.year), (Number(period.month) || 1) - 1, 10, 12, 0, 0, 0);
  const billed = attachHouseholdToMembers(members);
  const discountRules = resolveDiscountRules(meta?.discountRules);
  const memberUpdates = buildFeePeriodCharges(members, period, when, discountRules);
  const packLines = feePackLinesFromMembers(billed, periodDate, when);
  const packTotal = memberUpdates.length
    ? memberUpdates.reduce((sum, row) => sum + (Number(row.addAmount) || 0), 0)
    : packLines.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const surcharges = resolvePackSurcharges(period, period.pack);
  const nextPeriod = {
    ...period,
    status: 'draft',
    amount: packTotal || 0,
    generatedAt: null,
    updatedAt: new Date().toISOString(),
    pack: {
      ...(period.pack || {}),
      title: period.pack?.title || `Liquidación - ${periodLabel(period)}`,
      total: packTotal,
      concepts: packLines,
      charges: [],
      surcharges,
      preparedAt: iso,
      preparedFrom: 'padron',
    },
    lines: packLines.map((row) => ({
      identifier: row.id,
      tierId: row.tierId,
      name: row.label,
      holders: row.holders,
      unit: row.amount,
      total: row.total,
    })),
  };

  return {
    periods: (list || []).map((p) => (p.id === periodId ? nextPeriod : p)),
    period: nextPeriod,
    memberUpdates,
  };
}

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
  if (status === 'pending') return 'Pendiente';
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
      const hasPack = Boolean(p.pack?.concepts?.length || p.pack?.total);
      const hasLines = Array.isArray(p.lines) && p.lines.length > 0;
      const edited = hasPack || hasLines;
      // Pending/procesada vacía (sin monto, pack ni fecha) no pisa el seed en draft
      // — era el caso de Dic 2026: pending amount 0 → UI inventaba ~$91 M.
      const hasClosureEvidence = Number(p.amount) > 0 || hasPack || Boolean(p.generatedAt);
      const promotes = (p.status === 'processed' || p.status === 'pending')
        && official.status !== 'processed'
        && official.status !== 'pending'
        && hasClosureEvidence;
      const draftClosure = p.status === 'draft' && (hasPack || Number(p.amount) > 0);
      if (promotes || edited || draftClosure) {
        const packTotal = Number(p.pack?.total)
          || (hasPack
            ? (p.pack.concepts || []).reduce((sum, row) => {
              const holders = Number(row.holders) || 0;
              const unit = Number(row.unit ?? row.amount) || 0;
              return sum + (holders > 0 && unit > 0 ? holders * unit : 0);
            }, 0)
            : 0);
        const nextStatus = p.status === 'processed' || p.status === 'pending'
          ? p.status
          : (p.status || official.status);
        // Último gana: la carga desde Supabase debe ir al final del array.
        byId.set(officialId, {
          ...official,
          status: nextStatus,
          amount: Number(p.amount) > 0
            ? Number(p.amount)
            : (packTotal > 0 ? packTotal : official.amount),
          generatedAt: nextStatus === 'draft'
            ? (p.generatedAt || null)
            : (p.generatedAt || official.generatedAt),
          availableAt: nextStatus === 'draft'
            ? (p.availableAt || null)
            : (p.availableAt || official.availableAt || null),
          accessinId: p.accessinId ?? official.accessinId,
          lines: hasLines ? p.lines : official.lines,
          pack: hasPack ? p.pack : official.pack,
          source: p.source || official.source || 'app',
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
  if (period.status !== 'processed' && period.status !== 'pending') return false;
  const base = ACCESSIN_FEE_PERIODS.find((p) => p.id === period.id)
    || ACCESSIN_FEE_PERIODS.find((p) => (
      Number(p.year) === Number(period.year) && Number(p.month) === Number(period.month)
    ));
  if (!base) return true;
  return base.status !== 'processed'
    || String(base.generatedAt || '') !== String(period.generatedAt || '')
    || Number(base.amount) !== Number(period.amount);
}

/** True el día 1 del mes (calendario AR): corrida automática de liquidación. */
export function isFeePeriodAutoDay(today = new Date()) {
  return Number(todayISODateAR(today).slice(8, 10)) === 1;
}

export function findFeePeriodForMonth(list = [], year, month) {
  return (list || []).find((p) => Number(p.year) === Number(year) && Number(p.month) === Number(month)) || null;
}

/** Asegura un slot borrador del mes (app) si todavía no existe en la lista. */
export function ensureAppFeePeriodSlot(list = [], year, month) {
  const existing = findFeePeriodForMonth(list, year, month);
  if (existing) return { periods: list || [], period: existing, created: false };
  const stub = { year: Number(year), month: Number(month) };
  if (!appOwnsFeePeriod(stub)) return { periods: list || [], period: null, created: false };
  const period = {
    id: `fp-${year}-${String(month).padStart(2, '0')}`,
    accessinId: null,
    year: Number(year),
    month: Number(month),
    amount: 0,
    generatedAt: null,
    status: 'draft',
    source: 'app',
  };
  return {
    periods: resolveFeePeriods([...(list || []), period]),
    period,
    created: true,
  };
}

/**
 * Día 1 (AR): genera la cuota del mes a cada titular que abona (altas/bajas del padrón).
 * Queda Pendiente hasta las 00 h del día siguiente; al procesar SE SUMA al saldo previo
 * (si no pagó, debe 2 cuotas, etc.). El 10 % no va en la liquidación: se aplica al cobrar
 * después del 10. Idempotente si ya está pendiente/procesada.
 * Con `meta.catchUp: true` también genera si el mes quedó en borrador después del día 1.
 */
export function autoLiquidateFeePeriodOnMonthStart(list = [], members = [], today = new Date(), meta = {}) {
  const iso = todayISODateAR(today);
  const day = Number(iso.slice(8, 10));
  if (day !== 1 && !meta?.catchUp) {
    return { ran: false, reason: 'not_day_one', periods: list || [] };
  }
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const slotted = ensureAppFeePeriodSlot(list, year, month);
  let periods = slotted.periods;
  let period = slotted.period;
  if (!period) return { ran: false, reason: 'not_app_owned', periods };
  if (period.status === 'processed' || period.status === 'pending') {
    return { ran: false, reason: 'already_generated', periods, period };
  }

  const drafted = prepareFeePeriodDraft(periods, period.id, members, today, meta);
  periods = drafted.periods;
  period = drafted.period;

  const generated = liquidateFeePeriod(periods, period.id, members, today, {
    ...meta,
    by: meta?.by || (day === 1 ? 'Automático · día 1' : 'Automático · catch-up'),
    auto: true,
  });
  const history = Array.isArray(generated.period.pack?.history) ? generated.period.pack.history : [];
  // Catch-up después del día 1: el “día siguiente” ya pasó; disponible hoy para imputar.
  const availableAt = day === 1 ? generated.period.availableAt : iso;
  const stamped = {
    ...generated.period,
    availableAt,
    pack: {
      ...(generated.period.pack || {}),
      availableAt,
      autoFromPadronAt: iso,
      preparedFrom: 'padron_auto',
      history: history.map((row, index) => (
        index === history.length - 1
          ? {
            ...row,
            type: 'auto_generated',
            note: day === 1
              ? 'Día 1 · altas y bajas del padrón'
              : 'Catch-up · mes sin generar',
            availableAt,
          }
          : row
      )),
    },
  };
  return {
    ran: true,
    reason: 'generated',
    period: stamped,
    periods: generated.periods.map((row) => (row.id === stamped.id ? stamped : row)),
    pendingCharges: generated.pendingCharges,
  };
}

function feePeriodChargeDay(period) {
  return new Date(Number(period.year), (Number(period.month) || 1) - 1, 10, 12, 0, 0, 0);
}

/** Cargos del mes con bonificaciones / descuentos extras aplicados. */
export function buildFeePeriodCharges(members = [], period, today = new Date(), discountRules) {
  if (!period) return [];
  const periodDate = feePeriodChargeDay(period);
  const billed = attachHouseholdToMembers(members);
  const rules = resolveDiscountRules(discountRules);
  return billed.flatMap((member) => {
    if (!member || !isMemberBillingActive(member, today) || !isTitularMember(member)) return [];
    if (isDuesExemptMember(member)) return [];
    // Alineado con el trigger Postgres: no inventar cargo que apply_member_balance_deltas va a saltar.
    if (dbMemberIsDuesExempt(member.tier, { cuotaCategories: member.cuotaCategories })) return [];
    const dueOn = `${period.year}-${pad2(period.month)}-${pad2(duesDueDayForMember(member))}`;
    return duesChargeSlicesForMember(member, periodDate, { rules }).map((slice) => ({
      memberId: member.memberId,
      addAmount: slice.amount,
      tierId: slice.tierId,
      category: slice.category,
      dueOn,
    }));
  });
}

/**
 * Recalcula el borrador o el pendiente con Descuentos extras.
 * Procesada no se toca: un ajuste posterior es una nota de crédito o débito.
 */
export function refreshFeePeriodWithDiscounts(period, members = [], meta = {}, today = new Date()) {
  if (!period || !appOwnsFeePeriod(period)) {
    return { changed: false, reason: 'not_app_owned', period, deltas: [] };
  }
  if (period.status === 'cancelled') {
    return { changed: false, reason: 'cancelled', period, deltas: [] };
  }
  if (period.status === 'processed') {
    return { changed: false, reason: 'processed_locked', period, deltas: [] };
  }
  const discountRules = resolveDiscountRules(meta?.discountRules);
  const nextCharges = buildFeePeriodCharges(members, period, today, discountRules);
  const prevCharges = Array.isArray(period.pack?.charges) ? period.pack.charges : [];
  const billed = attachHouseholdToMembers(members);
  const periodDate = feePeriodChargeDay(period);
  const packLines = feePackLinesFromMembers(billed, periodDate, today);
  const packTotal = nextCharges.length
    ? nextCharges.reduce((sum, row) => sum + (Number(row.addAmount) || 0), 0)
    : packLines.reduce((sum, row) => sum + (Number(row.total) || 0), 0);

  const prevTotal = Number(period.amount) || Number(period.pack?.total) || 0;
  const sameCharges = JSON.stringify(prevCharges) === JSON.stringify(nextCharges);
  if (sameCharges && money(prevTotal) === money(packTotal)) {
    return { changed: false, reason: 'already_applied', period, deltas: [] };
  }

  const history = Array.isArray(period.pack?.history) ? period.pack.history : [];
  const by = String(meta?.by || '').trim() || null;
  const stamp = {
    type: 'discounts_reapplied',
    at: new Date().toISOString(),
    amount: packTotal,
    status: period.status,
    ...(by ? { by } : {}),
  };

  if (period.status === 'draft') {
    const drafted = prepareFeePeriodDraft(
      [period],
      period.id,
      members,
      today,
      { ...meta, discountRules },
    );
    return {
      changed: true,
      reason: 'draft_refreshed',
      period: drafted.period,
      deltas: [],
    };
  }

  const nextPeriod = {
    ...period,
    amount: packTotal,
    updatedAt: new Date().toISOString(),
    lines: packLines.map((row) => ({
      identifier: row.id,
      tierId: row.tierId,
      name: row.label,
      holders: row.holders,
      unit: row.amount,
      total: row.total,
    })),
    pack: {
      ...(period.pack || {}),
      total: packTotal,
      concepts: packLines,
      charges: nextCharges,
      history: [...history, stamp],
    },
  };

  return {
    changed: true,
    reason: 'pending_refreshed',
    period: nextPeriod,
    deltas: [],
  };
}

/**
 * Genera la liquidación de la app (desde noviembre 2026).
 * Regla LILA: queda Pendiente hasta las 00 h del día siguiente (AR); ahí pasa a Procesada
 * y recién entonces las deudas entran en cuenta. Sin recargo en la imputación (el 10 % es al pagar después del 10).
 * Comisión, vitalicio, fundador e integrantes del grupo no se cobran.
 * El tenis del adherente entra en la deuda de tenis del titular.
 */
export function liquidateFeePeriod(list = [], periodId, members = [], today = new Date(), meta = {}) {
  const period = (list || []).find((p) => p.id === periodId);
  if (!period) throw new Error('Período no encontrado.');
  if (period.status === 'processed') throw new Error('El período ya está liquidado.');
  if (period.status === 'pending') throw new Error('El período ya fue generado y está pendiente hasta las 00 h.');
  const block = feePeriodLiquidateBlock(period, today);
  if (block) throw new Error(block);

  const iso = todayISODateAR(today);
  const availableAt = feePeriodAvailableFrom(today);
  const periodDate = feePeriodChargeDay(period);
  const billed = attachHouseholdToMembers(members);
  const discountRules = resolveDiscountRules(meta?.discountRules);
  const charges = buildFeePeriodCharges(members, period, today, discountRules);
  const packLines = feePackLinesFromMembers(billed, periodDate, today);
  // Total = suma de cargos (ya con bonificaciones), no holders × tarifa bruta.
  const packTotal = charges.length
    ? charges.reduce((sum, row) => sum + (Number(row.addAmount) || 0), 0)
    : packLines.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const by = String(meta?.by || '').trim() || null;
  const byId = meta?.byId ? String(meta.byId) : null;

  const history = Array.isArray(period.pack?.history) ? period.pack.history : [];
  const nextPeriod = {
    ...period,
    status: 'pending',
    amount: packTotal || Number(period.amount) || 0,
    generatedAt: iso,
    availableAt,
    accessinId: period.accessinId || Number(String(Date.now()).slice(-4)),
    updatedAt: new Date().toISOString(),
    pack: {
      ...(period.pack || {}),
      title: period.pack?.title || `Liquidación - ${periodLabel(period)}`,
      total: packTotal,
      concepts: packLines,
      charges,
      availableAt,
      history: [...history, {
        type: 'generated',
        at: new Date().toISOString(),
        amount: packTotal || Number(period.amount) || 0,
        availableAt,
        status: 'pending',
        ...(by ? { by } : {}),
        ...(byId ? { byId } : {}),
      }],
    },
    lines: packLines.map((row) => ({
      identifier: row.id,
      tierId: row.tierId,
      name: row.label,
      holders: row.holders,
      unit: row.amount,
      total: row.total,
    })),
  };

  return {
    periods: (list || []).map((p) => (p.id === periodId ? nextPeriod : p)),
    // Las deudas no se imputan hasta Procesada (00 h del día siguiente).
    memberUpdates: [],
    pendingCharges: charges,
    period: nextPeriod,
  };
}

/**
 * Pasa a Procesada todo Pendiente cuya fecha de disponibilidad (00 h AR) ya llegó,
 * y devuelve las deudas a imputar.
 */
export function promotePendingFeePeriods(list = [], today = new Date()) {
  const todayIso = todayISODateAR(today);
  const memberUpdates = [];
  const promoted = [];
  const periods = (list || []).map((period) => {
    if (!feePeriodIsPending(period)) return period;
    if (!feePeriodIsAvailable(period, today)) return period;
    const charges = Array.isArray(period.pack?.charges) ? period.pack.charges : [];
    for (const charge of charges) {
      if ((Number(charge.addAmount) || 0) > 0) memberUpdates.push(charge);
    }
    const next = {
      ...period,
      status: 'processed',
      updatedAt: new Date().toISOString(),
      pack: {
        ...(period.pack || {}),
        processedAt: todayIso,
      },
    };
    promoted.push(next);
    return next;
  });
  return { periods, promoted, memberUpdates };
}

/** Agrupa cargos de liquidación por socio (memberId = Nº de socio). */
export function aggregateFeeChargeDeltas(charges = []) {
  const byId = new Map();
  for (const charge of charges || []) {
    const memberId = String(charge?.memberId || charge?.memberNumber || '').trim();
    const amount = Number(charge?.addAmount ?? charge?.amount) || 0;
    if (!memberId || !(amount > 0)) continue;
    const row = byId.get(memberId) || { memberId, amount: 0, periods: new Map() };
    row.amount += amount;
    const dueOn = String(charge?.dueOn || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
      const tierId = String(charge?.tierId || '').trim().toLowerCase();
      const late = !tierId || DUES_LATE_TIER_IDS.has(tierId) ? amount : 0;
      const period = row.periods.get(dueOn) || { dueOn, capital: 0, lateBase: 0 };
      period.capital += amount;
      period.lateBase += late;
      row.periods.set(dueOn, period);
    }
    byId.set(memberId, row);
  }
  return [...byId.values()].map((row) => ({
    memberId: row.memberId,
    amount: money(row.amount),
    periods: [...row.periods.values()].map((period) => ({
      dueOn: period.dueOn,
      capital: money(period.capital),
      lateBase: money(period.lateBase),
    })),
  }));
}

/**
 * Suma los deltas de liquidación al padrón en memoria.
 * No pisa el corte LILA: acumula capital (apertura + mes nuevo − cobros).
 * El 10 % no entra acá: se calcula al cobrar.
 */
export function applyFeeChargeDeltasToMembers(members = [], deltas = []) {
  if (!members?.length || !deltas?.length) return members || [];
  const byId = new Map(
    deltas.map((row) => [String(row.memberId || '').trim(), Number(row.amount) || 0]),
  );
  return members.map((member) => {
    const key = String(member?.memberId || '').trim();
    const add = byId.get(key);
    if (!add) return member;
    const capitalAdd = money(add);
    const prevBalance = Number(member.outstandingBalance) || 0;
    const prevCapital = member.unpaidCapital != null && member.unpaidCapital !== ''
      ? Number(member.unpaidCapital) || 0
      : prevBalance;
    return {
      ...member,
      outstandingBalance: money(prevBalance + capitalAdd),
      unpaidCapital: money(prevCapital + capitalAdd),
    };
  });
}

const EXPENSE_CATEGORIES = [
  'Sueldos y Jornales',
  'Cargas Sociales',
  'Gastos de Administración',
  'Tasas y Servicios',
  'Mantenimiento y Reparaciones',
  'Otros Ingresos',
  'Seguridad',
];

export { EXPENSE_CATEGORIES };

/**
 * Líneas del pack = categorías Accessin asignadas en el padrón (como LILA).
 * Solo conceptos con valor; sin inventar línea desde el tier si no hay categoría.
 */
export function feePackLinesFromMembers(members = [], periodDate = new Date(), today = periodDate) {
  const buckets = new Map();
  const add = (id) => {
    const key = String(id || '').trim().toLowerCase();
    if (!key || !isFeePackLiquidationTier(key)) return;
    if (!buckets.has(key)) {
      const amount = money(duesAmountForTier(key, undefined, periodDate));
      if (!(amount > 0)) return;
      const accessinId = getTierAccessinCategoryId(key);
      buckets.set(key, {
        id: accessinId || key,
        tierId: key,
        label: getTierDisplayName(key),
        holders: 0,
        amount,
      });
    }
    buckets.get(key).holders += 1;
  };
  for (const member of members) {
    if (!member || !isMemberBillingActive(member, today)) continue;
    const ids = parseCuotaCategories(member?.cuotaCategories || member?.meta?.cuotaCategories)
      .map((name) => slugifyTierId(name))
      .filter(Boolean);
    [...new Set(ids)].forEach(add);
  }
  return [...buckets.values()]
    .map((row) => ({ ...row, total: row.holders * row.amount }))
    .toSorted((a, b) => a.label.localeCompare(b.label, 'es'));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthStart(period) {
  const year = Number(period?.year) || new Date().getFullYear();
  const month = Number(period?.month) || 1;
  return `${year}-${pad2(month)}-01`;
}

function monthDueDay(period) {
  const year = Number(period?.year) || new Date().getFullYear();
  const month = Number(period?.month) || 1;
  return `${year}-${pad2(month)}-10`;
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
  if (!draft?.isRounded) return money(n);
  if (draft.roundingOption === 'diez') return Math.round(n / 10) * 10;
  return Math.round(n);
}

export function feePeriodIsClosed(period) {
  // Pendiente sigue editable; Procesada / anulada no.
  return period?.status === 'processed' || period?.status === 'cancelled';
}

/**
 * Anula una liquidación de la app por un error grave.
 * Devuelve el mes a borrador y las deudas que hay que restar.
 * Octubre y lo anterior quedó en Lila y no se reabre.
 */
export function reopenFeePeriod(period, reason, meta = {}) {
  const note = String(reason || '').trim();
  if (note.length < 8) throw new Error('Describí el error grave.');
  if (!period) throw new Error('Período no encontrado.');
  if (period.status !== 'processed' && period.status !== 'pending') {
    throw new Error('Solo se reabre un período ya generado.');
  }
  if (!appOwnsFeePeriod(period)) throw new Error('Hasta octubre de 2026 la liquidación quedó en LILA.');
  const charges = Array.isArray(period.pack?.charges) ? period.pack.charges : [];
  if (period.status === 'processed' && !charges.length && Number(period.amount) > 0) {
    throw new Error('Esta liquidación no guarda el detalle por socio, así que no se puede anular.');
  }
  // Pendiente aún no imputó deudas: no hay reversals. Procesada sí.
  const reversals = period.status === 'processed' ? charges : [];
  const reopens = Array.isArray(period.pack?.reopens) ? period.pack.reopens : [];
  const history = Array.isArray(period.pack?.history) ? period.pack.history : [];
  // Pendiente → borrador: se conserva el pack preparado (como LILA). Procesada → limpia montos.
  const keepPrepared = period.status === 'pending';
  const preparedTotal = Number(period.pack?.total) || Number(period.amount) || 0;
  const preparedConcepts = Array.isArray(period.pack?.concepts) ? period.pack.concepts : [];
  const preparedLines = Array.isArray(period.lines) ? period.lines : [];
  const by = String(meta?.by || '').trim() || null;
  const byId = meta?.byId ? String(meta.byId) : null;
  const reopenEntry = {
    at: new Date().toISOString(),
    reason: note,
    amount: Number(period.amount) || 0,
    generatedAt: period.generatedAt || null,
    statusWas: period.status,
    charges,
    ...(by ? { by } : {}),
    ...(byId ? { byId } : {}),
  };
  return {
    reversals,
    period: {
      ...period,
      status: 'draft',
      amount: keepPrepared ? preparedTotal : 0,
      generatedAt: null,
      availableAt: null,
      lines: keepPrepared ? preparedLines : [],
      updatedAt: new Date().toISOString(),
      pack: {
        ...(period.pack || {}),
        concepts: keepPrepared ? preparedConcepts : (period.pack?.concepts || []),
        charges: [],
        total: keepPrepared ? preparedTotal : 0,
        availableAt: null,
        reopens: [...reopens, reopenEntry],
        history: [...history, {
          type: 'reverted',
          at: reopenEntry.at,
          reason: note,
          amount: reopenEntry.amount,
          generatedAt: reopenEntry.generatedAt,
          statusWas: period.status,
          ...(by ? { by } : {}),
          ...(byId ? { byId } : {}),
        }],
      },
    },
  };
}

/** Historial de generación / reversión de una liquidación (pack en Supabase). */
export function feePeriodActionHistory(period) {
  const pack = period?.pack || {};
  const fromHistory = Array.isArray(pack.history) ? pack.history : [];
  const fromReopens = (Array.isArray(pack.reopens) ? pack.reopens : [])
    .filter((row) => !fromHistory.some((h) => h?.type === 'reverted' && h?.at === row?.at))
    .map((row) => ({
      type: 'reverted',
      at: row.at,
      reason: row.reason,
      amount: row.amount,
      generatedAt: row.generatedAt,
      statusWas: row.statusWas,
      by: row.by || null,
      byId: row.byId || null,
    }));
  return [...fromHistory, ...fromReopens]
    .filter((row) => row && (row.type === 'generated' || row.type === 'reverted') && row.at)
    .toSorted((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Borrador del formulario de edición, igual para cualquier período abierto. */
export function packEditorFromPeriod(period, liquidation = null) {
  const pack = period?.pack?.concepts?.length ? period.pack : null;
  const base = feePackForPeriod({ ...period, pack: null });
  // Pack preparado (LILA) manda: no pisar titulares/montos con una liquidación viva del padrón.
  const fromPack = (pack?.concepts || []).map((row) => ({
    identifier: row.id,
    name: row.label,
    holders: row.holders,
    unit: row.amount,
    tierId: row.tierId,
  }));
  const rows = fromPack.length
    ? fromPack
    : (liquidation?.rows?.length
      ? liquidation.rows
      : (base?.concepts || []).map((row) => ({
        identifier: row.id,
        name: row.label,
        holders: row.holders,
        unit: row.amount,
        tierId: row.tierId,
      })));
  const surchargeSource = resolvePackSurcharges(period, pack, base);
  return {
    imputeDate: pack?.imputeDate || monthStart(period),
    paymentTicketDueDate: pack?.paymentTicketDueDate || '',
    imputeOverpayments: Boolean(pack?.imputeOverpayments),
    isRounded: Boolean(pack?.isRounded),
    roundingOption: pack?.roundingOption || 'peso',
    finalizeCommunicationsMotive: pack?.finalizeCommunicationsMotive || '',
    concepts: rows
      .map((row) => ({
        id: String(row.identifier || row.id || ''),
        tierId: row.tierId || '',
        label: row.name || row.label || '',
        holders: Number(row.holders) || 0,
        amount: Number(row.unit ?? row.amount) || 0,
      }))
      .filter((row) => row.amount > 0),
    surcharges: surchargeSource.map((row) => ({
      date: parseLilaDate(row.date) || monthDueDay(period),
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
  if (!appOwnsFeePeriod(period)) throw new Error('Hasta octubre de 2026 la liquidación quedó en LILA.');
  const concepts = (draft?.concepts || []).map((row) => {
    const holders = Number(row.holders) || 0;
    const amount = roundUnit(row.amount, draft);
    return {
      id: String(row.id || ''),
      tierId: String(row.tierId || '').trim(),
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
    imputeOverpayments: Boolean(draft?.imputeOverpayments),
    isRounded: Boolean(draft?.isRounded),
    roundingOption: draft?.roundingOption === 'diez' ? 'diez' : 'peso',
    finalizeCommunicationsMotive: String(draft?.finalizeCommunicationsMotive || '').trim(),
    alerts: (draft?.alerts || []).filter((row) => row.date).map((row) => ({ date: row.date })),
    expenses,
  };
  return {
    ...period,
    amount: total,
    pack,
    lines: concepts.map((row) => ({
      identifier: row.id,
      tierId: row.tierId || undefined,
      name: row.label,
      holders: row.holders,
      unit: row.amount,
      total: row.total,
    })),
  };
}

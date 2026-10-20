/** Clasificación de cuotas sociales: en mora (después del 10) vs próximas a vencer. */

import {
  DUES_LATE_RATE,
  DUES_LATE_TIER_IDS,
  DUES_TARIFF_FROM,
  getTierDisplayName,
  getTierMonthlyDues,
  MONTHLY_DUES_FROM_OCTOBER_2026,
  MONTHLY_DUES_THROUGH_SEPTEMBER_2026,
  parseCuotaCategories,
  slugifyTierId,
} from './tiers';
import { discountOnAmount, resolveDiscountRules } from '../accounting/discountApplication';

const DAY_MS = 86400000;

/** Día de vencimiento de todas las cuotas sociales. */
export const DUES_DUE_DAY = 10;

let runtimeDueDay = null;

export function setRuntimeDueDay(day) {
  const n = Number(day);
  runtimeDueDay = Number.isInteger(n) && n >= 1 && n <= 28 ? n : null;
}

export function duesDueDay() {
  return runtimeDueDay ?? DUES_DUE_DAY;
}

const DUE_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * El 10 de cada mes vencen las cuotas.
 * before: todavía no llegó. today: es el día. after: el vencimiento de este mes ya pasó.
 */
export function duesDueMoment(today = new Date()) {
  const d = today instanceof Date
    ? today
    : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  const day = d.getDate();
  const monthName = DUE_MONTHS[d.getMonth()] || '';
  const dueDay = duesDueDay();
  const dueLabel = `${dueDay} de ${monthName}`;
  let phase = 'before';
  if (day === dueDay) phase = 'today';
  else if (day > dueDay) phase = 'after';
  return {
    phase,
    dueDay,
    dueLabel,
    monthName,
    year: d.getFullYear(),
    daysUntil: phase === 'before' ? dueDay - day : 0,
    daysSince: phase === 'after' ? day - dueDay : 0,
  };
}

function parseDate(value) {
  if (!value) return null;
  // Acepta YYYY-MM-DD o ISO completo
  const raw = String(value);
  const d = raw.includes('T') ? new Date(raw) : new Date(`${raw.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d;
}

function duesDateOnTenth(year, monthIndex) {
  return new Date(year, monthIndex, duesDueDay(), 12, 0, 0, 0);
}

function asDueAnchor(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return startOfDay(value);
  return parseDate(value) || startOfDay(new Date());
}

/** Fija cualquier fecha al día 10 de ese mes. */
export function pinDuesDueDate(value) {
  if (!value && !(value instanceof Date)) return null;
  const d = value instanceof Date ? startOfDay(value) : parseDate(value);
  if (!d) return null;
  return toISODate(duesDateOnTenth(d.getFullYear(), d.getMonth()));
}

function parseDueDate(value) {
  const pinned = pinDuesDueDate(value);
  return pinned ? parseDate(pinned) : null;
}

/**
 * Próximo vencimiento: el 10 de este mes, o el 10 del siguiente si ya pasó.
 */
export function nextDuesDueDate(from = new Date()) {
  const d = asDueAnchor(from);
  if (d.getDate() <= duesDueDay()) {
    return toISODate(duesDateOnTenth(d.getFullYear(), d.getMonth()));
  }
  return toISODate(duesDateOnTenth(d.getFullYear(), d.getMonth() + 1));
}

/**
 * Un pago cubre el mes en que se hizo. El próximo vencimiento es el 10 del mes siguiente.
 * Último pago 13/08 → cubre agosto → vence 10/09. El 21/09 ya hay 1 mes atrasado.
 */
export function firstUnpaidDuesDate({ lastPaymentDate, nextDueDate, today = new Date() } = {}) {
  const paid = parseDate(lastPaymentDate);
  if (paid) {
    return toISODate(duesDateOnTenth(paid.getFullYear(), paid.getMonth() + 1));
  }
  const pinned = pinDuesDueDate(nextDueDate);
  if (pinned) return pinned;
  return nextDuesDueDate(today);
}

/** Cuántos vencimientos del día 10 quedaron sin pagar desde el último cobro. */
export function monthsBehindOnDues({ lastPaymentDate, nextDueDate, today = new Date() } = {}) {
  const firstUnpaid = parseDate(firstUnpaidDuesDate({ lastPaymentDate, nextDueDate, today }));
  if (!firstUnpaid) return 0;
  const todayStart = startOfDay(today);
  let months = 0;
  let cursor = firstUnpaid;
  while (cursor < todayStart) {
    months += 1;
    cursor = duesDateOnTenth(cursor.getFullYear(), cursor.getMonth() + 1);
    if (months > 120) break;
  }
  return months;
}

export function formatMonthsBehind(months) {
  const n = Number(months) || 0;
  if (n <= 0) return null;
  return n === 1 ? '1 mes atrasado' : `${n} meses atrasados`;
}

/** Solo activos operan cuota / mora. Baja, suspensión y pendiente no generan ni figuran. */
export function isMemberBillingActive(member) {
  const s = String(member?.status || 'active').toLowerCase();
  return s === 'active';
}

function isExemptDuesTierId(id) {
  const t = String(id || '').trim().toLowerCase();
  return /vitalicio|fundador|^comision$/.test(t);
}

/** SOCIO (Vitalicio) y GRUPO FAMILIAR (Vitalicio): no liquidan cuota social. */
export function isVitalicioMember(member) {
  const ids = billedTierIds(member);
  if (ids.some((id) => /vitalicio/.test(id))) return true;
  return /vitalicio/i.test(String(member?.tier || ''));
}

/**
 * No abonan cuota social: vitalicio, fundador y comisión (presidente / comisión directiva).
 * Si además tienen una categoría que sí liquida (p. ej. socio familiar), no están exentos.
 * Vale para todo el padrón: no es un caso puntual.
 */
export function isDuesExemptMember(member) {
  if (isVitalicioMember(member)) return true;
  const ids = billedTierIds(member);
  const tier = String(member?.tier || '').trim().toLowerCase();
  const pool = ids.length ? ids : (tier ? [tier] : []);
  if (!pool.length) return false;
  return pool.every((id) => isExemptDuesTierId(id));
}

/** Activo y con categoría que liquida. Vitalicio / fundador / comisión nunca. */
export function canChargeSocialDues(member) {
  return isMemberBillingActive(member) && !isDuesExemptMember(member);
}

function duesExemptHeadline(member) {
  const blob = `${String(member?.tier || '')} ${billedTierIds(member).join(' ')}`.toLowerCase();
  if (/comision/.test(blob)) {
    return { title: 'Comisión', hint: 'No abona cuota social' };
  }
  if (/fundador/.test(blob)) {
    return { title: 'Fundador', hint: 'No abona cuota social' };
  }
  return { title: 'Vitalicio', hint: 'No abona cuota social' };
}

/**
 * Texto de cuota para la ficha.
 * Baja / suspensión / pendiente no son «al día»: no facturan.
 */
export function quotaHeadline(member) {
  const status = String(member?.status || 'active').toLowerCase();
  const balance = Number(member?.outstandingBalance) || 0;
  const billing = isMemberBillingActive(member);

  if (isDuesExemptMember(member)) {
    const copy = duesExemptHeadline(member);
    return {
      kind: 'off',
      title: copy.title,
      hint: copy.hint,
      billing: false,
    };
  }

  if (balance > 0) {
    return {
      kind: 'debt',
      title: 'Saldo de cuota',
      hint: billing
        ? null
        : (status === 'inactive'
          ? 'Deuda previa · no se liquida más'
          : 'Deuda previa · cuota en pausa'),
      billing,
    };
  }

  if (status === 'inactive') {
    return {
      kind: 'off',
      title: 'Sin cuota',
      hint: 'No factura mientras esté de baja',
      billing: false,
    };
  }
  if (status === 'suspended') {
    return {
      kind: 'off',
      title: 'Cuota en pausa',
      hint: 'Cuenta suspendida · no se liquida',
      billing: false,
    };
  }
  if (status === 'pending') {
    return {
      kind: 'off',
      title: 'Sin liquidar',
      hint: 'El alta todavía no factura',
      billing: false,
    };
  }

  return { kind: 'clear', title: 'Al día', hint: null, billing: true };
}

/**
 * Monto de cuota según categoría, igual que la liquidación de Lila.
 * Desde octubre 2026 usa el borrador de ese mes. Antes, la liquidación de septiembre,
 * salvo que el catálogo tenga un valor editado distinto de la tarifa oficial.
 */
export function duesAmountForTier(tier, catalog, on = new Date()) {
  const when = asDueAnchor(on);
  const from = parseDate(DUES_TARIFF_FROM);
  const id = String(tier || '').trim().toLowerCase();
  const october = MONTHLY_DUES_FROM_OCTOBER_2026[id];
  const september = MONTHLY_DUES_THROUGH_SEPTEMBER_2026[id];
  if (from && when >= from && october != null) return october;
  const catalogAmount = getTierMonthlyDues(tier, catalog);
  if (from && when < from && october != null && catalogAmount === october) {
    return september != null ? september : 0;
  }
  return catalogAmount;
}

function billedTierIds(member) {
  const fromCategories = parseCuotaCategories(member?.cuotaCategories).map((name) => slugifyTierId(name));
  if (fromCategories.length) return [...new Set(fromCategories)];
  const tier = String(member?.tier || '').trim().toLowerCase();
  return tier ? [tier] : [];
}

function asDiscountPerson(row, titular) {
  if (!row) return titular;
  return {
    ...row,
    memberId: row.memberId || row.memberNumber,
    memberNumber: row.memberId || row.memberNumber,
    familyGroupName: row.familyGroupName || titular?.familyGroupName,
    cuotaCategories: row.cuotaCategories || (row.tier ? [row.tier] : titular?.cuotaCategories),
  };
}

function discountedTierAmount(member, id, on, rules) {
  const gross = duesAmountForTier(id, undefined, on);
  if (!gross) return 0;
  if (!rules?.length) return gross;
  return discountOnAmount(gross, rules, member, {
    on,
    categoryName: getTierDisplayName(id),
    tierId: id,
  }).net;
}

export function memberDuesTierIds(member) {
  return billedTierIds(member);
}

export function memberMatchesDuesTier(member, tierId) {
  if (!tierId || tierId === 'all') return true;
  const want = String(tierId).trim().toLowerCase();
  if (!want) return true;
  if (String(member?.tier || '').trim().toLowerCase() === want) return true;
  return billedTierIds(member).includes(want);
}

/** Días hasta el 10 de este mes. Después del 10 no hay “a vencer” hasta el aviso del mes siguiente. */
export function upcomingDuesHorizonDays(today = new Date()) {
  const moment = duesDueMoment(today);
  if (moment.phase === 'before') return Math.max(0, moment.daysUntil);
  return 0;
}

/** Cuota social impaga (con recargo desde el 11), sin mezclar alquiler ni otros cargos. */
export function unpaidSocialDuesAmount(member, today = new Date()) {
  if (isDuesExemptMember(member)) return 0;
  const todayStart = startOfDay(today);
  const first = parseDate(firstUnpaidDuesDate({
    lastPaymentDate: member?.lastPaymentDate,
    nextDueDate: member?.nextDueDate,
    today: todayStart,
  }));
  if (!first || first >= todayStart) return 0;
  let total = 0;
  let cursor = first;
  let months = 0;
  while (cursor < todayStart && months < 24) {
    total += duesPayableForMember(member, { paidOn: todayStart, dueOn: cursor, on: cursor });
    cursor = duesDateOnTenth(cursor.getFullYear(), cursor.getMonth() + 1);
    months += 1;
  }
  return total;
}

function socialDuesAmountDue(member, todayStart) {
  const synthetic = unpaidSocialDuesAmount(member, todayStart);
  const stored = Number(member?.outstandingBalance) || 0;
  if (synthetic > 0 && stored > synthetic) return synthetic;
  if (stored > 0) return stored;
  return synthetic;
}

function isSocialDuesMora(member, todayStart) {
  if (!isMemberBillingActive(member) || isDuesExemptMember(member)) return false;
  const due = parseDueDate(member?.nextDueDate);
  if (due && due < todayStart) return true;
  if (monthsBehindOnDues({
    lastPaymentDate: member?.lastPaymentDate,
    nextDueDate: member?.nextDueDate,
    today: todayStart,
  }) > 0) return true;
  const stored = Number(member?.outstandingBalance) || 0;
  if (stored <= 0) return false;
  // Padrón LILA: hay saldo de cuota y no está cargado el vencimiento.
  if (!due) return true;
  const paid = parseDate(member?.lastPaymentDate);
  if (paid && due >= todayStart
    && paid.getFullYear() === todayStart.getFullYear()
    && paid.getMonth() === todayStart.getMonth()) {
    return false;
  }
  return false;
}

function isSocialDuesDueToday(member, todayStart) {
  if (!isMemberBillingActive(member) || isDuesExemptMember(member)) return false;
  if (isSocialDuesMora(member, todayStart)) return false;
  const due = parseDueDate(member?.nextDueDate);
  return Boolean(due && toISODate(due) === toISODate(todayStart));
}

/**
 * Después del 10 el pago lleva 10 % solo en socio familiar y socio individual.
 * El día 10 todavía es el vencimiento, sin recargo.
 * Sin categoría, se mantiene el 10 % (un solo importe, sin líneas).
 */
export function duesPayableAmount(base, { paidOn = new Date(), dueOn, tier } = {}) {
  const amount = Math.round(Number(base) || 0);
  if (amount <= 0) return 0;
  const paid = asDueAnchor(paidOn);
  const due = parseDueDate(dueOn) || duesDateOnTenth(paid.getFullYear(), paid.getMonth());
  if (paid <= due) return amount;
  const id = String(tier || '').trim().toLowerCase();
  if (id && !DUES_LATE_TIER_IDS.has(id)) return amount;
  return Math.round(amount * (1 + DUES_LATE_RATE));
}

/** Suma cada categoría del socio y aplica el recargo solo donde corresponde. */
export function duesPayableForMember(member, { paidOn = new Date(), dueOn, on, rules } = {}) {
  if (isDuesExemptMember(member)) return 0;
  const when = on || dueOn || paidOn;
  const discountRules = resolveDiscountRules(rules);
  const ids = billedTierIds(member);
  const own = ids.reduce(
    (sum, id) => sum + duesPayableAmount(
      discountedTierAmount(member, id, when, discountRules),
      { paidOn, dueOn, tier: id },
    ),
    0,
  );
  const family = (member?.adherents || []).filter((row) => row && row.status !== 'inactive');
  const extra = family.reduce((sum, row) => {
    const id = row?.tier || member?.tier;
    const person = asDiscountPerson(row, member);
    return sum + duesPayableAmount(
      discountedTierAmount(person, id, when, discountRules),
      { paidOn, dueOn, tier: id },
    );
  }, 0);
  return own + extra;
}

/**
 * Cuota del grupo familiar al alta: titular + cada adherente según su categoría.
 */
export function duesAmountForHousehold(titularTier, familyGroup = [], on = new Date()) {
  const titular = duesAmountForTier(titularTier, undefined, on);
  const family = (familyGroup || []).reduce(
    (sum, row) => sum + duesAmountForTier(row?.tier || titularTier, undefined, on),
    0
  );
  return titular + family;
}

/** Cuota vigente del socio: cada categoría, más adherentes activos. `on` es el mes que se cobra. */
export function duesAmountForMember(member, on = new Date(), options = {}) {
  if (isDuesExemptMember(member)) return 0;
  const rules = resolveDiscountRules(options?.rules);
  const own = billedTierIds(member).reduce(
    (sum, id) => sum + discountedTierAmount(member, id, on, rules),
    0,
  );
  const family = (member?.adherents || []).filter((a) => a && a.status !== 'inactive');
  const extra = family.reduce((sum, row) => {
    const id = row?.tier || member?.tier;
    return sum + discountedTierAmount(asDiscountPerson(row, member), id, on, rules);
  }, 0);
  return own + extra;
}

/**
 * Normaliza teléfono AR para wa.me (solo dígitos con código país).
 */
export function toWhatsAppPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('54')) return digits;
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) return `549${digits}`;
  if (digits.length === 11 && digits.startsWith('9')) return `54${digits}`;
  return digits;
}

/**
 * Socios en mora de cuota social: vencimiento ya pasado (después del 10)
 * o meses impagos. Un saldo de salón/alquiler no alcanza para entrar acá.
 */
export function getOverdueMembers(members, today = new Date()) {
  const todayStart = startOfDay(today);

  return members
    .filter((m) => isSocialDuesMora(m, todayStart))
    .map((m) => {
      const due = parseDueDate(m.nextDueDate);
      const since = parseDate(m.overdueSince);
      const firstUnpaid = parseDate(firstUnpaidDuesDate({
        lastPaymentDate: m.lastPaymentDate,
        nextDueDate: m.nextDueDate,
        today: todayStart,
      }));
      const anchor = (firstUnpaid && firstUnpaid < todayStart)
        ? firstUnpaid
        : ((due && due < todayStart) ? due : (since && since < todayStart ? since : null));
      const daysOverdue = anchor
        ? Math.max(0, Math.floor((todayStart - anchor) / DAY_MS))
        : null;
      const amountDue = socialDuesAmountDue(m, todayStart);

      return {
        ...m,
        duesStatus: 'mora',
        daysOverdue,
        dueDate: pinDuesDueDate(m.nextDueDate) || pinDuesDueDate(firstUnpaid) || m.overdueSince || null,
        amountDue,
      };
    })
    .filter((m) => (Number(m.amountDue) || 0) > 0)
    .sort((a, b) => (b.amountDue || 0) - (a.amountDue || 0));
}

/** El día 10: vence hoy, todavía sin recargo ni mora. */
export function getDueTodayMembers(members, today = new Date()) {
  const todayStart = startOfDay(today);
  return members
    .filter((m) => isSocialDuesDueToday(m, todayStart))
    .map((m) => {
      const due = parseDueDate(m.nextDueDate) || todayStart;
      const dueIso = toISODate(due);
      return {
        ...m,
        duesStatus: 'due',
        daysUntil: 0,
        dueDate: dueIso,
        amountDue: duesAmountForMember(m, due),
        nextDueDate: dueIso,
      };
    })
    .filter((m) => (Number(m.amountDue) || 0) > 0)
    .sort((a, b) => (b.amountDue || 0) - (a.amountDue || 0));
}

/**
 * Socios al día cuya cuota vence dentro del horizonte (hasta el 10 de este mes).
 */
export function getUpcomingDuesMembers(members, { withinDays, today = new Date() } = {}) {
  const todayStart = startOfDay(today);
  const horizonDays = withinDays == null ? upcomingDuesHorizonDays(todayStart) : withinDays;
  const horizon = new Date(todayStart.getTime() + horizonDays * DAY_MS);

  return members
    .filter((m) => isMemberBillingActive(m) && !isDuesExemptMember(m))
    .filter((m) => !isSocialDuesMora(m, todayStart) && !isSocialDuesDueToday(m, todayStart))
    .map((m) => {
      const due = parseDueDate(m.nextDueDate);
      if (!due) return null;
      if (due <= todayStart || due > horizon) return null;
      const daysUntil = Math.round((due - todayStart) / DAY_MS);
      const dueIso = toISODate(due);
      return {
        ...m,
        duesStatus: 'upcoming',
        daysUntil,
        dueDate: dueIso,
        amountDue: duesAmountForMember(m, due),
        nextDueDate: dueIso,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

export function formatShortDate(iso) {
  if (!iso) return '—';
  const d = parseDate(iso);
  if (!d) return String(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Link de recordatorio de cuota por WhatsApp. Null si no hay teléfono válido. */
export function buildWhatsAppDuesUrl(member, formatCurrency) {
  if (isDuesExemptMember(member)) return null;
  const cleanPhone = toWhatsAppPhone(member?.phone);
  if (!cleanPhone) return null;
  const dueLabel = formatShortDate(member.dueDate || member.nextDueDate);
  const amount = typeof formatCurrency === 'function'
    ? formatCurrency(member.amountDue)
    : (member.amountDue ?? '');
  const name = member.name || 'socio/a';
  const msg = `Estimado/a ${name}, le saludamos del Jockey Club San Juan. Le recordamos que posee una cuota vencida de ${amount} (vencimiento ${dueLabel}). Puede regularizarla en administración o por transferencia. ¡Gracias!`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

/**
 * Genera la deuda de cuota automáticamente al vencer.
 * Si nextDueDate ya pasó y el socio no tiene saldo, carga el monto de su categoría.
 * No vuelve a sumar si ya hay outstandingBalance (evita doble cargo).
 */
export function applyAutomaticDues(members, today = new Date()) {
  const todayStart = startOfDay(today);

  return members.map((m) => {
    const pinnedDue = pinDuesDueDate(m.nextDueDate);
    const normalized = pinnedDue && pinnedDue !== m.nextDueDate
      ? { ...m, nextDueDate: pinnedDue }
      : m;

    if (!isMemberBillingActive(normalized) || isDuesExemptMember(normalized)) return normalized;
    if ((Number(normalized.outstandingBalance) || 0) > 0) return normalized;

    const due = parseDueDate(normalized.nextDueDate);
    if (!due || due >= todayStart) return normalized;

    const tariffFrom = parseDate(DUES_TARIFF_FROM);
    const tierId = String(normalized.tier || '').trim().toLowerCase();
    const official = MONTHLY_DUES_FROM_OCTOBER_2026[tierId];
    const catalogAmount = getTierMonthlyDues(tierId);
    if (tariffFrom && due < tariffFrom && official != null && catalogAmount === official) {
      return normalized;
    }

    const base = duesPayableForMember(normalized, { paidOn: todayStart, dueOn: due, on: due });
    return {
      ...normalized,
      outstandingBalance: base,
      overdueSince: normalized.overdueSince || toISODate(due),
    };
  });
}

/** Socios cuyo saldo/fecha cambió tras applyAutomaticDues (para persistir en nube). */
export function diffAutomaticDues(before = [], after = []) {
  const prevById = new Map(before.map((m) => [m.memberId, m]));
  return after.filter((m) => {
    const prev = prevById.get(m.memberId);
    if (!prev) return false;
    return (
      Number(prev.outstandingBalance || 0) !== Number(m.outstandingBalance || 0)
      || (prev.overdueSince || null) !== (m.overdueSince || null)
      || (prev.nextDueDate || null) !== (m.nextDueDate || null)
    );
  });
}

/** Tras cobrar, deja al día y programa el próximo vencimiento (siempre el día 10). */
export function afterCollectDues(member, today = new Date()) {
  const base = parseDate(member.nextDueDate) || startOfDay(today);
  let next = duesDateOnTenth(base.getFullYear(), base.getMonth());
  if (next <= base) {
    next = duesDateOnTenth(base.getFullYear(), base.getMonth() + 1);
  }
  const todayStart = startOfDay(today);
  while (next <= todayStart) {
    next = duesDateOnTenth(next.getFullYear(), next.getMonth() + 1);
  }
  return {
    ...member,
    outstandingBalance: 0,
    overdueSince: null,
    nextDueDate: toISODate(next),
  };
}

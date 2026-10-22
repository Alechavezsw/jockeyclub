/** Clasificación de cuotas sociales: en mora (después del vencimiento) vs próximas a vencer. */

import {
  DUES_LATE_RATE,
  DUES_LATE_TIER_IDS,
  DUES_TARIFF_FROM,
  getTierDisplayName,
  getTierMonthlyDues,
  isAddOnDuesTierId,
  isSocialQuotaTierId,
  MONTHLY_DUES_FROM_OCTOBER_2026,
  MONTHLY_DUES_THROUGH_SEPTEMBER_2026,
  parseCuotaCategories,
  slugifyTierId,
} from './tiers';
import { discountOnAmount, resolveDiscountRules } from '../accounting/discountApplication';
import { isFamilyDependent, isTitularMember } from './households';
import { familyDependentShouldLeave } from './familyStanding';

const DAY_MS = 86400000;

/** Día de vencimiento de la cuota social (familiar e individual). */
export const DUES_DUE_DAY = 10;
/** AMET vence el 18. El 2,5 % es tarifa, no recargo de mora. */
export const DUES_AMET_DUE_DAY = 18;

let runtimeDueDay = null;

export function setRuntimeDueDay(day) {
  const n = Number(day);
  runtimeDueDay = Number.isInteger(n) && n >= 1 && n <= 28 ? n : null;
}

export function duesDueDay() {
  return runtimeDueDay ?? DUES_DUE_DAY;
}

function billedTierIds(member) {
  const fromCategories = parseCuotaCategories(member?.cuotaCategories).map((name) => slugifyTierId(name));
  if (fromCategories.length) return [...new Set(fromCategories)];
  const tier = String(member?.tier || '').trim().toLowerCase();
  return tier ? [tier] : [];
}

/** SOCIO FAMILIAR (AMET) y SOCIO INDIVIDUAL (AMET). */
export function isAmetDuesMember(member) {
  const ids = billedTierIds(member);
  const pool = ids.length ? ids : [String(member?.tier || '').trim().toLowerCase()].filter(Boolean);
  return pool.some((id) => isSocialQuotaTierId(id) && id.includes('amet'));
}

export function duesDueDayForMember(member) {
  if (isAmetDuesMember(member)) return DUES_AMET_DUE_DAY;
  return duesDueDay();
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

function duesDateOnDueDay(year, monthIndex, day = duesDueDay()) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function asDueAnchor(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return startOfDay(value);
  return parseDate(value) || startOfDay(new Date());
}

/**
 * Fija la fecha al día de vencimiento del socio.
 * Sin ficha, el 18 queda AMET; cualquier otro día va al 10.
 */
export function pinDuesDueDate(value, member) {
  if (!value && !(value instanceof Date)) return null;
  const d = value instanceof Date ? startOfDay(value) : parseDate(value);
  if (!d) return null;
  const day = member
    ? duesDueDayForMember(member)
    : (d.getDate() === DUES_AMET_DUE_DAY ? DUES_AMET_DUE_DAY : duesDueDay());
  return toISODate(duesDateOnDueDay(d.getFullYear(), d.getMonth(), day));
}

function parseDueDate(value, member) {
  const pinned = pinDuesDueDate(value, member);
  return pinned ? parseDate(pinned) : null;
}

/**
 * Próximo vencimiento: el día de cuota de este mes, o el del siguiente si ya pasó.
 */
export function nextDuesDueDate(from = new Date(), member) {
  const d = asDueAnchor(from);
  const day = duesDueDayForMember(member);
  if (d.getDate() <= day) {
    return toISODate(duesDateOnDueDay(d.getFullYear(), d.getMonth(), day));
  }
  return toISODate(duesDateOnDueDay(d.getFullYear(), d.getMonth() + 1, day));
}

/**
 * Un pago cubre el mes en que se hizo. El próximo vencimiento es el día de cuota del mes siguiente.
 * Último pago 13/08 → cubre agosto → vence 10/09 (o 18/09 si es AMET).
 */
export function firstUnpaidDuesDate({ lastPaymentDate, nextDueDate, today = new Date(), member } = {}) {
  const day = duesDueDayForMember(member);
  const paid = parseDate(lastPaymentDate);
  if (paid) {
    return toISODate(duesDateOnDueDay(paid.getFullYear(), paid.getMonth() + 1, day));
  }
  const pinned = pinDuesDueDate(nextDueDate, member);
  if (pinned) return pinned;
  return nextDuesDueDate(today, member);
}

/** Cuántos vencimientos quedaron sin pagar desde el último cobro. */
export function monthsBehindOnDues({ lastPaymentDate, nextDueDate, today = new Date(), member } = {}) {
  const day = duesDueDayForMember(member);
  const firstUnpaid = parseDate(firstUnpaidDuesDate({ lastPaymentDate, nextDueDate, today, member }));
  if (!firstUnpaid) return 0;
  const todayStart = startOfDay(today);
  let months = 0;
  let cursor = firstUnpaid;
  while (cursor < todayStart) {
    months += 1;
    cursor = duesDateOnDueDay(cursor.getFullYear(), cursor.getMonth() + 1, day);
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
export function isMemberBillingActive(member, today = new Date()) {
  const s = String(member?.status || 'active').toLowerCase();
  if (s !== 'active') return false;
  const baja = String(member?.bajaFecha || member?.meta?.bajaFecha || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(baja)) {
    const iso = today instanceof Date ? toISODate(startOfDay(today)) : String(today).slice(0, 10);
    if (baja <= iso) return false;
  }
  return true;
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

/** Activo y con categoría que liquida. Vitalicio / fundador / comisión nunca. El adherente no tiene cuenta. */
export function canChargeSocialDues(member) {
  return isMemberBillingActive(member) && isTitularMember(member) && !isDuesExemptMember(member);
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

  if (isFamilyDependent(member)) {
    return {
      kind: 'off',
      title: 'Grupo familiar',
      hint: 'La cuenta la lleva el titular',
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

function amountForTierIds(person, ids, on, rules, { addOnsOnly = false } = {}) {
  return (ids || []).reduce((sum, id) => {
    if (addOnsOnly && !isAddOnDuesTierId(id)) return sum;
    return sum + discountedTierAmount(person, id, on, rules);
  }, 0);
}

function payableForTierIds(person, ids, { paidOn, dueOn, on, rules, addOnsOnly = false } = {}) {
  return (ids || []).reduce((sum, id) => {
    if (addOnsOnly && !isAddOnDuesTierId(id)) return sum;
    return sum + duesPayableAmount(
      discountedTierAmount(person, id, on, rules),
      { paidOn, dueOn, tier: id },
    );
  }, 0);
}

function activeAdherentsOf(member, today = new Date()) {
  return (member?.adherents || []).filter((row) => {
    if (!row || row.status === 'inactive') return false;
    return !familyDependentShouldLeave(row, today);
  });
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

/** Días hasta el vencimiento de este mes. Después de ese día no hay “a vencer” hasta el mes siguiente. */
export function upcomingDuesHorizonDays(today = new Date(), member) {
  const d = today instanceof Date
    ? today
    : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  const dueDay = duesDueDayForMember(member);
  const day = d.getDate();
  if (day < dueDay) return dueDay - day;
  return 0;
}

/** Cuota social impaga (con recargo desde el 11), sin mezclar alquiler ni otros cargos. */
export function unpaidSocialDuesAmount(member, today = new Date()) {
  if (isDuesExemptMember(member)) return 0;
  const todayStart = startOfDay(today);
  const day = duesDueDayForMember(member);
  const first = parseDate(firstUnpaidDuesDate({
    lastPaymentDate: member?.lastPaymentDate,
    nextDueDate: member?.nextDueDate,
    today: todayStart,
    member,
  }));
  if (!first || first >= todayStart) return 0;
  let total = 0;
  let cursor = first;
  let months = 0;
  while (cursor < todayStart && months < 24) {
    total += duesPayableForMember(member, { paidOn: todayStart, dueOn: cursor, on: cursor });
    cursor = duesDateOnDueDay(cursor.getFullYear(), cursor.getMonth() + 1, day);
    months += 1;
  }
  return total;
}

function socialDuesAmountDue(member, todayStart) {
  return duesChargeBreakdown(member, { paidOn: todayStart }).total;
}

function isSocialDuesMora(member, todayStart) {
  if (!isMemberBillingActive(member) || isDuesExemptMember(member) || isFamilyDependent(member)) return false;
  const due = parseDueDate(member?.nextDueDate, member);
  if (due && due < todayStart) return true;
  if (monthsBehindOnDues({
    lastPaymentDate: member?.lastPaymentDate,
    nextDueDate: member?.nextDueDate,
    today: todayStart,
    member,
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
  if (!isMemberBillingActive(member) || isDuesExemptMember(member) || isFamilyDependent(member)) return false;
  if (isSocialDuesMora(member, todayStart)) return false;
  const due = parseDueDate(member?.nextDueDate, member);
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
  const due = parseDueDate(dueOn) || duesDateOnDueDay(paid.getFullYear(), paid.getMonth());
  if (paid <= due) return amount;
  const id = String(tier || '').trim().toLowerCase();
  if (id && !DUES_LATE_TIER_IDS.has(id)) return amount;
  return Math.round(amount * (1 + DUES_LATE_RATE));
}

/** Suma cada categoría del socio y aplica el recargo solo donde corresponde. */
export function duesPayableForMember(member, { paidOn = new Date(), dueOn, on, rules } = {}) {
  if (isDuesExemptMember(member) || isFamilyDependent(member)) return 0;
  const when = on || dueOn || paidOn;
  const discountRules = resolveDiscountRules(rules);
  const own = payableForTierIds(member, billedTierIds(member), {
    paidOn, dueOn, on: when, rules: discountRules,
  });
  const extra = activeAdherentsOf(member).reduce((sum, row) => {
    const person = asDiscountPerson(row, member);
    return sum + payableForTierIds(person, billedTierIds(person), {
      paidOn, dueOn, on: when, rules: discountRules, addOnsOnly: true,
    });
  }, 0);
  return own + extra;
}

/**
 * Cuota del grupo al alta: valor único del titular, más abonos (tenis) de integrantes.
 */
export function duesAmountForHousehold(titularTier, familyGroup = [], on = new Date()) {
  const titular = duesAmountForTier(titularTier, undefined, on);
  const addOns = (familyGroup || []).reduce((sum, row) => {
    const ids = billedTierIds(row);
    const pool = ids.length ? ids : [row?.tier];
    return sum + pool.reduce((inner, id) => (
      isAddOnDuesTierId(id) ? inner + duesAmountForTier(id, undefined, on) : inner
    ), 0);
  }, 0);
  return titular + addOns;
}

function pushChargeSlice(slices, person, id, on, rules) {
  const amount = Math.round(discountedTierAmount(person, id, on, rules) || 0);
  if (amount <= 0) return;
  const prev = slices.get(id);
  if (prev) {
    prev.amount += amount;
    return;
  }
  slices.set(id, {
    tierId: id,
    category: getTierDisplayName(id),
    amount,
  });
}

/**
 * Una deuda por categoría con importe. Familiar y abono de tenis no se mezclan.
 * El tenis de un adherente entra en la deuda de tenis del titular.
 */
export function duesChargeSlicesForMember(member, on = new Date(), options = {}) {
  if (isDuesExemptMember(member) || isFamilyDependent(member)) return [];
  const rules = resolveDiscountRules(options?.rules);
  const slices = new Map();
  for (const id of billedTierIds(member)) pushChargeSlice(slices, member, id, on, rules);
  for (const row of activeAdherentsOf(member)) {
    const person = asDiscountPerson(row, member);
    for (const id of billedTierIds(person)) {
      if (!isAddOnDuesTierId(id)) continue;
      pushChargeSlice(slices, person, id, on, rules);
    }
  }
  return [...slices.values()].toSorted((a, b) => a.category.localeCompare(b.category, 'es'));
}

/** Cuota vigente: titular (estatuto + abonos propios) + tenis de adherentes. El grupo no suma cuota social. */
export function duesAmountForMember(member, on = new Date(), options = {}) {
  return duesChargeSlicesForMember(member, on, options)
    .reduce((sum, slice) => sum + slice.amount, 0);
}

/**
 * Meses vencidos y todavía impagos. Cada uno trae su cuota y su propio 10 %.
 * El mes que todavía no venció no entra.
 */
function overdueSocialMonths(member, paidOn) {
  const todayStart = startOfDay(paidOn);
  const day = duesDueDayForMember(member);
  const first = parseDate(firstUnpaidDuesDate({
    lastPaymentDate: member?.lastPaymentDate,
    nextDueDate: member?.nextDueDate,
    today: todayStart,
    member,
  }));
  if (!first || first >= todayStart) return [];
  const months = [];
  let cursor = first;
  while (cursor < todayStart && months.length < 24) {
    const capital = Math.round(duesAmountForMember(member, cursor) || 0);
    const payable = Math.round(duesPayableForMember(member, {
      paidOn: todayStart,
      dueOn: cursor,
      on: cursor,
    }) || 0);
    months.push({
      dueOn: toISODate(cursor),
      capital,
      payable,
      surcharge: Math.max(0, payable - capital),
    });
    cursor = duesDateOnDueDay(cursor.getFullYear(), cursor.getMonth() + 1, day);
  }
  return months;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Cuota, recargo y total a cobrar.
 * El 10 % es el de cada mes vencido, por separado: no es un 10 % de todo el saldo
 * y un mes anterior no se anota como recargo del mes que se está cobrando.
 */
export function duesChargeBreakdown(member, { paidOn = new Date(), dueOn, on, amount, waiveSurcharge = false } = {}) {
  const when = on || dueOn || paidOn;
  const paid = paidOn || when;
  const months = dueOn ? [] : overdueSocialMonths(member, paid);
  const singleCapital = Math.round(duesAmountForMember(member, when) || 0);
  const singlePayable = Math.round(duesPayableForMember(member, { paidOn: paid, dueOn, on: when }) || 0);
  const useMonths = !dueOn && months.some((row) => row.capital > 0);
  let capital = useMonths
    ? months.reduce((sum, row) => sum + row.capital, 0)
    : singleCapital;
  let payable = useMonths
    ? months.reduce((sum, row) => sum + row.payable, 0)
    : singlePayable;
  const monthSurcharge = Math.max(0, payable - capital);
  const stored = Number(amount != null ? amount : member?.outstandingBalance);
  const hasStored = Number.isFinite(stored) && stored > 0;
  const rounded = hasStored ? Math.round(stored) : 0;

  let total;
  let surcharge;
  if (!hasStored) {
    total = payable;
    surcharge = monthSurcharge;
  } else if (capital <= 0) {
    total = rounded;
    surcharge = 0;
  } else if (rounded + 0.01 < capital) {
    let left = rounded;
    surcharge = 0;
    const rows = useMonths ? months : [{ capital, surcharge: monthSurcharge }];
    for (const row of rows) {
      if (left <= 0) break;
      const take = Math.min(left, row.capital);
      if (row.capital > 0) surcharge += Math.round(row.surcharge * take / row.capital);
      left -= take;
    }
    total = rounded + surcharge;
    capital = rounded;
    payable = total;
  } else {
    const excess = rounded - capital;
    const surchargeAlreadyInBalance = Math.abs(excess - monthSurcharge) <= 1;
    if (surchargeAlreadyInBalance) {
      surcharge = monthSurcharge;
      total = rounded;
    } else if (excess > monthSurcharge + 1) {
      surcharge = monthSurcharge;
      total = rounded + monthSurcharge;
    } else {
      surcharge = monthSurcharge;
      total = rounded + Math.max(0, monthSurcharge - excess);
    }
    payable = total;
  }
  total = roundMoney(total);
  surcharge = roundMoney(surcharge);
  capital = roundMoney(capital);
  payable = roundMoney(payable);
  const quota = Math.max(0, roundMoney(total - surcharge));
  if (waiveSurcharge && surcharge > 0) {
    return {
      quota,
      surcharge: 0,
      total: quota,
      capital,
      payable: quota,
      waivedSurcharge: surcharge,
    };
  }
  return { quota, surcharge, total, capital, payable, waivedSurcharge: 0 };
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
 * Socios en mora de cuota social: vencimiento ya pasado
 * o meses impagos. Un saldo de salón/alquiler no alcanza para entrar acá.
 */
export function getOverdueMembers(members, today = new Date()) {
  const todayStart = startOfDay(today);

  return members
    .filter((m) => isSocialDuesMora(m, todayStart))
    .map((m) => {
      const due = parseDueDate(m.nextDueDate, m);
      const since = parseDate(m.overdueSince);
      const firstUnpaid = parseDate(firstUnpaidDuesDate({
        lastPaymentDate: m.lastPaymentDate,
        nextDueDate: m.nextDueDate,
        today: todayStart,
        member: m,
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
        dueDate: pinDuesDueDate(m.nextDueDate, m) || pinDuesDueDate(firstUnpaid, m) || m.overdueSince || null,
        amountDue,
      };
    })
    .filter((m) => (Number(m.amountDue) || 0) > 0)
    .sort((a, b) => (b.amountDue || 0) - (a.amountDue || 0));
}

/** El día de vencimiento de cada socio: vence hoy, todavía sin recargo ni mora. */
export function getDueTodayMembers(members, today = new Date()) {
  const todayStart = startOfDay(today);
  return members
    .filter((m) => isSocialDuesDueToday(m, todayStart))
    .map((m) => {
      const due = parseDueDate(m.nextDueDate, m) || todayStart;
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
 * Socios al día cuya cuota vence dentro del horizonte de su categoría.
 */
export function getUpcomingDuesMembers(members, { withinDays, today = new Date() } = {}) {
  const todayStart = startOfDay(today);

  return members
    .filter((m) => isMemberBillingActive(m) && !isDuesExemptMember(m))
    .filter((m) => !isSocialDuesMora(m, todayStart) && !isSocialDuesDueToday(m, todayStart))
    .map((m) => {
      const due = parseDueDate(m.nextDueDate, m);
      if (!due) return null;
      const horizonDays = withinDays == null ? upcomingDuesHorizonDays(todayStart, m) : withinDays;
      const horizon = new Date(todayStart.getTime() + horizonDays * DAY_MS);
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
    const pinnedDue = pinDuesDueDate(m.nextDueDate, m);
    const normalized = pinnedDue && pinnedDue !== m.nextDueDate
      ? { ...m, nextDueDate: pinnedDue }
      : m;

    if (!isMemberBillingActive(normalized) || isDuesExemptMember(normalized) || isFamilyDependent(normalized)) {
      return normalized;
    }
    if ((Number(normalized.outstandingBalance) || 0) > 0) return normalized;

    const due = parseDueDate(normalized.nextDueDate, normalized);
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

/**
 * Alta a mitad de mes: paga el mes entero.
 * Si entra antes del vencimiento, vence ese mes; si entra después, cobra el mes
 * en curso sin recargo y el próximo vencimiento es el del mes siguiente.
 */
export function duesOnJoin(member, joinDate = new Date()) {
  const join = asDueAnchor(joinDate);
  const fromHousehold = Array.isArray(member?.familyGroup) && member.familyGroup.length
    ? duesAmountForHousehold(member.tier, member.familyGroup, join)
    : duesAmountForMember(member, join);
  const outstandingBalance = isDuesExemptMember(member) ? 0 : Math.round(fromHousehold || 0);
  const dueDay = duesDueDayForMember(member);
  const nextDueDate = join.getDate() <= dueDay
    ? pinDuesDueDate(join, member)
    : nextDuesDueDate(join, member);
  return { outstandingBalance, nextDueDate };
}

/** Tras cobrar, deja al día y programa el próximo vencimiento (10 o 18 si es AMET). */
export function afterCollectDues(member, today = new Date()) {
  const day = duesDueDayForMember(member);
  const base = parseDate(member.nextDueDate) || startOfDay(today);
  let next = duesDateOnDueDay(base.getFullYear(), base.getMonth(), day);
  if (next <= base) {
    next = duesDateOnDueDay(base.getFullYear(), base.getMonth() + 1, day);
  }
  const todayStart = startOfDay(today);
  while (next <= todayStart) {
    next = duesDateOnDueDay(next.getFullYear(), next.getMonth() + 1, day);
  }
  return {
    ...member,
    outstandingBalance: 0,
    overdueSince: null,
    nextDueDate: toISODate(next),
  };
}

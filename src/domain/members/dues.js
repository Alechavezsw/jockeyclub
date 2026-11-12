/** Clasificación de cuotas sociales: en mora (después del vencimiento) vs próximas a vencer. */

import {
  DUES_AMET_RATE,
  DUES_LATE_RATE,
  DUES_LATE_TIER_IDS,
  DUES_TARIFF_FROM,
  findTier,
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
import { todayAR } from '../../lib/arDate';
import { money } from '../money';
import { duesMonthLabel } from './duesImputations';

const DAY_MS = 86400000;

/** Día de vencimiento de la cuota social (familiar e individual). */
export const DUES_DUE_DAY = 10;
/** AMET vence el 18. El 2,5 % es tarifa, no recargo de mora. */
export const DUES_AMET_DUE_DAY = 18;

function percentLabel(rate) {
  const n = Math.round(Number(rate) * 1000) / 10;
  return `${String(n).replace('.', ',')} %`;
}

/** Textos de la regla. El manual de Jev lee esto: no copia el día ni el porcentaje. */
export function duesRuleSentences() {
  const late = percentLabel(DUES_LATE_RATE);
  const ametCut = percentLabel(DUES_AMET_RATE);
  const moraDay = DUES_DUE_DAY + 1;
  const ametMoraDay = DUES_AMET_DUE_DAY + 1;
  const tariffWhen = new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${DUES_TARIFF_FROM}T12:00:00Z`));
  return {
    dueDay: DUES_DUE_DAY,
    ametDueDay: DUES_AMET_DUE_DAY,
    moraDay,
    ametMoraDay,
    late,
    ametCut,
    dueLine: `La cuota social vence el día ${DUES_DUE_DAY} de cada mes. Desde el ${moraDay} el socio está en mora.`,
    ametLine: `AMET (socio familiar AMET y socio individual AMET) vence el ${DUES_AMET_DUE_DAY}. Su cuota es la base menos ${ametCut}; ese ${ametCut} es tarifa, no mora ni recargo.`,
    lateLine: `El recargo es del ${late}, corre desde el día siguiente al vencimiento y solo en socio familiar e individual. AMET no lleva recargo.`,
    exemptLine: 'Vitalicio, fundador y comisión no abonan cuota. Para todo el padrón: sin mora, sin saldo, sin avisos, sin Mercado Pago y sin cobro en caja ni en el portal.',
    householdLine: 'En un grupo familiar la cuota es una sola, la del titular. El adherente no tiene cuenta propia. Un abono de tenis de un integrante sí se suma a la cuenta del titular.',
    groupMoraLine: 'La mora del titular alcanza al grupo: en temporada el adherente no ingresa ni paga pileta si el titular está en mora.',
    paymentLine: `Un pago cubre el mes en que se hizo: si el último pago fue en agosto, el próximo vencimiento es el ${DUES_DUE_DAY} de septiembre.`,
    deskLine: 'El recargo se cobra siempre. Un administrador puede borrarlo después en la ficha: el importe cobrado queda y el recargo pasa a saldo a favor.',
    creditLine: 'El saldo a favor se descuenta solo en el próximo cobro. Si cubre la cuota, lo que sobra queda para el siguiente.',
    tariffLine: `La tarifa vigente desde ${tariffWhen} y la liquidación de cada mes están en Cuotas; el día de vencimiento se ve en Configuración.`,
    banner: `el ${DUES_DUE_DAY} de cada mes (AMET, el ${DUES_AMET_DUE_DAY})`,
    collectLine: `El recargo del ${late} es el de cada mes vencido, por separado, desde el día siguiente al vencimiento y solo en socio familiar e individual; AMET no lleva.`,
    moraWhen: `El día ${DUES_DUE_DAY} (AMET, el ${DUES_AMET_DUE_DAY}) vence la cuota. Hasta ese día no lleva recargo.`,
    moraAfter: `Desde el día siguiente (el ${moraDay}; AMET, el ${ametMoraDay}) es mora. En socio familiar e individual corre el recargo del ${late}; AMET no lleva recargo.`,
    glossaryAmet: `AMET: categoría que vence el ${DUES_AMET_DUE_DAY}, con la cuota en base menos ${ametCut}; ese ${ametCut} es tarifa, no mora, y no lleva recargo.`,
    glossaryMora: `Mora: cuota vencida y sin pagar, desde el día siguiente al vencimiento. Recargo: ${late} de la cuota de cada mes vencido, por separado, solo familiar e individual.`,
    controlMora: `Desde el día siguiente al vencimiento corre el recargo del ${late} (familiar e individual).`,
    gateMora: `ACCESO DENEGADO · MORA aparece solo en temporada de pileta (diciembre a marzo), desde el ${DUES_DUE_DAY}, si no pagó la cuota del mes. Fuera de temporada la deuda se informa pero no cierra la puerta. Un adherente queda igual que su titular: si el titular está en mora, el grupo también.`,
    gateReason: `ACCESO DENEGADO · MORA: es temporada de pileta (diciembre a marzo), pasó el ${DUES_DUE_DAY} y no pagó la cuota del mes. Que regularice en Caja o en Mi Cuenta; cuando se acredita, pasa. Fuera de temporada, la deuda no cierra la puerta.`,
    poolMora: `Un socio en mora (desde el ${DUES_DUE_DAY}, o con saldo) no puede pagar pileta hasta regularizar la cuota. La ficha lo dice: Puede pagar pileta / No puede pagar pileta.`,
    inicio: `Vencimiento del mes (${DUES_DUE_DAY}; AMET, ${DUES_AMET_DUE_DAY}), recaudado del mes con su cobrabilidad, caja y alertas vivas.`,
    configDue: `Cuotas: Vence el día (1 al 28; hoy el ${DUES_DUE_DAY}), tolerancia de pago, gracia de la credencial, deuda máxima, cuenta protegida y si los socios ven su cuenta corriente. AMET vence el ${DUES_AMET_DUE_DAY} por regla de la categoría, no por este campo.`,
    configNotices(advanceDays) {
      const upcoming = DUES_DUE_DAY - advanceDays;
      return `Regla de avisos: queda guardada en el libro. Mensaje interno y mail el día ${upcoming} (por vencer), el ${DUES_DUE_DAY} (vence) y el ${moraDay} (mora). Recargo del ${late} desde el ${moraDay} en familiar e individual.`;
    },
    noticesLine(advanceDays) {
      const upcoming = DUES_DUE_DAY - advanceDays;
      const ametUpcoming = DUES_AMET_DUE_DAY - advanceDays;
      return `Avisos reales, uno de cada etapa por socio: desde ${advanceDays} días antes del vencimiento, el día que vence y desde el día siguiente (mora). Para casi todos eso es desde el ${upcoming}, el ${DUES_DUE_DAY} y desde el ${moraDay}; para AMET, desde el ${ametUpcoming}, el ${DUES_AMET_DUE_DAY} y desde el ${ametMoraDay}. Llegan por mensaje interno y mail, con las consecuencias de mora. La regla está en Configuración.`;
    },
    poolGate: `Pileta: canon socio e invitado, apto médico (días), invitados por socio, nombre de la temporada, si el socio carga el apto, y Mora desde el ${DUES_DUE_DAY} bloquea el ingreso (en temporada, diciembre a marzo; vale para sede y pileta).`,
  };
}

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
  // next_due_date es la fuente de verdad del primer vencimiento abierto (registrar_cobro).
  // lastPaymentDate solo rellena si la ficha no trae vencimiento: si gana el último pago,
  // reaparecen meses ya cobrados en “Meses del recibo”.
  const pinned = pinDuesDueDate(nextDueDate, member);
  if (pinned) return pinned;
  const paid = parseDate(lastPaymentDate);
  if (paid) {
    return toISODate(duesDateOnDueDay(paid.getFullYear(), paid.getMonth() + 1, day));
  }
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

/**
 * Misma regla que `member_is_dues_exempt` en Postgres.
 * El trigger pone el saldo en 0 si el tier o cuotaCategories matchean,
 * aunque la ficha también tenga una categoría que sí liquida.
 */
export function dbMemberIsDuesExempt(tier, meta) {
  const t = String(tier || '');
  const raw = meta && typeof meta === 'object' ? meta.cuotaCategories : null;
  const cats = raw == null ? '' : (typeof raw === 'string' ? raw : JSON.stringify(raw));
  return /(vitalicio|fundador)/i.test(t)
    || /^comision$/i.test(t.trim())
    || /(vitalicio|fundador|comision)/i.test(cats);
}

/** SOCIO (Vitalicio) y GRUPO FAMILIAR (Vitalicio): no liquidan cuota social. */
export function isVitalicioMember(member) {
  const ids = billedTierIds(member);
  if (ids.some((id) => /vitalicio/.test(id))) return true;
  return /vitalicio/i.test(String(member?.tier || ''));
}

/** Comisión directiva / presidente: categoría comisión en el padrón. */
export function isCommissionMember(member) {
  const ids = billedTierIds(member);
  if (ids.some((id) => /comision/.test(id))) return true;
  const tier = String(member?.tier || '').trim().toLowerCase();
  if (/comision/.test(tier)) return true;
  const cats = member?.cuotaCategories ?? member?.meta?.cuotaCategories;
  const blob = cats == null ? '' : (typeof cats === 'string' ? cats : JSON.stringify(cats));
  return /comision/i.test(blob);
}

/**
 * No abonan cuota social: vitalicio, fundador y comisión (presidente / comisión directiva).
 * Si además tienen una categoría que sí liquida (p. ej. socio familiar), no están exentos
 * en la UI/liquidación JS. Postgres (`member_is_dues_exempt`) usa OR y puede poner saldo 0
 * en fichas mixtas: buildFeePeriodCharges también salta esas con `dbMemberIsDuesExempt`.
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
 * Socio familiar: junio, julio y deudas anteriores, más agosto y septiembre 2026,
 * salen a la misma cuota que octubre ($ 70.000). En mora el recibo es $ 77.000.
 */
function isFamiliarLiftedTariffMonth(when) {
  const d = asDueAnchor(when);
  // Cualquier mes hasta septiembre 2026 inclusive (y deudas más viejas).
  return d < new Date(2026, 9, 1);
}

/** Meses cuya ficha puede traer $ 60.000 y al cobrar pasan a $ 70.000. */
function isFamiliarTariffLiftDueOn(dueOn) {
  const due = String(dueOn || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due <= '2026-09-30';
}

/**
 * Monto de cuota según categoría, igual que la liquidación de Lila.
 * Socio individual: $ 40.000 en noviembre y en todos los meses.
 * Socio familiar: junio, julio y deudas anteriores, más agosto y septiembre 2026,
 * usan la misma cuota que octubre ($ 70.000). En mora el recibo de esos meses
 * es $ 77.000. Desde octubre 2026, el borrador de ese mes.
 */
export function duesAmountForTier(tier, catalog, on = new Date()) {
  const when = asDueAnchor(on);
  const from = parseDate(DUES_TARIFF_FROM);
  const id = String(tier || '').trim().toLowerCase();
  const october = MONTHLY_DUES_FROM_OCTOBER_2026[id];
  const september = MONTHLY_DUES_THROUGH_SEPTEMBER_2026[id];
  // Socio individual: $ 40.000 en noviembre y en todos los meses.
  // No vuelve la tarifa de septiembre ni un saldo viejo del catálogo.
  if (id === 'socio_individual' && october != null) return october;
  if (id === 'socio_familiar' && october != null && isFamiliarLiftedTariffMonth(when)) {
    return october;
  }
  if (from && when >= from && october != null) return october;
  if (from && when < from && september != null) {
    const listed = findTier(tier, catalog);
    if (listed) {
      const catalogAmount = getTierMonthlyDues(tier, catalog);
      // Valor editado en catálogo (ni oct ni sep oficiales) → respetar. Si es la tarifa de oct, usar sep.
      if (catalogAmount !== october && catalogAmount !== september) return catalogAmount;
    }
    return september;
  }
  return getTierMonthlyDues(tier, catalog);
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

/** Caso particular: capital de un mes cargado en la ficha. El resto del padrón no lo tiene. */
function memberSocialMonthCapital(member, tierId, on) {
  const table = member?.duesMonthCapital;
  if (!table || typeof table !== 'object' || Array.isArray(table)) return null;
  const when = asDueAnchor(on);
  const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}`;
  if (!Object.prototype.hasOwnProperty.call(table, key)) return null;
  const amount = Number(table[key]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const id = String(tierId || '').trim().toLowerCase();
  const own = String(member?.tier || '').trim().toLowerCase();
  if (!id || (own && id !== own)) return null;
  return money(amount);
}

function discountedTierAmount(member, id, on, rules) {
  const override = memberSocialMonthCapital(member, id, on);
  const gross = override != null ? override : duesAmountForTier(id, undefined, on);
  if (!gross) return 0;
  if (!rules?.length) return gross;
  return discountOnAmount(gross, rules, member, {
    on,
    categoryName: getTierDisplayName(id),
    tierId: id,
  }).net;
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

/** Capital de cuota del corte LILA (`meta.unpaidCapital`). Null si no hay dato. */
export function lilaUnpaidCapital(member) {
  const raw = member?.unpaidCapital;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Saldo de cuota para mora / “cuánto debe”.
 * Tras importar débitos, unpaidCapital LILA es la verdad; la columna
 * outstanding_balance a veces quedó vieja y metía cobrados en mora.
 */
export function socialDuesStoredBalance(member) {
  const lila = lilaUnpaidCapital(member);
  if (lila != null) return Math.max(0, money(lila));
  return Math.max(0, money(Number(member?.outstandingBalance) || 0));
}

function socialDuesAmountDue(member, todayStart) {
  const stored = socialDuesStoredBalance(member);
  const forBreakdown = stored === money(Number(member?.outstandingBalance) || 0)
    ? member
    : { ...member, outstandingBalance: stored };
  return duesChargeBreakdown(forBreakdown, { paidOn: todayStart }).total;
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
  const stored = socialDuesStoredBalance(member);
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
 * Después del 10 el pago lleva 10 % en socio familiar y socio individual.
 * Desde octubre, toda cuota de esos socios lo lleva si ese mes está en mora.
 * El día 10 todavía es el vencimiento, sin recargo.
 * Sin categoría, se mantiene el 10 % (un solo importe, sin líneas).
 */
/** Día civil en Argentina. Una fecha YYYY-MM-DD no se corre a UTC. */
function argentinaDay(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? todayAR() : todayAR(value);
  const raw = String(value ?? '').trim();
  if (!raw) return todayAR();
  const day = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day) && !/[T\s]\d{2}:\d{2}/.test(raw)) return day;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? todayAR() : todayAR(parsed);
}

export function duesPayableAmount(base, { paidOn = new Date(), dueOn, tier } = {}) {
  const amount = money(base);
  if (amount <= 0) return 0;
  const paidIso = argentinaDay(paidOn);
  const dueIso = dueOn
    ? argentinaDay(dueOn)
    : `${paidIso.slice(0, 8)}${String(duesDueDay()).padStart(2, '0')}`;
  if (paidIso <= dueIso) return amount;
  const id = String(tier || '').trim().toLowerCase();
  if (id && !DUES_LATE_TIER_IDS.has(id)) return amount;
  return money(amount * (1 + DUES_LATE_RATE));
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
  const amount = money(discountedTierAmount(person, id, on, rules));
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
  return money(duesChargeSlicesForMember(member, on, options)
    .reduce((sum, slice) => sum + slice.amount, 0));
}

/** Capital del mes que sí lleva 10 % (familiar e individual). El abono no. */
export function lateBaseForMember(member, on) {
  return money(duesChargeSlicesForMember(member, on).reduce((sum, slice) => {
    const id = String(slice.tierId || '').trim().toLowerCase();
    if (id && !DUES_LATE_TIER_IDS.has(id)) return sum;
    return sum + (Number(slice.amount) || 0);
  }, 0));
}

/**
 * Meses vencidos y todavía impagos. Cada uno trae su cuota y su propio 10 %.
 * El mes que todavía no venció no entra.
 */
export function overdueSocialMonths(member, paidOn) {
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
    const capital = money(duesAmountForMember(member, cursor));
    const payable = money(duesPayableForMember(member, {
      paidOn: todayStart,
      dueOn: cursor,
      on: cursor,
    }) || 0);
    months.push({
      dueOn: toISODate(cursor),
      capital,
      lateBase: lateBaseForMember(member, cursor),
      payable,
      surcharge: Math.max(0, payable - capital),
    });
    cursor = duesDateOnDueDay(cursor.getFullYear(), cursor.getMonth() + 1, day);
  }
  return months;
}

function periodChoiceLabel(dueOn) {
  return duesMonthLabel(dueOn) || String(dueOn || '').slice(0, 10);
}

function periodChoiceFromDue(member, dueOn, paidOn, kind = 'overdue') {
  const on = parseDate(dueOn) || paidOn;
  const capital = money(duesAmountForMember(member, on));
  if (!(capital > 0)) return null;
  const payable = money(duesPayableForMember(member, {
    paidOn,
    dueOn,
    on,
  }) || 0);
  return {
    id: dueOn,
    dueOn,
    monthKey: String(dueOn).slice(0, 7),
    label: periodChoiceLabel(dueOn),
    capital,
    lateBase: lateBaseForMember(member, on),
    surcharge: Math.max(0, payable - capital),
    payable,
    kind,
  };
}

function appendPeriodChoiceCovering(rows, full, remaining) {
  if (!full) return null;
  const capital = money(Math.min(Number(full.capital) || 0, remaining));
  if (!(capital > 0)) return null;
  const surcharge = full.capital > 0
    ? money((full.surcharge * capital) / full.capital)
    : 0;
  return {
    ...full,
    capital,
    surcharge,
    payable: money(capital + surcharge),
    lateBase: money(Math.min(Number(full.lateBase) || capital, capital)),
  };
}

/**
 * Regla general de cobro: la cuota de un mes se ofrece recién cuando ese mes ya empezó
 * (día 1). Ej.: en noviembre no se ofrece diciembre; los atrasados sí.
 */
function duesPeriodMonthStarted(dueOn, paidOn) {
  const due = parseDate(dueOn);
  if (!due || !paidOn) return false;
  const dueYm = due.getFullYear() * 12 + due.getMonth();
  const paidYm = paidOn.getFullYear() * 12 + paidOn.getMonth();
  return dueYm <= paidYm;
}

/** Meses ya cubiertos por cobros (periodDueOns / imputaciones). No se vuelven a ofrecer. */
export function memberCoveredDueOns(member) {
  const set = new Set();
  const push = (value) => {
    const iso = String(value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) set.add(iso);
  };
  for (const payment of member?.paymentHistory || []) {
    for (const due of payment?.periodDueOns || []) push(due);
    for (const row of payment?.imputations || []) push(row?.dueOn);
  }
  return set;
}

function dueOnAlreadyCovered(dueOn, coveredDueOns) {
  if (!coveredDueOns || coveredDueOns.size === 0) return false;
  return coveredDueOns.has(String(dueOn || '').slice(0, 10));
}

/**
 * Si el saldo de ficha (capital) supera los meses reconstruidos desde nextDueDate,
 * completa el mes en curso (si ya arrancó) y después hacia atrás (atrasados).
 * No adelanta meses futuros: diciembre recién cuando estamos en diciembre.
 * Si hay de más (ficha ya cobrada / nextDue desfasado), recorta al saldo: no re-cobra meses pagos.
 */
/** Capital a repartir en meses. El recargo que Lila dejó en el saldo no abre otro mes. */
function capitalOwedForChoices(member) {
  const balance = money(Math.max(0, Number(member?.outstandingBalance) || 0));
  const lila = lilaUnpaidCapital(member);
  // El corte Lila es la cuota. Si la apertura quedó más baja (8063 en 28.000
  // con individual a 40.000), no se cobra ese importe viejo.
  if (lila != null) return money(Math.max(0, lila));
  const surcharge = money(Math.max(0, Number(member?.unpaidSurcharges) || 0));
  if (surcharge > 0.01 && balance > surcharge + 0.01) return money(balance - surcharge);
  return balance;
}

function expandChoicesToCoverBalance(member, choices, paidOn, coveredDueOns = null) {
  const owed = capitalOwedForChoices(member);
  if (!(owed > 0.01)) return choices;
  const day = duesDueDayForMember(member);
  const paidSet = coveredDueOns || memberCoveredDueOns(member);
  let rows = [...(choices || [])].filter((row) => !dueOnAlreadyCovered(row.dueOn, paidSet));
  let covered = money(rows.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
  let guard = 0;

  // 1) Adelante solo si el mes de esa cuota ya empezó (día 1) y no está pago.
  while (covered + 0.01 < owed && guard < 24) {
    guard += 1;
    const anchor = rows[rows.length - 1]?.dueOn
      || pinDuesDueDate(member?.nextDueDate, member)
      || toISODate(paidOn);
    const last = parseDate(anchor);
    if (!last) break;
    const nextDue = toISODate(duesDateOnDueDay(last.getFullYear(), last.getMonth() + 1, day));
    if (rows.some((row) => row.dueOn === nextDue)) break;
    if (!duesPeriodMonthStarted(nextDue, paidOn)) break;
    if (dueOnAlreadyCovered(nextDue, paidSet)) {
      // Mes ya pago: avanzar el ancla sin sumar capital.
      rows.push({
        id: nextDue,
        dueOn: nextDue,
        monthKey: String(nextDue).slice(0, 7),
        label: periodChoiceLabel(nextDue),
        capital: 0,
        lateBase: 0,
        surcharge: 0,
        payable: 0,
        kind: 'paid',
      });
      continue;
    }
    const remaining = money(owed - covered);
    const dueDate = parseDate(nextDue);
    const kind = dueDate && dueDate < paidOn ? 'overdue' : 'upcoming';
    const full = periodChoiceFromDue(member, nextDue, paidOn, kind);
    const row = appendPeriodChoiceCovering(rows, full, remaining);
    if (!row) break;
    rows.push(row);
    covered = money(covered + row.capital);
  }

  // 2) Atrás: meses anteriores si todavía no alcanza el capital de ficha.
  guard = 0;
  while (covered + 0.01 < owed && guard < 24) {
    guard += 1;
    const anchor = rows.find((row) => Number(row.capital) > 0)?.dueOn
      || rows[0]?.dueOn
      || pinDuesDueDate(member?.nextDueDate, member)
      || toISODate(paidOn);
    const first = parseDate(anchor);
    if (!first) break;
    const prevDue = toISODate(duesDateOnDueDay(first.getFullYear(), first.getMonth() - 1, day));
    if (rows.some((row) => row.dueOn === prevDue)) break;
    if (dueOnAlreadyCovered(prevDue, paidSet)) {
      rows.unshift({
        id: prevDue,
        dueOn: prevDue,
        monthKey: String(prevDue).slice(0, 7),
        label: periodChoiceLabel(prevDue),
        capital: 0,
        lateBase: 0,
        surcharge: 0,
        payable: 0,
        kind: 'paid',
      });
      continue;
    }
    const remaining = money(owed - covered);
    const full = periodChoiceFromDue(member, prevDue, paidOn, 'overdue');
    const row = appendPeriodChoiceCovering(rows, full, remaining);
    if (!row) break;
    rows.unshift(row);
    covered = money(covered + row.capital);
  }

  const openMonths = rows.filter((row) => (
    Number(row.capital) > 0
    && row.kind !== 'paid'
    && (row.kind === 'overdue' || duesPeriodMonthStarted(row.dueOn, paidOn))
    && !dueOnAlreadyCovered(row.dueOn, paidSet)
  ));
  rows = openMonths.length ? openMonths : rows.filter((row) => Number(row.capital) > 0 && row.kind !== 'paid');
  rows = rows.map((row) => {
    const due = String(row.dueOn || '').slice(0, 10);
    if (!isFamiliarTariffLiftDueOn(due)) return row;
    const full = periodChoiceFromDue(member, due, paidOn, row.kind || 'overdue');
    if (!full || full.capital + 0.01 < 70000) return row;
    if ((Number(row.capital) || 0) + 0.01 >= full.capital) return row;
    return full;
  });
  covered = money(rows.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));

  // Junio, julio y deudas anteriores, más agosto y septiembre 2026 del familiar,
  // pasan de $ 60.000 a $ 70.000. Si el saldo de ficha todavía trae esos meses
  // a $ 60.000, no se recorta octubre ni noviembre: cada uno queda en $ 77.000 con mora.
  const familiarLift = rows.reduce((sum, row) => {
    const due = String(row.dueOn || '').slice(0, 10);
    if (!isFamiliarTariffLiftDueOn(due)) return sum;
    if ((Number(row.capital) || 0) + 0.01 < 70000) return sum;
    return sum + 10000;
  }, 0);
  if (covered <= owed + familiarLift + 0.01) return rows;
  // De más: dejar solo lo que cubre el saldo (desde el más viejo = next due).
  const trimmed = [];
  let taken = 0;
  for (const row of rows) {
    if (taken + 0.01 >= owed) break;
    const remaining = money(owed - taken);
    const fullCap = Number(row.capital) || 0;
    const capital = money(Math.min(fullCap, remaining));
    if (!(capital > 0)) continue;
    const ratio = fullCap > 0 ? capital / fullCap : 0;
    const surcharge = money((Number(row.surcharge) || 0) * ratio);
    const lateBase = money((Number(row.lateBase) || 0) * ratio);
    trimmed.push({
      ...row,
      capital,
      surcharge,
      payable: money(capital + surcharge),
      lateBase,
    });
    taken = money(taken + capital);
  }
  const kept = trimmed.length ? trimmed : rows;
  // Si el saldo de ficha traía $ 60.000, el recorte deja $ 60.000: volver a $ 70.000
  // (recibo $ 77.000 con mora) en junio, julio y deudas anteriores.
  return kept.map((row) => {
    if (!isFamiliarTariffLiftDueOn(row.dueOn)) return row;
    const full = periodChoiceFromDue(member, row.dueOn, paidOn, row.kind || 'overdue');
    if (!full || full.capital + 0.01 < 70000) return row;
    const cap = Number(row.capital) || 0;
    if (cap + 0.01 >= full.capital) return row;
    if (cap + 10000 + 0.01 >= full.capital) return full;
    return row;
  });
}

/**
 * Diferencia entre la cuota de ahora y la de septiembre 2026.
 * Lila a veces guardó un mes a tarifa vieja dentro del capital.
 */
function cuotaTariffStep(member, paidOn) {
  const current = money(duesAmountForMember(member, paidOn));
  const from = parseDate(DUES_TARIFF_FROM);
  if (!from) return 0;
  const ids = billedTierIds(member);
  const tier = String(member?.tier || '').trim().toLowerCase();
  const pool = ids.length ? ids : (tier ? [tier] : []);
  let step = 0;
  for (const id of pool) {
    const previousTariff = MONTHLY_DUES_THROUGH_SEPTEMBER_2026[id];
    const currentTariff = MONTHLY_DUES_FROM_OCTOBER_2026[id];
    if (previousTariff == null || currentTariff == null) continue;
    step += Math.abs(money(currentTariff - previousTariff));
  }
  if (step > 0) return money(step);
  const previous = money(duesAmountForMember(member, new Date(from.getTime() - DAY_MS)));
  return Math.abs(money(current - previous));
}

/**
 * Saldo sin vencimiento que entra en N cuotas vigentes.
 * No se desarma con la tarifa vieja (septiembre a $36.000) ni con el recargo
 * que Lila dejó metido en el saldo: son N meses de la cuota de ahora,
 * desde el mes en curso hacia atrás.
 * Un capital como 116.000 (36.000 + 40.000 + 40.000) no abre agosto por el
 * recargo ni baja septiembre: septiembre también sale a la cuota vigente.
 */
function lumpMonthsAtCurrentCuota(member, paidOn, paidSet) {
  if (pinDuesDueDate(member?.nextDueDate, member)) return null;
  const balance = money(Math.max(0, Number(member?.outstandingBalance) || 0));
  const lila = lilaUnpaidCapital(member);
  const capital = lila != null && lila > 0.01 && lila <= balance + 0.01 ? money(lila) : balance;
  if (!(capital > 0.01)) return null;
  const monthly = money(duesAmountForMember(member, paidOn));
  if (!(monthly > 0)) return null;
  const count = Math.round(capital / monthly);
  if (count < 1 || count > 18) return null;
  const gap = Math.abs(money(capital - count * monthly));
  const allowedGap = money(Math.max(monthly * 0.02, cuotaTariffStep(member, paidOn)));
  if (gap > allowedGap) return null;

  const day = duesDueDayForMember(member);
  const tier = String(member?.tier || '').trim().toLowerCase();
  // Misma regla que el 10 % del recibo: sin categoría también hay recargo.
  const lateBase = tier && !DUES_LATE_TIER_IDS.has(tier) ? 0 : monthly;
  let cursor = duesDateOnDueDay(paidOn.getFullYear(), paidOn.getMonth(), day);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const dueOn = toISODate(cursor);
    if (dueOnAlreadyCovered(dueOn, paidSet) || !duesPeriodMonthStarted(dueOn, paidOn)) return null;
    const kind = cursor < paidOn ? 'overdue' : 'upcoming';
    const payable = money(duesPayableAmount(monthly, { paidOn, dueOn, tier: member?.tier }));
    rows.unshift({
      id: dueOn,
      dueOn,
      monthKey: dueOn.slice(0, 7),
      label: periodChoiceLabel(dueOn),
      capital: monthly,
      lateBase,
      surcharge: money(Math.max(0, payable - monthly)),
      payable,
      kind,
    });
    cursor = duesDateOnDueDay(cursor.getFullYear(), cursor.getMonth() - 1, day);
  }
  return rows.length === count ? rows : null;
}

/**
 * Meses que se pueden marcar en el cobro (atrasados y mes en curso).
 * Si el saldo supera lo vencido, suma el mes actual (si ya empezó) y completa hacia atrás.
 */
export function collectionPeriodChoices(member, today = new Date()) {
  if (!member || isDuesExemptMember(member) || isFamilyDependent(member)) return [];
  const paidOn = startOfDay(today);
  const paidSet = memberCoveredDueOns(member);
  // Sin vencimiento, el saldo son N cuotas vigentes. No se abre agosto con el recargo.
  if (!pinDuesDueDate(member?.nextDueDate, member)) {
    const lump = lumpMonthsAtCurrentCuota(member, paidOn, paidSet);
    if (lump) return lump;
  }
  const overdue = overdueSocialMonths(member, paidOn)
    .filter((row) => row.capital > 0 && !dueOnAlreadyCovered(row.dueOn, paidSet))
    .map((row) => ({
      id: row.dueOn,
      dueOn: row.dueOn,
      monthKey: String(row.dueOn).slice(0, 7),
      label: periodChoiceLabel(row.dueOn),
      capital: row.capital,
      lateBase: row.lateBase,
      surcharge: row.surcharge,
      payable: row.payable,
      kind: 'overdue',
    }));
  if (overdue.length) return expandChoicesToCoverBalance(member, overdue, paidOn, paidSet);

  const owed = money(Math.max(0, Number(member?.outstandingBalance) || 0));
  if (owed > 0.01) {
    const day = duesDueDayForMember(member);
    const currentDue = toISODate(duesDateOnDueDay(paidOn.getFullYear(), paidOn.getMonth(), day));
    // Sin nextDue, el saldo abierto es el mes en curso (desde el día 1), no el mes anterior.
    // Un nextDue que todavía no empezó (diciembre en noviembre) tampoco se usa de semilla.
    const hinted = pinDuesDueDate(member.nextDueDate, member)
      || (member?.lastPaymentDate
        ? firstUnpaidDuesDate({
          lastPaymentDate: member.lastPaymentDate,
          nextDueDate: null,
          today: paidOn,
          member,
        })
        : null);
    const seedDue = hinted && duesPeriodMonthStarted(hinted, paidOn) ? hinted : currentDue;
    if (!dueOnAlreadyCovered(seedDue, paidSet)) {
      const seedDate = parseDate(seedDue);
      const seedKind = seedDate && seedDate < paidOn ? 'overdue' : 'upcoming';
      const seed = periodChoiceFromDue(member, seedDue, paidOn, seedKind);
      if (seed) return expandChoicesToCoverBalance(member, [seed], paidOn, paidSet);
    }
    // El mes que todavía no empezó no se cobra: lo genera la liquidación del día 1.
    return expandChoicesToCoverBalance(member, [], paidOn, paidSet);
  }

  const dueOn = pinDuesDueDate(member.nextDueDate, member) || nextDuesDueDate(today, member);
  if (!duesPeriodMonthStarted(dueOn, paidOn)) return [];
  if (dueOnAlreadyCovered(dueOn, paidSet)) return [];
  const upcoming = periodChoiceFromDue(member, dueOn, paidOn, 'upcoming');
  return upcoming ? [upcoming] : [];
}

/**
 * Cuota, recargo y total a cobrar.
 * El 10 % es el de cada mes vencido, por separado: no es un 10 % de todo el saldo
 * y un mes anterior no se anota como recargo del mes que se está cobrando.
 */
export function duesChargeBreakdown(member, {
  paidOn = new Date(),
  dueOn,
  on,
  amount,
  waiveSurcharge = false,
  periodDueOns = null,
} = {}) {
  const when = on || dueOn || paidOn;
  const paid = paidOn || when;
  const selected = Array.isArray(periodDueOns)
    ? new Set(periodDueOns.map((value) => String(value || '').slice(0, 10)).filter(Boolean))
    : null;
  let months = dueOn ? [] : overdueSocialMonths(member, paid);
  if (selected?.size) {
    months = months.filter((row) => selected.has(String(row.dueOn).slice(0, 10)));
  }
  const singleCapital = money(duesAmountForMember(member, when));
  const singlePayable = money(duesPayableForMember(member, { paidOn: paid, dueOn, on: when }));
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
  const rounded = hasStored ? money(stored) : 0;

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
      if (row.capital > 0) surcharge = money(surcharge + (row.surcharge * take) / row.capital);
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
  total = money(total);
  surcharge = money(surcharge);
  capital = money(capital);
  payable = money(payable);
  const quota = Math.max(0, money(total - surcharge));
  // El mostrador nunca manda este flag: canWaiveDuesSurcharge es siempre falso.
  // Si igual llega, registrar_cobro lo rechaza.
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
 * Conteo de mora sin clonar ni ordenar el padrón (badge / resumen).
 */
export function countOverdueMembers(members, today = new Date()) {
  const todayStart = startOfDay(today);
  let count = 0;
  for (const member of members || []) {
    if (!isSocialDuesMora(member, todayStart)) continue;
    if ((Number(socialDuesAmountDue(member, todayStart)) || 0) > 0) count += 1;
  }
  return count;
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
    .filter((m) => (
      isMemberBillingActive(m)
      && !isDuesExemptMember(m)
      && !isFamilyDependent(m)
    ))
    .filter((m) => !isSocialDuesMora(m, todayStart) && !isSocialDuesDueToday(m, todayStart))
    .map((m) => {
      const due = parseDueDate(m.nextDueDate, m);
      if (!due) return null;
      const horizonDays = withinDays == null ? upcomingDuesHorizonDays(todayStart, m) : withinDays;
      const horizon = new Date(todayStart.getTime() + horizonDays * DAY_MS);
      if (due <= todayStart || due > horizon) return null;
      const daysUntil = Math.round((due - todayStart) / DAY_MS);
      const dueIso = toISODate(due);
      const amountDue = duesAmountForMember(m, due);
      if (!(amountDue > 0)) return null;
      return {
        ...m,
        duesStatus: 'upcoming',
        daysUntil,
        dueDate: dueIso,
        amountDue,
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

/**
 * Etiqueta del vencimiento en ficha: “próximo” solo si la fecha aún no pasó.
 * Si next_due quedó en octubre y hoy es noviembre, es cuota vencida / pendiente.
 */
export function memberDueFact(member, today = new Date()) {
  const iso = pinDuesDueDate(member?.nextDueDate, member)
    || String(member?.nextDueDate || '').slice(0, 10)
    || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { label: 'Próximo vencimiento', value: null, hint: null, iso: null, overdue: false };
  }
  const todayIso = today instanceof Date
    ? toISODate(startOfDay(today))
    : String(today).slice(0, 10);
  const owed = Number(member?.outstandingBalance) || 0;
  const value = formatShortDate(iso);
  if (iso < todayIso) {
    return {
      label: owed > 0.01 ? 'Cuota vencida' : 'Vencimiento',
      value,
      hint: owed > 0.01 ? 'Pendiente de cobro' : null,
      iso,
      overdue: true,
    };
  }
  if (iso === todayIso) {
    return { label: 'Vence hoy', value, hint: null, iso, overdue: false };
  }
  return { label: 'Próximo vencimiento', value, hint: null, iso, overdue: false };
}

/** Link de recordatorio de cuota por WhatsApp. Null si no hay teléfono válido. */
export function buildWhatsAppDuesUrl(member, formatCurrency) {
  if (isDuesExemptMember(member) || isFamilyDependent(member)) return null;
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
 * Solo modo local. En la nube el saldo lo calcula la base y esta función no se guarda.
 * Alinea el saldo al capital de meses vencidos.
 * La nube usa liquidación día 1 (suma cuota sobre cuota). Acá igual: solo capital;
 * el 10 % se calcula al cobrar (duesChargeBreakdown), nunca se mete en el saldo.
 * Si ya hay saldo (LILA / liquidación), solo completa hacia arriba si faltaban meses.
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

    const due = parseDueDate(normalized.nextDueDate, normalized);
    if (!due || due >= todayStart) return normalized;

    const tariffFrom = parseDate(DUES_TARIFF_FROM);
    const tierId = String(normalized.tier || '').trim().toLowerCase();
    const official = MONTHLY_DUES_FROM_OCTOBER_2026[tierId];
    const catalogAmount = getTierMonthlyDues(tierId);
    if (tariffFrom && due < tariffFrom && official != null && catalogAmount === official) {
      return normalized;
    }

    const months = overdueSocialMonths(normalized, todayStart);
    if (!months.length) return normalized;

    const capital = money(months.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
    const stored = money(normalized.outstandingBalance);
    const nextBalance = Math.max(stored, capital);

    if (nextBalance === stored) return normalized;

    return {
      ...normalized,
      outstandingBalance: nextBalance,
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
  const outstandingBalance = isDuesExemptMember(member) ? 0 : money(fromHousehold);
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
    unpaidCapital: member.unpaidCapital != null ? 0 : member.unpaidCapital,
    unpaidSurcharges: member.unpaidSurcharges != null ? 0 : member.unpaidSurcharges,
    unpaidInterest: member.unpaidInterest != null ? 0 : member.unpaidInterest,
    unallocatedBalance: member.unallocatedBalance != null ? 0 : member.unallocatedBalance,
    overdueSince: null,
    nextDueDate: toISODate(next),
  };
}

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
import {
  duesMonthLabel,
  isJoinFeeDueOn,
  JOIN_FEE_AMOUNT,
  JOIN_FEE_DUE_ON,
  JOIN_FEE_LABEL,
} from './duesImputations';

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
    exemptLine: 'Vitalicio, fundador y comisión no abonan cuota social: sin mora, sin avisos ni Mercado Pago de cuota. Si tienen abono de tenis, ese abono sí se liquida y se cobra (aparte, sin el 10 %).',
    householdLine: 'En un grupo familiar la cuota es una sola, la del titular. El adherente no tiene cuenta propia. Un abono de tenis de un integrante sí se suma a la cuenta del titular, y se puede cobrar aparte de la cuota social.',
    joinLine: `La cuota de alta es de ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(70000)}. Es un solo cargo al ingresar, no es un mes de cuota social y no lleva el recargo del ${late}. El mes siguiente ya es la cuota social.`,
    groupMoraLine: 'La deuda del titular alcanza al grupo: si debe meses anteriores, el adherente no entra a la sede. En temporada de pileta, desde el día 11 sin la cuota del mes tampoco. Fuera de temporada, si solo debe el mes en curso, sí puede pasar. Pileta sigue la mora del titular.',
    paymentLine: `Un pago cubre el mes en que se hizo: si el último pago fue en agosto, el próximo vencimiento es el ${DUES_DUE_DAY} de septiembre.`,
    deskLine: 'El recargo se cobra siempre. Un administrador puede borrarlo después en la ficha: el importe cobrado queda y el recargo pasa a saldo a favor.',
    creditLine: 'El saldo a favor se descuenta solo en el próximo cobro. Si cubre la cuota, lo que sobra queda para el siguiente.',
    tariffLine: `La tarifa vigente desde ${tariffWhen} y la liquidación de cada mes están en Cuotas; el día de vencimiento se ve en Configuración.`,
    banner: `el ${DUES_DUE_DAY} de cada mes (AMET, el ${DUES_AMET_DUE_DAY})`,
    collectLine: `El recargo del ${late} es el de cada mes vencido, por separado, desde el día siguiente al vencimiento y solo en socio familiar e individual; AMET no lleva.`,
    moraWhen: `El día ${DUES_DUE_DAY} (AMET, el ${DUES_AMET_DUE_DAY}) vence la cuota. Hasta ese día no lleva recargo.`,
    moraAfter: `Desde el día siguiente (el ${moraDay}) es mora en socio familiar e individual, con recargo del ${late}. AMET no entra en mora ni lleva ese recargo.`,
    glossaryAmet: `AMET: categoría que vence el ${DUES_AMET_DUE_DAY}, con la cuota en base menos ${ametCut}; ese ${ametCut} es tarifa. No entra en mora y no lleva el recargo del ${late}.`,
    glossaryMora: `Mora: cuota vencida y sin pagar, desde el día siguiente al vencimiento. Recargo: ${late} de la cuota de cada mes vencido, por separado, solo familiar e individual.`,
    controlMora: `Desde el día siguiente al vencimiento corre el recargo del ${late} (familiar e individual).`,
    gateMora: `ACCESO DENEGADO · DEUDA: si debe meses anteriores de cuota social, no ingresa (todo el año). ACCESO DENEGADO · MORA: en temporada de pileta (dic–mar), desde el día 11 sin la cuota del mes, no ingresa al club ni a pileta. Fuera de temporada, si solo debe el mes en curso —aunque ya venció el ${DUES_DUE_DAY}— sí puede pasar. Un adherente queda igual que su titular.`,
    gateReason: `ACCESO DENEGADO · DEUDA: tiene deuda de meses anteriores. Que regularice en Caja o en Mi Cuenta; cuando se acredita, pasa. ACCESO DENEGADO · MORA: en temporada de pileta, desde el día 11 sin la cuota del mes no entra hasta regularizar. Fuera de temporada, si solo debe el mes en curso (vencido o no), la puerta lo deja entrar.`,
    poolMora: `Un socio en mora (desde el día 11, o con saldo de meses anteriores) no puede pagar pileta hasta regularizar la cuota. La ficha lo dice: Puede pagar pileta / No puede pagar pileta.`,
    inicio: `Vencimiento del mes (${DUES_DUE_DAY}; AMET, ${DUES_AMET_DUE_DAY}), recaudado del mes con su cobrabilidad, caja y alertas vivas.`,
    configDue: `Cuotas: Vence el día (1 al 28; hoy el ${DUES_DUE_DAY}), tolerancia de pago, gracia de la credencial, deuda máxima, cuenta protegida y si los socios ven su cuenta corriente. AMET vence el ${DUES_AMET_DUE_DAY} por regla de la categoría, no por este campo.`,
    configNotices(advanceDays) {
      const upcoming = DUES_DUE_DAY - advanceDays;
      return `Regla de avisos: queda guardada en el libro. Mensaje interno y mail el día ${upcoming} (por vencer), el ${DUES_DUE_DAY} (vence) y el ${moraDay} (mora). Recargo del ${late} desde el ${moraDay} en familiar e individual.`;
    },
    noticesLine(advanceDays) {
      const upcoming = DUES_DUE_DAY - advanceDays;
      const ametUpcoming = DUES_AMET_DUE_DAY - advanceDays;
      return `Avisos reales, uno de cada etapa por socio: desde ${advanceDays} días antes del vencimiento, el día que vence y desde el día siguiente (mora). Para socio familiar e individual eso es desde el ${upcoming}, el ${DUES_DUE_DAY} y desde el ${moraDay}. AMET avisa desde el ${ametUpcoming} y el ${DUES_AMET_DUE_DAY}; no tiene etapa mora. Llegan por mensaje interno y mail. La regla está en Configuración.`;
    },
    poolGate: `Pileta: canon de temporada $90.000/persona (máx. 4 por grupo; menores de 4 libres), invitado del día, apto médico, y desde el día 11 (después del ${DUES_DUE_DAY}) la mora bloquea sede y pileta en temporada dic–mar. Fuera de temporada la sede solo corta deuda de meses anteriores.`,
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

/** Abono tenis en cuotaCategories / tier (add-on; sin 10 % de mora). */
export function isTennisAbonoTierId(id) {
  return String(id || '').trim().toLowerCase() === 'abono_tenis';
}

/** Tiene abono de tenis en la ficha (titular o integrante). */
export function memberHasTennisAbono(member) {
  return billedTierIds(member).some(isTennisAbonoTierId);
}

/**
 * Monto mensual del abono tenis de esta ficha ($ 12.000 en lift / oct).
 * No incluye el tenis de otros del hogar (cada fila del padrón tenis es una persona).
 */
export function duesTennisAbonoAmount(member, on = new Date()) {
  if (!memberHasTennisAbono(member)) return 0;
  return money(
    billedTierIds(member)
      .filter(isTennisAbonoTierId)
      .reduce((sum, id) => sum + duesAmountForTier(id, undefined, on), 0),
  );
}

/**
 * Abono tenis de la cuenta del titular: propio + adherentes.
 * Se puede cobrar aparte de la cuota social (sin 10 %).
 */
export function duesTennisAbonoAmountForAccount(member, on = new Date()) {
  if (!member || isFamilyDependent(member)) return 0;
  let total = duesTennisAbonoAmount(member, on);
  for (const row of activeAdherentsOf(member, on)) {
    total = money(total + duesTennisAbonoAmount(asDiscountPerson(row, member), on));
  }
  return total;
}

/** Línea Lila «interés por transacción 2,5 %» (tarifa AMET, no mora). */
export function isAmetInterestTierId(id) {
  const key = String(id || '').trim().toLowerCase();
  return key.includes('interes_por_transaccion') && key.includes('amet');
}

function ametSocialTierIds(member) {
  const ids = billedTierIds(member).filter((id) => isSocialQuotaTierId(id) && id.includes('amet'));
  if (ids.length) return ids;
  const tier = String(member?.tier || '').trim().toLowerCase();
  return (isSocialQuotaTierId(tier) && tier.includes('amet')) ? [tier] : [];
}

/**
 * Cuota AMET del mes: lo que se cobra = base − 2,5 % (familiar $ 68.250 / individual $ 39.000).
 * La línea Lila «interés 2,5 %» no se cobra: documenta el descuento, no un cargo extra.
 */
export function duesAmetQuotaAmount(member, on = new Date()) {
  if (!isAmetDuesMember(member) || isDuesExemptMember(member) || isFamilyDependent(member)) return 0;
  return money(ametSocialTierIds(member).reduce(
    (sum, id) => sum + duesAmountForTier(id, undefined, on),
    0,
  ));
}

/**
 * Monto del −2,5 % AMET (referencia / catálogo Lila). No se imputa ni se suma al cobro.
 */
export function duesAmetInterestAmount(member, on = new Date()) {
  if (!isAmetDuesMember(member) || isDuesExemptMember(member) || isFamilyDependent(member)) return 0;
  const fromCatalog = money(billedTierIds(member).filter(isAmetInterestTierId).reduce(
    (sum, id) => sum + duesAmountForTier(id, undefined, on),
    0,
  ));
  if (fromCatalog > 0) return fromCatalog;
  // Si no trae la línea Lila, el descuento es el 2,5 % de la base (cuota / 0,975 − cuota).
  const quota = duesAmetQuotaAmount(member, on);
  if (quota <= 0) return 0;
  return money(quota / (1 - DUES_AMET_RATE) - quota);
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
  // Sin ficha: mes en curso (día 1+), no el próximo mes después del 10.
  // nextDuesDueDate salta a diciembre desde el 11 y Consultar deuda inventaba octubre.
  const anchor = asDueAnchor(today);
  return toISODate(duesDateOnDueDay(anchor.getFullYear(), anchor.getMonth(), day));
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
  // ABONO TENIS (y otros add-ons) no cuentan para exención de cuota social.
  const social = pool.filter((id) => !isAddOnDuesTierId(id));
  if (!social.length) return false;
  return social.every((id) => isExemptDuesTierId(id));
}

/** Activo y con categoría que liquida. Vitalicio / fundador / comisión nunca. El adherente no tiene cuenta. */
export function canChargeSocialDues(member) {
  return isMemberBillingActive(member) && isTitularMember(member) && !isDuesExemptMember(member);
}

function duesExemptHeadline(member) {
  const blob = `${String(member?.tier || '')} ${billedTierIds(member).join(' ')}`.toLowerCase();
  const tennis = memberHasTennisAbono(member) || duesTennisAbonoAmountForAccount(member) > 0;
  const hint = tennis
    ? 'No abona cuota social · sí abono tenis'
    : 'No abona cuota social';
  if (/comision/.test(blob)) {
    return { title: 'Comisión', hint };
  }
  if (/fundador/.test(blob)) {
    return { title: 'Fundador', hint };
  }
  return { title: 'Vitalicio', hint };
}

/**
 * Texto de cuota para la ficha.
 * Baja / suspensión / pendiente no son «al día»: no facturan.
 */
export function quotaHeadline(member) {
  const status = String(member?.status || 'active').toLowerCase();
  const balance = socialDuesStoredBalance(member);
  const billing = isMemberBillingActive(member);

  if (isDuesExemptMember(member)) {
    const copy = duesExemptHeadline(member);
    const tennisBalance = Math.max(0, Number(member?.outstandingBalance) || 0);
    if (tennisBalance > 0.01 && (memberHasTennisAbono(member) || duesTennisAbonoAmountForAccount(member) > 0)) {
      return {
        kind: 'debt',
        title: 'Abono tenis',
        hint: `${copy.title} · sin cuota social`,
        billing: true,
      };
    }
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
  // Abono tenis: $ 12.000 también en meses abiertos anteriores a octubre
  // (misma ventana que el lift del familiar). No reabrir a $ 10.000.
  if (id === 'abono_tenis' && october != null && isFamiliarLiftedTariffMonth(when)) {
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

/** Caso particular: la cuenta queda en el capital. No suma el 10 %. El resto del padrón no lo tiene. */
function memberKeepsFlatDuesAccount(member) {
  const flag = member?.duesCapitalOnly ?? member?.meta?.duesCapitalOnly;
  return flag === true || flag === 'true';
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
    if (isAmetInterestTierId(id)) return sum; // −2,5 % AMET: no se cobra como línea aparte
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
 * Saldo de cuota para mora / “cuánto debe” / padrón / Consultar deuda / cobro.
 * Misma cifra en todos lados.
 * - outstanding_balance ≤ 0 (al día o a favor): manda la ficha. No reabrir deuda
 *   con un unpaidCapital LILA viejo después de un cobro.
 * - Si hay saldo en ficha y unpaidCapital LILA, el capital LILA es la verdad
 *   (la columna a veces quedó vieja tras importar débitos).
 */
export function socialDuesStoredBalance(member) {
  const outstanding = money(Number(member?.outstandingBalance) || 0);
  if (outstanding <= 0.01) return 0;
  const lila = lilaUnpaidCapital(member);
  if (lila != null) return Math.max(0, money(lila));
  return Math.max(0, outstanding);
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
  // AMET: sin mora ni recargo del 10 %. Puede deber saldo, pero no entra al listado de mora.
  if (isAmetDuesMember(member)) return false;
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
  if (isJoinFeeDueOn(dueOn)) return amount;
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
export function duesPayableForMember(member, {
  paidOn = new Date(),
  dueOn,
  on,
  rules,
  chargeScope = 'all',
} = {}) {
  if (isFamilyDependent(member)) return 0;
  const when = on || dueOn || paidOn;
  const discountRules = resolveDiscountRules(rules);
  const scope = normalizeDuesChargeScope(chargeScope);
  // Vitalicio / fundador / comisión: sin cuota social; el abono tenis sí se cobra.
  const addOnsOnly = isDuesExemptMember(member);
  if (addOnsOnly && scope === 'social') return 0;
  if (memberKeepsFlatDuesAccount(member) && !addOnsOnly) {
    return duesAmountForMember(member, when, { rules: discountRules, chargeScope: scope });
  }
  const ownIds = billedTierIds(member).filter((id) => {
    if (addOnsOnly || scope === 'addon') return isAddOnDuesTierId(id);
    if (scope === 'social') return !isAddOnDuesTierId(id);
    return true;
  });
  const own = payableForTierIds(member, ownIds, {
    paidOn, dueOn, on: when, rules: discountRules, addOnsOnly: addOnsOnly || scope === 'addon',
  });
  if (scope === 'social') return own;
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
  // AMET: se cobra solo la cuota (base − 2,5 %). La línea «interés» no entra.
  if (isAmetInterestTierId(id)) return;
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

/** all = cuota + abono · social = solo cuota · addon = solo tenis (u otro abono). */
export function normalizeDuesChargeScope(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'social' || raw === 'cuota' || raw === 'quota') return 'social';
  if (raw === 'addon' || raw === 'tenis' || raw === 'abono' || raw === 'abono_tenis') return 'addon';
  return 'all';
}

export function duesChargeScopeLabel(scope) {
  const normalized = normalizeDuesChargeScope(scope);
  if (normalized === 'social') return 'Solo cuota social';
  if (normalized === 'addon') return 'Solo abono tenis';
  return 'Cuota y abono';
}

function sliceMatchesChargeScope(slice, chargeScope) {
  const scope = normalizeDuesChargeScope(chargeScope);
  const id = String(slice?.tierId || '').trim().toLowerCase();
  if (scope === 'social') return !isAddOnDuesTierId(id);
  if (scope === 'addon') return isAddOnDuesTierId(id);
  return true;
}

/** True si el titular tiene cuota social y abono (tenis) en el mismo mes. */
export function memberHasSeparableAddOn(member, on = new Date()) {
  const slices = duesChargeSlicesForMember(member, on, { chargeScope: 'all' });
  const hasSocial = slices.some((row) => !isAddOnDuesTierId(row.tierId));
  const hasAddon = slices.some((row) => isAddOnDuesTierId(row.tierId));
  return hasSocial && hasAddon;
}

/**
 * Una deuda por categoría con importe. Familiar y abono de tenis no se mezclan.
 * El tenis de un adherente entra en la deuda de tenis del titular.
 * `chargeScope`: all | social | addon — permite cobrar cuota y tenis por separado.
 */
export function duesChargeSlicesForMember(member, on = new Date(), options = {}) {
  if (isFamilyDependent(member)) return [];
  const rules = resolveDiscountRules(options?.rules);
  const scope = normalizeDuesChargeScope(options?.chargeScope);
  const addOnsOnly = isDuesExemptMember(member);
  if (addOnsOnly && scope === 'social') return [];
  const slices = new Map();
  const effectiveScope = addOnsOnly ? 'addon' : scope;
  if (effectiveScope !== 'addon') {
    for (const id of billedTierIds(member)) {
      if (effectiveScope === 'social' && isAddOnDuesTierId(id)) continue;
      pushChargeSlice(slices, member, id, on, rules);
    }
  } else {
    for (const id of billedTierIds(member)) {
      if (!isAddOnDuesTierId(id)) continue;
      pushChargeSlice(slices, member, id, on, rules);
    }
  }
  if (effectiveScope !== 'social') {
    for (const row of activeAdherentsOf(member)) {
      const person = asDiscountPerson(row, member);
      for (const id of billedTierIds(person)) {
        if (!isAddOnDuesTierId(id)) continue;
        pushChargeSlice(slices, person, id, on, rules);
      }
    }
  }
  return [...slices.values()]
    .filter((row) => sliceMatchesChargeScope(row, effectiveScope))
    .toSorted((a, b) => a.category.localeCompare(b.category, 'es'));
}

/** Cuota vigente: titular (estatuto + abonos propios) + tenis de adherentes. El grupo no suma cuota social. */
export function duesAmountForMember(member, on = new Date(), options = {}) {
  return money(duesChargeSlicesForMember(member, on, options)
    .reduce((sum, slice) => sum + slice.amount, 0));
}

/** Capital del mes que sí lleva 10 % (familiar e individual). El abono no. */
export function lateBaseForMember(member, on, options = {}) {
  if (memberKeepsFlatDuesAccount(member)) return 0;
  return money(duesChargeSlicesForMember(member, on, options).reduce((sum, slice) => {
    const id = String(slice.tierId || '').trim().toLowerCase();
    if (id && !DUES_LATE_TIER_IDS.has(id)) return sum;
    return sum + (Number(slice.amount) || 0);
  }, 0));
}

/**
 * Meses vencidos y todavía impagos. Cada uno trae su cuota y su propio 10 %.
 * El mes que todavía no venció no entra.
 */
export function overdueSocialMonths(member, paidOn, { chargeScope = 'all' } = {}) {
  const todayStart = startOfDay(paidOn);
  const day = duesDueDayForMember(member);
  const scopeOpts = { chargeScope };
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
    const capital = money(duesAmountForMember(member, cursor, scopeOpts));
    const payable = money(duesPayableForMember(member, {
      paidOn: todayStart,
      dueOn: cursor,
      on: cursor,
      chargeScope,
    }) || 0);
    months.push({
      dueOn: toISODate(cursor),
      capital,
      lateBase: lateBaseForMember(member, cursor, scopeOpts),
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

function tennisSettledIndependently(member, dueOn) {
  const iso = String(dueOn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  for (const payment of member?.paymentHistory || []) {
    if (paymentIsVoided(payment) || !paymentIsTennisAbonoOnly(payment)) continue;
    for (const due of payment?.periodDueOns || []) {
      if (String(due || '').slice(0, 10) === iso) return true;
    }
    for (const row of payment?.imputations || []) {
      if (row?.voidedAt) continue;
      if (String(row?.dueOn || '').slice(0, 10) === iso) return true;
    }
  }
  return false;
}

function periodChoiceFromDue(member, dueOn, paidOn, kind = 'overdue', { chargeScope = 'all' } = {}) {
  const on = parseDate(dueOn) || paidOn;
  const scopeOpts = { chargeScope };
  let capital = money(duesAmountForMember(member, on, scopeOpts));
  if (!(capital > 0)) return null;
  const tennis = duesTennisAbonoAmountForAccount(member, on);
  if (normalizeDuesChargeScope(chargeScope) !== 'addon'
    && tennis > 0.01
    && tennisSettledIndependently(member, dueOn)) {
    capital = money(Math.max(0, capital - tennis));
    if (!(capital > 0.01)) return null;
  }
  const payable = money(duesPayableForMember(member, {
    paidOn,
    dueOn,
    on,
    chargeScope,
  }) || 0);
  let surcharge = Math.max(0, payable - money(duesAmountForMember(member, on, scopeOpts)));
  if (normalizeDuesChargeScope(chargeScope) !== 'addon'
    && tennis > 0.01
    && tennisSettledIndependently(member, dueOn)) {
    surcharge = money(duesPayableAmount(
      lateBaseForMember(member, on, scopeOpts),
      { paidOn, dueOn, tier: member?.tier },
    ) - lateBaseForMember(member, on, scopeOpts));
    if (surcharge < 0) surcharge = 0;
  }
  return {
    id: dueOn,
    dueOn,
    monthKey: String(dueOn).slice(0, 7),
    label: periodChoiceLabel(dueOn),
    capital,
    lateBase: lateBaseForMember(member, on, scopeOpts),
    surcharge,
    payable: money(capital + surcharge),
    kind,
    chargeScope: normalizeDuesChargeScope(chargeScope),
  };
}

/**
 * Cuánto del saldo de ficha consume un mes.
 * Lift 60→70 del familiar: Lila guardó $ 60.000 y el recibo muestra $ 70.000.
 * Si el mes lleva abono (tenis u otro), el capital ya es el de cobro: no restar.
 */
function fichaCostForChoice(row) {
  const cap = Number(row?.capital) || 0;
  if (!(cap > 0)) return 0;
  if (!isFamiliarTariffLiftDueOn(row.dueOn)) return money(cap);
  const lateBase = money(Number(row?.lateBase) || 0);
  const addOns = money(Math.max(0, cap - lateBase));
  // Familiar solo a tarifa liftada: ficha a $ 60.000.
  if (addOns <= 0.01 && lateBase + 0.01 >= 70000) return money(cap - 10000);
  return money(cap);
}

function appendPeriodChoiceCovering(rows, full, fichaRemaining) {
  if (!full) return null;
  const fullCap = Number(full.capital) || 0;
  if (!(fullCap > 0)) return null;
  // Solo meses enteros a tarifa real. Si no alcanza, no inventa un resto (ej. $ 26.000).
  const cost = fichaCostForChoice(full);
  if (fichaRemaining + 0.01 < cost) return null;
  return { ...full };
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

/** Cobro anulado / cancelado: no cuenta para meses cubiertos ni recibos. */
export function paymentIsVoided(payment) {
  return Boolean(
    payment?.status === 'void'
    || payment?.status === 'cancelled'
    || payment?.voidedAt,
  );
}

/** Cobro solo de abono tenis: no salda la cuota social de esos meses. */
export function paymentIsTennisAbonoOnly(payment) {
  const scope = String(payment?.chargeScope || payment?.meta?.chargeScope || '').trim().toLowerCase();
  if (scope === 'abono_tenis' || scope === 'tenis' || scope === 'addon') return true;
  const concept = String(payment?.concept || '').toLowerCase();
  return concept.startsWith('abono tenis');
}

export function memberCoveredDueOns(member, { chargeScope = 'all' } = {}) {
  const scope = normalizeDuesChargeScope(chargeScope);
  const set = new Set();
  const push = (value) => {
    const iso = String(value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) set.add(iso);
  };
  for (const payment of member?.paymentHistory || []) {
    // Cobro anulado: esos meses vuelven a estar disponibles para cobrar.
    if (
      payment?.status === 'void'
      || payment?.status === 'cancelled'
      || payment?.voidedAt
    ) {
      continue;
    }
    const payScope = normalizeDuesChargeScope(
      payment?.chargeScope || payment?.meta?.chargeScope || 'all',
    );
    if (scope === 'addon') {
      // Solo tenis: no cuenta un cobro de «solo cuota».
      if (payScope === 'social') continue;
      const addonDues = payment?.addonPeriodDueOns || payment?.meta?.addonPeriodDueOns;
      if (Array.isArray(addonDues) && addonDues.length) {
        for (const due of addonDues) push(due);
        continue;
      }
      // Cobro completo (o tenis sin lista aparte): los meses del recibo cubren el abono.
      if (payScope === 'all' || payScope === 'addon') {
        for (const due of payment?.periodDueOns || []) push(due);
        for (const row of payment?.imputations || []) {
          if (row?.voidedAt) continue;
          push(row?.dueOn);
        }
      }
      continue;
    }
    if (scope === 'social') {
      // Solo cuota: no cuenta un cobro de «solo tenis».
      if (payScope === 'addon') continue;
      for (const due of payment?.periodDueOns || []) push(due);
      for (const row of payment?.imputations || []) {
        if (row?.voidedAt) continue;
        if (row?.tierId && isAddOnDuesTierId(row.tierId)) continue;
        push(row?.dueOn);
      }
      continue;
    }
    // Vista completa: un cobro solo de tenis no marca la cuota social como paga.
    if (payScope === 'addon' || paymentIsTennisAbonoOnly(payment)) continue;
    for (const due of payment?.periodDueOns || []) push(due);
    for (const due of payment?.addonPeriodDueOns || payment?.meta?.addonPeriodDueOns || []) push(due);
    for (const row of payment?.imputations || []) {
      if (row?.voidedAt) continue;
      push(row?.dueOn);
    }
  }
  const joinDue = joinMonthDueOn(member);
  if (joinDue && set.has(JOIN_FEE_DUE_ON)) set.add(joinDue);
  return set;
}

export function memberJoinMonthKey(member) {
  const join = String(member?.joinDate || member?.meta?.joinDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(join)) return '';
  return join.slice(0, 7);
}

function joinMonthDueOn(member) {
  const key = memberJoinMonthKey(member);
  if (!key) return '';
  const [year, month] = key.split('-').map(Number);
  const day = String(duesDueDayForMember(member)).padStart(2, '0');
  return `${year}-${String(month).padStart(2, '0')}-${day}`;
}

export function isMemberJoinFeeMonth(member, dueOn) {
  const key = memberJoinMonthKey(member);
  const due = String(dueOn || '').slice(0, 7);
  return Boolean(key && due === key);
}

/** El mes de ingreso es la cuota de alta: $ 70.000, sin recargo y sin nombre de mes. */
function rewriteJoinFeeRows(member, rows) {
  if (!member || isDuesExemptMember(member) || isFamilyDependent(member)) return rows || [];
  const joinDue = joinMonthDueOn(member);
  if (!joinDue) return rows || [];
  let seen = false;
  const next = [];
  for (const row of rows || []) {
    const due = String(row?.dueOn || '').slice(0, 10);
    const isAlta = isJoinFeeDueOn(due) || due.slice(0, 7) === joinDue.slice(0, 7);
    if (!isAlta) {
      next.push(row);
      continue;
    }
    if (seen) continue;
    seen = true;
    const capital = money(row.capital);
    next.push({
      ...row,
      id: JOIN_FEE_DUE_ON,
      dueOn: JOIN_FEE_DUE_ON,
      monthKey: 'alta',
      label: JOIN_FEE_LABEL,
      capital,
      lateBase: 0,
      surcharge: 0,
      payable: capital,
      kind: 'alta',
    });
  }
  return next;
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

function expandChoicesToCoverBalance(member, choices, paidOn, coveredDueOns = null, { chargeScope = 'all' } = {}) {
  const owed = capitalOwedForChoices(member);
  if (!(owed > 0.01)) return choices;
  const day = duesDueDayForMember(member);
  const scopeOpts = { chargeScope };
  const paidSet = coveredDueOns || memberCoveredDueOns(member, scopeOpts);
  let rows = [...(choices || [])].filter((row) => !dueOnAlreadyCovered(row.dueOn, paidSet));
  // Semilla: meses enteros a tarifa; el costo de ficha respeta el lift 60→70.
  rows = rows.map((row) => {
    const full = periodChoiceFromDue(member, row.dueOn, paidOn, row.kind || 'overdue', scopeOpts);
    return full || row;
  }).filter((row) => (Number(row.capital) || 0) > 0);
  let fichaUsed = money(rows.reduce((sum, row) => sum + fichaCostForChoice(row), 0));
  let guard = 0;

  // 1) Adelante solo si el mes de esa cuota ya empezó (día 1) y no está pago.
  while (fichaUsed + 0.01 < owed && guard < 24) {
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
    const dueDate = parseDate(nextDue);
    const kind = dueDate && dueDate < paidOn ? 'overdue' : 'upcoming';
    const full = periodChoiceFromDue(member, nextDue, paidOn, kind, scopeOpts);
    const row = appendPeriodChoiceCovering(rows, full, money(owed - fichaUsed));
    if (!row) break;
    rows.push(row);
    fichaUsed = money(fichaUsed + fichaCostForChoice(row));
  }

  // 2) Atrás: meses anteriores si todavía no alcanza el capital de ficha.
  guard = 0;
  while (fichaUsed + 0.01 < owed && guard < 24) {
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
    const full = periodChoiceFromDue(member, prevDue, paidOn, 'overdue', scopeOpts);
    const row = appendPeriodChoiceCovering(rows, full, money(owed - fichaUsed));
    if (!row) break;
    rows.unshift(row);
    fichaUsed = money(fichaUsed + fichaCostForChoice(row));
  }

  const openMonths = rows.filter((row) => (
    Number(row.capital) > 0
    && row.kind !== 'paid'
    && (row.kind === 'overdue' || duesPeriodMonthStarted(row.dueOn, paidOn))
    && !dueOnAlreadyCovered(row.dueOn, paidSet)
  ));
  rows = openMonths.length ? openMonths : rows.filter((row) => Number(row.capital) > 0 && row.kind !== 'paid');

  // De más (semilla overdue más larga que el saldo): sacar meses nuevos enteros.
  fichaUsed = money(rows.reduce((sum, row) => sum + fichaCostForChoice(row), 0));
  if (fichaUsed <= owed + 0.01) return rows;
  const kept = [...rows];
  while (kept.length > 1) {
    const used = money(kept.reduce((sum, row) => sum + fichaCostForChoice(row), 0));
    if (used <= owed + 0.01) break;
    kept.pop();
  }
  return kept.length ? kept : rows;
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
function lumpMonthsAtCurrentCuota(member, paidOn, paidSet, { chargeScope = 'all' } = {}) {
  if (pinDuesDueDate(member?.nextDueDate, member)) return null;
  const balance = money(Math.max(0, Number(member?.outstandingBalance) || 0));
  const lila = lilaUnpaidCapital(member);
  const capital = lila != null && lila > 0.01 && lila <= balance + 0.01 ? money(lila) : balance;
  if (!(capital > 0.01)) return null;
  const monthly = money(duesAmountForMember(member, paidOn, { chargeScope }));
  if (!(monthly > 0)) return null;
  const count = Math.round(capital / monthly);
  if (count < 1 || count > 18) return null;
  const gap = Math.abs(money(capital - count * monthly));
  const allowedGap = money(Math.max(monthly * 0.02, cuotaTariffStep(member, paidOn)));
  if (gap > allowedGap) return null;

  const day = duesDueDayForMember(member);
  const tier = String(member?.tier || '').trim().toLowerCase();
  const flatAccount = memberKeepsFlatDuesAccount(member);
  // Misma regla que el 10 % del recibo: sin categoría también hay recargo.
  const lateBase = flatAccount || (tier && !DUES_LATE_TIER_IDS.has(tier)) ? 0 : monthly;
  let cursor = duesDateOnDueDay(paidOn.getFullYear(), paidOn.getMonth(), day);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const dueOn = toISODate(cursor);
    if (dueOnAlreadyCovered(dueOn, paidSet) || !duesPeriodMonthStarted(dueOn, paidOn)) return null;
    const kind = cursor < paidOn ? 'overdue' : 'upcoming';
    const payable = flatAccount
      ? monthly
      : money(duesPayableAmount(monthly, { paidOn, dueOn, tier: member?.tier }));
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
 * `chargeScope`: all | social | addon — cuota y abono tenis se pueden cobrar aparte.
 */
/**
 * Meses ya guardados de un pago a cuenta. El más viejo puede estar a medias.
 * No se reescribe: si no, agosto y septiembre vuelven a la tarifa llena
 * y el saldo parcial se corre al mes más nuevo.
 */
function choicesFromStoredOpenPeriods(member, paidOn, paidSet, scopeOpts = {}) {
  const raw = member?.duesOpenPeriods;
  if (!Array.isArray(raw) || !raw.length) return null;
  const balance = money(Math.max(0, Number(member?.outstandingBalance) || 0));
  const owed = capitalOwedForChoices(member);
  const stored = [];
  for (const row of raw) {
    const dueOn = String(row?.dueOn || row?.due_on || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) continue;
    if (dueOn <= '1900-01-10' && !isJoinFeeDueOn(dueOn)) continue;
    if (dueOnAlreadyCovered(dueOn, paidSet)) continue;
    const capital = money(row.capital ?? row.capitalOpen ?? row.capital_open);
    if (!(capital > 0)) continue;
    const lateBase = money(row.lateBase ?? row.late_base ?? 0);
    const due = parseDate(dueOn);
    const overdue = Boolean(due && due < paidOn);
    const surcharge = overdue ? money(lateBase * 0.1) : 0;
    stored.push({
      id: dueOn,
      dueOn,
      monthKey: dueOn.slice(0, 7),
      label: periodChoiceLabel(dueOn),
      capital,
      lateBase,
      surcharge,
      payable: money(capital + surcharge),
      kind: overdue ? 'overdue' : 'upcoming',
      chargeScope: normalizeDuesChargeScope(scopeOpts.chargeScope),
    });
  }
  if (!stored.length) return null;
  stored.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  let rows = stored;
  let covered = money(rows.reduce((sum, row) => sum + row.capital, 0));
  if (balance + 0.01 < covered && owed + 0.01 < covered) return null;
  const target = money(Math.max(owed, balance));
  if (covered + 0.01 < target) {
    const day = duesDueDayForMember(member);
    let guard = 0;
    while (covered + 0.01 < target && guard < 6) {
      guard += 1;
      const last = parseDate(rows[rows.length - 1].dueOn);
      if (!last) break;
      const nextDue = toISODate(duesDateOnDueDay(last.getFullYear(), last.getMonth() + 1, day));
      if (rows.some((row) => row.dueOn === nextDue)) break;
      if (!duesPeriodMonthStarted(nextDue, paidOn) || dueOnAlreadyCovered(nextDue, paidSet)) break;
      const nextDate = parseDate(nextDue);
      const full = periodChoiceFromDue(
        member,
        nextDue,
        paidOn,
        nextDate && nextDate < paidOn ? 'overdue' : 'upcoming',
        scopeOpts,
      );
      const gap = money(target - covered);
      if (!full || full.capital > gap + 0.01) break;
      rows = [...rows, full];
      covered = money(covered + full.capital);
    }
  }
  if (Math.abs(covered - owed) <= 0.01 || Math.abs(covered - balance) <= 0.01) return rows;
  if (covered + 0.01 >= owed && covered <= target + 0.01) return rows;
  return null;
}

export function memberCoveredTennisDueOns(member) {
  const set = new Set();
  const push = (value) => {
    const iso = String(value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) set.add(iso);
  };
  for (const payment of member?.paymentHistory || []) {
    if (paymentIsVoided(payment)) continue;
    for (const due of payment?.periodDueOns || []) push(due);
    for (const row of payment?.imputations || []) {
      if (row?.voidedAt) continue;
      push(row?.dueOn);
    }
  }
  return set;
}

export function collectionTennisPeriodChoices(member, today = new Date(), {
  monthlyAmount = null,
} = {}) {
  if (!member || isFamilyDependent(member)) return [];
  const paidOn = startOfDay(today);
  const monthly = money(
    monthlyAmount != null && monthlyAmount !== ''
      ? Number(monthlyAmount) || 0
      : duesTennisAbonoAmountForAccount(member, paidOn),
  );
  if (!(monthly > 0.01)) return [];
  const covered = memberCoveredTennisDueOns(member);
  const toRow = (dueOn, kind) => ({
    id: dueOn,
    dueOn,
    monthKey: String(dueOn).slice(0, 7),
    label: periodChoiceLabel(dueOn),
    capital: monthly,
    lateBase: 0,
    surcharge: 0,
    payable: monthly,
    kind,
    chargeScope: 'abono_tenis',
  });

  // Misma ventana de meses abiertos que la cuota, pero solo el capital de tenis.
  if (!isDuesExemptMember(member)) {
    const social = collectionPeriodChoices(member, today)
      .filter((row) => (Number(row.capital) || 0) > 0 && !dueOnAlreadyCovered(row.dueOn, covered));
    if (social.length) {
      return social.map((row) => toRow(row.dueOn, row.kind || 'overdue'));
    }
  }

  const day = duesDueDayForMember(member);
  const currentDue = toISODate(duesDateOnDueDay(paidOn.getFullYear(), paidOn.getMonth(), day));
  if (!duesPeriodMonthStarted(currentDue, paidOn)) return [];
  if (dueOnAlreadyCovered(currentDue, covered)) return [];
  const dueDate = parseDate(currentDue);
  const kind = dueDate && dueDate < paidOn ? 'overdue' : 'upcoming';
  return [toRow(currentDue, kind)];
}

export function collectionTennisPreview(member, today = new Date(), {
  periodDueOns = null,
  monthlyAmount = null,
} = {}) {
  const choices = collectionTennisPeriodChoices(member, today, { monthlyAmount });
  const selected = Array.isArray(periodDueOns) && periodDueOns.length
    ? periodDueOns.map((value) => String(value || '').slice(0, 10)).filter(Boolean)
    : choices.map((row) => row.dueOn);
  const selectedChoices = choices.filter((row) => selected.includes(String(row.dueOn).slice(0, 10)));
  const quota = money(selectedChoices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
  return {
    quota,
    surcharge: 0,
    gross: quota,
    creditApplied: 0,
    cash: quota,
    leftover: 0,
    periods: selectedChoices,
    choices,
    clear: selectedChoices.length === 0,
    skipSurcharge: true,
    chargeScope: 'abono_tenis',
  };
}

export function collectionPeriodChoices(member, today = new Date(), { chargeScope = 'all' } = {}) {
  if (!member || isDuesExemptMember(member) || isFamilyDependent(member)) return [];
  const paidOn = startOfDay(today);
  const scopeOpts = { chargeScope };
  const paidSet = memberCoveredDueOns(member, scopeOpts);
  const storedChoices = choicesFromStoredOpenPeriods(member, paidOn, paidSet, scopeOpts);
  if (storedChoices) return rewriteJoinFeeRows(member, storedChoices);
  // Sin vencimiento, el saldo son N cuotas vigentes. No se abre agosto con el recargo.
  if (!pinDuesDueDate(member?.nextDueDate, member)) {
    const lump = lumpMonthsAtCurrentCuota(member, paidOn, paidSet, scopeOpts);
    if (lump) return rewriteJoinFeeRows(member, lump);
  }
  const overdue = overdueSocialMonths(member, paidOn, scopeOpts)
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
      chargeScope: normalizeDuesChargeScope(chargeScope),
    }));
  if (overdue.length) {
    return rewriteJoinFeeRows(
      member,
      expandChoicesToCoverBalance(member, overdue, paidOn, paidSet, scopeOpts),
    );
  }

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
      const seed = periodChoiceFromDue(member, seedDue, paidOn, seedKind, scopeOpts);
      if (seed) {
        return rewriteJoinFeeRows(
          member,
          expandChoicesToCoverBalance(member, [seed], paidOn, paidSet, scopeOpts),
        );
      }
    }
    // El mes que todavía no empezó no se cobra: lo genera la liquidación del día 1.
    return rewriteJoinFeeRows(
      member,
      expandChoicesToCoverBalance(member, [], paidOn, paidSet, scopeOpts),
    );
  }

  const dueOn = pinDuesDueDate(member.nextDueDate, member) || nextDuesDueDate(today, member);
  if (!duesPeriodMonthStarted(dueOn, paidOn)) return [];
  if (dueOnAlreadyCovered(dueOn, paidSet)) return [];
  const upcoming = periodChoiceFromDue(member, dueOn, paidOn, 'upcoming', scopeOpts);
  return rewriteJoinFeeRows(member, upcoming ? [upcoming] : []);
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
 * Cuota de alta: $ 70.000, una sola vez, sin recargo y sin nombre de mes.
 * Reemplaza la cuota social del mes de ingreso. El mes siguiente ya es cuota social.
 * Exentos: solo el abono de tenis, si lo tienen.
 */
export function duesOnJoin(member, joinDate = new Date()) {
  const join = asDueAnchor(joinDate);
  const exempt = isDuesExemptMember(member);
  const tennis = money(duesTennisAbonoAmountForAccount(member, join));
  const alta = exempt ? 0 : JOIN_FEE_AMOUNT;
  const outstandingBalance = money(alta + tennis);
  const day = duesDueDayForMember(member);
  const nextDueDate = toISODate(duesDateOnDueDay(join.getFullYear(), join.getMonth() + 1, day));
  const duesOpenPeriods = alta > 0
    ? [{ dueOn: JOIN_FEE_DUE_ON, capital: alta, lateBase: 0, kind: 'alta' }]
    : undefined;
  return {
    outstandingBalance,
    nextDueDate,
    ...(duesOpenPeriods ? { duesOpenPeriods } : {}),
  };
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

/**
 * Anticipos y saldos a favor — una sola imputación válida por peso.
 *
 * Reglas:
 * 1. Un adelanto imputado a un período futuro NO genera crédito libre por ese monto.
 * 2. Solo el excedente real (menor a una cuota entera) queda como saldo a favor.
 * 3. Un descuento administrativo no es dinero ingresado: no puede crear crédito.
 * 4. El abono tenis ($12.000) no entra en la base de anticipo ni en el 10 % social.
 * 5. El anticipo de un mes futuro es capital de cuota (sin 10 % de mora).
 * 6. La tarifa futura es el tarifario efectivo (categoría / convenio / AMET),
 *    nunca el capital histórico del último período.
 */

import {
  duesAmountForMember,
  duesDueDayForMember,
  isDuesExemptMember,
  lateBaseForMember,
} from './dues.js';
import { isFamilyDependent } from './households.js';

export const ADVANCE_LOOP_LIMIT = 24;
export const TENNIS_ABONO_AMOUNT = 12000;

/** Únicas categorías con cuota social oficial (oct-2026). */
export const OFFICIAL_SOCIAL_ADVANCE_TIERS = Object.freeze({
  socio_familiar: 70000,
  socio_individual: 40000,
  socio_familiar_amet: 68250,
  socio_individual_amet: 39000,
});

export class SocialTariffError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SocialTariffError';
  }
}

export function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function officialSocialAdvanceTier(member) {
  const tier = String(member?.tier || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(OFFICIAL_SOCIAL_ADVANCE_TIERS, tier) ? tier : '';
}

function metaNumeric(meta, key) {
  if (!meta || typeof meta !== 'object') return null;
  const raw = meta[key];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0.01) return null;
  return money(n);
}

/**
 * Tarifa social efectiva del socio (convenios / AMET / exentos).
 * Nunca mezcla abono tenis. Nunca usa capital histórico de períodos.
 */
export function effectiveSocialAdvanceTariff(member, on = new Date()) {
  if (!member || isDuesExemptMember(member) || isFamilyDependent(member)) return 0;
  const tier = officialSocialAdvanceTier(member);
  if (!tier) return 0;
  const meta = member.meta && typeof member.meta === 'object' ? member.meta : {};
  for (const key of ['duesAmount', 'monthlyDues', 'socialQuota']) {
    const fromMember = metaNumeric(member, key);
    if (fromMember != null) return fromMember;
    const fromMeta = metaNumeric(meta, key);
    if (fromMeta != null) return fromMeta;
  }
  const catalog = OFFICIAL_SOCIAL_ADVANCE_TIERS[tier];
  const fromSlices = money(duesAmountForMember(member, on, { chargeScope: 'social' }));
  return fromSlices > 0.01 ? fromSlices : catalog;
}

/** El 10 % social no incluye tenis. */
export function socialLateBaseExcludesTennis(member, on = new Date()) {
  const late = money(lateBaseForMember(member, on, { chargeScope: 'social' }));
  const tennis = money(duesAmountForMember(member, on, { chargeScope: 'addon' }));
  return {
    lateBase: late,
    tennisAbono: tennis,
    includesTennis: late + 0.01 >= TENNIS_ABONO_AMOUNT && tennis > 0.01
      ? Math.abs(late - (effectiveSocialAdvanceTariff(member, on) + tennis)) <= 0.02
      : false,
  };
}

/** @deprecated Preferí effectiveSocialAdvanceTariff(member). */
export function socialTariffForTier(tier = '', member = null) {
  if (member) return effectiveSocialAdvanceTariff({ ...member, tier: member.tier || tier });
  return effectiveSocialAdvanceTariff({ tier });
}

export function nextDueOnAfter(dueOn, member = null) {
  const iso = String(dueOn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m] = iso.split('-').map(Number);
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const dueDay = Math.min(28, Math.max(1, Number(duesDueDayForMember(member || {})) || 10));
  return `${next.y}-${String(next.m).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
}

export function isValidDueOn(value) {
  const iso = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const day = Number(iso.slice(8, 10));
  return day >= 1 && day <= 28 && iso > '1900-01-10';
}

/** Capital ya imputado (cobro o adelanto) a un dueOn, sin anulados. */
export function imputedCapitalForDue(imputations = [], dueOn) {
  const target = String(dueOn || '').slice(0, 10);
  let sum = 0;
  for (const row of imputations || []) {
    if (row?.voidedAt) continue;
    if (String(row?.dueOn || row?.due_on || '').slice(0, 10) !== target) continue;
    const kind = String(row?.kind || 'cobro').toLowerCase();
    if (kind !== 'cobro' && kind !== 'adelanto') continue;
    sum = money(sum + (Number(row?.capital) || 0));
  }
  return sum;
}

/**
 * Reparte el sobrante de caja tras cubrir deudas abiertas.
 * Solo cuotas enteras → adelanto (surcharge 0). Residual → crédito libre.
 */
export function allocateAdvanceCash({
  cash = 0,
  tariff = 0,
  startDueOn = '',
  existingImputations = [],
  discount = 0,
  paidAmount = null,
  capitalPaid = 0,
  surchargePaid = 0,
  member = null,
  loopLimit = ADVANCE_LOOP_LIMIT,
} = {}) {
  let left = money(cash);
  const disc = money(Math.max(0, discount));
  if (disc > 0.01 && paidAmount != null) {
    const realLeft = money(Math.max(
      0,
      money(paidAmount) - money(capitalPaid) - money(Math.max(0, money(surchargePaid) - disc)),
    ));
    left = money(Math.min(left, realLeft));
  }

  if (
    member
    && left > 0.01
    && !isDuesExemptMember(member)
    && !isFamilyDependent(member)
    && !officialSocialAdvanceTier(member)
  ) {
    throw new SocialTariffError(
      `Sin tarifa social oficial para anticipar (categoría ${member.tier || 'inválida'}). No se genera anticipo.`,
    );
  }

  const advances = [];
  let dueOn = String(startDueOn || '').slice(0, 10);
  const rate = money(
    Number(tariff) > 0.01
      ? tariff
      : (member ? effectiveSocialAdvanceTariff(member, dueOn || undefined) : 0),
  );
  let guard = 0;
  const maxLoops = Math.max(1, Math.min(36, Number(loopLimit) || ADVANCE_LOOP_LIMIT));

  while (rate > 0.01 && left + 0.01 >= rate && guard < maxLoops) {
    guard += 1;
    if (!isValidDueOn(dueOn)) break;

    const already = imputedCapitalForDue(
      [...(existingImputations || []), ...advances],
      dueOn,
    );
    if (already + 0.01 >= rate) {
      dueOn = nextDueOnAfter(dueOn, member);
      continue;
    }

    const need = money(rate - already);
    if (left + 0.01 < need) break;

    advances.push({
      dueOn,
      capital: need,
      surcharge: 0,
      kind: 'adelanto',
    });
    left = money(left - need);
    dueOn = nextDueOnAfter(dueOn, member);
  }

  return {
    advances,
    freeCredit: money(Math.max(0, left)),
    lastAdvanceDueOn: advances.length ? advances[advances.length - 1].dueOn : null,
    loops: guard,
  };
}

/**
 * Crédito libre canónico y conciliable.
 *
 * Fuente de verdad:
 * 1) `outstanding_balance` negativo (ficha / libro).
 * 2) `creditBalance` vivo en el objeto socio (acarreo post-liquidación).
 *
 * `meta.creditBalance` solo se usa si no hay campo vivo y no está marcado
 * como consumido. Nunca reutiliza un crédito ya aplicado.
 */
export function freeCreditFromStanding({
  outstandingBalance = 0,
  explicitCredit = null,
  metaCredit = null,
  creditConsumed = false,
  hasLiveCreditField = false,
} = {}) {
  const stored = money(Number(outstandingBalance) || 0);
  if (stored < -0.01) return money(-stored);
  if (creditConsumed) return 0;

  if (hasLiveCreditField) {
    return money(Math.max(0, Number(explicitCredit) || 0));
  }
  if (explicitCredit != null && explicitCredit !== '') {
    return money(Math.max(0, Number(explicitCredit) || 0));
  }
  if (metaCredit != null && metaCredit !== '') {
    return money(Math.max(0, Number(metaCredit) || 0));
  }
  return 0;
}

/** Invariantes de un socio reconciliado (fixtures de regresión). */
export function assertAdvanceCreditInvariants(snapshot = {}) {
  const errors = [];
  const member = { tier: snapshot.tier, ...snapshot.member };
  const tariff = snapshot.tariff != null
    ? money(snapshot.tariff)
    : effectiveSocialAdvanceTariff(member);
  const imputations = snapshot.imputations || [];
  const entries = snapshot.entries || [];
  const outstanding = money(Number(snapshot.outstandingBalance) || 0);
  const book = money((entries || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0));

  if (entries.length && Math.abs(outstanding - book) > 0.02) {
    errors.push(`ficha ${outstanding} ≠ libro ${book}`);
  }

  const adelantoImps = imputations.filter((row) => (
    !row?.voidedAt && String(row?.kind || '').toLowerCase() === 'adelanto'
  ));
  for (const imp of adelantoImps) {
    if (money(Number(imp.surcharge) || 0) > 0.01) {
      errors.push(`adelanto ${imp.dueOn || imp.due_on} no debe llevar recargo`);
    }
    const cap = money(Number(imp.capital) || 0);
    if (tariff > 0.01 && Math.abs(cap - tariff) > 0.02 && cap + 0.01 >= TENNIS_ABONO_AMOUNT) {
      if (Math.abs(cap - (tariff + TENNIS_ABONO_AMOUNT)) <= 0.02) {
        errors.push(`adelanto ${imp.dueOn || imp.due_on} mezcla tenis con capital social`);
      }
    }
  }

  const adelantoEntries = entries.filter((row) => (
    String(row?.kind || '').toLowerCase() === 'adelanto'
    && money(Number(row.amount) || 0) < -0.01
  ));

  for (const imp of adelantoImps) {
    const due = String(imp.dueOn || imp.due_on || '').slice(0, 10);
    const paymentId = imp.paymentId || imp.payment_id;
    if (!paymentId) continue;
    const twin = adelantoEntries.find((row) => (
      String(row.source || '').includes(String(paymentId))
    ));
    if (!twin) continue;
    const twinAbs = money(Math.abs(Number(twin.amount) || 0));
    const reversed = (entries || []).some((row) => (
      String(row.kind || '').toLowerCase() === 'ajuste_administrativo'
      && String(row.source || '').includes(String(paymentId))
      && Math.abs(money(Number(row.amount) || 0) - twinAbs) <= 0.02
    ));
    if (!reversed) {
      errors.push(`doble crédito: adelanto ${due} también en libro sin ajuste`);
    }
  }

  if (outstanding < -0.01 && tariff > 0 && money(-outstanding) + 0.01 >= tariff) {
    const hasFutureAdvance = adelantoImps.some((row) => money(Number(row.capital) || 0) > 0.01);
    if (!hasFutureAdvance) {
      errors.push(`crédito libre ${-outstanding} ≥ tarifa ${tariff} sin imputación de adelanto`);
    }
  }

  return { ok: errors.length === 0, errors };
}

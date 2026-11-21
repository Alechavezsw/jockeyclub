/**
 * Financiación POS / tarjeta en cuotas — separada de la cuota social y de la mora.
 * Modalidad A (club_keeps): el club percibe el adicional.
 * Modalidad B (issuer_keeps): el emisor retiene el interés; solo se asienta el capital social.
 */

import {
  FINANCING_MODE_CLUB,
  FINANCING_MODE_ISSUER,
  normalizePaymentPlan,
  paymentPlanSnapshot,
} from '../system/paymentPlans';

export const POS_FINANCING_INCOME_ACCOUNT = 'Ingresos por financiación tarjetas';
export const POS_CARD_RECEIVABLE_ACCOUNT = 'Tarjetas a cobrar';
export const POS_DUES_INCOME_ACCOUNT = 'Cuotas Sociales';

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function isPosFinancingUnsupported(kind) {
  const key = String(kind || '').trim().toLowerCase();
  return ['chargeback', 'settlement', 'acquirer_settlement', 'pos_rejection_after_post'].includes(key);
}

/** Bloquea operaciones de conciliación/chargeback aún no implementadas. */
export function assertPosFinancingOperationSupported(kind) {
  if (isPosFinancingUnsupported(kind)) {
    const err = new Error(
      `Operación POS «${kind}» no soportada en este módulo: no se acredita ni se revierte. Usá el flujo de conciliación cuando esté disponible.`,
    );
    err.code = 'POS_FINANCING_UNSUPPORTED';
    err.unsupported = true;
    throw err;
  }
}

/**
 * Modelo de liquidación neta / chargeback (Paso futuro).
 * Siempre unsupported en este núcleo: no acreditar ni revertir a medias.
 */
export function buildPosSettlementStub({ kind = 'settlement', payment = null } = {}) {
  assertPosFinancingOperationSupported(kind);
  return {
    unsupported: true,
    kind,
    paymentId: payment?.id || null,
  };
}

/**
 * Texto portal / ficha: precio contado vs financiado sin inventar CFT bancario.
 * El estado social sigue el capital imputado (`amount` / ficha), no el cupón.
 */
export function posFinancingPortalSummary(payment) {
  const fin = payment?.cardFinancing;
  if (!fin || !(Number(fin.financingAmount) > 0.009)) return null;
  const cashPrice = Number(fin.baseAmount != null ? fin.baseAmount : payment?.amount) || 0;
  const financed = Number(fin.voucherTotal != null ? fin.voucherTotal : cashPrice + Number(fin.financingAmount)) || 0;
  return {
    cashPrice,
    financedTotal: financed,
    financingAmount: Number(fin.financingAmount) || 0,
    installments: Number(fin.installments) || 1,
    mode: fin.mode === 'club_keeps' ? 'club_keeps' : 'issuer_keeps',
    planLabel: fin.planLabel || payment?.paymentPlanLabel || null,
    // No CFT: solo desglose del plan/cupón registrado.
    cft: null,
  };
}

/**
 * Calcula financiación sobre el capital social cobrado por POS (sin mora).
 * 1 cuota → financiación 0. No inventa CFT bancario.
 */
export function computePosFinancing({
  socialAmount,
  plan,
  percent = null,
  fixedAmount = null,
  voucherAmount = null,
} = {}) {
  const base = money(socialAmount);
  const normalized = plan ? normalizePaymentPlan(plan) : null;
  const installments = Math.max(1, Number(normalized?.installments) || 1);
  const mode = normalized?.financingMode === FINANCING_MODE_CLUB
    ? FINANCING_MODE_CLUB
    : FINANCING_MODE_ISSUER;

  let financingAmount = 0;
  let appliedPercent = null;
  let appliedFixed = null;

  if (installments <= 1) {
    financingAmount = 0;
  } else if (fixedAmount != null && fixedAmount !== '' && Number.isFinite(Number(fixedAmount))) {
    appliedFixed = money(fixedAmount);
    financingAmount = Math.max(0, appliedFixed);
  } else if (percent != null && percent !== '' && Number.isFinite(Number(percent))) {
    appliedPercent = money(percent);
    financingAmount = money(base * (appliedPercent / 100));
  } else if (normalized?.financingFixed != null) {
    appliedFixed = money(normalized.financingFixed);
    financingAmount = Math.max(0, appliedFixed);
  } else if (normalized?.financingPercent != null) {
    appliedPercent = money(normalized.financingPercent);
    financingAmount = money(base * (appliedPercent / 100));
  } else if (voucherAmount != null && Number(voucherAmount) > base + 0.009) {
    financingAmount = money(Number(voucherAmount) - base);
  }

  const voucherTotal = money(base + financingAmount);
  const installmentAmount = installments > 0 ? money(voucherTotal / installments) : voucherTotal;
  // Ajuste de centavos: las cuotas deben sumar exactamente el voucher.
  const installmentAmounts = [];
  let allocated = 0;
  for (let i = 0; i < installments; i += 1) {
    if (i === installments - 1) {
      installmentAmounts.push(money(voucherTotal - allocated));
    } else {
      installmentAmounts.push(installmentAmount);
      allocated = money(allocated + installmentAmount);
    }
  }

  return {
    base,
    financingAmount,
    voucherTotal,
    installmentAmount,
    installmentAmounts,
    installments,
    mode,
    percent: appliedPercent,
    fixedAmount: appliedFixed,
    acquirer: normalized?.acquirer || normalized?.cardBrand || null,
    planId: normalized?.id || null,
    planLabel: normalized?.label || null,
    cardBrand: normalized?.cardBrand || null,
  };
}

/** Meta persistible vinculada al pago / tramo POS. */
export function buildCardFinancingMeta(computed, extras = {}) {
  if (!computed) return null;
  return {
    mode: computed.mode,
    percent: computed.percent,
    fixedAmount: computed.fixedAmount,
    baseAmount: computed.base,
    financingAmount: computed.financingAmount,
    voucherTotal: computed.voucherTotal,
    installments: computed.installments,
    installmentAmounts: computed.installmentAmounts,
    acquirer: computed.acquirer,
    cardBrand: computed.cardBrand,
    planId: computed.planId,
    planLabel: computed.planLabel,
    authReference: extras.authReference || null,
    operatorUserId: extras.operatorUserId || null,
    paymentPlanSnapshot: extras.paymentPlanSnapshot || (computed.planId
      ? paymentPlanSnapshot({
        id: computed.planId,
        label: computed.planLabel,
        cardBrand: computed.cardBrand,
        installments: computed.installments,
        acquirer: computed.acquirer,
        financingMode: computed.mode,
        financingPercent: computed.percent,
        financingFixed: computed.fixedAmount,
      })
      : null),
  };
}

/**
 * Líneas de asiento para el tramo/cobro POS.
 * socialIncome = capital + mora social imputados (sin financiación).
 * financingAmount = adicional del cupón.
 */
export function buildPosJournalLines({
  socialIncome,
  financingAmount = 0,
  mode = FINANCING_MODE_ISSUER,
  cardAccount = POS_CARD_RECEIVABLE_ACCOUNT,
  duesAccount = POS_DUES_INCOME_ACCOUNT,
  financingAccount = POS_FINANCING_INCOME_ACCOUNT,
} = {}) {
  const social = money(socialIncome);
  const financing = money(financingAmount);
  const resolvedMode = mode === FINANCING_MODE_CLUB ? FINANCING_MODE_CLUB : FINANCING_MODE_ISSUER;

  if (resolvedMode === FINANCING_MODE_CLUB && financing > 0.009) {
    const voucher = money(social + financing);
    return {
      mode: resolvedMode,
      lines: [
        { account: cardAccount, type: 'debit', amount: voucher },
        { account: duesAccount, type: 'credit', amount: social },
        { account: financingAccount, type: 'credit', amount: financing },
      ],
      debitTotal: voucher,
      creditTotal: voucher,
    };
  }

  // Modo B: el club solo asienta lo social; el cupón queda en meta/recibo.
  return {
    mode: resolvedMode,
    lines: social > 0.009
      ? [
        { account: cardAccount, type: 'debit', amount: social },
        { account: duesAccount, type: 'credit', amount: social },
      ]
      : [],
    debitTotal: social,
    creditTotal: social,
  };
}

/** Cupón efectivo a mostrar / persistir. */
export function resolvePosVoucherAmount(socialAmount, cardFinancing, fallbackVoucher = null) {
  if (cardFinancing?.voucherTotal != null && Number(cardFinancing.voucherTotal) > 0) {
    return money(cardFinancing.voucherTotal);
  }
  const social = money(socialAmount);
  const financing = money(cardFinancing?.financingAmount);
  if (financing > 0.009) return money(social + financing);
  const raw = Number(fallbackVoucher);
  if (Number.isFinite(raw) && raw > social + 0.009) return money(raw);
  return social > 0.009 ? social : null;
}

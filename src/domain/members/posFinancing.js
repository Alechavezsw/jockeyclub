/**
 * Financiación POS / tarjeta en cuotas — separada de la cuota social y de la mora.
 * Modalidad A (club_keeps): el club percibe el adicional.
 * Modalidad B (issuer_keeps): el emisor retiene el interés; solo se asienta el capital social.
 *
 * Autoridad: el plan autorizado (vigencia/modalidad/tasa) se resuelve en servidor.
 * El navegador no puede imponer financingMode / financingAmount / voucherTotal.
 */

import {
  FINANCING_MODE_CLUB,
  FINANCING_MODE_ISSUER,
  canEditPaymentPlanFinancing,
  findPaymentPlan,
  normalizePaymentPlan,
  paymentPlanIsValidOn,
  paymentPlanSnapshot,
} from '../system/paymentPlans';

export const POS_FINANCING_INCOME_ACCOUNT = 'Ingresos por financiación tarjetas';
export const POS_CARD_RECEIVABLE_ACCOUNT = 'Tarjetas a cobrar';
export const POS_DUES_INCOME_ACCOUNT = 'Cuotas Sociales';
export const POS_DISCOUNT_ACCOUNT = 'Descuentos sobre cuotas';

/** Tolerancia de centavos para cupón vs cálculo. */
export const POS_VOUCHER_TOLERANCE = 0.01;

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function finiteOrThrow(value, label) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const err = new Error(`${label} inválido.`);
    err.code = 'POS_FINANCING_INVALID';
    throw err;
  }
  return n;
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
    cft: null,
  };
}

/**
 * Calcula financiación sobre la base de capital (sin mora, sin descuento).
 * 1 cuota → financiación 0.
 * NO interpreta automáticamente la diferencia del comprobante como interés (B2).
 * B10: la tasa nunca se aplica sobre mora u otros cargos.
 *
 * @param {number} [financingBase] capital financiable (preferido)
 * @param {number} [socialAmount] alias legacy de financingBase
 * @param {number} [surchargeAmount] mora social (suma al cupón, no se financia)
 */
export function computePosFinancing({
  socialAmount,
  financingBase = null,
  surchargeAmount = 0,
  plan,
  percent = null,
  fixedAmount = null,
} = {}) {
  const base = money(financingBase != null ? financingBase : socialAmount);
  const surcharge = money(surchargeAmount);
  if (!(base >= 0) || !Number.isFinite(base)) {
    const err = new Error('Importe social POS inválido.');
    err.code = 'POS_FINANCING_INVALID';
    throw err;
  }
  if (surcharge < 0 || !Number.isFinite(surcharge)) {
    const err = new Error('Mora social inválida para el cupón POS.');
    err.code = 'POS_FINANCING_INVALID';
    throw err;
  }
  const normalized = plan ? normalizePaymentPlan(plan) : null;
  const installments = Math.max(1, Number(normalized?.installments) || 1);
  const mode = normalized?.financingMode === FINANCING_MODE_CLUB
    ? FINANCING_MODE_CLUB
    : FINANCING_MODE_ISSUER;

  let financingAmount = 0;
  let appliedPercent = null;
  let appliedFixed = null;

  const fixedRaw = finiteOrThrow(fixedAmount, 'Importe fijo de financiación');
  const percentRaw = finiteOrThrow(percent, 'Porcentaje de financiación');

  if (fixedRaw != null && fixedRaw < 0) {
    const err = new Error('El importe fijo de financiación no puede ser negativo.');
    err.code = 'POS_FINANCING_INVALID';
    throw err;
  }
  if (percentRaw != null && percentRaw < 0) {
    const err = new Error('El porcentaje de financiación no puede ser negativo.');
    err.code = 'POS_FINANCING_INVALID';
    throw err;
  }
  if (percentRaw != null && percentRaw > 100) {
    const err = new Error('El porcentaje de financiación no puede superar 100 %.');
    err.code = 'POS_FINANCING_INVALID';
    throw err;
  }

  if (installments <= 1) {
    financingAmount = 0;
  } else if (fixedRaw != null) {
    appliedFixed = money(fixedRaw);
    financingAmount = Math.max(0, appliedFixed);
  } else if (percentRaw != null) {
    appliedPercent = money(percentRaw);
    financingAmount = money(base * (appliedPercent / 100));
  } else if (normalized?.financingFixed != null) {
    appliedFixed = money(normalized.financingFixed);
    financingAmount = Math.max(0, appliedFixed);
  } else if (normalized?.financingPercent != null) {
    appliedPercent = money(normalized.financingPercent);
    financingAmount = money(base * (appliedPercent / 100));
  }

  // Cupón = capital financiable + financiación + mora (la mora no genera interés POS).
  const voucherTotal = money(base + financingAmount + surcharge);
  const installmentAmount = installments > 0 ? money(voucherTotal / installments) : voucherTotal;
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
    financingBase: base,
    surchargeAmount: surcharge,
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

/**
 * Si hay cupón declarado en el comprobante, debe coincidir con el total calculado.
 * Conserva ambos valores en el error para auditoría; no sobrescribe el real.
 */
export function assertPosVoucherMatchesComputed({
  receiptVoucher = null,
  computedVoucher = null,
  tolerance = POS_VOUCHER_TOLERANCE,
} = {}) {
  if (receiptVoucher == null || receiptVoucher === '') return null;
  const receipt = money(finiteOrThrow(receiptVoucher, 'Cupón del comprobante'));
  const computed = money(computedVoucher);
  if (Math.abs(receipt - computed) <= tolerance) {
    return { receiptVoucher: receipt, computedVoucher: computed, matched: true };
  }
  const err = new Error(
    `El cupón del comprobante (${receipt.toLocaleString('es-AR')}) no coincide con el total calculado del plan (${computed.toLocaleString('es-AR')}). Resolvé la diferencia antes de acreditar.`,
  );
  err.code = 'POS_VOUCHER_MISMATCH';
  err.receiptVoucher = receipt;
  err.computedVoucher = computed;
  throw err;
}

/** Meta persistible vinculada al pago / tramo POS. */
export function buildCardFinancingMeta(computed, extras = {}) {
  if (!computed) return null;
  return {
    mode: computed.mode,
    percent: computed.percent,
    fixedAmount: computed.fixedAmount,
    baseAmount: computed.base,
    financingBase: computed.financingBase ?? computed.base,
    surchargeAmount: computed.surchargeAmount || 0,
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
    receiptVoucher: extras.receiptVoucher != null ? money(extras.receiptVoucher) : null,
    authorizedAt: extras.authorizedAt || new Date().toISOString(),
    authorizedByServer: extras.authorizedByServer === true,
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
 * Autoridad de servidor: recupera el plan del catálogo, valida vigencia/modalidad/tasa
 * y reconstruye cardFinancing. No acepta el objeto del navegador como verdad.
 */
export function authorizePosCardFinancing({
  socialAmount,
  financingBase = null,
  surchargeAmount = 0,
  plans = [],
  paymentPlanId = null,
  plan = null,
  percent = null,
  fixedAmount = null,
  receiptVoucher = null,
  receiptParse = null,
  clientCardFinancing = null,
  operatorRole = null,
  allowOperatorOverride = null,
  dayISO = null,
  authReference = null,
  operatorUserId = null,
  authorizedByServer = false,
} = {}) {
  const planId = paymentPlanId || plan?.id || clientCardFinancing?.planId || null;
  const catalogPlan = plan
    || findPaymentPlan(plans, planId)
    || null;
  if (!catalogPlan) {
    const err = new Error(planId
      ? `Plan POS «${planId}» inexistente o inactivo.`
      : 'Falta el plan POS autorizado.');
    err.code = 'POS_PLAN_NOT_FOUND';
    throw err;
  }
  const normalized = normalizePaymentPlan(catalogPlan);
  const day = dayISO || new Date().toISOString().slice(0, 10);
  if (!paymentPlanIsValidOn(normalized, day)) {
    const err = new Error(`El plan POS «${normalized.label}» no está vigente.`);
    err.code = 'POS_PLAN_NOT_VALID';
    throw err;
  }

  const overrideAllowed = allowOperatorOverride != null
    ? Boolean(allowOperatorOverride)
    : normalized.allowOperatorOverride === true;
  let usePercent = null;
  let useFixed = null;
  if (overrideAllowed) {
    if (fixedAmount != null && fixedAmount !== '') useFixed = fixedAmount;
    else if (percent != null && percent !== '') usePercent = percent;
  } else if (
    (percent != null && percent !== '' && Number(percent) !== Number(normalized.financingPercent))
    || (fixedAmount != null && fixedAmount !== '' && Number(fixedAmount) !== Number(normalized.financingFixed))
  ) {
    if (!canEditPaymentPlanFinancing(operatorRole)) {
      const err = new Error('No tenés permiso para alterar la tasa de financiación del plan.');
      err.code = 'POS_FINANCING_FORBIDDEN';
      throw err;
    }
    if (fixedAmount != null && fixedAmount !== '') useFixed = fixedAmount;
    else if (percent != null && percent !== '') usePercent = percent;
  }

  // Modalidad siempre del plan autorizado — nunca del cliente.
  if (
    clientCardFinancing?.mode
    && clientCardFinancing.mode !== normalized.financingMode
  ) {
    const err = new Error('La modalidad de financiación del plan no puede cambiarse desde caja.');
    err.code = 'POS_MODE_TAMPER';
    throw err;
  }

  const computed = computePosFinancing({
    socialAmount,
    financingBase: financingBase != null ? financingBase : socialAmount,
    surchargeAmount,
    plan: normalized,
    percent: usePercent,
    fixedAmount: useFixed,
  });

  // B14: cupón declarado, monto parseado del comprobante y total calculado — por separado.
  const declared = receiptVoucher != null && receiptVoucher !== ''
    ? money(receiptVoucher)
    : null;
  const parsed = receiptParse?.amount != null && receiptParse.amount !== ''
    ? money(receiptParse.amount)
    : null;
  if (
    declared != null
    && parsed != null
    && Math.abs(declared - parsed) > POS_VOUCHER_TOLERANCE
  ) {
    const err = new Error(
      `El cupón declarado (${declared.toLocaleString('es-AR')}) no coincide con el monto del comprobante (${parsed.toLocaleString('es-AR')}).`,
    );
    err.code = 'POS_VOUCHER_MISMATCH';
    throw err;
  }
  if (declared != null) {
    assertPosVoucherMatchesComputed({
      receiptVoucher: declared,
      computedVoucher: computed.voucherTotal,
    });
  }
  if (parsed != null) {
    assertPosVoucherMatchesComputed({
      receiptVoucher: parsed,
      computedVoucher: computed.voucherTotal,
    });
  }
  const voucherFromReceipt = declared != null ? declared : parsed;

  const meta = buildCardFinancingMeta(computed, {
    authReference: authReference || receiptParse?.reference || null,
    operatorUserId,
    receiptVoucher: voucherFromReceipt,
    paymentPlanSnapshot: paymentPlanSnapshot(normalized),
    authorizedByServer: Boolean(authorizedByServer),
  });

  // Si el cliente mandó un cardFinancing, debe coincidir con lo reconstruido.
  if (clientCardFinancing && typeof clientCardFinancing === 'object') {
    const clientFin = money(clientCardFinancing.financingAmount);
    const clientVoucher = money(clientCardFinancing.voucherTotal);
    if (
      Math.abs(clientFin - meta.financingAmount) > POS_VOUCHER_TOLERANCE
      || Math.abs(clientVoucher - meta.voucherTotal) > POS_VOUCHER_TOLERANCE
      || (clientCardFinancing.mode && clientCardFinancing.mode !== meta.mode)
    ) {
      const err = new Error(
        'Los importes de financiación enviados no coinciden con el plan autorizado. Se rechaza el cobro.',
      );
      err.code = 'POS_FINANCING_TAMPER';
      err.authorized = meta;
      err.client = clientCardFinancing;
      throw err;
    }
  }

  return meta;
}

/**
 * Líneas de asiento POS.
 * posCashReceived = importe efectivamente cobrado al club por el tramo POS (después de descuento).
 * socialCredit = valor social (posCash + descuento autorizado).
 * discount = solo el descuento de mostrador.
 * Financiación A: crédito separado; B: no se asienta.
 */
export function buildPosJournalLines({
  posCashReceived,
  socialCredit = null,
  discount = 0,
  financingAmount = 0,
  mode = FINANCING_MODE_ISSUER,
  cardAccount = POS_CARD_RECEIVABLE_ACCOUNT,
  duesAccount = POS_DUES_INCOME_ACCOUNT,
  financingAccount = POS_FINANCING_INCOME_ACCOUNT,
  discountAccount = POS_DISCOUNT_ACCOUNT,
  /** @deprecated use posCashReceived */
  socialIncome = null,
} = {}) {
  const cash = money(posCashReceived != null ? posCashReceived : socialIncome);
  const disc = money(discount);
  const income = money(socialCredit != null ? socialCredit : money(cash + disc));
  const financing = money(financingAmount);
  const resolvedMode = mode === FINANCING_MODE_CLUB ? FINANCING_MODE_CLUB : FINANCING_MODE_ISSUER;

  const lines = [];
  const cardDebit = resolvedMode === FINANCING_MODE_CLUB && financing > 0.009
    ? money(cash + financing)
    : cash;
  if (cardDebit > 0.009) {
    lines.push({ account: cardAccount, type: 'debit', amount: cardDebit });
  }
  if (disc > 0.009) {
    lines.push({ account: discountAccount, type: 'debit', amount: disc });
  }
  if (income > 0.009) {
    lines.push({ account: duesAccount, type: 'credit', amount: income });
  }
  if (resolvedMode === FINANCING_MODE_CLUB && financing > 0.009) {
    lines.push({ account: financingAccount, type: 'credit', amount: financing });
  }

  assertJournalLinesBalanced(lines);

  const debitTotal = money(lines.filter((l) => l.type === 'debit').reduce((s, l) => s + l.amount, 0));
  const creditTotal = money(lines.filter((l) => l.type === 'credit').reduce((s, l) => s + l.amount, 0));
  return {
    mode: resolvedMode,
    lines,
    debitTotal,
    creditTotal,
  };
}

/** Rechaza asientos desbalanceados. */
export function assertJournalLinesBalanced(lines = []) {
  const debit = money((lines || [])
    .filter((l) => l.type === 'debit')
    .reduce((s, l) => s + Number(l.amount || 0), 0));
  const credit = money((lines || [])
    .filter((l) => l.type === 'credit')
    .reduce((s, l) => s + Number(l.amount || 0), 0));
  if (Math.abs(debit - credit) > 0.009) {
    const err = new Error(
      `Asiento desbalanceado: debe ${debit} ≠ haber ${credit}.`,
    );
    err.code = 'JOURNAL_UNBALANCED';
    err.debitTotal = debit;
    err.creditTotal = credit;
    err.lines = lines;
    throw err;
  }
  return { debit, credit };
}

/** Cupón efectivo a mostrar / persistir (ya autorizado). */
export function resolvePosVoucherAmount(socialAmount, cardFinancing, fallbackVoucher = null) {
  if (cardFinancing?.voucherTotal != null && Number(cardFinancing.voucherTotal) > 0) {
    return money(cardFinancing.voucherTotal);
  }
  const social = money(socialAmount);
  const financing = money(cardFinancing?.financingAmount);
  if (financing > 0.009) return money(social + financing);
  const raw = Number(fallbackVoucher);
  if (Number.isFinite(raw) && raw > 0) return money(raw);
  return social > 0.009 ? social : null;
}

/** True si el plan trae financiación predeterminada (aunque el cliente no mande %). */
export function planHasDefaultPosFinancing(plan) {
  if (!plan) return false;
  const normalized = normalizePaymentPlan(plan);
  if ((normalized.installments || 1) <= 1) return false;
  if (normalized.financingPercent != null && Number(normalized.financingPercent) > 0) return true;
  if (normalized.financingFixed != null && Number(normalized.financingFixed) > 0) return true;
  try {
    const probe = computePosFinancing({ financingBase: 1000, plan: normalized });
    return probe.financingAmount > 0.009;
  } catch {
    return false;
  }
}

/** Abono tenis no soporta financiación POS en este núcleo. */
export function assertTennisPosFinancingAllowed({
  method,
  paymentPlanId = null,
  plans = [],
  plan = null,
  cardFinancing = null,
  paymentSplits = null,
} = {}) {
  const hasFin = (row) => {
    if (!row) return false;
    if (Number(row.financingAmount) > 0.009) return true;
    if (Number(row?.cardFinancing?.financingAmount) > 0.009) return true;
    return false;
  };
  const reject = (msg) => {
    const err = new Error(msg);
    err.code = 'TENNIS_POS_FINANCING_UNSUPPORTED';
    err.unsupported = true;
    throw err;
  };
  const isPos = String(method || '').toLowerCase() === 'tarjeta'
    || String(method || '').toLowerCase() === 'pos'
    || String(method || '').toLowerCase() === 'mixto';
  if (!isPos && !Array.isArray(paymentSplits)) return;

  const resolvedPlan = plan
    || findPaymentPlan(plans, paymentPlanId)
    || null;
  if (planHasDefaultPosFinancing(resolvedPlan)) {
    reject(
      'El abono tenis no admite planes POS con financiación predeterminada. Usá un plan al contado (1 cuota).',
    );
  }
  if (hasFin(cardFinancing)) {
    reject(
      'El abono tenis no admite financiación POS. Registrá el POS de tenis al contado (sin interés) o cobrá la cuota social por separado.',
    );
  }
  if (Array.isArray(paymentSplits)) {
    for (const row of paymentSplits) {
      const m = String(row?.method || '').toLowerCase();
      if (m !== 'tarjeta' && m !== 'pos') continue;
      const splitPlan = row.paymentPlan
        || findPaymentPlan(plans, row.paymentPlanId)
        || null;
      if (planHasDefaultPosFinancing(splitPlan) || hasFin(row.cardFinancing || row)) {
        reject('El abono tenis no admite financiación POS en el tramo de tarjeta.');
      }
    }
  }
}

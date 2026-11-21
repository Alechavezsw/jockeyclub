import {
  afterCollectDues,
  collectionPeriodChoices,
  collectionTennisPeriodChoices,
  collectionTennisPreview,
  duesAmountForMember,
  duesChargeBreakdown,
  duesPayableForMember,
  duesTennisAbonoAmountForAccount,
  isDuesExemptMember,
  nextDuesDueDate,
  paymentIsTennisAbonoOnly,
} from './dues';
import { billingAccountMember, isFamilyDependent } from './households';
import { referenceMonthlyDues } from './paymentHistory';
import { createAccountEntry } from '../accounting/accountEntries';
import { applyDuesPartsDelta } from '../accounting/currentAccountBalances';
import { journalAccountForPayment } from './clubBanks';
import { nowTimeAR, todayISODateAR } from '../../lib/arDate';
import { money } from '../money';
import {
  detectFeeLedgerFichaAnomalies,
  shouldBlockLedgerOnlyCollection,
} from '../accounting/feeLedgerIntegrity';
import {
  duesChargeConcept,
  duesMonthsPhrase,
  imputationSummary,
  imputeDuesPayment,
  nextOpenDue,
  OPENING_DUE_ON,
  openPeriodsAfterPayment,
  openPeriodsFromChoices,
} from './duesImputations';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  findDuesJournalBySourceId,
  patchMemberPaymentChargeScope,
  quitarRecargoCuota,
  registrarCobro,
  registrarCobroPos,
  revertDuesPayment,
} from '../../data/repos';
import {
  assertJournalLinesBalanced,
  assertPosFinancingOperationSupported,
  assertTennisPosFinancingAllowed,
  authorizePosCardFinancing,
  buildPosJournalLines,
  computePosFinancing,
  POS_CARD_RECEIVABLE_ACCOUNT,
  POS_DUES_INCOME_ACCOUNT,
  POS_FINANCING_INCOME_ACCOUNT,
  resolvePosVoucherAmount,
} from './posFinancing';
import { findPaymentPlan, paymentPlanSnapshot } from '../system/paymentPlans';

function attachLedgerDesync(preview, member, {
  ledgerLines = null,
  payments = null,
  imputations = null,
} = {}) {
  const lines = Array.isArray(ledgerLines)
    ? ledgerLines
    : (Array.isArray(member?.feeLedgerLines) ? member.feeLedgerLines : []);
  if (!lines.length) return preview;
  const pays = Array.isArray(payments) ? payments : (member?.paymentHistory || []);
  const imps = Array.isArray(imputations) ? imputations : (member?.duesImputations || []);
  const findings = detectFeeLedgerFichaAnomalies({
    member,
    ledgerLines: lines,
    payments: pays,
    imputations: imps,
  });
  if (!findings.length) return preview;
  const blockLedgerOnly = shouldBlockLedgerOnlyCollection(member, {
    ledgerLines: lines,
    payments: pays,
    imputations: imps,
  });
  return {
    ...preview,
    ledgerDesync: {
      findings,
      reconciliationStatus: findings[0]?.reconciliationStatus || 'en_revision',
      blockLedgerOnlyCollection: blockLedgerOnly,
    },
  };
}

/** Resta capital (y recargos de stock LILA) del desglose vivo tras un cobro. */
function withPaidParts(member, capitalPaid = 0, surchargePaid = 0) {
  const stock = Number(member?.unpaidSurcharges) || 0;
  const surchargeCut = Math.min(Math.max(0, Number(surchargePaid) || 0), stock);
  return applyDuesPartsDelta(member, {
    capital: -(Number(capitalPaid) || 0),
    surcharges: -surchargeCut,
  });
}

export const DUES_METHOD_LABELS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Pago POS',
  pos: 'Pago POS',
  mixto: 'Pago mixto',
  mercadopago: 'Mercado Pago',
  debito: 'Débito',
  a_cuenta: 'A cuenta',
  caja: 'Efectivo',
};

/** Medios que se pueden combinar en un pago mixto (sin QR async). */
export const MIXED_DUES_METHODS = ['efectivo', 'transferencia', 'tarjeta'];

/** Terminal POS / cupón Visa (histórico `tarjeta` y alias `pos`). */
export function isCardPosDuesMethod(method) {
  const raw = String(method || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return raw === 'tarjeta' || raw === 'pos' || raw === 'pago pos' || raw === 'card';
}

/** Entrega parcial o a favor: se imputa del mes más viejo al más nuevo. */
export function isOnAccountDuesMethod(method) {
  const raw = String(method || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return raw === 'a cuenta' || raw === 'acuenta' || raw === 'pago a cuenta';
}

/**
 * Saldo a favor con respaldo en ficha.
 * Solo cuenta outstanding negativo o `creditBalance` explícito (p. ej. acarreo
 * tras liquidar). Nunca una diferencia entre unpaidCapital y outstanding.
 */
export function memberCreditBalance(member) {
  const stored = Number(member?.outstandingBalance) || 0;
  const fromNegative = stored < -0.01 ? money(-stored) : 0;
  const explicitRaw = member?.creditBalance ?? member?.meta?.creditBalance;
  const explicit = explicitRaw != null && explicitRaw !== ''
    ? money(Math.max(0, Number(explicitRaw) || 0))
    : 0;
  return money(fromNegative + explicit);
}

/** Consume crédito explícito al imputar; el resto a favor vive en outstanding negativo. */
export function withCreditBalanceAfterApply(member, { creditApplied = 0, creditLeftover = 0 } = {}) {
  if (creditLeftover > 0.01) {
    return { ...member, creditBalance: 0 };
  }
  const prevExplicit = money(Math.max(0, Number(member?.creditBalance ?? member?.meta?.creditBalance) || 0));
  if (!(prevExplicit > 0.01) && !(creditApplied > 0.01)) return member;
  const nextExplicit = money(Math.max(0, prevExplicit - money(creditApplied)));
  return { ...member, creditBalance: nextExplicit > 0.01 ? nextExplicit : 0 };
}

/** Desync unpaidCapital vs outstanding: alerta, no dinero. */
export function duesBalanceDesync(member) {
  const outstanding = money(Number(member?.outstandingBalance) || 0);
  const unpaidRaw = member?.unpaidCapital ?? member?.meta?.unpaidCapital;
  if (unpaidRaw == null || unpaidRaw === '') return null;
  const unpaid = money(Number(unpaidRaw) || 0);
  if (outstanding <= 0.01) {
    if (unpaid > 0.01) {
      return {
        code: 'stale_unpaid_while_clear',
        severity: 'high',
        outstanding,
        unpaid,
        gap: unpaid,
        message: 'unpaidCapital positivo con ficha en 0 o a favor',
      };
    }
    return null;
  }
  const gap = money(unpaid - outstanding);
  if (Math.abs(gap) <= 0.01) return null;
  return {
    code: gap > 0 ? 'unpaid_above_outstanding' : 'unpaid_below_outstanding',
    severity: Math.abs(gap) >= 1000 ? 'high' : 'medium',
    outstanding,
    unpaid,
    gap,
    message: gap > 0
      ? 'unpaidCapital mayor que el saldo de ficha (no es crédito)'
      : 'unpaidCapital menor que el saldo de ficha',
  };
}

/** Transferencia, POS y débito exigen comprobante (archivo o carga a mano). */
export function duesMethodNeedsReceipt(method) {
  return method === 'transferencia' || isCardPosDuesMethod(method) || method === 'debito';
}

/** Medios que acreditan en banco / alias del club (no caja). */
export function duesMethodUsesBank(method) {
  return method === 'transferencia' || method === 'debito';
}

/**
 * Débito (caja, Galicia, automático): solo capital.
 * El 10 % de mora no se cobra. No aplica a efectivo, transferencia, tarjeta ni MP one-shot.
 */
export function duesMethodSkipsSurcharge(method) {
  const raw = String(method || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!raw) return false;
  if (raw === 'debito' || raw === 'debito automatico' || raw === 'galicia') return true;
  if (raw.includes('debito automatico') || raw.includes('debito galicia') || raw.includes('debito bancario')) {
    return true;
  }
  return false;
}

export function duesReceiptRequiredMessage(method, { mixed = false } = {}) {
  if (isCardPosDuesMethod(method)) {
    return mixed
      ? 'Adjunte el comprobante del POS en el pago mixto.'
      : 'Adjunte el comprobante del POS (voucher / cupón).';
  }
  if (method === 'debito') {
    return mixed
      ? 'Adjunte el comprobante del débito en el pago mixto.'
      : 'Adjunte el comprobante del débito.';
  }
  return mixed
    ? 'Adjunte el comprobante de la transferencia en el pago mixto.'
    : 'Adjunte el comprobante de la transferencia.';
}

/** Cuenta del descuento de mostrador. No es la cuota ni el recargo. */
export const DUES_DISCOUNT_ACCOUNT = 'Descuentos sobre cuotas';

/**
 * Descuento en monto sobre este cobro. El capital y el 10 % no se recalculan:
 * el descuento solo baja el dinero que entra.
 */
export function collectionDiscount(gross, { discount = 0, detail = '' } = {}) {
  const base = money(Math.max(0, Number(gross) || 0));
  const cut = money(discount);
  if (cut < -0.001) throw new Error('El descuento no puede ser negativo.');
  if (cut > base + 0.01) throw new Error('El descuento supera el cobro.');
  const note = String(detail || '').replace(/\s+/g, ' ').trim();
  if (cut > 0.009 && note.length < 3) throw new Error('Falta el detalle del descuento.');
  const applied = cut > 0.009 ? cut : 0;
  return {
    discount: applied,
    detail: applied ? note : '',
    cash: money(base - applied),
    gross: base,
  };
}

/** Comprobante cargado a mano: la referencia reemplaza al archivo. */
export function isManualDuesReceipt(receiptParse) {
  if (!receiptParse || typeof receiptParse !== 'object') return false;
  if (receiptParse.source !== 'manual') return false;
  return String(receiptParse.reference || '').trim().length > 0;
}

export function manualDuesReceiptLabel(receiptParse) {
  const ref = String(receiptParse?.reference || '').trim();
  return ref ? `Manual · ${ref}` : '';
}

export function duesMethodLabel(method, bankName) {
  if (isOnAccountDuesMethod(method)) return DUES_METHOD_LABELS.a_cuenta;
  if (isCardPosDuesMethod(method)) return DUES_METHOD_LABELS.tarjeta;
  if (method === 'transferencia') {
    return bankName ? `Transferencia ${bankName}` : 'Transferencia';
  }
  if (method === 'debito') {
    return bankName ? `Débito ${bankName}` : 'Débito';
  }
  return DUES_METHOD_LABELS[method] || method || 'Pago';
}

export {
  EDITABLE_DUES_METHODS,
  changeDuesPaymentMethod,
} from './duesPaymentMethodChange';

/**
 * Cupón POS: total del voucher (puede incluir financiación).
 * La imputación social sigue siendo `amount`; la financiación va en `cardFinancing`.
 */
export function duesVoucherAmount(row, imputedAmount = null) {
  const imputed = money(imputedAmount != null ? imputedAmount : row?.amount);
  if (row?.cardFinancing?.voucherTotal != null) {
    return resolvePosVoucherAmount(imputed, row.cardFinancing);
  }
  const raw = Number(row?.voucherAmount ?? row?.receiptParse?.amount);
  if (!Number.isFinite(raw) || !(raw > 0)) return null;
  const voucher = money(raw);
  if (imputed > 0 && voucher > imputed + 0.01) return voucher;
  if (!(imputed > 0) && voucher > 0.01) return voucher;
  return null;
}

/**
 * Arma meta de financiación POS con autoridad de servidor (plan del catálogo).
 * No confía en cardFinancing del navegador.
 */
export function resolveCardFinancingForPos({
  socialAmount,
  financingBase = null,
  surchargeAmount = 0,
  plan = null,
  plans = [],
  paymentPlanId = null,
  percent = null,
  fixedAmount = null,
  voucherAmount = null,
  receiptParse = null,
  cardFinancing = null,
  authReference = null,
  operatorUserId = null,
  operatorRole = null,
  dayISO = null,
  authorizedByServer = false,
} = {}) {
  return authorizePosCardFinancing({
    socialAmount,
    financingBase: financingBase != null ? financingBase : socialAmount,
    surchargeAmount,
    plans,
    paymentPlanId,
    plan,
    percent,
    fixedAmount,
    receiptVoucher: voucherAmount,
    receiptParse,
    clientCardFinancing: cardFinancing,
    operatorRole,
    dayISO,
    authReference,
    operatorUserId,
    authorizedByServer,
  });
}

/** Normaliza líneas de un pago mixto. Con `authorize: true` reconstruye financiación desde el plan. */
export function normalizePaymentSplits(raw = [], {
  authorize = false,
  plans = [],
  operatorRole = null,
} = {}) {
  return (Array.isArray(raw) ? raw : [])
    .map((row, index) => {
      const rawMethod = String(row?.method || '').trim().toLowerCase();
      const method = isCardPosDuesMethod(rawMethod) ? 'tarjeta' : rawMethod;
      if (!MIXED_DUES_METHODS.includes(method)) return null;
      const amount = money(row?.amount);
      if (!(amount > 0)) return null;
      const attachment = row?.receiptAttachment && row.receiptAttachment.path
        ? {
          path: row.receiptAttachment.path,
          bucket: row.receiptAttachment.bucket || 'dues-receipts',
          name: row.receiptAttachment.name || row.receiptName || '',
          mimeType: row.receiptAttachment.mimeType || '',
          size: Number(row.receiptAttachment.size) || 0,
        }
        : null;
      const manual = isManualDuesReceipt(row.receiptParse);
      const receiptName = attachment?.name
        || row?.receiptName
        || (manual ? manualDuesReceiptLabel(row.receiptParse) : null);
      const bankId = duesMethodUsesBank(method) ? (row.bankId || null) : null;
      const bankName = duesMethodUsesBank(method) ? (row.bankName || null) : null;
      const paymentPlanId = isCardPosDuesMethod(method) ? (row.paymentPlanId || null) : null;
      const paymentPlanLabel = isCardPosDuesMethod(method) ? (String(row.paymentPlanLabel || '').trim() || null) : null;
      // B15: cuenta siempre del catálogo servidor (método + banco), no del cliente.
      const journalAccount = journalAccountForPayment(method, bankId);
      const clientAccount = String(row.journalAccount || '').trim();
      if (clientAccount && clientAccount.toLowerCase() !== String(journalAccount).toLowerCase()) {
        const err = new Error(
          `La cuenta «${clientAccount}» no está autorizada para ${method}. Debe ser «${journalAccount}».`,
        );
        err.code = 'POS_JOURNAL_ACCOUNT_TAMPER';
        throw err;
      }
      // B16: capital/mora explícitos por tramo (obligatorios si hay mora en el cobro).
      const capitalAmount = row.capitalAmount != null && row.capitalAmount !== ''
        ? money(row.capitalAmount)
        : null;
      const surchargeAmount = row.surchargeAmount != null && row.surchargeAmount !== ''
        ? money(row.surchargeAmount)
        : null;
      let cardFinancing = null;
      if (isCardPosDuesMethod(method)) {
        if (authorize) {
          // Financiar solo capital del tramo; nunca mora.
          const financingBase = capitalAmount != null ? capitalAmount : amount;
          cardFinancing = resolveCardFinancingForPos({
            socialAmount: financingBase,
            financingBase,
            surchargeAmount: 0,
            paymentPlanId,
            plan: row.paymentPlan || null,
            plans: row.paymentPlans || plans,
            percent: row.financingPercent,
            fixedAmount: row.financingFixed,
            voucherAmount: row.voucherAmount ?? row.receiptParse?.amount,
            receiptParse: row.receiptParse,
            cardFinancing: row.cardFinancing,
            authReference: row.authReference,
            operatorRole: row.operatorRole || operatorRole,
          });
        } else if (row.cardFinancing && typeof row.cardFinancing === 'object') {
          cardFinancing = row.cardFinancing;
        }
      }
      const voucherAmount = isCardPosDuesMethod(method)
        ? (duesVoucherAmount({ ...row, cardFinancing }, amount)
          || resolvePosVoucherAmount(amount, cardFinancing, row.voucherAmount))
        : null;
      return {
        id: row.id || `split-${index + 1}`,
        method,
        amount,
        capitalAmount,
        surchargeAmount,
        bankId,
        bankName,
        journalAccount,
        paymentPlanId,
        paymentPlanLabel,
        paymentPlanSnapshot: cardFinancing?.paymentPlanSnapshot || row.paymentPlanSnapshot || null,
        voucherAmount,
        cardFinancing,
        receiptName,
        receiptPath: attachment?.path || row.receiptPath || null,
        receiptBucket: attachment?.bucket || row.receiptBucket || null,
        receiptMime: attachment?.mimeType || row.receiptMime || null,
        receiptSize: attachment?.size ?? row.receiptSize ?? null,
        receiptAttachment: attachment,
        receiptParse: row.receiptParse && typeof row.receiptParse === 'object' ? row.receiptParse : null,
        label: duesMethodLabel(method, bankName)
          + (paymentPlanLabel ? ` · ${paymentPlanLabel}` : ''),
      };
    })
    .filter(Boolean);
}

/**
 * Asiento de cobro de cuota con tramos POS (modalidad A/B).
 * `cashReceived` = dinero social efectivamente cobrado (después de descuento; sin financiación).
 * `socialIncome` = cashReceived + descuento (crédito a Cuotas Sociales).
 * Tarjetas a cobrar = cash POS (+ financiación A). Nunca incluye el descuento como cobrado en POS.
 */
export function buildDuesCollectionJournalLines({
  cashReceived,
  socialIncome,
  discount = 0,
  cashAccount = 'Caja General',
  mixedSplits = null,
  cardFinancing = null,
  isCardPos = false,
} = {}) {
  const cash = money(cashReceived);
  const disc = money(discount);
  const income = money(socialIncome != null ? socialIncome : cash + disc);
  const discountLine = disc > 0.009
    ? [{ account: DUES_DISCOUNT_ACCOUNT, type: 'debit', amount: disc }]
    : [];

  if (Array.isArray(mixedSplits) && mixedSplits.length >= 2) {
    const lines = [];
    let financingCredit = 0;
    mixedSplits.forEach((row) => {
      const isPos = isCardPosDuesMethod(row.method);
      const fin = isPos ? (row.cardFinancing || null) : null;
      const finAmount = money(fin?.financingAmount);
      if (isPos && fin?.mode === 'club_keeps' && finAmount > 0.009) {
        lines.push({
          account: row.journalAccount || POS_CARD_RECEIVABLE_ACCOUNT,
          type: 'debit',
          amount: money(row.amount + finAmount),
        });
        financingCredit = money(financingCredit + finAmount);
      } else {
        lines.push({
          account: row.journalAccount || journalAccountForPayment(row.method, row.bankId) || 'Caja General',
          type: 'debit',
          amount: money(row.amount),
        });
      }
    });
    const built = [
      ...lines,
      ...discountLine,
      { account: POS_DUES_INCOME_ACCOUNT, type: 'credit', amount: income },
      ...(financingCredit > 0.009
        ? [{ account: POS_FINANCING_INCOME_ACCOUNT, type: 'credit', amount: financingCredit }]
        : []),
    ];
    assertJournalLinesBalanced(built);
    return built;
  }

  if (isCardPos) {
    const pos = buildPosJournalLines({
      posCashReceived: cash,
      socialCredit: income,
      discount: disc,
      financingAmount: cardFinancing?.financingAmount || 0,
      mode: cardFinancing?.mode,
      cardAccount: cashAccount || POS_CARD_RECEIVABLE_ACCOUNT,
      discountAccount: DUES_DISCOUNT_ACCOUNT,
    });
    return pos.lines;
  }

  const plain = [
    ...(cash > 0.009 ? [{ account: cashAccount, type: 'debit', amount: cash }] : []),
    ...discountLine,
    { account: POS_DUES_INCOME_ACCOUNT, type: 'credit', amount: income },
  ];
  assertJournalLinesBalanced(plain);
  return plain;
}

/**
 * Valida splits: ≥2 líneas, suma = total, comprobantes donde corresponde.
 * @returns {{ splits: object[], total: number }}
 */
/**
 * B16: con mora + tramo POS, cada medio debe declarar capitalAmount y surchargeAmount
 * que sumen el importe del tramo y cierren con la liquidación.
 */
export function assertMixedPosMoraAllocation(splits = [], {
  capital = 0,
  surcharge = 0,
} = {}) {
  const sur = money(surcharge);
  const cap = money(capital);
  const list = Array.isArray(splits) ? splits : [];
  const hasPos = list.some((row) => isCardPosDuesMethod(row?.method));
  if (!(sur > 0.009) || !hasPos) return list;

  let capSum = 0;
  let surSum = 0;
  for (const row of list) {
    if (row.capitalAmount == null || row.surchargeAmount == null) {
      const err = new Error(
        'Pago mixto con mora y POS: cada tramo debe declarar capitalAmount y surchargeAmount. No se financia mora por defecto.',
      );
      err.code = 'POS_MIXED_MORA_ALLOCATION_REQUIRED';
      throw err;
    }
    const rowCap = money(row.capitalAmount);
    const rowSur = money(row.surchargeAmount);
    if (Math.abs(rowCap + rowSur - money(row.amount)) > 0.009) {
      const err = new Error(
        `En el tramo ${row.method}, capital (${rowCap}) + mora (${rowSur}) debe igualar el importe (${money(row.amount)}).`,
      );
      err.code = 'POS_MIXED_MORA_ALLOCATION_MISMATCH';
      throw err;
    }
    capSum = money(capSum + rowCap);
    surSum = money(surSum + rowSur);
  }
  if (Math.abs(capSum - cap) > 0.009 || Math.abs(surSum - sur) > 0.009) {
    const err = new Error(
      `La asignación capital/mora de los tramos no cierra con la liquidación (capital ${capSum}/${cap}, mora ${surSum}/${sur}).`,
    );
    err.code = 'POS_MIXED_MORA_ALLOCATION_TOTAL';
    throw err;
  }
  return list;
}

export function validatePaymentSplits(rawSplits, expectedAmount, {
  treasuryMatch = false,
  plans = [],
  operatorRole = null,
  capital = null,
  surcharge = null,
} = {}) {
  const splits = normalizePaymentSplits(rawSplits, {
    authorize: true,
    plans,
    operatorRole,
  });
  if (splits.length < 2) {
    throw new Error('El pago mixto necesita al menos dos medios con importe.');
  }
  const total = money(splits.reduce((sum, row) => sum + row.amount, 0));
  const expected = money(expectedAmount);
  if (expected > 0 && Math.abs(total - expected) > 0.009) {
    throw new Error(`Los medios suman ${total} y el cobro es ${expected}.`);
  }
  if (capital != null || surcharge != null) {
    assertMixedPosMoraAllocation(splits, { capital, surcharge });
  } else if (
    splits.some((row) => isCardPosDuesMethod(row.method))
    && splits.some((row) => row.surchargeAmount == null && row.capitalAmount == null)
  ) {
    // Sin totales aún: si hay POS y algún tramo no tipó capital/mora, exigir si alguno tipó surcharge>0
    const hintedSur = money(splits.reduce((s, r) => s + (Number(r.surchargeAmount) || 0), 0));
    if (hintedSur > 0.009) {
      assertMixedPosMoraAllocation(splits, {
        capital: money(splits.reduce((s, r) => s + (Number(r.capitalAmount) || 0), 0)),
        surcharge: hintedSur,
      });
    }
  }
  splits.forEach((row) => {
    if (!duesMethodNeedsReceipt(row.method)) return;
    if (row.receiptParse?.source === 'manual' && !isManualDuesReceipt(row.receiptParse)) {
      throw new Error('Completá la referencia del comprobante manual.');
    }
    if (!row.receiptName) {
      throw new Error(duesReceiptRequiredMessage(row.method, { mixed: true }));
    }
    if (!row.receiptPath && !treasuryMatch && !isManualDuesReceipt(row.receiptParse)) {
      throw new Error('No se pudo guardar un comprobante del pago mixto en Supabase.');
    }
  });
  return { splits, total };
}

function receiptNumberFor(member, date) {
  return `RC-${String(member.memberId).slice(-6)}-${String(date).replace(/-/g, '')}`;
}

function ledgerPago(member, payment) {
  const methods = Array.isArray(payment.paymentSplits) && payment.paymentSplits.length
    ? payment.paymentSplits.map((row) => ({
      method: row.label || duesMethodLabel(row.method, row.bankName),
      amount: row.amount,
      reference: row.receiptName || row.paymentPlanLabel || '',
    }))
    : (payment.method ? [{ method: payment.method, amount: payment.amount }] : []);
  return createAccountEntry({
    id: payment.ledgerId,
    type: 'pago',
    memberNumber: member.memberId,
    memberName: member.name,
    value: payment.amount,
    date: payment.date,
    voucher: payment.receiptNumber || payment.receipt || payment.voucher,
    source: payment.source || 'dues_payment',
    description: payment.concept,
    paymentMethods: methods,
  });
}

function duesSnapshot(member) {
  return {
    outstandingBalance: Number(member?.outstandingBalance) || 0,
    lastPaymentDate: member?.lastPaymentDate || null,
    nextDueDate: member?.nextDueDate || null,
    overdueSince: member?.overdueSince ?? null,
  };
}

/**
 * Identidad de un cobro importado. No usa la hora: la misma fila del Excel
 * vuelve a dar la misma clave, y la base rechaza el segundo insert.
 */
export function importedCollectionKey({
  memberId,
  date,
  amount,
  voucher = '',
  cbu = '',
} = {}) {
  const who = String(memberId || '').trim();
  const receipt = String(voucher || '').trim().toUpperCase().replace(/\s+/g, '');
  if (receipt) return `import:${who}:rc:${receipt}`;
  const day = String(date || '').slice(0, 10);
  const cents = Math.round(money(amount) * 100);
  const bank = String(cbu || '').replace(/\D/g, '');
  return `import:${who}:${day}:${cents}${bank ? `:${bank}` : ''}`;
}

export function memberAlreadyHasCollection(member, key) {
  if (!key) return false;
  return (member?.paymentHistory || []).some((row) => (
    row?.id === key || row?.idempotencyKey === key || row?.ledgerId === key
  ));
}

function asPaymentDate(date) {
  const iso = String(date || todayISODateAR()).slice(0, 10);
  const when = new Date(`${iso}T12:00:00`);
  return { iso, when: Number.isNaN(when.getTime()) ? new Date() : when };
}

/**
 * Pago importado (Excel): baja saldo, deja crédito si sobra,
 * y si cancela pasa el vencimiento al próximo día 10 (igual que caja).
 */
export function applyImportedMemberPayment(member, {
  amount,
  date,
  voucher = '',
  method = 'transferencia',
  methodLabel = '',
  concept = '',
  bankName = '',
  paidAtReason = '',
  importSource = '',
  id,
  source = 'collection_import',
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const paid = money(amount);
  if (paid <= 0) throw new Error('Importe inválido.');
  const { iso, when } = asPaymentDate(date);
  const before = duesSnapshot(member);
  const key = id || importedCollectionKey({
    memberId: member.memberId,
    date: iso,
    amount: paid,
    voucher,
  });
  if (memberAlreadyHasCollection(member, key)) {
    const balance = money(member.outstandingBalance);
    return {
      member,
      payment: (member.paymentHistory || []).find((row) => (
        row?.id === key || row?.idempotencyKey === key || row?.ledgerId === key
      )),
      fullyPaid: balance <= 0.01,
      credit: balance < -0.01 ? Math.abs(balance) : 0,
      before,
      ledgerEntry: null,
      duplicate: true,
    };
  }
  const bank = String(bankName || '').trim();
  const payment = {
    id: key,
    idempotencyKey: key,
    date: iso,
    time: nowTimeAR(when),
    paidAt: when.toISOString(),
    createdAt: when.toISOString(),
    concept: String(concept || '').trim() || 'Importación cobranzas socios',
    amount: paid,
    method,
    methodLabel: String(methodLabel || '').trim()
      || duesMethodLabel(method, bank),
    bankName: bank || null,
    paidAtReason: String(paidAtReason || '').trim() || undefined,
    importSource: String(importSource || '').trim() || undefined,
    status: 'paid',
    receipt: voucher || receiptNumberFor(member, iso),
    receiptNumber: voucher || receiptNumberFor(member, iso),
    voucher,
    source,
    ledgerId: key,
    balanceBefore: before.outstandingBalance,
    nextDueBefore: before.nextDueDate,
    lastPaymentBefore: before.lastPaymentDate,
    period: when.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
  };

  let current = member;
  let leftover = paid;
  const due = money(member.outstandingBalance);
  const skipSurcharge = duesMethodSkipsSurcharge(method);

  if (due > 0.01) {
    // Débito: el resto de apertura (mora embebida) no es un período a cobrar.
    const schedule = openPeriodsFromChoices(collectionPeriodChoices(member, when), due)
      .map((row) => (skipSurcharge ? { ...row, lateBase: 0 } : row))
      .filter((row) => !(skipSurcharge && String(row.dueOn) <= OPENING_DUE_ON));
    const imputed = imputeDuesPayment(schedule, paid, iso);
    payment.imputations = imputed.allocations;
    payment.quota = imputed.capital;
    payment.surcharge = skipSurcharge ? 0 : imputed.surcharge;
    payment.waivedSurcharge = 0;
    if (imputed.allocations.length) {
      payment.period = imputationSummary(imputed.allocations);
      payment.periodDueOns = imputed.allocations.map((row) => row.dueOn);
    }
    const capitalLeft = money(due - imputed.capital);
    leftover = imputed.unapplied;
    const openDue = nextOpenDue(schedule, imputed.allocations);
    const scheduleCapital = money(
      schedule.reduce((sum, row) => sum + (Number(row.capital) || 0), 0),
    );
    // Débito: si cubrió el capital de los meses, no deja el 10 % embebido en ficha.
    const debitClearsResidual = skipSurcharge
      && imputed.capital + 0.01 >= scheduleCapital
      && capitalLeft > 0.01;
    if (capitalLeft <= 0.01 || debitClearsResidual) {
      current = afterCollectDues(member, when);
      current = {
        ...current,
        outstandingBalance: capitalLeft <= 0.01 ? capitalLeft : 0,
      };
    } else {
      current = {
        ...withPaidParts(member, imputed.capital, skipSurcharge ? 0 : imputed.surcharge),
        outstandingBalance: capitalLeft,
        nextDueDate: openDue || member.nextDueDate,
      };
    }
  }

  let months = 0;
  while (leftover > 0.01 && months < 24) {
    months += 1;
    const dueOn = current.nextDueDate || nextDuesDueDate(when);
    const monthAmount = money(
      skipSurcharge
        ? duesAmountForMember(current, dueOn)
        : duesPayableForMember(current, { paidOn: when, dueOn, on: dueOn }),
    );
    if (monthAmount <= 0.01) {
      current = {
        ...current,
        outstandingBalance: money((Number(current.outstandingBalance) || 0) - leftover),
      };
      leftover = 0;
      break;
    }
    if (leftover + 0.01 >= monthAmount) {
      leftover = money(leftover - monthAmount);
      current = afterCollectDues({
        ...current,
        outstandingBalance: monthAmount,
        nextDueDate: current.nextDueDate || dueOn,
      }, when);
    } else {
      current = {
        ...current,
        outstandingBalance: money((Number(current.outstandingBalance) || 0) - leftover),
      };
      leftover = 0;
    }
  }
  if (leftover > 0.01) {
    current = {
      ...current,
      outstandingBalance: money((Number(current.outstandingBalance) || 0) - leftover),
    };
  }

  const next = {
    ...current,
    lastPaymentDate: iso,
    paymentHistory: [payment, ...(member.paymentHistory || [])],
    updatedAt: new Date().toISOString(),
  };
  const balance = money(next.outstandingBalance);
  return {
    member: next,
    payment,
    fullyPaid: balance <= 0.01,
    credit: balance < -0.01 ? Math.abs(balance) : 0,
    before,
    ledgerEntry: ledgerPago(next, payment),
  };
}

export function revertImportedMemberPayment(member, snapshot = {}) {
  if (!member || !snapshot) return member;
  return {
    ...member,
    outstandingBalance: snapshot.outstandingBalance,
    lastPaymentDate: snapshot.lastPaymentDate,
    nextDueDate: snapshot.nextDueDate,
    overdueSince: snapshot.overdueSince,
    paymentHistory: (member.paymentHistory || []).filter((row) => row.id !== snapshot.paymentId),
    updatedAt: new Date().toISOString(),
  };
}

function duesOpenSnapshot(schedule, imputed, remainingChoices = []) {
  const open = openPeriodsAfterPayment(schedule, imputed?.allocations || [])
    .filter((row) => String(row.dueOn) > OPENING_DUE_ON && row.capital > 0.009);
  for (const row of remainingChoices || []) {
    const dueOn = String(row?.dueOn || '').slice(0, 10);
    if (!dueOn || dueOn <= OPENING_DUE_ON || !(Number(row.capital) > 0)) continue;
    if (open.some((item) => item.dueOn === dueOn)) continue;
    open.push({
      dueOn,
      capital: money(row.capital),
      lateBase: money(row.lateBase ?? row.capital),
    });
  }
  open.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return {
    duesOpenPeriods: open,
    unpaidCapital: money(open.reduce((sum, row) => sum + (Number(row.capital) || 0), 0)),
  };
}

/** Meses abiertos, del más viejo al más nuevo, para imputar un pago a cuenta. */
export function duesPaymentSchedule(member, today = new Date(), periodDueOns = null) {
  const choices = collectionPeriodChoices(member, today);
  const selected = Array.isArray(periodDueOns) && periodDueOns.length
    ? periodDueOns.map((value) => String(value || '').slice(0, 10))
    : null;
  const rows = selected
    ? choices.filter((row) => selected.includes(String(row.dueOn).slice(0, 10)))
    : choices;
  const capital = money(rows.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
  if (!(capital > 0)) return [];
  return openPeriodsFromChoices(rows, capital)
    .filter((row) => String(row.dueOn) > OPENING_DUE_ON)
    .map((row) => ({
      dueOn: String(row.dueOn).slice(0, 10),
      capital: money(row.capital),
      lateBase: money(row.lateBase),
    }));
}

/**
 * Reparte un importe a cuenta: primero la cuota más vieja, después la siguiente.
 * El 10 % entra recién cuando el capital de ese mes ya quedó cubierto.
 */
export function accountPaymentPlan(member, amount, today = new Date(), periodDueOns = null) {
  const choices = collectionPeriodChoices(member, today);
  const selected = Array.isArray(periodDueOns) && periodDueOns.length
    ? new Set(periodDueOns.map((value) => String(value || '').slice(0, 10)))
    : null;
  const rows = selected
    ? choices.filter((row) => selected.has(String(row.dueOn).slice(0, 10)))
    : choices;
  const payable = money(rows.reduce((sum, row) => sum + (Number(row.payable) || 0), 0));
  const schedule = duesPaymentSchedule(member, today, periodDueOns);
  const cash = money(amount);
  const imputed = imputeDuesPayment(schedule, cash, todayISODateAR(today));
  const touched = (imputed.allocations || []).filter((row) => (
    (Number(row.capital) || 0) > 0.009 || (Number(row.surcharge) || 0) > 0.009
  ));
  return {
    payable,
    schedule,
    cash,
    partial: payable > 0.01 && cash > 0.009 && cash + 0.01 < payable,
    over: cash > payable + 0.01,
    touched,
  };
}

/**
 * Registra un pago de cuota del socio (portal / caja).
 * Actualiza saldo, próximo vencimiento e historial.
 */
export function payMemberDues(member, {
  method = 'transferencia',
  amount = null,
  today = new Date(),
  periodDueOns = null,
  skipSurcharge = false,
  chargeScope = 'all',
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  if (isFamilyDependent(member)) throw new Error('El cobro va a la cuenta del titular.');
  if (isDuesExemptMember(member)) throw new Error('Esta categoría no abona cuota social.');
  const skipInterest = skipSurcharge || duesMethodSkipsSurcharge(method);
  const requested = amount != null ? Number(amount) : 0;
  const stored = Number(member.outstandingBalance) || 0;
  let selected = Array.isArray(periodDueOns) && periodDueOns.length
    ? periodDueOns.map((value) => String(value || '').slice(0, 10)).filter(Boolean)
    : null;
  const choices = collectionPeriodChoices(member, today, { chargeScope });
  let selectedChoices = selected
    ? choices.filter((row) => selected.includes(String(row.dueOn).slice(0, 10)))
    : choices;
  // El total del modal ya muestra esos meses. No frenar el cobro pidiendo marcarlos.
  if (selected && !selectedChoices.length) {
    selected = null;
    selectedChoices = choices;
  }
  const preview = collectionPreview(member, today, {
    periodDueOns: selected,
    skipSurcharge: skipInterest,
    chargeScope,
  });
  const split = duesChargeBreakdown(member, {
    paidOn: today,
    periodDueOns: selected,
    ...(stored > 0 || !(requested > 0) ? {} : { amount: requested }),
  });
  const creditApplied = money(preview.creditApplied || 0);
  let classicDue = selected
    ? selectedChoices.reduce(
      (sum, row) => sum + (Number(skipInterest ? row.capital : row.payable) || 0),
      0,
    )
    : (skipInterest ? money(split.quota) : split.total);
  if (!(stored > 0) && requested > 0 && !selected) classicDue = requested;
  // Con saldo a favor usamos el preview (efectivo = bruto − crédito).
  // Sin crédito, el desglose clásico respeta el saldo de ficha.
  const grossDue = creditApplied > 0.01 && preview.gross > 0.01
    ? preview.gross
    : classicDue;
  const cashDue = creditApplied > 0.01 && preview.gross > 0.01
    ? preview.cash
    : classicDue;
  let due = cashDue;
  if (due <= 0 && creditApplied <= 0.01) throw new Error('No hay saldo pendiente para abonar.');
  if (due <= 0 && creditApplied > 0.01) due = 0;

  const onAccount = isOnAccountDuesMethod(method);
  const paidAmount = requested > 0 ? requested : due;
  if ((!paidAmount || paidAmount <= 0) && creditApplied <= 0.01) {
    throw new Error('Importe inválido.');
  }
  if (paidAmount > due + 0.01 && !onAccount) {
    throw new Error('El importe supera el saldo pendiente.');
  }
  const covered = selectedChoices.length ? selectedChoices : choices;
  const coveredCapital = money(covered.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
  const scheduleAmount = coveredCapital > 0 ? coveredCapital : Math.max(0, stored);
  const schedule = scheduleAmount > 0
    ? openPeriodsFromChoices(covered, scheduleAmount)
      .map((row) => (skipInterest ? { ...row, lateBase: 0 } : row))
      .filter((row) => !(skipInterest && String(row.dueOn) <= OPENING_DUE_ON))
    : [];
  // El saldo a favor se imputa al saldar el efectivo debido. En un a cuenta
  // parcial el crédito sigue embebido en el saldo de ficha hasta el próximo cobro.
  const creditLeftover = onAccount
    ? money(Math.max(0, paidAmount - cashDue))
    : 0;
  const settleCash = paidAmount + 0.01 >= cashDue;
  const creditInPool = settleCash || !onAccount ? creditApplied : 0;
  const imputePool = money(Math.min(
    money(Math.max(0, paidAmount) + creditInPool),
    money(grossDue + creditLeftover),
  ));
  const imputed = schedule.length
    ? imputeDuesPayment(schedule, imputePool, todayISODateAR(today))
    : null;

  const date = todayISODateAR(today);
  const time = nowTimeAR(today);
  const paidAt = today.toISOString();
  const lines = paidAmount + creditApplied + 0.01 >= grossDue
    ? (selected
      ? {
        quota: money(selectedChoices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0)),
        surcharge: skipInterest
          ? 0
          : money(selectedChoices.reduce((sum, row) => sum + (Number(row.surcharge) || 0), 0)),
        waivedSurcharge: 0,
      }
      : (skipInterest
        ? { ...split, surcharge: 0, total: money(split.quota), waivedSurcharge: 0 }
        : split))
    : duesChargeBreakdown(member, {
      paidOn: today,
      amount: imputePool,
      periodDueOns: selected,
    });
  const imputedDueOns = (imputed?.allocations || [])
    .filter((row) => (Number(row.capital) || 0) > 0.009 || (Number(row.surcharge) || 0) > 0.009)
    .map((row) => row.dueOn);
  const monthPhrase = duesMonthsPhrase(
    imputedDueOns.length ? imputedDueOns : selectedChoices.map((row) => row.dueOn),
  );
  const periodLabel = monthPhrase
    || today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const quotaPaid = imputed ? imputed.capital : lines.quota;
  const surchargePaid = skipInterest ? 0 : (imputed ? imputed.surcharge : lines.surcharge);
  const methodLabel = duesMethodLabel(method);
  let concept = onAccount
    ? duesChargeConcept(monthPhrase, { prefix: 'A cuenta', empty: `A cuenta · ${methodLabel}` })
    : duesChargeConcept(monthPhrase, { empty: `Cuota social · ${methodLabel}` });
  if (creditInPool > 0.01) {
    concept = `${concept} · saldo a favor imputado ${creditInPool}`;
  }
  if (creditLeftover > 0.01) {
    concept = `${concept} · saldo a favor ${creditLeftover}`;
  }
  const payment = {
    id: `pay-${member.memberId}-${Date.now()}`,
    date,
    time,
    paidAt,
    createdAt: paidAt,
    concept,
    duesOpenPeriodsBefore: Array.isArray(member?.duesOpenPeriods) ? member.duesOpenPeriods : null,
    unpaidCapitalBefore: member?.unpaidCapital ?? null,
    amount: paidAmount,
    quota: quotaPaid,
    surcharge: surchargePaid,
    waivedSurcharge: 0,
    method: onAccount ? 'a_cuenta' : method,
    status: 'paid',
    receipt: receiptNumberFor(member, date),
    receiptNumber: receiptNumberFor(member, date),
    period: imputed?.allocations?.length ? imputationSummary(imputed.allocations) : periodLabel,
    periodDueOns: imputed?.allocations?.length
      ? imputed.allocations.map((row) => row.dueOn)
      : selectedChoices.map((row) => row.dueOn),
    imputations: imputed?.allocations || [],
    balanceBefore: Number(member.outstandingBalance) || 0,
    nextDueBefore: member.nextDueDate || null,
    lastPaymentBefore: member.lastPaymentDate || null,
    ...(creditInPool > 0.01 ? { creditApplied: creditInPool } : {}),
    ...(creditLeftover > 0.01 ? { creditLeftover } : {}),
  };

  const history = [payment, ...(member.paymentHistory || [])];
  const remainingCash = money(cashDue - paidAmount);
  const remainingChoices = selected
    ? choices.filter((row) => !selected.includes(String(row.dueOn).slice(0, 10)))
    : [];
  const openSnapshot = imputed
    ? duesOpenSnapshot(schedule, imputed, remainingChoices)
    : null;
  const stampCredit = (row) => withCreditBalanceAfterApply(row, {
    creditApplied: creditInPool,
    creditLeftover,
  });

  if (imputed && stored > 0) {
    const capitalLeft = money(stored - imputed.capital);
    const openDue = nextOpenDue(schedule, imputed.allocations);
    const lilaRaw = member?.unpaidCapital;
    const embedded = lilaRaw != null && lilaRaw !== ''
      ? money(Math.max(0, stored - money(Math.max(0, Number(lilaRaw) || 0))))
      : money(Math.max(0, Number(member?.unpaidSurcharges) || 0));
    const scheduleCapital = money(
      schedule.reduce((sum, row) => sum + (Number(row.capital) || 0), 0),
    );
    // Débito / Galicia: al saldar el capital no genera ni deja el 10 % de mora.
    const debitClearsResidual = skipInterest
      && imputed.capital + 0.01 >= scheduleCapital
      && capitalLeft > 0.01
      && remainingCash <= 0.01;
    const duesSettled = !openDue
      && remainingCash <= 0.01
      && remainingChoices.length === 0
      && embedded > 0.01
      && capitalLeft <= embedded + 0.01;
    if ((capitalLeft <= 0.01 && !openDue) || duesSettled || debitClearsResidual) {
      const cleared = afterCollectDues(member, today);
      const balanceLeft = money(creditLeftover > 0.01 ? -creditLeftover : 0);
      const settled = stampCredit({
        ...cleared,
        ...openSnapshot,
        outstandingBalance: balanceLeft,
        lastPaymentDate: date,
        paymentHistory: history,
      });
      return {
        member: settled,
        payment,
        fullyPaid: true,
        ledgerEntry: ledgerPago(settled, payment),
      };
    }
    const next = stampCredit({
      ...withPaidParts(member, imputed.capital, imputed.surcharge),
      ...openSnapshot,
      outstandingBalance: capitalLeft,
      nextDueDate: openDue || member.nextDueDate,
      lastPaymentDate: date,
      paymentHistory: history,
    });
    return {
      member: next,
      payment,
      fullyPaid: capitalLeft <= 0.01,
      ledgerEntry: ledgerPago(next, payment),
    };
  }

  const paidCapital = imputed ? imputed.capital : (lines.quota || 0);
  const paidSurcharge = imputed ? imputed.surcharge : (lines.surcharge || 0);

  if (remainingCash > 0.01) {
    const next = stampCredit({
      ...withPaidParts(member, paidCapital, paidSurcharge),
      ...openSnapshot,
      outstandingBalance: money(Math.max(0, stored - paidCapital)),
      lastPaymentDate: date,
      paymentHistory: history,
    });
    return {
      member: next,
      payment,
      fullyPaid: false,
      ledgerEntry: ledgerPago(next, payment),
    };
  }

  if (remainingChoices.length) {
    const remainingCapital = money(
      remainingChoices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0),
    );
    const next = stampCredit({
      ...withPaidParts(member, paidCapital, paidSurcharge),
      ...openSnapshot,
      outstandingBalance: remainingCapital,
      nextDueDate: remainingChoices[0].dueOn,
      lastPaymentDate: date,
      paymentHistory: history,
    });
    return {
      member: next,
      payment,
      fullyPaid: false,
      ledgerEntry: ledgerPago(next, payment),
    };
  }

  const cleared = afterCollectDues(member, today);
  const leftoverCredit = creditLeftover > 0.01
    ? creditLeftover
    : money(preview.leftover || 0);
  const balanceLeft = leftoverCredit > 0.01 ? money(-leftoverCredit) : 0;
  const next = stampCredit({
    ...cleared,
    ...openSnapshot,
    outstandingBalance: balanceLeft,
    lastPaymentDate: date,
    paymentHistory: history,
  });
  return {
    member: next,
    payment,
    fullyPaid: true,
    ledgerEntry: paidAmount > 0.01 ? ledgerPago(next, payment) : null,
  };
}

/**
 * Próximo cobro. Si hay saldo a favor, se descuenta en este pago.
 * Lo que sobra queda a favor para el siguiente.
 * `periodDueOns` marca qué meses entran en el recibo.
 *
 * Crédito = outstanding negativo o `creditBalance` explícito.
 * Nunca la diferencia unpaidCapital − outstanding (eso es desync / alerta).
 */
export function collectionPreview(member, today = new Date(), {
  periodDueOns = null,
  skipSurcharge = false,
  chargeScope = 'all',
  ledgerLines = null,
  payments = null,
  imputations = null,
} = {}) {
  const choices = collectionPeriodChoices(member, today, { chargeScope });
  const selected = Array.isArray(periodDueOns) && periodDueOns.length
    ? periodDueOns.map((value) => String(value || '').slice(0, 10)).filter(Boolean)
    : choices.map((row) => row.dueOn);
  const selectedChoices = choices.filter((row) => selected.includes(String(row.dueOn).slice(0, 10)));
  const stored = Number(member?.outstandingBalance) || 0;
  const explicitCredit = memberCreditBalance(member);
  const desync = duesBalanceDesync(member);
  const ledgerOpts = { ledgerLines, payments, imputations };

  if (selectedChoices.some((row) => row.kind === 'overdue') || stored > 0.01) {
    const quota = money(selectedChoices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
    const surcharge = skipSurcharge
      ? 0
      : money(selectedChoices.reduce((sum, row) => sum + (Number(row.surcharge) || 0), 0));
    let gross = money(quota + surcharge);
    // Saldo de ficha sin mes entero a tarifa: cobrar el residual, no inventar mes ni crédito.
    if (!(gross > 0.01) && stored > 0.01) {
      gross = money(Math.max(0, stored));
    }
    const credit = explicitCredit;
    const creditApplied = money(Math.min(credit, gross));
    return attachLedgerDesync({
      quota,
      surcharge,
      gross,
      creditApplied,
      cash: money(gross - creditApplied),
      leftover: money(credit - creditApplied),
      periods: selectedChoices,
      choices,
      clear: false,
      skipSurcharge: Boolean(skipSurcharge),
      ...(desync ? { balanceDesync: desync } : {}),
      ...(!(quota > 0.01) && stored > 0.01 ? { residualBalance: true } : {}),
    }, member, ledgerOpts);
  }

  // Al día (saldo 0) y sin mes abierto: no inventar adelanto (ej. diciembre en noviembre).
  // Con saldo a favor sí se permite imputar al próximo período.
  if (!selectedChoices.length && stored >= -0.01) {
    return attachLedgerDesync({
      quota: 0,
      surcharge: 0,
      gross: 0,
      creditApplied: 0,
      cash: 0,
      leftover: 0,
      periods: [],
      choices,
      clear: true,
      skipSurcharge: Boolean(skipSurcharge),
    }, member, ledgerOpts);
  }

  const dueOn = selectedChoices[0]?.dueOn || member?.nextDueDate || nextDuesDueDate(today, member);
  const capitalOnly = money(
    selectedChoices[0]?.capital
    || duesAmountForMember(member, dueOn)
    || referenceMonthlyDues(member, member?.paymentHistory),
  );
  const gross = skipSurcharge
    ? capitalOnly
    : money(
      selectedChoices[0]?.payable
      || duesPayableForMember(member, { paidOn: today, dueOn, on: dueOn })
      || capitalOnly,
    );
  const split = duesChargeBreakdown(member, { paidOn: today, dueOn, on: dueOn, amount: gross });
  const credit = explicitCredit;
  const creditApplied = money(Math.min(credit, gross));
  const surcharge = skipSurcharge ? 0 : split.surcharge;
  const quota = skipSurcharge ? gross : split.quota;
  return attachLedgerDesync({
    quota,
    surcharge,
    gross,
    creditApplied,
    cash: money(gross - creditApplied),
    leftover: money(credit - creditApplied),
    periods: selectedChoices,
    choices,
    clear: false,
    skipSurcharge: Boolean(skipSurcharge),
  }, member, ledgerOpts);
}

/** Anticipo de cuota cuando está al día (paga el próximo período). */
export function payUpcomingDues(member, { method = 'transferencia', today = new Date() } = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  if (isFamilyDependent(member)) throw new Error('El cobro va a la cuenta del titular.');
  if (isDuesExemptMember(member)) throw new Error('Esta categoría no abona cuota social.');
  const skipSurcharge = duesMethodSkipsSurcharge(method);
  if ((Number(member.outstandingBalance) || 0) > 0) {
    return payMemberDues(member, { method, today, skipSurcharge });
  }
  const preview = collectionPreview(member, today, { skipSurcharge });
  const date = todayISODateAR(today);
  const time = nowTimeAR(today);
  const paidAt = today.toISOString();
  const monthPhrase = duesMonthsPhrase((preview.periods || []).map((row) => row.dueOn));
  const payment = {
    id: `pay-${member.memberId}-${Date.now()}`,
    date,
    time,
    paidAt,
    createdAt: paidAt,
    concept: duesChargeConcept(monthPhrase, {
      prefix: 'Cuota social anticipada',
      empty: `Cuota social anticipada · ${duesMethodLabel(method)}`,
    }),
    amount: preview.cash,
    adelanto: true,
    quota: preview.quota,
    surcharge: skipSurcharge ? 0 : preview.surcharge,
    waivedSurcharge: 0,
    creditApplied: preview.creditApplied,
    method,
    status: 'paid',
    receipt: receiptNumberFor(member, date),
    receiptNumber: receiptNumberFor(member, date),
    period: monthPhrase || today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
    periodDueOns: (preview.periods || []).map((row) => row.dueOn).filter(Boolean),
    balanceBefore: Number(member.outstandingBalance) || 0,
    nextDueBefore: member.nextDueDate || null,
    lastPaymentBefore: member.lastPaymentDate || null,
  };
  const advanced = afterCollectDues({
    ...member,
    outstandingBalance: preview.gross,
    nextDueDate: member.nextDueDate,
  }, today);
  const next = {
    ...advanced,
    outstandingBalance: preview.leftover > 0 ? -preview.leftover : 0,
    lastPaymentDate: date,
    paymentHistory: [payment, ...(member.paymentHistory || [])],
  };
  return {
    member: next,
    payment,
    fullyPaid: true,
    ledgerEntry: preview.cash > 0 ? ledgerPago(next, payment) : null,
  };
}

/**
 * Cobro operativo único: saldo vivo + historial + asiento de cuenta + diario.
 * Efectivo acredita; transferencia, tarjeta y débito exigen comprobante; MP deja QR.
 */
export function recordDuesCollection(member, {
  method = 'efectivo',
  bankId = null,
  bankName = null,
  journalAccount = null,
  receiptName = null,
  receiptAttachment = null,
  amount = null,
  today = new Date(),
  members = [],
  periodDueOns = null,
  /** Cobranza ya en banco (Sin identificar / Galicia): entra directo a cuota sin re-subir archivo. */
  treasuryMatch = false,
  paymentPlanId = null,
  paymentPlanLabel = null,
  paymentPlans = null,
  receiptParse = null,
  paymentSplits = null,
  cardFinancing = null,
  financingPercent = null,
  financingFixed = null,
  operatorRole = null,
  discount = 0,
  discountDetail = '',
  chargeScope = 'all',
  monthlyAmount = null,
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const account = billingAccountMember(member, members);
  if (!account) throw new Error('El cobro va a la cuenta del titular. No está en el padrón.');
  const scope = String(chargeScope || '').trim().toLowerCase();
  if (scope === 'abono_tenis' || scope === 'addon' || scope === 'tenis') {
    return recordTennisAbonoCollection(member, {
      method,
      bankId,
      bankName,
      journalAccount,
      receiptName,
      receiptAttachment,
      amount,
      today,
      members,
      periodDueOns,
      monthlyAmount,
      treasuryMatch,
      paymentPlanId,
      paymentPlanLabel,
      paymentPlans,
      receiptParse,
      paymentSplits,
      cardFinancing,
      financingPercent,
      financingFixed,
      discount,
      discountDetail,
    });
  }
  if (isDuesExemptMember(account)) throw new Error('Esta categoría no abona cuota social.');

  const wantsMixed = method === 'mixto'
    || (Array.isArray(paymentSplits) && paymentSplits.filter((row) => Number(row?.amount) > 0).length >= 2);
  const received = amount != null ? money(amount) : null;
  const quotedGross = received == null
    ? collectionPreview(account, today, {
      periodDueOns,
      skipSurcharge: !wantsMixed && duesMethodSkipsSurcharge(method),
      chargeScope,
    }).cash
    : money(received + money(discount || 0));
  const concession = collectionDiscount(quotedGross, { discount, detail: discountDetail });
  let mixed = null;
  if (wantsMixed) {
    const previewCash = received != null ? received : concession.cash;
    const mixedPreview = collectionPreview(account, today, {
      periodDueOns,
      skipSurcharge: false,
      chargeScope,
    });
    mixed = validatePaymentSplits(paymentSplits, previewCash > 0 ? previewCash : amount, {
      treasuryMatch,
      plans: paymentPlans || [],
      operatorRole,
      capital: mixedPreview.quota,
      surcharge: mixedPreview.surcharge,
    });
  }

  const resolvedMethod = mixed
    ? 'mixto'
    : (isOnAccountDuesMethod(method) ? 'a_cuenta' : method);
  const skipSurcharge = !mixed && duesMethodSkipsSurcharge(resolvedMethod);
  const manual = !mixed && isManualDuesReceipt(receiptParse);
  if (!mixed && receiptParse?.source === 'manual' && !manual) {
    throw new Error('Completá la referencia del comprobante manual.');
  }
  const attachmentName = receiptAttachment?.name
    || receiptName
    || (manual ? manualDuesReceiptLabel(receiptParse) : null);
  const attachmentPath = receiptAttachment?.path || null;
  if (!mixed && !(concession.discount > 0.009 && concession.cash <= 0.009)) {
    const needsReceipt = duesMethodNeedsReceipt(resolvedMethod);
    if (needsReceipt && !attachmentName) {
      throw new Error(duesReceiptRequiredMessage(resolvedMethod));
    }
    if (needsReceipt && !attachmentPath && !treasuryMatch && !manual) {
      throw new Error('No se pudo guardar el comprobante en Supabase.');
    }
  }

  const choices = collectionPeriodChoices(account, today, { chargeScope });
  const hasOverdue = choices.some((row) => row.kind === 'overdue');
  const due = Number(account.outstandingBalance) || 0;
  if (concession.discount > 0 && !(due > 0 || hasOverdue)) {
    throw new Error('El descuento es sobre la cuota adeudada.');
  }
  const collectAmount = concession.discount > 0
    ? concession.gross
    : (mixed ? mixed.total : amount);
  const paid = (due > 0 || hasOverdue)
    ? payMemberDues(account, {
      method: resolvedMethod,
      amount: collectAmount,
      today,
      periodDueOns,
      skipSurcharge,
      chargeScope,
    })
    : payUpcomingDues(account, { method: resolvedMethod, today });

  const label = mixed
    ? `Pago mixto (${mixed.splits.map((row) => row.label).join(' + ')})`
    : duesMethodLabel(resolvedMethod, bankName);
  const cashAccount = mixed
    ? null
    : (journalAccount || journalAccountForPayment(resolvedMethod, bankId));
  const receiptNote = !mixed && attachmentName ? ` · Comp: ${attachmentName}` : '';
  const planLabel = String(paymentPlanLabel || '').trim();
  const planNote = !mixed && isCardPosDuesMethod(resolvedMethod) && planLabel ? ` · Plan: ${planLabel}` : '';
  const mixedNote = mixed
    ? ` · ${mixed.splits.map((row) => `${row.label} ${row.amount}`).join(' + ')}`
    : '';
  const primarySplit = mixed?.splits[0] || null;
  const payment = {
    ...paid.payment,
    method: resolvedMethod,
    bankId: mixed ? null : (duesMethodUsesBank(resolvedMethod) ? bankId : null),
    bankName: mixed ? null : (duesMethodUsesBank(resolvedMethod) ? bankName : null),
    journalAccount: cashAccount,
    receiptName: mixed ? (primarySplit?.receiptName || null) : attachmentName,
    receiptPath: mixed ? (primarySplit?.receiptPath || null) : attachmentPath,
    receiptBucket: mixed
      ? (primarySplit?.receiptBucket || null)
      : (receiptAttachment?.bucket || (attachmentPath ? 'dues-receipts' : null)),
    receiptMime: mixed ? (primarySplit?.receiptMime || null) : (receiptAttachment?.mimeType || null),
    receiptSize: mixed ? (primarySplit?.receiptSize ?? null) : (receiptAttachment?.size || null),
    receiptAttachment: mixed
      ? (primarySplit?.receiptAttachment || null)
      : (attachmentPath
        ? {
          path: attachmentPath,
          bucket: receiptAttachment?.bucket || 'dues-receipts',
          name: attachmentName,
          mimeType: receiptAttachment?.mimeType || '',
          size: receiptAttachment?.size || 0,
        }
        : null),
    receiptNumber: paid.payment.receiptNumber || paid.payment.receipt,
    receipt: paid.payment.receiptNumber || paid.payment.receipt,
    concept: `${paid.payment.concept}${receiptNote}${planNote}${mixedNote}`,
    collectedFromMemberId: account.memberId !== member.memberId ? member.memberId : null,
    collectedFromName: account.memberId !== member.memberId ? member.name : null,
    paymentPlanId: mixed ? null : (isCardPosDuesMethod(resolvedMethod) ? (paymentPlanId || null) : null),
    paymentPlanLabel: mixed ? null : (isCardPosDuesMethod(resolvedMethod) ? (planLabel || null) : null),
    receiptParse: mixed ? null : (receiptParse && typeof receiptParse === 'object' ? receiptParse : null),
    voucherAmount: mixed
      ? null
      : (isCardPosDuesMethod(resolvedMethod)
        ? null // se completa abajo con cardFinancing
        : null),
    cardFinancing: null,
    paymentPlanSnapshot: null,
    paymentSplits: mixed ? mixed.splits : null,
    amount: concession.discount > 0 ? concession.cash : paid.payment.amount,
    discount: concession.discount,
    discountDetail: concession.detail || null,
  };

  if (!mixed && isCardPosDuesMethod(resolvedMethod)) {
    // B10: financiar solo capital (quota); la mora no entra en la tasa.
    const capitalBase = money(payment.quota != null ? payment.quota : payment.amount);
    const surchargePart = money(payment.surcharge || 0);
    const fin = resolveCardFinancingForPos({
      socialAmount: capitalBase,
      financingBase: capitalBase,
      surchargeAmount: surchargePart,
      paymentPlanId,
      plans: paymentPlans || [],
      percent: financingPercent,
      fixedAmount: financingFixed,
      voucherAmount: receiptParse?.amount != null ? Number(receiptParse.amount) : null,
      receiptParse,
      cardFinancing,
      operatorRole,
    });
    payment.cardFinancing = fin;
    payment.paymentPlanSnapshot = fin?.paymentPlanSnapshot || null;
    payment.voucherAmount = resolvePosVoucherAmount(payment.amount, fin, receiptParse?.amount);
  }

  const memberNext = {
    ...paid.member,
    paymentHistory: [payment, ...(paid.member.paymentHistory || []).filter((row) => row.id !== paid.payment.id)],
  };

  // Comprobante a cuenta: cuánto entregó y cuánto queda de deuda (con mora viva).
  const remainingPreview = collectionPreview(memberNext, today, {
    skipSurcharge: skipSurcharge,
  });
  const storedAfter = Number(memberNext.outstandingBalance) || 0;
  const balanceRemaining = storedAfter < -0.01
    ? 0
    : money(remainingPreview.clear ? 0 : remainingPreview.cash);
  const creditAfter = storedAfter < -0.01 ? money(-storedAfter) : money(payment.creditLeftover || 0);
  const paymentWithBalance = {
    ...payment,
    methodLabel: label,
    balanceRemaining,
    ...(creditAfter > 0.01 ? { creditLeftover: creditAfter } : {}),
  };
  memberNext.paymentHistory = [
    paymentWithBalance,
    ...(memberNext.paymentHistory || []).filter((row) => row.id !== payment.id),
  ];

  const discountNote = concession.discount > 0 ? ` · Descuento ${concession.detail}` : '';
  const cobroLabel = resolvedMethod === 'a_cuenta' ? 'Cobro a cuenta' : 'Cobro cuota social';
  const financingNote = paymentWithBalance.cardFinancing?.financingAmount > 0.009
    ? ` · Financ. ${money(paymentWithBalance.cardFinancing.financingAmount)}`
    : '';
  let journalEntry = null;
  if (paymentWithBalance.amount > 0 || concession.discount > 0) {
    const income = money(paymentWithBalance.amount + concession.discount);
    journalEntry = {
      date: paymentWithBalance.date,
      description: `${cobroLabel} (${label}) - Socio: ${account.name} (Cred. ${account.memberId})${receiptNote}${planNote}${discountNote}${financingNote}`,
      lines: buildDuesCollectionJournalLines({
        cashReceived: paymentWithBalance.amount,
        socialIncome: income,
        discount: concession.discount,
        cashAccount,
        mixedSplits: mixed ? mixed.splits : null,
        cardFinancing: paymentWithBalance.cardFinancing,
        isCardPos: !mixed && isCardPosDuesMethod(resolvedMethod),
      }),
      sourceModule: 'cuotas',
      sourceId: paymentWithBalance.id,
      memberId: account.memberId,
    };
  }

  return {
    member: memberNext,
    payment: paymentWithBalance,
    fullyPaid: paid.fullyPaid,
    ledgerEntry: paid.ledgerEntry ? ledgerPago(memberNext, paymentWithBalance) : null,
    journalEntry,
  };
}

/**
 * Cobro solo del abono tenis (independiente de la cuota social).
 * Sin 10 %; no marca los meses de cuota como pagos; baja el saldo de ficha si hay capital.
 */
export function payTennisAbono(member, {
  method = 'efectivo',
  amount = null,
  today = new Date(),
  periodDueOns = null,
  monthlyAmount = null,
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  if (isFamilyDependent(member)) throw new Error('El cobro va a la cuenta del titular.');
  const preview = collectionTennisPreview(member, today, { periodDueOns, monthlyAmount });
  if (!preview.periods.length) throw new Error('No hay abono de tenis pendiente para cobrar.');
  const due = money(preview.cash);
  const onAccount = isOnAccountDuesMethod(method);
  const paidAmount = amount != null ? money(amount) : due;
  if (!(paidAmount > 0.009)) throw new Error('Importe inválido.');
  if (paidAmount > due + 0.01 && !onAccount) {
    throw new Error('El importe supera el abono de tenis seleccionado.');
  }

  const date = todayISODateAR(today);
  const time = nowTimeAR(today);
  const paidAt = today.toISOString();
  const dueOns = preview.periods.map((row) => String(row.dueOn).slice(0, 10));
  const monthPhrase = duesMonthsPhrase(dueOns);
  const methodLabel = duesMethodLabel(method);
  const concept = monthPhrase
    ? `Abono tenis · ${monthPhrase}`
    : `Abono tenis · ${methodLabel}`;
  const imputations = preview.periods.map((row) => ({
    dueOn: String(row.dueOn).slice(0, 10),
    capital: money(row.capital),
    surcharge: 0,
    capitalOpen: 0,
    surchargeOpen: 0,
    lateBase: 0,
    lateBaseTaken: 0,
    tierId: 'abono_tenis',
  }));
  const payment = {
    id: `pay-tenis-${member.memberId}-${Date.now()}`,
    date,
    time,
    paidAt,
    createdAt: paidAt,
    concept,
    amount: paidAmount,
    quota: money(Math.min(paidAmount, due)),
    surcharge: 0,
    waivedSurcharge: 0,
    method: onAccount ? 'a_cuenta' : method,
    status: 'paid',
    receipt: receiptNumberFor(member, date),
    receiptNumber: receiptNumberFor(member, date),
    period: monthPhrase || imputationSummary(imputations),
    periodDueOns: dueOns,
    imputations,
    chargeScope: 'abono_tenis',
    balanceBefore: Number(member.outstandingBalance) || 0,
    nextDueBefore: member.nextDueDate || null,
    lastPaymentBefore: member.lastPaymentDate || null,
  };

  const stored = money(Math.max(0, Number(member.outstandingBalance) || 0));
  const capitalCut = money(Math.min(stored, payment.quota));
  const nextBalance = money(stored - capitalCut);
  const next = withPaidParts({
    ...member,
    outstandingBalance: nextBalance,
    lastPaymentDate: date,
    // El vencimiento de cuota social no avanza: solo se pagó tenis.
    nextDueDate: member.nextDueDate,
    paymentHistory: [payment, ...(member.paymentHistory || [])],
  }, capitalCut, 0);

  return {
    member: next,
    payment,
    fullyPaid: paidAmount + 0.01 >= due,
    ledgerEntry: paidAmount > 0 ? ledgerPago(next, payment) : null,
  };
}

/** Persistencia operativa del cobro de abono tenis (misma caja / comprobante que cuota). */
export function recordTennisAbonoCollection(member, {
  method = 'efectivo',
  bankId = null,
  bankName = null,
  journalAccount = null,
  receiptName = null,
  receiptAttachment = null,
  amount = null,
  today = new Date(),
  members = [],
  periodDueOns = null,
  monthlyAmount = null,
  treasuryMatch = false,
  paymentPlanId = null,
  paymentPlanLabel = null,
  receiptParse = null,
  paymentSplits = null,
  paymentPlans = null,
  cardFinancing = null,
  financingPercent = null,
  financingFixed = null,
  discount = 0,
  discountDetail = '',
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const account = billingAccountMember(member, members);
  if (!account) throw new Error('El cobro va a la cuenta del titular. No está en el padrón.');
  const tennisMonthly = monthlyAmount != null && monthlyAmount !== ''
    ? money(Number(monthlyAmount) || 0)
    : duesTennisAbonoAmountForAccount(account, today);
  if (!(tennisMonthly > 0.01) && !(monthlyAmount > 0)) {
    throw new Error('Esta cuenta no tiene abono de tenis.');
  }

  // B6/B10: tenis no admite financiación POS ni planes con tasa predeterminada.
  assertTennisPosFinancingAllowed({
    method,
    paymentPlanId,
    plans: paymentPlans || [],
    cardFinancing: cardFinancing
      || (Number(financingPercent) > 0 || Number(financingFixed) > 0
        ? { financingAmount: 1 }
        : null),
    paymentSplits,
  });


  const wantsMixed = method === 'mixto'
    || (Array.isArray(paymentSplits) && paymentSplits.filter((row) => Number(row?.amount) > 0).length >= 2);
  const received = amount != null ? money(amount) : null;
  const quotedGross = received == null
    ? collectionTennisPreview(account, today, { periodDueOns, monthlyAmount: tennisMonthly }).cash
    : money(received + money(discount || 0));
  const concession = collectionDiscount(quotedGross, { discount, detail: discountDetail });
  let mixed = null;
  if (wantsMixed) {
    const previewCash = received != null ? received : concession.cash;
    mixed = validatePaymentSplits(paymentSplits, previewCash > 0 ? previewCash : amount, { treasuryMatch });
  }

  const resolvedMethod = mixed
    ? 'mixto'
    : (isOnAccountDuesMethod(method) ? 'a_cuenta' : method);
  const manual = !mixed && isManualDuesReceipt(receiptParse);
  if (!mixed && receiptParse?.source === 'manual' && !manual) {
    throw new Error('Completá la referencia del comprobante manual.');
  }
  const attachmentName = receiptAttachment?.name
    || receiptName
    || (manual ? manualDuesReceiptLabel(receiptParse) : null);
  const attachmentPath = receiptAttachment?.path || null;
  if (!mixed && !(concession.discount > 0.009 && concession.cash <= 0.009)) {
    const needsReceipt = duesMethodNeedsReceipt(resolvedMethod);
    if (needsReceipt && !attachmentName) {
      throw new Error(duesReceiptRequiredMessage(resolvedMethod));
    }
    if (needsReceipt && !attachmentPath && !treasuryMatch && !manual) {
      throw new Error('No se pudo guardar el comprobante en Supabase.');
    }
  }

  const collectAmount = concession.discount > 0
    ? concession.gross
    : (mixed ? mixed.total : amount);
  const paid = payTennisAbono(account, {
    method: resolvedMethod,
    amount: collectAmount,
    today,
    periodDueOns,
    monthlyAmount: tennisMonthly,
  });

  const label = mixed
    ? `Pago mixto (${mixed.splits.map((row) => row.label).join(' + ')})`
    : duesMethodLabel(resolvedMethod, bankName);
  const cashAccount = mixed
    ? null
    : (journalAccount || journalAccountForPayment(resolvedMethod, bankId));
  const receiptNote = !mixed && attachmentName ? ` · Comp: ${attachmentName}` : '';
  const planLabel = String(paymentPlanLabel || '').trim();
  const planNote = !mixed && isCardPosDuesMethod(resolvedMethod) && planLabel ? ` · Plan: ${planLabel}` : '';
  const mixedNote = mixed
    ? ` · ${mixed.splits.map((row) => `${row.label} ${row.amount}`).join(' + ')}`
    : '';
  const primarySplit = mixed?.splits[0] || null;
  const payment = {
    ...paid.payment,
    method: resolvedMethod,
    bankId: mixed ? null : (duesMethodUsesBank(resolvedMethod) ? bankId : null),
    bankName: mixed ? null : (duesMethodUsesBank(resolvedMethod) ? bankName : null),
    journalAccount: cashAccount,
    receiptName: mixed ? (primarySplit?.receiptName || null) : attachmentName,
    receiptPath: mixed ? (primarySplit?.receiptPath || null) : attachmentPath,
    receiptBucket: mixed
      ? (primarySplit?.receiptBucket || null)
      : (receiptAttachment?.bucket || (attachmentPath ? 'dues-receipts' : null)),
    receiptMime: mixed ? (primarySplit?.receiptMime || null) : (receiptAttachment?.mimeType || null),
    receiptSize: mixed ? (primarySplit?.receiptSize ?? null) : (receiptAttachment?.size || null),
    receiptAttachment: mixed
      ? (primarySplit?.receiptAttachment || null)
      : (attachmentPath
        ? {
          path: attachmentPath,
          bucket: receiptAttachment?.bucket || 'dues-receipts',
          name: attachmentName,
          mimeType: receiptAttachment?.mimeType || '',
          size: receiptAttachment?.size || 0,
        }
        : null),
    receiptNumber: paid.payment.receiptNumber || paid.payment.receipt,
    receipt: paid.payment.receiptNumber || paid.payment.receipt,
    concept: `${paid.payment.concept}${receiptNote}${planNote}${mixedNote}`,
    collectedFromMemberId: account.memberId !== member.memberId ? member.memberId : null,
    collectedFromName: account.memberId !== member.memberId ? member.name : null,
    paymentPlanId: mixed ? null : (isCardPosDuesMethod(resolvedMethod) ? (paymentPlanId || null) : null),
    paymentPlanLabel: mixed ? null : (isCardPosDuesMethod(resolvedMethod) ? (planLabel || null) : null),
    receiptParse: mixed ? null : (receiptParse && typeof receiptParse === 'object' ? receiptParse : null),
    voucherAmount: mixed
      ? null
      : (isCardPosDuesMethod(resolvedMethod)
        ? duesVoucherAmount(
          { receiptParse },
          concession.discount > 0 ? concession.cash : paid.payment.amount,
        )
        : null),
    paymentSplits: mixed ? mixed.splits : null,
    amount: concession.discount > 0 ? concession.cash : paid.payment.amount,
    discount: concession.discount,
    discountDetail: concession.detail || null,
    chargeScope: 'abono_tenis',
  };

  const memberNext = {
    ...paid.member,
    paymentHistory: [payment, ...(paid.member.paymentHistory || []).filter((row) => row.id !== paid.payment.id)],
  };
  const paymentWithBalance = {
    ...payment,
    methodLabel: label,
    balanceRemaining: money(Math.max(0, Number(memberNext.outstandingBalance) || 0)),
  };
  memberNext.paymentHistory = [
    paymentWithBalance,
    ...(memberNext.paymentHistory || []).filter((row) => row.id !== payment.id),
  ];

  const discountNote = concession.discount > 0 ? ` · Descuento ${concession.detail}` : '';
  const cobroLabel = 'Cobro abono tenis';
  let journalEntry = null;
  if (paymentWithBalance.amount > 0 || concession.discount > 0) {
    const income = money(paymentWithBalance.amount + concession.discount);
    const discountLine = concession.discount > 0
      ? [{ account: DUES_DISCOUNT_ACCOUNT, type: 'debit', amount: concession.discount }]
      : [];
    if (mixed) {
      const byAccount = new Map();
      mixed.splits.forEach((row) => {
        const key = row.journalAccount || 'Caja General';
        byAccount.set(key, money((byAccount.get(key) || 0) + row.amount));
      });
      journalEntry = {
        date: paymentWithBalance.date,
        description: `${cobroLabel} (${label}) - Socio: ${account.name} (Cred. ${account.memberId})${discountNote}`,
        lines: [
          ...[...byAccount.entries()].map(([accountName, value]) => ({
            account: accountName,
            type: 'debit',
            amount: value,
          })),
          ...discountLine,
          { account: 'Cuotas Sociales', type: 'credit', amount: income },
        ],
        sourceModule: 'cuotas',
        sourceId: paymentWithBalance.id,
        memberId: account.memberId,
      };
    } else {
      journalEntry = {
        date: paymentWithBalance.date,
        description: `${cobroLabel} (${label}) - Socio: ${account.name} (Cred. ${account.memberId})${receiptNote}${planNote}${discountNote}`,
        lines: [
          ...(paymentWithBalance.amount > 0
            ? [{ account: cashAccount, type: 'debit', amount: paymentWithBalance.amount }]
            : []),
          ...discountLine,
          { account: 'Cuotas Sociales', type: 'credit', amount: income },
        ],
        sourceModule: 'cuotas',
        sourceId: paymentWithBalance.id,
        memberId: account.memberId,
      };
    }
  }

  return {
    member: memberNext,
    payment: paymentWithBalance,
    fullyPaid: paid.fullyPaid,
    ledgerEntry: paid.ledgerEntry ? ledgerPago(memberNext, paymentWithBalance) : null,
    journalEntry,
  };
}

/**
 * Borra el recargo de un cobro ya registrado. El importe cobrado queda.
 * El recargo pasa a saldo a favor. No se perdona en el mostrador.
 */
export function removeDuesSurcharge(member, paymentId, {
  removedBy = 'Administración',
  reason = '',
  today = new Date(),
} = {}) {
  const why = String(reason || '').trim();
  if (why.length < 8) {
    throw new Error('Falta el motivo para quitar el recargo (mínimo 8 caracteres).');
  }
  if (!member) throw new Error('Socio no encontrado.');
  const history = member.paymentHistory || [];
  const payment = history.find((row) => row && String(row.id) === String(paymentId));
  if (!payment) throw new Error('No se encontró el cobro.');
  if (payment.status === 'void' || payment.status === 'cancelled') {
    throw new Error('Ese cobro está anulado.');
  }
  const surcharge = money(payment.surcharge);
  if (surcharge <= 0) throw new Error('Este cobro no tiene recargo.');
  const removedAt = today instanceof Date ? today.toISOString() : String(today);
  const nextPayment = {
    ...payment,
    surcharge: 0,
    removedSurcharge: surcharge,
    surchargeRemovedBy: removedBy,
    surchargeRemovedAt: removedAt,
    surchargeRemoveReason: why,
  };
  const next = {
    ...member,
    outstandingBalance: money((Number(member.outstandingBalance) || 0) - surcharge),
    paymentHistory: history.map((row) => (row.id === payment.id ? nextPayment : row)),
    updatedAt: removedAt,
  };
  return { member: next, payment: nextPayment };
}

/**
 * Anula un cobro de cuota: deja el rastro y restaura el saldo.
 * No borra el movimiento. En pago mixto revierte cada medio a su cuenta.
 */
export function voidMemberDuesPayment(member, paymentId, {
  voidedBy = 'Administración',
  voidedById = null,
  reason = '',
  today = new Date(),
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const history = member.paymentHistory || [];
  const payment = history.find((row) => row && String(row.id) === String(paymentId));
  if (!payment) throw new Error('No se encontró el cobro.');
  if (payment.status === 'void' || payment.status === 'cancelled' || payment.voidedAt) {
    throw new Error('Ese cobro ya está anulado.');
  }
  if (payment.posChargebackPending || payment.meta?.posChargebackPending) {
    assertPosFinancingOperationSupported('chargeback');
  }
  if (payment.posSettlementPending || payment.meta?.posSettlementPending) {
    assertPosFinancingOperationSupported('settlement');
  }

  const why = String(reason || '').trim();
  if (why.length < 8) {
    throw new Error('Falta el motivo de la anulación (mínimo 8 caracteres).');
  }
  const who = String(voidedBy || 'Administración').trim() || 'Administración';
  const amount = money(payment.amount);
  const discount = money(payment.discount);
  const gross = money(amount + discount);
  const voidSplitsEarly = normalizePaymentSplits(payment.paymentSplits);
  const financingAmount = voidSplitsEarly.length >= 2
    ? money(voidSplitsEarly
      .filter((row) => row.cardFinancing?.mode === 'club_keeps')
      .reduce((sum, row) => sum + (Number(row.cardFinancing?.financingAmount) || 0), 0))
    : money(payment.cardFinancing?.mode === 'club_keeps' ? payment.cardFinancing?.financingAmount : 0);
  const voidedAt = today instanceof Date ? today.toISOString() : String(today);
  const nextPayment = {
    ...payment,
    status: 'void',
    voidedBy: voidedById || who,
    voidedByName: who,
    voidedAt,
    voidReason: why,
  };
  const restoredBalance = payment.balanceBefore != null
    ? money(payment.balanceBefore)
    : money((Number(member.outstandingBalance) || 0) + amount);
  const next = {
    ...member,
    outstandingBalance: restoredBalance,
    nextDueDate: ('nextDueBefore' in payment ? payment.nextDueBefore : null) || member.nextDueDate,
    lastPaymentDate: ('lastPaymentBefore' in payment ? payment.lastPaymentBefore : null) || null,
    unpaidCapital: payment.balanceBefore != null
      ? money(Math.max(0, Number(payment.balanceBefore) || 0))
      : member.unpaidCapital,
    paymentHistory: history.map((row) => (row.id === payment.id ? nextPayment : row)),
    updatedAt: voidedAt,
  };

  const splits = normalizePaymentSplits(payment.paymentSplits);
  let creditLines;
  if (splits.length >= 2) {
    const byAccount = new Map();
    splits.forEach((row) => {
      const fin = row.cardFinancing?.mode === 'club_keeps'
        ? money(row.cardFinancing?.financingAmount)
        : 0;
      const key = row.journalAccount
        || journalAccountForPayment(row.method, row.bankId)
        || 'Caja General';
      byAccount.set(key, money((byAccount.get(key) || 0) + row.amount + fin));
    });
    creditLines = [...byAccount.entries()].map(([accountName, value]) => ({
      account: accountName,
      type: 'credit',
      amount: value,
    }));
  } else {
    const cardFin = payment.cardFinancing?.mode === 'club_keeps'
      ? money(payment.cardFinancing?.financingAmount)
      : 0;
    creditLines = amount > 0.009 || cardFin > 0.009
      ? [{
        account: payment.journalAccount
          || journalAccountForPayment(payment.method, payment.bankId)
          || 'Caja General',
        type: 'credit',
        amount: money(amount + cardFin),
      }]
      : [];
  }
  const discountCredit = discount > 0.009
    ? [{ account: DUES_DISCOUNT_ACCOUNT, type: 'credit', amount: discount }]
    : [];
  const financingDebit = financingAmount > 0.009
    ? [{ account: POS_FINANCING_INCOME_ACCOUNT, type: 'debit', amount: financingAmount }]
    : [];

  const receiptRef = nextPayment.receiptNumber || nextPayment.receipt || paymentId;
  const ledgerEntry = createAccountEntry({
    id: `void-${payment.id}`,
    type: 'cuota',
    memberNumber: member.memberId,
    memberName: member.name,
    value: gross > 0.009 ? gross : amount,
    date: todayISODateAR(today),
    voucher: receiptRef,
    source: 'dues_void',
    description: `Anulación cobro cuota social · ${receiptRef} · ${why}`,
  });

  return {
    member: next,
    payment: nextPayment,
    ledgerEntry,
    journalEntry: gross > 0.009 || creditLines.length || financingDebit.length
      ? {
        date: todayISODateAR(today),
        description: `Anulación cobro cuota social (${who}) - Socio: ${member.name} (Cred. ${member.memberId}) · ${receiptRef} · ${why}`,
        lines: [
          { account: POS_DUES_INCOME_ACCOUNT, type: 'debit', amount: gross > 0.009 ? gross : amount },
          ...financingDebit,
          ...creditLines,
          ...discountCredit,
        ],
        sourceModule: 'cuotas',
        sourceId: payment.id,
        memberId: member.memberId,
        status: 'posted',
      }
      : null,
  };
}

export async function persistDuesVoid(result, {
  setMembers,
  updateMember,
  addJournalEntry,
  onAccountEntry,
} = {}) {
  return persistDuesCollection(result, {
    setMembers,
    updateMember,
    addJournalEntry,
    onAccountEntry,
  });
}

/** El asiento de caja nombra al socio. En la ficha no se muestra: el cobro ya está en el historial. */
export function isDuesCollectionJournal(entry) {
  if (entry?.sourceModule === 'cuotas') return true;
  return /^Cobro cuota social\b/i.test(String(entry?.description || ''));
}

/** Credencial completa, no un prefijo: "244" no es "244346". */
export function journalEntryBelongsToMember(entry, member) {
  if (!entry || !member?.memberId) return false;
  const id = String(member.memberId);
  if (entry.memberId != null && String(entry.memberId) === id) return true;
  const text = String(entry.description || '');
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\(Cred\\.\\s*${escaped}(?:\\.{3}|…)?\\)`, 'i').test(text);
}

const PAYMENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedPaymentId(id) {
  return PAYMENT_UUID.test(String(id || ''));
}

/** Cobro armado en el navegador, todavía sin fila en member_payments. */
export function localDuesPayment(previous, next) {
  const prevHist = previous?.paymentHistory || [];
  const nextHist = next?.paymentHistory || [];
  if (nextHist.length <= prevHist.length) return null;
  const newest = nextHist[0];
  if (!newest || isPersistedPaymentId(newest.id)) return null;
  return newest;
}

function cobroSchedule(member, payment) {
  // La ficha que llega acá ya tiene el cobro en el historial y el vencimiento
  // del mes que sigue. Si se usa esa foto, los meses del recibo figuran pagos
  // y todo el saldo cae en 1900-01-10, sin lugar para el interés.
  const history = (member?.paymentHistory || []).filter((row) => row && row.id !== payment?.id);
  const before = {
    ...member,
    paymentHistory: history,
    outstandingBalance: payment.balanceBefore ?? member.outstandingBalance,
    nextDueDate: payment && 'nextDueBefore' in payment ? payment.nextDueBefore : member.nextDueDate,
    lastPaymentDate: payment && 'lastPaymentBefore' in payment ? payment.lastPaymentBefore : member.lastPaymentDate,
    duesOpenPeriods: payment && 'duesOpenPeriodsBefore' in payment
      ? payment.duesOpenPeriodsBefore
      : member.duesOpenPeriods,
    unpaidCapital: payment && 'unpaidCapitalBefore' in payment
      ? payment.unpaidCapitalBefore
      : member.unpaidCapital,
  };
  const paidOn = payment.paidAt || payment.date || new Date();
  if (paymentIsTennisAbonoOnly(payment)) {
    const monthly = payment.monthlyAmount != null
      ? money(Number(payment.monthlyAmount) || 0)
      : null;
    const tennisChoices = collectionTennisPeriodChoices(before, paidOn, {
      monthlyAmount: monthly > 0 ? monthly : undefined,
    });
    const selected = Array.isArray(payment.periodDueOns) && payment.periodDueOns.length
      ? payment.periodDueOns.map((value) => String(value || '').slice(0, 10))
      : tennisChoices.map((row) => row.dueOn);
    const rows = tennisChoices.filter((row) => selected.includes(String(row.dueOn).slice(0, 10)));
    const tennisCapital = money(rows.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
    return openPeriodsFromChoices(rows, tennisCapital).map((row) => ({ ...row, lateBase: 0 }));
  }
  const balance = Math.max(Number(before.outstandingBalance) || 0, 0);
  const choices = collectionPeriodChoices(before, paidOn);
  const choiceCapital = choices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0);
  // El saldo puede traer recargos de Lila. Esos no son otra cuota.
  const scheduleBalance = choiceCapital > 0.01 && choiceCapital < balance - 0.01
    ? choiceCapital
    : balance;
  return openPeriodsFromChoices(choices, scheduleBalance);
}

export function cobroPeriods(member, payment) {
  const tennisOnly = paymentIsTennisAbonoOnly(payment);
  const skipSurcharge = tennisOnly || duesMethodSkipsSurcharge(payment?.method);
  const schedule = cobroSchedule(member, payment).map((row) => (
    skipSurcharge ? { ...row, lateBase: 0 } : row
  ));
  const scheduleCapital = schedule.reduce((sum, row) => sum + (Number(row.capital) || 0), 0);
  const balance = Math.max(Number(payment.balanceBefore ?? member?.outstandingBalance) || 0, 0);
  const bakedSurcharge = !tennisOnly && scheduleCapital > 0.01 && balance > scheduleCapital + 0.01
    ? Math.round((balance - scheduleCapital) * 100) / 100
    : 0;
  return {
    dueOns: Array.isArray(payment.periodDueOns) ? payment.periodDueOns : [],
    schedule,
    bakedSurcharge,
    quota: payment.quota ?? null,
    surcharge: skipSurcharge ? 0 : (payment.surcharge ?? 0),
    creditApplied: payment.creditApplied ?? null,
    method: payment.method || null,
    skipSurcharge: skipSurcharge || undefined,
    concept: payment.concept || null,
    receiptNumber: payment.receiptNumber || payment.receipt || null,
    paidAt: payment.paidAt || payment.date || null,
    paidAtReason: payment.paidAtReason || payment.backdateReason || null,
    time: payment.time || null,
    balanceBefore: payment.balanceBefore ?? null,
    balanceRemaining: payment.balanceRemaining != null ? Number(payment.balanceRemaining) : null,
    creditLeftover: payment.creditLeftover != null ? Number(payment.creditLeftover) : null,
    methodLabel: payment.methodLabel || duesMethodLabel(payment.method, payment.bankName),
    nextDueBefore: payment.nextDueBefore ?? null,
    lastPaymentBefore: payment.lastPaymentBefore ?? null,
    nextDueDate: member.nextDueDate || null,
    bankName: payment.bankName || null,
    bankId: payment.bankId || null,
    receiptName: payment.receiptName || null,
    receiptPath: payment.receiptPath || null,
    receiptBucket: payment.receiptBucket || null,
    receiptMime: payment.receiptMime || null,
    receiptSize: payment.receiptSize ?? null,
    paymentPlanId: payment.paymentPlanId || null,
    paymentPlanLabel: payment.paymentPlanLabel || null,
    paymentPlanSnapshot: payment.paymentPlanSnapshot || payment.cardFinancing?.paymentPlanSnapshot || null,
    voucherAmount: payment.voucherAmount != null ? Number(payment.voucherAmount) : null,
    cardFinancing: payment.cardFinancing || null,
    receiptParse: payment.receiptParse || null,
    journalAccount: payment.journalAccount || null,
    paymentSplits: payment.paymentSplits || null,
    // B10: base POS = capital; mora aparte (el servidor no financia surcharge).
    financingBase: payment.cardFinancing?.financingBase
      ?? payment.cardFinancing?.baseAmount
      ?? payment.quota
      ?? null,
    surchargeAmount: payment.cardFinancing?.surchargeAmount
      ?? payment.surcharge
      ?? 0,
    financingPercent: payment.cardFinancing?.percent ?? null,
    financingFixed: payment.cardFinancing?.fixedAmount ?? null,
    waiveSurcharge: Number(payment.waivedSurcharge) > 0,
    waivedSurcharge: Number(payment.waivedSurcharge) || 0,
    discount: Number(payment.discount) || 0,
    discountDetail: payment.discountDetail || null,
    adelanto: payment.adelanto === true,
    importSource: payment.importSource || null,
    ...(tennisOnly ? { chargeScope: 'abono_tenis' } : {}),
  };
}

/** Cobro con tramo POS (simple o mixto) → RPC atómica en servidor. */
export function duesCollectionNeedsPosAtomicCommit(payment) {
  if (!payment) return false;
  if (isCardPosDuesMethod(payment.method)) return true;
  if (payment.method === 'mixto' && Array.isArray(payment.paymentSplits)) {
    return payment.paymentSplits.some((row) => isCardPosDuesMethod(row?.method));
  }
  return false;
}

/**
 * Recibo, períodos y saldo en una sola transacción.
 * POS: `registrar_cobro_pos` autoriza plan/tasa, acredita e inserta asiento atómico.
 * Si falla, no hay que pintar el saldo nuevo.
 */
export async function commitDuesCollection(member, payment, { journalEntry = null } = {}) {
  const memberDbId = member?.id;
  if (!memberDbId) {
    throw new Error('No se pudo registrar el cobro: el socio no está cargado en la base.');
  }
  if (Number(payment.waivedSurcharge) > 0) {
    throw new Error('El recargo no se perdona al cobrar.');
  }
  const paidDay = String(payment.date || payment.paidAt || '').slice(0, 10);
  const today = todayISODateAR();
  if (paidDay && paidDay < today) {
    const reason = String(payment.paidAtReason || payment.backdateReason || '').trim();
    if (reason.length < 8) {
      throw new Error('Falta el motivo del cobro antedatado (mínimo 8 caracteres).');
    }
  }
  const periods = cobroPeriods(member, payment);
  const amount = Number(payment.amount) || 0;
  const key = `cobro:${member.memberId}:${payment.id}`;
  const usePosAtomic = duesCollectionNeedsPosAtomicCommit(payment);
  let saved;
  let atomicJournal = null;
  const posUnavailableError = (cause) => {
    const err = new Error(
      'El cobro POS financiado no está disponible. Contactá al administrador',
    );
    err.code = 'POS_RPC_MISSING';
    err.cause = cause;
    return err;
  };
  const runClassic = async (periodsPayload) => registrarCobro({
    memberId: memberDbId,
    amount,
    periods: periodsPayload,
    idempotencyKey: key,
  });
  // B11/B13: POS solo vía RPC atómica. Sin degradación a registrar_cobro.
  // El servidor reconstruye el asiento; no se envían líneas contables del navegador.
  const runPos = async (periodsPayload) => {
    try {
      return await registrarCobroPos({
        memberId: memberDbId,
        amount,
        periods: periodsPayload,
        idempotencyKey: key,
        journal: journalEntry
          ? {
            concept: journalEntry.concept || journalEntry.description || null,
            date: journalEntry.date || null,
            fiscalPeriodId: journalEntry.fiscalPeriodId || null,
            reference: journalEntry.reference || null,
          }
          : null,
      });
    } catch (posErr) {
      if (posErr?.code === 'POS_RPC_MISSING') throw posUnavailableError(posErr);
      throw posErr;
    }
  };
  try {
    if (usePosAtomic) {
      saved = await runPos(periods);
      atomicJournal = saved.journal || null;
    } else {
      saved = await runClassic(periods);
    }
  } catch (err) {
    if (err?.code === 'POS_RPC_MISSING') throw err;
    // Bases viejas todavía pedían marcar adelanto a mano; reintentamos en silencio.
    // Misma clave: si el primer intento no insertó, no se duplica el cobro.
    const msg = String(err?.message || err || '');
    if (!/supera la deuda|marcarlo como adelanto/i.test(msg) || periods.adelanto) throw err;
    const retryPeriods = { ...periods, adelanto: true };
    if (usePosAtomic) {
      saved = await runPos(retryPeriods);
      atomicJournal = saved.journal || null;
    } else {
      saved = await runClassic(retryPeriods);
    }
  }
  const history = (member.paymentHistory || []).filter((row) => row && row.id !== payment.id);
  const tennisOnly = paymentIsTennisAbonoOnly(payment);
  // Abono tenis independiente: no avanza el vencimiento de la cuota social.
  const nextDueDate = tennisOnly
    ? (payment.nextDueBefore || member.nextDueDate || null)
    : (saved.nextDueDate || member.nextDueDate);
  const mergedPayment = {
    ...saved.payment,
    ...(tennisOnly ? { chargeScope: 'abono_tenis' } : {}),
    ...(payment.chargeScope ? { chargeScope: payment.chargeScope } : {}),
    cardFinancing: saved.payment?.cardFinancing || payment.cardFinancing || null,
    paymentPlanSnapshot: saved.payment?.paymentPlanSnapshot
      || payment.paymentPlanSnapshot
      || null,
  };
  if (tennisOnly && mergedPayment.id) {
    try {
      const patched = await patchMemberPaymentChargeScope(mergedPayment.id, 'abono_tenis', {
        memberDbId: memberDbId,
        nextDueDate,
      });
      if (patched) Object.assign(mergedPayment, patched, { chargeScope: 'abono_tenis' });
    } catch {
      /* best-effort: el concept Abono tenis alcanza para el dedupe local */
    }
  }
  const nextMember = {
    ...member,
    outstandingBalance: saved.outstandingBalance,
    nextDueDate,
    lastPaymentDate: saved.payment?.date || member.lastPaymentDate,
    paymentHistory: [mergedPayment, ...history],
  };
  return {
    member: nextMember,
    payment: mergedPayment,
    idempotent: saved.idempotent,
    journal: atomicJournal,
    authorized: saved.authorized === true,
  };
}

/**
 * Cada fila importada se inserta una sola vez. Si la clave ya está,
 * la base devuelve el cobro anterior y el saldo no vuelve a bajar.
 */
export async function persistImportedCollectionPayments(members = [], payments = []) {
  const next = [...(members || [])];
  const indexById = new Map(next.map((m, i) => [String(m.memberId), i]));
  const applied = [];
  const ledgerEntries = [];
  let fullyPaidCount = 0;
  let creditCount = 0;
  let skipped = 0;

  for (const payment of payments || []) {
    if (!payment?.matched) continue;
    const idx = indexById.get(String(payment.memberId));
    if (idx == null) continue;
    const current = next[idx];
    if (memberAlreadyHasCollection(current, payment.id)) {
      skipped += 1;
      continue;
    }
    const draft = applyImportedMemberPayment(current, {
      amount: payment.amount,
      date: payment.date,
      voucher: payment.voucher,
      method: payment.method || 'transferencia',
      methodLabel: payment.methodLabel,
      concept: payment.concept,
      bankName: payment.bankName,
      paidAtReason: payment.paidAtReason,
      importSource: payment.importSource,
      id: payment.id,
    });
    if (draft.duplicate) {
      skipped += 1;
      continue;
    }
    let savedMember = draft.member;
    let paymentDbId = null;
    if (current.id) {
      const committed = await commitDuesCollection(current, draft.payment);
      savedMember = committed.member;
      paymentDbId = committed.payment?.id || null;
      if (committed.idempotent) {
        next[idx] = savedMember;
        skipped += 1;
        continue;
      }
    }
    next[idx] = savedMember;
    applied.push({
      paymentId: draft.payment.id,
      paymentDbId,
      memberId: savedMember.memberId,
      amount: draft.payment.amount,
      date: draft.payment.date,
      fullyPaid: money(savedMember.outstandingBalance) <= 0.01,
      credit: money(savedMember.outstandingBalance) < -0.01
        ? Math.abs(money(savedMember.outstandingBalance))
        : 0,
      outstandingBalance: draft.before.outstandingBalance,
      lastPaymentDate: draft.before.lastPaymentDate,
      nextDueDate: draft.before.nextDueDate,
      overdueSince: draft.before.overdueSince,
    });
    if (draft.ledgerEntry) ledgerEntries.push(draft.ledgerEntry);
    if (money(savedMember.outstandingBalance) <= 0.01) fullyPaidCount += 1;
    if (money(savedMember.outstandingBalance) < -0.01) creditCount += 1;
  }

  return { members: next, applied, ledgerEntries, fullyPaidCount, creditCount, skipped };
}

/** Aplica el cobro al padrón, al libro de cuenta y al diario. El saldo no se pinta hasta que el recibo quedó. */
export async function persistDuesCollection(result, {
  setMembers,
  updateMember,
  addJournalEntry,
  onAccountEntry,
} = {}) {
  if (!result?.member) return result;
  let next = result;
  const payment = result.payment;
  if (isSupabaseConfigured && payment && isPersistedPaymentId(payment.id) && result.member?.id) {
    if (payment.status === 'void') {
      const balance = await revertDuesPayment(payment.id, payment.voidReason, {
        voidedByName: payment.voidedByName || payment.voidedBy || null,
      });
      next = {
        ...next,
        member: {
          ...next.member,
          outstandingBalance: balance,
          // La RPC ya restauró vencimiento / último pago / unpaidCapital en la base;
          // el estado local conserva el snapshot del void hasta el hydrate.
          nextDueDate: next.member.nextDueDate,
          lastPaymentDate: next.member.lastPaymentDate,
        },
        payment: {
          ...payment,
          status: 'void',
          voidReason: payment.voidReason,
          voidedByName: payment.voidedByName || payment.voidedBy || null,
        },
      };
    } else if (Number(payment.removedSurcharge) > 0) {
      const balance = await quitarRecargoCuota({
        paymentId: payment.id,
        reason: payment.surchargeRemoveReason,
      });
      next = { ...next, member: { ...next.member, outstandingBalance: balance } };
    }
  }
  if (isSupabaseConfigured && payment && !isPersistedPaymentId(payment.id)) {
    const committed = await commitDuesCollection(result.member, payment, {
      journalEntry: result.journalEntry || null,
    });
    // El PDF / MD del a cuenta necesitan entregado + deuda restante aunque la fila
    // venga de la base sin esos campos todavía.
    const committedPay = committed.payment || {};
    // No dejar que nulls del RPC pisen meta local (voucher / financiación / parse).
    const mergedPayment = {
      ...payment,
      ...committedPay,
      balanceRemaining: committedPay.balanceRemaining ?? payment.balanceRemaining ?? null,
      creditLeftover: committedPay.creditLeftover ?? payment.creditLeftover ?? null,
      methodLabel: committedPay.methodLabel || payment.methodLabel || null,
      imputations: committedPay.imputations || payment.imputations || [],
      voucherAmount: committedPay.voucherAmount ?? payment.voucherAmount ?? null,
      cardFinancing: committedPay.cardFinancing || payment.cardFinancing || null,
      receiptParse: committedPay.receiptParse || payment.receiptParse || null,
      journalAccount: committedPay.journalAccount || payment.journalAccount || null,
      paymentPlanId: committedPay.paymentPlanId || payment.paymentPlanId || null,
      paymentPlanLabel: committedPay.paymentPlanLabel || payment.paymentPlanLabel || null,
      paymentPlanSnapshot: committedPay.paymentPlanSnapshot || payment.paymentPlanSnapshot || null,
      paymentSplits: committedPay.paymentSplits || payment.paymentSplits || null,
    };
    const atomicEntry = committed.journal?.entry || null;
    const journalAlreadyPosted = Boolean(atomicEntry?.id);
    next = {
      ...result,
      member: {
        ...committed.member,
        paymentHistory: [
          mergedPayment,
          ...(committed.member.paymentHistory || []).filter((row) => row && row.id !== mergedPayment.id),
        ],
      },
      payment: mergedPayment,
      journalEntry: journalAlreadyPosted
        ? {
          ...(result.journalEntry || {}),
          id: atomicEntry.id,
          sourceId: mergedPayment.id,
          status: atomicEntry.status || 'posted',
        }
        : (result.journalEntry
          ? { ...result.journalEntry, sourceId: mergedPayment.id }
          : result.journalEntry),
      journalAtomic: journalAlreadyPosted,
      authorized: committed.authorized === true,
    };
  }
  if (typeof setMembers === 'function') {
    setMembers((prev) => {
      const list = prev || [];
      const idx = list.findIndex((m) => m.memberId === next.member.memberId);
      if (idx < 0) return [next.member, ...list];
      return list.map((m) => (m.memberId === next.member.memberId ? next.member : m));
    });
  } else {
    await updateMember?.(next.member);
  }
  if (next.ledgerEntry) onAccountEntry?.(next.ledgerEntry);
  // B9: si el RPC POS ya publicó el asiento en la misma txn, no re-publicar.
  if (next.journalEntry && !next.journalAtomic) {
    const ensured = await ensureDuesCollectionJournal(next, { addJournalEntry });
    return ensured;
  }
  return next;
}

/**
 * Idempotencia / recuperación del asiento (B4):
 * - Si ya existe asiento con sourceId = payment.id → no duplica.
 * - Si el cobro quedó persistido y el asiento falló → reintento solo publica el asiento.
 * - Doble clic / timeout: misma clave de cobro + mismo sourceId.
 */
export async function ensureDuesCollectionJournal(result, { addJournalEntry } = {}) {
  if (!result?.journalEntry) return result;
  const sourceId = result.journalEntry.sourceId || result.payment?.id || null;
  const entry = {
    ...result.journalEntry,
    ...(sourceId ? { sourceId } : {}),
  };

  if (isSupabaseConfigured && sourceId && isPersistedPaymentId(sourceId)) {
    const existing = await findDuesJournalBySourceId(sourceId);
    if (existing?.id) {
      return {
        ...result,
        journalEntry: { ...entry, id: existing.id, status: existing.status || 'posted' },
        journalRecovered: true,
      };
    }
  }

  if (typeof addJournalEntry !== 'function') {
    if (isSupabaseConfigured) {
      const err = new Error(
        'El cobro quedó en la ficha, pero no hay quién registre el asiento de caja. Recargá el panel e intentá de nuevo.',
      );
      err.code = 'JOURNAL_MISSING_HANDLER';
      err.paymentId = sourceId;
      err.recoverable = true;
      throw err;
    }
    return result;
  }

  try {
    const saved = await addJournalEntry(entry);
    if (saved && typeof saved === 'object' && saved.id) {
      return { ...result, journalEntry: saved, journalRecovered: false };
    }
    throw new Error('El asiento no devolvió un id.');
  } catch (err) {
    // Carrera: otro request pudo crear el asiento entre el check y el insert.
    if (isSupabaseConfigured && sourceId && isPersistedPaymentId(sourceId)) {
      const raced = await findDuesJournalBySourceId(sourceId);
      if (raced?.id) {
        return {
          ...result,
          journalEntry: { ...entry, id: raced.id, status: raced.status || 'posted' },
          journalRecovered: true,
        };
      }
    }
    const detail = err?.message ? ` ${err.message}` : '';
    const wrapped = new Error(
      `El cobro quedó en la ficha, pero no entró a caja ni al diario.${detail} Reintentá el asiento (idempotente) o avisá a sistemas.`,
    );
    wrapped.code = 'JOURNAL_POST_FAILED';
    wrapped.paymentId = sourceId;
    wrapped.recoverable = true;
    wrapped.cause = err;
    throw wrapped;
  }
}

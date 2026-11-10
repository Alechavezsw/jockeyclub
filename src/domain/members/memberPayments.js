import {
  afterCollectDues,
  collectionPeriodChoices,
  duesChargeBreakdown,
  duesPayableForMember,
  isDuesExemptMember,
  nextDuesDueDate,
} from './dues';
import { billingAccountMember, isFamilyDependent } from './households';
import { referenceMonthlyDues } from './paymentHistory';
import { createAccountEntry } from '../accounting/accountEntries';
import { applyDuesPartsDelta } from '../accounting/currentAccountBalances';
import { journalAccountForPayment } from './clubBanks';
import { nowTimeAR, todayISODateAR } from '../../lib/arDate';
import { money } from '../money';
import {
  imputationSummary,
  imputeDuesPayment,
  nextOpenDue,
  openPeriodsFromChoices,
} from './duesImputations';
import { isSupabaseConfigured } from '../../lib/supabase';
import { quitarRecargoCuota, registrarCobro, revertDuesPayment } from '../../data/repos';

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
  tarjeta: 'Tarjeta',
  mixto: 'Pago mixto',
  mercadopago: 'Mercado Pago',
  caja: 'Efectivo',
};

/** Medios que se pueden combinar en un pago mixto (sin QR async). */
export const MIXED_DUES_METHODS = ['efectivo', 'transferencia', 'tarjeta'];

/** Transferencia y tarjeta exigen comprobante guardado. */
export function duesMethodNeedsReceipt(method) {
  return method === 'transferencia' || method === 'tarjeta';
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
  if (method === 'transferencia') {
    return bankName ? `Transferencia ${bankName}` : 'Transferencia';
  }
  return DUES_METHOD_LABELS[method] || method || 'Pago';
}

/** Normaliza líneas de un pago mixto. */
export function normalizePaymentSplits(raw = []) {
  return (Array.isArray(raw) ? raw : [])
    .map((row, index) => {
      const method = String(row?.method || '').trim();
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
      const bankId = method === 'transferencia' ? (row.bankId || null) : null;
      const bankName = method === 'transferencia' ? (row.bankName || null) : null;
      const paymentPlanId = method === 'tarjeta' ? (row.paymentPlanId || null) : null;
      const paymentPlanLabel = method === 'tarjeta' ? (String(row.paymentPlanLabel || '').trim() || null) : null;
      const journalAccount = row.journalAccount || journalAccountForPayment(method, bankId);
      return {
        id: row.id || `split-${index + 1}`,
        method,
        amount,
        bankId,
        bankName,
        journalAccount,
        paymentPlanId,
        paymentPlanLabel,
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
 * Valida splits: ≥2 líneas, suma = total, comprobantes donde corresponde.
 * @returns {{ splits: object[], total: number }}
 */
export function validatePaymentSplits(rawSplits, expectedAmount, { treasuryMatch = false } = {}) {
  const splits = normalizePaymentSplits(rawSplits);
  if (splits.length < 2) {
    throw new Error('El pago mixto necesita al menos dos medios con importe.');
  }
  const total = money(splits.reduce((sum, row) => sum + row.amount, 0));
  const expected = money(expectedAmount);
  if (expected > 0 && Math.abs(total - expected) > 0.009) {
    throw new Error(`Los medios suman ${total} y el cobro es ${expected}.`);
  }
  splits.forEach((row) => {
    if (!duesMethodNeedsReceipt(row.method)) return;
    if (row.receiptParse?.source === 'manual' && !isManualDuesReceipt(row.receiptParse)) {
      throw new Error('Completá la referencia del comprobante manual.');
    }
    if (!row.receiptName) {
      throw new Error(row.method === 'tarjeta'
        ? 'Adjunte el comprobante de la tarjeta en el pago mixto.'
        : 'Adjunte el comprobante de la transferencia en el pago mixto.');
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

  if (due > 0.01) {
    const schedule = openPeriodsFromChoices(collectionPeriodChoices(member, when), due);
    const imputed = imputeDuesPayment(schedule, paid, iso);
    payment.imputations = imputed.allocations;
    payment.quota = imputed.capital;
    payment.surcharge = imputed.surcharge;
    if (imputed.allocations.length) {
      payment.period = imputationSummary(imputed.allocations);
      payment.periodDueOns = imputed.allocations.map((row) => row.dueOn);
    }
    const capitalLeft = money(due - imputed.capital);
    leftover = imputed.unapplied;
    const openDue = nextOpenDue(schedule, imputed.allocations);
    if (capitalLeft <= 0.01) {
      current = afterCollectDues(member, when);
      current = { ...current, outstandingBalance: capitalLeft };
    } else {
      current = {
        ...withPaidParts(member, imputed.capital, imputed.surcharge),
        outstandingBalance: capitalLeft,
        nextDueDate: openDue || member.nextDueDate,
      };
    }
  }

  let months = 0;
  while (leftover > 0.01 && months < 24) {
    months += 1;
    const dueOn = current.nextDueDate || nextDuesDueDate(when);
    const monthAmount = money(duesPayableForMember(current, { paidOn: when, dueOn, on: dueOn }));
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

/**
 * Registra un pago de cuota del socio (portal / caja).
 * Actualiza saldo, próximo vencimiento e historial.
 */
export function payMemberDues(member, {
  method = 'transferencia',
  amount = null,
  today = new Date(),
  periodDueOns = null,
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  if (isFamilyDependent(member)) throw new Error('El cobro va a la cuenta del titular.');
  if (isDuesExemptMember(member)) throw new Error('Esta categoría no abona cuota social.');
  const requested = amount != null ? Number(amount) : 0;
  const stored = Number(member.outstandingBalance) || 0;
  const selected = Array.isArray(periodDueOns) && periodDueOns.length
    ? periodDueOns.map((value) => String(value || '').slice(0, 10)).filter(Boolean)
    : null;
  const choices = collectionPeriodChoices(member, today);
  const selectedChoices = selected
    ? choices.filter((row) => selected.includes(String(row.dueOn).slice(0, 10)))
    : choices;
  if (selected && !selectedChoices.length) {
    throw new Error('Marcá al menos un mes a cobrar.');
  }
  const split = duesChargeBreakdown(member, {
    paidOn: today,
    periodDueOns: selected,
    ...(stored > 0 || !(requested > 0) ? {} : { amount: requested }),
  });
  let due = selected
    ? selectedChoices.reduce((sum, row) => sum + (Number(row.payable) || 0), 0)
    : split.total;
  if (!(stored > 0) && requested > 0 && !selected) due = requested;
  if (due <= 0) throw new Error('No hay saldo pendiente para abonar.');

  const paidAmount = requested > 0 ? requested : due;
  if (!paidAmount || paidAmount <= 0) throw new Error('Importe inválido.');
  if (paidAmount > due + 0.01) throw new Error('El importe supera el saldo pendiente.');
  const covered = selectedChoices.length ? selectedChoices : choices;
  const coveredCapital = money(covered.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
  const scheduleAmount = coveredCapital > 0 ? coveredCapital : stored;
  const schedule = scheduleAmount > 0
    ? openPeriodsFromChoices(covered, scheduleAmount)
    : [];
  const imputed = schedule.length
    ? imputeDuesPayment(schedule, paidAmount, todayISODateAR(today))
    : null;

  const date = todayISODateAR(today);
  const time = nowTimeAR(today);
  const paidAt = today.toISOString();
  const lines = paidAmount + 0.01 >= due
    ? (selected
      ? {
        quota: money(selectedChoices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0)),
        surcharge: money(selectedChoices.reduce((sum, row) => sum + (Number(row.surcharge) || 0), 0)),
        waivedSurcharge: 0,
      }
      : split)
    : duesChargeBreakdown(member, { paidOn: today, amount: paidAmount, periodDueOns: selected });
  const periodLabel = selectedChoices.length === 1
    ? selectedChoices[0].label
    : (selectedChoices.length > 1
      ? `${selectedChoices[0].label} · ${selectedChoices[selectedChoices.length - 1].label}`
      : today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }));
  const payment = {
    id: `pay-${member.memberId}-${Date.now()}`,
    date,
    time,
    paidAt,
    createdAt: paidAt,
    concept: `Cuota social · ${duesMethodLabel(method)}`,
    amount: paidAmount,
    quota: imputed ? imputed.capital : lines.quota,
    surcharge: imputed ? imputed.surcharge : lines.surcharge,
    waivedSurcharge: lines.waivedSurcharge || 0,
    method,
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
  };

  const history = [payment, ...(member.paymentHistory || [])];
  const remainingCash = due - paidAmount;
  const remainingChoices = selected
    ? choices.filter((row) => !selected.includes(String(row.dueOn).slice(0, 10)))
    : [];

  if (imputed && stored > 0) {
    const capitalLeft = money(stored - imputed.capital);
    const openDue = nextOpenDue(schedule, imputed.allocations);
    const lilaRaw = member?.unpaidCapital;
    const embedded = lilaRaw != null && lilaRaw !== ''
      ? money(Math.max(0, stored - money(Math.max(0, Number(lilaRaw) || 0))))
      : money(Math.max(0, Number(member?.unpaidSurcharges) || 0));
    const duesSettled = !openDue
      && remainingCash <= 0.01
      && remainingChoices.length === 0
      && embedded > 0.01
      && capitalLeft <= embedded + 0.01;
    if ((capitalLeft <= 0.01 && !openDue) || duesSettled) {
      const cleared = afterCollectDues(member, today);
      const balanceLeft = duesSettled ? 0 : capitalLeft;
      return {
        member: { ...cleared, outstandingBalance: balanceLeft, lastPaymentDate: date, paymentHistory: history },
        payment,
        fullyPaid: true,
        ledgerEntry: ledgerPago({ ...cleared, outstandingBalance: balanceLeft }, payment),
      };
    }
    const next = {
      ...withPaidParts(member, imputed.capital, imputed.surcharge),
      outstandingBalance: capitalLeft,
      nextDueDate: openDue || member.nextDueDate,
      lastPaymentDate: date,
      paymentHistory: history,
    };
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
    const next = {
      ...withPaidParts(member, paidCapital, paidSurcharge),
      outstandingBalance: money(remainingCash),
      lastPaymentDate: date,
      paymentHistory: history,
    };
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
    const next = {
      ...withPaidParts(member, paidCapital, paidSurcharge),
      outstandingBalance: remainingCapital,
      nextDueDate: remainingChoices[0].dueOn,
      lastPaymentDate: date,
      paymentHistory: history,
    };
    return {
      member: next,
      payment,
      fullyPaid: false,
      ledgerEntry: ledgerPago(next, payment),
    };
  }

  const cleared = afterCollectDues(member, today);
  const next = {
    ...cleared,
    lastPaymentDate: date,
    paymentHistory: history,
  };
  return {
    member: next,
    payment,
    fullyPaid: true,
    ledgerEntry: ledgerPago(next, payment),
  };
}

/**
 * Próximo cobro. Si hay saldo a favor, se descuenta en este pago.
 * Lo que sobra queda a favor para el siguiente.
 * `periodDueOns` marca qué meses entran en el recibo.
 */
export function collectionPreview(member, today = new Date(), { periodDueOns = null } = {}) {
  const choices = collectionPeriodChoices(member, today);
  const selected = Array.isArray(periodDueOns) && periodDueOns.length
    ? periodDueOns.map((value) => String(value || '').slice(0, 10)).filter(Boolean)
    : choices.map((row) => row.dueOn);
  const selectedChoices = choices.filter((row) => selected.includes(String(row.dueOn).slice(0, 10)));
  const stored = Number(member?.outstandingBalance) || 0;

  if (selectedChoices.some((row) => row.kind === 'overdue') || stored > 0.01) {
    const quota = money(selectedChoices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
    const surcharge = money(selectedChoices.reduce((sum, row) => sum + (Number(row.surcharge) || 0), 0));
    const gross = money(quota + surcharge);
    return {
      quota,
      surcharge,
      gross,
      creditApplied: 0,
      cash: gross,
      leftover: 0,
      periods: selectedChoices,
      choices,
      clear: false,
    };
  }

  // Al día (saldo 0) y sin mes abierto: no inventar adelanto (ej. diciembre en noviembre).
  // Con saldo a favor sí se permite imputar al próximo período.
  if (!selectedChoices.length && stored >= -0.01) {
    return {
      quota: 0,
      surcharge: 0,
      gross: 0,
      creditApplied: 0,
      cash: 0,
      leftover: 0,
      periods: [],
      choices,
      clear: true,
    };
  }

  const dueOn = selectedChoices[0]?.dueOn || member?.nextDueDate || nextDuesDueDate(today, member);
  const gross = money(
    selectedChoices[0]?.payable
    || duesPayableForMember(member, { paidOn: today, dueOn, on: dueOn })
    || referenceMonthlyDues(member, member?.paymentHistory),
  );
  const split = duesChargeBreakdown(member, { paidOn: today, dueOn, on: dueOn, amount: gross });
  const credit = stored < 0 ? money(-stored) : 0;
  const creditApplied = money(Math.min(credit, gross));
  return {
    quota: split.quota,
    surcharge: split.surcharge,
    gross,
    creditApplied,
    cash: money(gross - creditApplied),
    leftover: money(credit - creditApplied),
    periods: selectedChoices,
    choices,
    clear: false,
  };
}

/** Anticipo de cuota cuando está al día (paga el próximo período). */
export function payUpcomingDues(member, { method = 'transferencia', today = new Date() } = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  if (isFamilyDependent(member)) throw new Error('El cobro va a la cuenta del titular.');
  if (isDuesExemptMember(member)) throw new Error('Esta categoría no abona cuota social.');
  if ((Number(member.outstandingBalance) || 0) > 0) {
    return payMemberDues(member, { method, today });
  }
  const preview = collectionPreview(member, today);
  const date = todayISODateAR(today);
  const time = nowTimeAR(today);
  const paidAt = today.toISOString();
  const payment = {
    id: `pay-${member.memberId}-${Date.now()}`,
    date,
    time,
    paidAt,
    createdAt: paidAt,
    concept: `Cuota social anticipada · ${duesMethodLabel(method)}`,
    amount: preview.cash,
    adelanto: true,
    quota: preview.quota,
    surcharge: preview.surcharge,
    creditApplied: preview.creditApplied,
    method,
    status: 'paid',
    receipt: receiptNumberFor(member, date),
    receiptNumber: receiptNumberFor(member, date),
    period: today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
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
 * Efectivo acredita; transferencia y tarjeta exigen comprobante; MP deja QR.
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
  receiptParse = null,
  paymentSplits = null,
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const account = billingAccountMember(member, members);
  if (isDuesExemptMember(account)) throw new Error('Esta categoría no abona cuota social.');

  const wantsMixed = method === 'mixto'
    || (Array.isArray(paymentSplits) && paymentSplits.filter((row) => Number(row?.amount) > 0).length >= 2);
  let mixed = null;
  if (wantsMixed) {
    const previewCash = amount != null
      ? money(amount)
      : collectionPreview(account, today, { periodDueOns }).cash;
    mixed = validatePaymentSplits(paymentSplits, previewCash > 0 ? previewCash : amount, { treasuryMatch });
  }

  const resolvedMethod = mixed ? 'mixto' : method;
  const manual = !mixed && isManualDuesReceipt(receiptParse);
  if (!mixed && receiptParse?.source === 'manual' && !manual) {
    throw new Error('Completá la referencia del comprobante manual.');
  }
  const attachmentName = receiptAttachment?.name
    || receiptName
    || (manual ? manualDuesReceiptLabel(receiptParse) : null);
  const attachmentPath = receiptAttachment?.path || null;
  if (!mixed) {
    const needsReceipt = duesMethodNeedsReceipt(resolvedMethod);
    if (needsReceipt && !attachmentName) {
      throw new Error(resolvedMethod === 'tarjeta'
        ? 'Adjunte el comprobante de la tarjeta.'
        : 'Adjunte el comprobante de la transferencia.');
    }
    if (needsReceipt && !attachmentPath && !treasuryMatch && !manual) {
      throw new Error('No se pudo guardar el comprobante en Supabase.');
    }
  }

  const choices = collectionPeriodChoices(account, today);
  const hasOverdue = choices.some((row) => row.kind === 'overdue');
  const due = Number(account.outstandingBalance) || 0;
  const collectAmount = mixed ? mixed.total : amount;
  const paid = (due > 0 || hasOverdue)
    ? payMemberDues(account, { method: resolvedMethod, amount: collectAmount, today, periodDueOns })
    : payUpcomingDues(account, { method: resolvedMethod, today });

  const label = mixed
    ? `Pago mixto (${mixed.splits.map((row) => row.label).join(' + ')})`
    : duesMethodLabel(resolvedMethod, bankName);
  const cashAccount = mixed
    ? null
    : (journalAccount || journalAccountForPayment(resolvedMethod, bankId));
  const receiptNote = !mixed && attachmentName ? ` · Comp: ${attachmentName}` : '';
  const planLabel = String(paymentPlanLabel || '').trim();
  const planNote = !mixed && resolvedMethod === 'tarjeta' && planLabel ? ` · Plan: ${planLabel}` : '';
  const mixedNote = mixed
    ? ` · ${mixed.splits.map((row) => `${row.label} ${row.amount}`).join(' + ')}`
    : '';
  const primarySplit = mixed?.splits[0] || null;
  const payment = {
    ...paid.payment,
    method: resolvedMethod,
    bankId: mixed ? null : (resolvedMethod === 'transferencia' ? bankId : null),
    bankName: mixed ? null : (resolvedMethod === 'transferencia' ? bankName : null),
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
    paymentPlanId: mixed ? null : (resolvedMethod === 'tarjeta' ? (paymentPlanId || null) : null),
    paymentPlanLabel: mixed ? null : (resolvedMethod === 'tarjeta' ? (planLabel || null) : null),
    receiptParse: mixed ? null : (receiptParse && typeof receiptParse === 'object' ? receiptParse : null),
    paymentSplits: mixed ? mixed.splits : null,
  };

  const memberNext = {
    ...paid.member,
    paymentHistory: [payment, ...(paid.member.paymentHistory || []).filter((row) => row.id !== paid.payment.id)],
  };

  let journalEntry = null;
  if (payment.amount > 0) {
    if (mixed) {
      const byAccount = new Map();
      mixed.splits.forEach((row) => {
        const key = row.journalAccount || 'Caja General';
        byAccount.set(key, money((byAccount.get(key) || 0) + row.amount));
      });
      journalEntry = {
        date: payment.date,
        description: `Cobro cuota social (${label}) - Socio: ${account.name} (Cred. ${account.memberId})`,
        lines: [
          ...[...byAccount.entries()].map(([accountName, value]) => ({
            account: accountName,
            type: 'debit',
            amount: value,
          })),
          { account: 'Cuotas Sociales', type: 'credit', amount: payment.amount },
        ],
        sourceModule: 'cuotas',
        sourceId: payment.id,
        memberId: account.memberId,
      };
    } else {
      journalEntry = {
        date: payment.date,
        description: `Cobro cuota social (${label}) - Socio: ${account.name} (Cred. ${account.memberId})${receiptNote}${planNote}`,
        lines: [
          { account: cashAccount, type: 'debit', amount: payment.amount },
          { account: 'Cuotas Sociales', type: 'credit', amount: payment.amount },
        ],
        sourceModule: 'cuotas',
        sourceId: payment.id,
        memberId: account.memberId,
      };
    }
  }

  return {
    member: memberNext,
    payment,
    fullyPaid: paid.fullyPaid,
    ledgerEntry: paid.ledgerEntry ? ledgerPago(memberNext, payment) : null,
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
  reason = '',
  today = new Date(),
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const history = member.paymentHistory || [];
  const payment = history.find((row) => row && String(row.id) === String(paymentId));
  if (!payment) throw new Error('No se encontró el cobro.');
  if (payment.status === 'void' || payment.status === 'cancelled') {
    throw new Error('Ese cobro ya está anulado.');
  }

  const why = String(reason || '').trim();
  if (why.length < 8) {
    throw new Error('Falta el motivo de la anulación (mínimo 8 caracteres).');
  }
  const amount = money(payment.amount);
  const voidedAt = today instanceof Date ? today.toISOString() : String(today);
  const nextPayment = {
    ...payment,
    status: 'void',
    voidedBy,
    voidedAt,
    voidReason: why,
  };
  const restoredBalance = payment.balanceBefore != null
    ? money(payment.balanceBefore)
    : money((Number(member.outstandingBalance) || 0) + amount);
  const next = {
    ...member,
    outstandingBalance: restoredBalance,
    nextDueDate: payment.nextDueBefore || member.nextDueDate,
    lastPaymentDate: payment.lastPaymentBefore || null,
    paymentHistory: history.map((row) => (row.id === payment.id ? nextPayment : row)),
    updatedAt: voidedAt,
  };

  const splits = normalizePaymentSplits(payment.paymentSplits);
  let creditLines;
  if (splits.length >= 2) {
    const byAccount = new Map();
    splits.forEach((row) => {
      const key = row.journalAccount || 'Caja General';
      byAccount.set(key, money((byAccount.get(key) || 0) + row.amount));
    });
    creditLines = [...byAccount.entries()].map(([accountName, value]) => ({
      account: accountName,
      type: 'credit',
      amount: value,
    }));
  } else {
    creditLines = [{
      account: payment.journalAccount || 'Caja General',
      type: 'credit',
      amount,
    }];
  }

  return {
    member: next,
    payment: nextPayment,
    journalEntry: {
      date: todayISODateAR(today),
      description: `Anulación cobro cuota social - Socio: ${member.name} (Cred. ${member.memberId}) · ${nextPayment.receiptNumber || nextPayment.receipt || paymentId}`,
      lines: [
        { account: 'Cuotas Sociales', type: 'debit', amount },
        ...creditLines,
      ],
      sourceModule: 'cuotas',
      sourceId: payment.id,
      memberId: member.memberId,
      status: 'posted',
    },
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
  const before = {
    ...member,
    outstandingBalance: payment.balanceBefore ?? member.outstandingBalance,
    nextDueDate: payment.nextDueBefore || member.nextDueDate,
    lastPaymentDate: payment.lastPaymentBefore ?? member.lastPaymentDate,
  };
  const paidOn = payment.paidAt || payment.date || new Date();
  const balance = Math.max(Number(before.outstandingBalance) || 0, 0);
  const choices = collectionPeriodChoices(before, paidOn);
  const choiceCapital = choices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0);
  // El saldo puede traer recargos de Lila. Esos no son otra cuota.
  const scheduleBalance = choiceCapital > 0.01 && choiceCapital < balance - 0.01
    ? choiceCapital
    : balance;
  return openPeriodsFromChoices(choices, scheduleBalance);
}

function cobroPeriods(member, payment) {
  const schedule = cobroSchedule(member, payment);
  const scheduleCapital = schedule.reduce((sum, row) => sum + (Number(row.capital) || 0), 0);
  const balance = Math.max(Number(payment.balanceBefore ?? member?.outstandingBalance) || 0, 0);
  const bakedSurcharge = scheduleCapital > 0.01 && balance > scheduleCapital + 0.01
    ? Math.round((balance - scheduleCapital) * 100) / 100
    : 0;
  return {
    dueOns: Array.isArray(payment.periodDueOns) ? payment.periodDueOns : [],
    schedule,
    bakedSurcharge,
    quota: payment.quota ?? null,
    surcharge: payment.surcharge ?? 0,
    creditApplied: payment.creditApplied ?? null,
    method: payment.method || null,
    concept: payment.concept || null,
    receiptNumber: payment.receiptNumber || payment.receipt || null,
    paidAt: payment.paidAt || payment.date || null,
    paidAtReason: payment.paidAtReason || payment.backdateReason || null,
    time: payment.time || null,
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
    paymentSplits: payment.paymentSplits || null,
    waiveSurcharge: Number(payment.waivedSurcharge) > 0,
    waivedSurcharge: Number(payment.waivedSurcharge) || 0,
    adelanto: payment.adelanto === true,
    importSource: payment.importSource || null,
  };
}

/**
 * Recibo, períodos y saldo en una sola transacción.
 * Si falla, no hay que pintar el saldo nuevo.
 */
export async function commitDuesCollection(member, payment) {
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
  const saved = await registrarCobro({
    memberId: memberDbId,
    amount: Number(payment.amount) || 0,
    periods: cobroPeriods(member, payment),
    idempotencyKey: `cobro:${member.memberId}:${payment.id}`,
  });
  const history = (member.paymentHistory || []).filter((row) => row && row.id !== payment.id);
  const nextMember = {
    ...member,
    outstandingBalance: saved.outstandingBalance,
    nextDueDate: saved.nextDueDate || member.nextDueDate,
    lastPaymentDate: saved.payment?.date || member.lastPaymentDate,
    paymentHistory: [saved.payment, ...history],
  };
  return { member: nextMember, payment: saved.payment, idempotent: saved.idempotent };
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
      const balance = await revertDuesPayment(payment.id, payment.voidReason);
      next = { ...next, member: { ...next.member, outstandingBalance: balance } };
    } else if (Number(payment.removedSurcharge) > 0) {
      const balance = await quitarRecargoCuota({
        paymentId: payment.id,
        reason: payment.surchargeRemoveReason,
      });
      next = { ...next, member: { ...next.member, outstandingBalance: balance } };
    }
  }
  if (isSupabaseConfigured && payment && !isPersistedPaymentId(payment.id)) {
    const committed = await commitDuesCollection(result.member, payment);
    next = {
      ...result,
      member: committed.member,
      payment: committed.payment,
      journalEntry: result.journalEntry
        ? { ...result.journalEntry, sourceId: committed.payment.id }
        : result.journalEntry,
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
  if (next.journalEntry && typeof addJournalEntry === 'function') {
    try {
      const saved = await addJournalEntry(next.journalEntry);
      if (saved && typeof saved === 'object' && saved.id) {
        return { ...next, journalEntry: saved };
      }
      throw new Error('El asiento no devolvió un id.');
    } catch (err) {
      const detail = err?.message ? ` ${err.message}` : '';
      throw new Error(
        `El cobro quedó en la ficha, pero no entró a caja ni al diario.${detail} Reintentá el asiento o avisá a sistemas.`,
      );
    }
  }
  if (isSupabaseConfigured && next.journalEntry && typeof addJournalEntry !== 'function') {
    throw new Error(
      'El cobro quedó en la ficha, pero no hay quién registre el asiento de caja. Recargá el panel e intentá de nuevo.',
    );
  }
  return next;
}

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
import { journalAccountForPayment } from './clubBanks';
import { nowTimeAR, todayISODateAR } from '../../lib/arDate';

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

export function duesMethodLabel(method, bankName) {
  if (method === 'transferencia') {
    return bankName ? `Transferencia ${bankName}` : 'Transferencia';
  }
  return DUES_METHOD_LABELS[method] || method || 'Pago';
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Normaliza líneas de un pago mixto. */
export function normalizePaymentSplits(raw = []) {
  return (Array.isArray(raw) ? raw : [])
    .map((row, index) => {
      const method = String(row?.method || '').trim();
      if (!MIXED_DUES_METHODS.includes(method)) return null;
      const amount = roundMoney(row?.amount);
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
      const receiptName = attachment?.name || row?.receiptName || null;
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
  const total = roundMoney(splits.reduce((sum, row) => sum + row.amount, 0));
  const expected = roundMoney(expectedAmount);
  if (expected > 0 && Math.abs(total - expected) > 0.009) {
    throw new Error(`Los medios suman ${total} y el cobro es ${expected}.`);
  }
  splits.forEach((row) => {
    if (!duesMethodNeedsReceipt(row.method)) return;
    if (!row.receiptName) {
      throw new Error(row.method === 'tarjeta'
        ? 'Adjunte el comprobante de la tarjeta en el pago mixto.'
        : 'Adjunte el comprobante de la transferencia en el pago mixto.');
    }
    if (!row.receiptPath && !treasuryMatch) {
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
  id,
  source = 'collection_import',
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const paid = roundMoney(amount);
  if (paid <= 0) throw new Error('Importe inválido.');
  const { iso, when } = asPaymentDate(date);
  const before = duesSnapshot(member);
  const payment = {
    id: id || `pay-${member.memberId}-${Date.now()}`,
    date: iso,
    time: nowTimeAR(when),
    paidAt: when.toISOString(),
    createdAt: when.toISOString(),
    concept: 'Importación cobranzas socios',
    amount: paid,
    method,
    status: 'paid',
    receipt: voucher || receiptNumberFor(member, iso),
    receiptNumber: voucher || receiptNumberFor(member, iso),
    voucher,
    source,
    ledgerId: id,
    period: when.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
  };

  let current = member;
  let leftover = paid;
  const due = roundMoney(member.outstandingBalance);

  if (due > 0.01) {
    const take = Math.min(due, leftover);
    leftover = roundMoney(leftover - take);
    if (take + 0.01 >= due) {
      current = afterCollectDues(member, when);
    } else {
      current = {
        ...member,
        outstandingBalance: roundMoney(due - take),
      };
    }
  }

  let months = 0;
  while (leftover > 0.01 && months < 24) {
    months += 1;
    const dueOn = current.nextDueDate || nextDuesDueDate(when);
    const monthAmount = roundMoney(duesPayableForMember(current, { paidOn: when, dueOn, on: dueOn }));
    if (monthAmount <= 0.01) {
      current = {
        ...current,
        outstandingBalance: roundMoney((Number(current.outstandingBalance) || 0) - leftover),
      };
      leftover = 0;
      break;
    }
    if (leftover + 0.01 >= monthAmount) {
      leftover = roundMoney(leftover - monthAmount);
      current = afterCollectDues({
        ...current,
        outstandingBalance: monthAmount,
        nextDueDate: current.nextDueDate || dueOn,
      }, when);
    } else {
      current = {
        ...current,
        outstandingBalance: roundMoney((Number(current.outstandingBalance) || 0) - leftover),
      };
      leftover = 0;
    }
  }
  if (leftover > 0.01) {
    current = {
      ...current,
      outstandingBalance: roundMoney((Number(current.outstandingBalance) || 0) - leftover),
    };
  }

  const next = {
    ...current,
    lastPaymentDate: iso,
    paymentHistory: [payment, ...(member.paymentHistory || [])],
    updatedAt: new Date().toISOString(),
  };
  const balance = roundMoney(next.outstandingBalance);
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

  const date = todayISODateAR(today);
  const time = nowTimeAR(today);
  const paidAt = today.toISOString();
  const lines = paidAmount + 0.01 >= due
    ? (selected
      ? {
        quota: roundMoney(selectedChoices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0)),
        surcharge: roundMoney(selectedChoices.reduce((sum, row) => sum + (Number(row.surcharge) || 0), 0)),
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
    quota: lines.quota,
    surcharge: lines.surcharge,
    waivedSurcharge: lines.waivedSurcharge || 0,
    method,
    status: 'paid',
    receipt: receiptNumberFor(member, date),
    receiptNumber: receiptNumberFor(member, date),
    period: periodLabel,
    periodDueOns: selectedChoices.map((row) => row.dueOn),
    balanceBefore: Number(member.outstandingBalance) || 0,
    nextDueBefore: member.nextDueDate || null,
    lastPaymentBefore: member.lastPaymentDate || null,
  };

  const history = [payment, ...(member.paymentHistory || [])];
  const remainingCash = due - paidAmount;
  const remainingChoices = selected
    ? choices.filter((row) => !selected.includes(String(row.dueOn).slice(0, 10)))
    : [];

  if (remainingCash > 0.01) {
    const next = {
      ...member,
      outstandingBalance: Math.round(remainingCash * 100) / 100,
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
    const remainingCapital = roundMoney(
      remainingChoices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0),
    );
    const next = {
      ...member,
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

  if (selectedChoices.some((row) => row.kind === 'overdue') || stored > 0) {
    const quota = roundMoney(selectedChoices.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
    const surcharge = roundMoney(selectedChoices.reduce((sum, row) => sum + (Number(row.surcharge) || 0), 0));
    const gross = roundMoney(quota + surcharge);
    return {
      quota,
      surcharge,
      gross,
      creditApplied: 0,
      cash: gross,
      leftover: 0,
      periods: selectedChoices,
      choices,
    };
  }

  const dueOn = selectedChoices[0]?.dueOn || member?.nextDueDate || nextDuesDueDate(today, member);
  const gross = roundMoney(
    selectedChoices[0]?.payable
    || duesPayableForMember(member, { paidOn: today, dueOn, on: dueOn })
    || referenceMonthlyDues(member, member?.paymentHistory),
  );
  const split = duesChargeBreakdown(member, { paidOn: today, dueOn, on: dueOn, amount: gross });
  const credit = stored < 0 ? roundMoney(-stored) : 0;
  const creditApplied = roundMoney(Math.min(credit, gross));
  return {
    quota: split.quota,
    surcharge: split.surcharge,
    gross,
    creditApplied,
    cash: roundMoney(gross - creditApplied),
    leftover: roundMoney(credit - creditApplied),
    periods: selectedChoices,
    choices,
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
    quota: preview.quota,
    surcharge: preview.surcharge,
    creditApplied: preview.creditApplied,
    method,
    status: 'paid',
    receipt: receiptNumberFor(member, date),
    receiptNumber: receiptNumberFor(member, date),
    period: today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
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
      ? roundMoney(amount)
      : collectionPreview(account, today, { periodDueOns }).cash;
    mixed = validatePaymentSplits(paymentSplits, previewCash > 0 ? previewCash : amount, { treasuryMatch });
  }

  const resolvedMethod = mixed ? 'mixto' : method;
  const attachmentName = receiptAttachment?.name || receiptName || null;
  const attachmentPath = receiptAttachment?.path || null;
  if (!mixed) {
    const needsReceipt = duesMethodNeedsReceipt(resolvedMethod);
    if (needsReceipt && !attachmentName) {
      throw new Error(resolvedMethod === 'tarjeta'
        ? 'Adjunte el comprobante de la tarjeta.'
        : 'Adjunte el comprobante de la transferencia.');
    }
    if (needsReceipt && !attachmentPath && !treasuryMatch) {
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
        byAccount.set(key, roundMoney((byAccount.get(key) || 0) + row.amount));
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
  today = new Date(),
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const history = member.paymentHistory || [];
  const payment = history.find((row) => row && String(row.id) === String(paymentId));
  if (!payment) throw new Error('No se encontró el cobro.');
  if (payment.status === 'void' || payment.status === 'cancelled') {
    throw new Error('Ese cobro está anulado.');
  }
  const surcharge = roundMoney(payment.surcharge);
  if (surcharge <= 0) throw new Error('Este cobro no tiene recargo.');
  const removedAt = today instanceof Date ? today.toISOString() : String(today);
  const nextPayment = {
    ...payment,
    surcharge: 0,
    removedSurcharge: surcharge,
    surchargeRemovedBy: removedBy,
    surchargeRemovedAt: removedAt,
  };
  const next = {
    ...member,
    outstandingBalance: roundMoney((Number(member.outstandingBalance) || 0) - surcharge),
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

  const amount = roundMoney(payment.amount);
  const voidedAt = today instanceof Date ? today.toISOString() : String(today);
  const nextPayment = {
    ...payment,
    status: 'void',
    voidedBy,
    voidedAt,
    voidReason: String(reason || '').trim() || 'Anulación de cobro',
  };
  const restoredBalance = payment.balanceBefore != null
    ? roundMoney(payment.balanceBefore)
    : roundMoney((Number(member.outstandingBalance) || 0) + amount);
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
      byAccount.set(key, roundMoney((byAccount.get(key) || 0) + row.amount));
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

/** Aplica el cobro al padrón, al libro de cuenta y al diario. */
export async function persistDuesCollection(result, {
  setMembers,
  updateMember,
  addJournalEntry,
  onAccountEntry,
} = {}) {
  if (!result?.member) return result;
  if (typeof setMembers === 'function') {
    setMembers((prev) => {
      const list = prev || [];
      const idx = list.findIndex((m) => m.memberId === result.member.memberId);
      if (idx < 0) return [result.member, ...list];
      return list.map((m) => (m.memberId === result.member.memberId ? result.member : m));
    });
  } else {
    updateMember?.(result.member);
  }
  if (result.ledgerEntry) onAccountEntry?.(result.ledgerEntry);
  if (result.journalEntry && typeof addJournalEntry === 'function') {
    try {
      const saved = await addJournalEntry(result.journalEntry);
      if (saved && typeof saved === 'object') {
        return { ...result, journalEntry: saved };
      }
    } catch {
      /* El cobro del padrón ya quedó. El diario se recompone con el libro oficial. */
    }
  }
  return result;
}

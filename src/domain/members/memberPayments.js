import { afterCollectDues, duesChargeBreakdown, duesPayableForMember, isDuesExemptMember, nextDuesDueDate } from './dues';
import { billingAccountMember, isFamilyDependent } from './households';
import { referenceMonthlyDues } from './paymentHistory';
import { createAccountEntry } from '../accounting/accountEntries';
import { journalAccountForPayment } from './clubBanks';
import { nowTimeAR, todayISODateAR } from '../../lib/arDate';

export const DUES_METHOD_LABELS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mercadopago: 'Mercado Pago',
  caja: 'Efectivo',
};

export function duesMethodLabel(method, bankName) {
  if (method === 'transferencia') {
    return bankName ? `Transferencia ${bankName}` : 'Transferencia';
  }
  return DUES_METHOD_LABELS[method] || method || 'Pago';
}

function receiptNumberFor(member, date) {
  return `RC-${String(member.memberId).slice(-6)}-${String(date).replace(/-/g, '')}`;
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function ledgerPago(member, payment) {
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
    paymentMethods: payment.method ? [payment.method] : [],
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
  waiveSurcharge = false,
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  if (isFamilyDependent(member)) throw new Error('El cobro va a la cuenta del titular.');
  if (isDuesExemptMember(member)) throw new Error('Esta categoría no abona cuota social.');
  const requested = amount != null ? Number(amount) : 0;
  const stored = Number(member.outstandingBalance) || 0;
  const split = duesChargeBreakdown(member, {
    paidOn: today,
    amount: stored > 0 ? stored : requested,
    waiveSurcharge,
  });
  let due = requested;
  if (waiveSurcharge) {
    due = split.quota;
  } else if (stored > 0) {
    if (stored + 0.01 >= split.payable) due = stored;
    else if (stored + 0.01 >= split.capital) due = split.payable;
    else due = stored;
  }
  if (due <= 0) throw new Error('No hay saldo pendiente para abonar.');

  const paidAmount = requested > 0 ? requested : due;
  if (!paidAmount || paidAmount <= 0) throw new Error('Importe inválido.');
  if (paidAmount > due + 0.01) throw new Error('El importe supera el saldo pendiente.');

  const date = todayISODateAR(today);
  const time = nowTimeAR(today);
  const paidAt = today.toISOString();
  const lines = duesChargeBreakdown(member, { paidOn: today, amount: paidAmount, waiveSurcharge });
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
    period: today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
    balanceBefore: Number(member.outstandingBalance) || 0,
    nextDueBefore: member.nextDueDate || null,
    lastPaymentBefore: member.lastPaymentDate || null,
  };

  const history = [payment, ...(member.paymentHistory || [])];
  const remaining = due - paidAmount;

  if (remaining > 0.01) {
    const next = {
      ...member,
      outstandingBalance: Math.round(remaining * 100) / 100,
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

/** Anticipo de cuota cuando está al día (paga el próximo período). */
export function payUpcomingDues(member, { method = 'transferencia', today = new Date() } = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  if (isFamilyDependent(member)) throw new Error('El cobro va a la cuenta del titular.');
  if (isDuesExemptMember(member)) throw new Error('Esta categoría no abona cuota social.');
  if ((Number(member.outstandingBalance) || 0) > 0) {
    return payMemberDues(member, { method, today });
  }
  const dueOn = member.nextDueDate || nextDuesDueDate(today);
  const amount = duesPayableForMember(member, { paidOn: today, dueOn, on: dueOn })
    || referenceMonthlyDues(member, member.paymentHistory);
  const date = todayISODateAR(today);
  const time = nowTimeAR(today);
  const paidAt = today.toISOString();
  const split = duesChargeBreakdown(member, { paidOn: today, dueOn, on: dueOn, amount });
  const payment = {
    id: `pay-${member.memberId}-${Date.now()}`,
    date,
    time,
    paidAt,
    createdAt: paidAt,
    concept: `Cuota social anticipada · ${duesMethodLabel(method)}`,
    amount,
    quota: split.quota,
    surcharge: split.surcharge,
    method,
    status: 'paid',
    receipt: receiptNumberFor(member, date),
    receiptNumber: receiptNumberFor(member, date),
    period: today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
    balanceBefore: Number(member.outstandingBalance) || 0,
    nextDueBefore: member.nextDueDate || null,
    lastPaymentBefore: member.lastPaymentDate || null,
  };
  const advanced = afterCollectDues({ ...member, outstandingBalance: amount, nextDueDate: member.nextDueDate }, today);
  const next = {
    ...advanced,
    lastPaymentDate: date,
    paymentHistory: [payment, ...(member.paymentHistory || [])],
  };
  return {
    member: next,
    payment,
    fullyPaid: true,
    ledgerEntry: ledgerPago(next, payment),
  };
}

/**
 * Cobro operativo único: saldo vivo + historial + asiento de cuenta + diario.
 * Efectivo acredita; transferencia exige comprobante en el modal; MP deja QR.
 */
export function recordDuesCollection(member, {
  method = 'efectivo',
  bankId = null,
  bankName = null,
  journalAccount = null,
  receiptName = null,
  amount = null,
  today = new Date(),
  members = [],
  waiveSurcharge = false,
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const account = billingAccountMember(member, members);
  if (isDuesExemptMember(account)) throw new Error('Esta categoría no abona cuota social.');
  if (method === 'transferencia' && !receiptName) {
    throw new Error('Adjunte el comprobante de la transferencia.');
  }

  const due = Number(account.outstandingBalance) || 0;
  const paid = due > 0
    ? payMemberDues(account, { method, amount, today, waiveSurcharge })
    : payUpcomingDues(account, { method, today });

  const label = duesMethodLabel(method, bankName);
  const cashAccount = journalAccount || journalAccountForPayment(method, bankId);
  const receiptNote = receiptName ? ` · Comp: ${receiptName}` : '';
  const payment = {
    ...paid.payment,
    method,
    bankId: method === 'transferencia' ? bankId : null,
    bankName: method === 'transferencia' ? bankName : null,
    journalAccount: cashAccount,
    receiptName: receiptName || null,
    receiptNumber: paid.payment.receiptNumber || paid.payment.receipt,
    receipt: paid.payment.receiptNumber || paid.payment.receipt,
    concept: `${paid.payment.concept}${receiptNote}`,
    collectedFromMemberId: account.memberId !== member.memberId ? member.memberId : null,
    collectedFromName: account.memberId !== member.memberId ? member.name : null,
  };

  const memberNext = {
    ...paid.member,
    paymentHistory: [payment, ...(paid.member.paymentHistory || []).filter((row) => row.id !== paid.payment.id)],
  };

  return {
    member: memberNext,
    payment,
    fullyPaid: paid.fullyPaid,
    ledgerEntry: ledgerPago(memberNext, payment),
    journalEntry: {
      date: payment.date,
      description: `Cobro cuota social (${label}) - Socio: ${account.name} (Cred. ${account.memberId})${receiptNote}`,
      lines: [
        { account: cashAccount, type: 'debit', amount: payment.amount },
        { account: 'Cuotas Sociales', type: 'credit', amount: payment.amount },
      ],
      sourceModule: 'cuotas',
      sourceId: payment.id,
      memberId: account.memberId,
    },
  };
}

/**
 * Anula un cobro de cuota: deja el rastro y restaura el saldo.
 * No borra el movimiento.
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

  return {
    member: next,
    payment: nextPayment,
    journalEntry: {
      date: todayISODateAR(today),
      description: `Anulación cobro cuota social - Socio: ${member.name} (Cred. ${member.memberId}) · ${nextPayment.receiptNumber || nextPayment.receipt || paymentId}`,
      lines: [
        { account: 'Cuotas Sociales', type: 'debit', amount },
        { account: payment.journalAccount || 'Caja General', type: 'credit', amount },
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

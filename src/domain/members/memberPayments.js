import { afterCollectDues, duesAmountForMember } from './dues';
import { createAccountEntry } from '../accounting/memberBalances';
import { journalAccountForPayment } from './clubBanks';

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

function ledgerPago(member, payment) {
  return createAccountEntry({
    type: 'pago',
    memberNumber: member.memberId,
    memberName: member.name,
    value: payment.amount,
    date: payment.date,
    voucher: payment.receiptNumber || payment.receipt,
    source: 'dues_payment',
    description: payment.concept,
    paymentMethods: payment.method ? [payment.method] : [],
  });
}

/**
 * Registra un pago de cuota del socio (portal / caja).
 * Actualiza saldo, próximo vencimiento e historial.
 */
export function payMemberDues(member, {
  method = 'transferencia',
  amount = null,
  today = new Date(),
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const due = Number(member.outstandingBalance) || 0;
  if (due <= 0) throw new Error('No hay saldo pendiente para abonar.');

  const paidAmount = amount != null ? Number(amount) : due;
  if (!paidAmount || paidAmount <= 0) throw new Error('Importe inválido.');
  if (paidAmount > due) throw new Error('El importe supera el saldo pendiente.');

  const date = today.toISOString().slice(0, 10);
  const payment = {
    id: `pay-${member.memberId}-${Date.now()}`,
    date,
    concept: `Cuota social · ${duesMethodLabel(method)}`,
    amount: paidAmount,
    method,
    status: 'paid',
    receipt: receiptNumberFor(member, date),
    receiptNumber: receiptNumberFor(member, date),
    period: today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
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
  if ((Number(member.outstandingBalance) || 0) > 0) {
    return payMemberDues(member, { method, today });
  }
  const amount = duesAmountForMember(member);
  const date = today.toISOString().slice(0, 10);
  const payment = {
    id: `pay-${member.memberId}-${Date.now()}`,
    date,
    concept: `Cuota social anticipada · ${duesMethodLabel(method)}`,
    amount,
    method,
    status: 'paid',
    receipt: receiptNumberFor(member, date),
    receiptNumber: receiptNumberFor(member, date),
    period: today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
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
} = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  if (method === 'transferencia' && !receiptName) {
    throw new Error('Adjunte el comprobante de la transferencia.');
  }

  const due = Number(member.outstandingBalance) || 0;
  const paid = due > 0
    ? payMemberDues(member, { method, amount, today })
    : payUpcomingDues(member, { method, today });

  const label = duesMethodLabel(method, bankName);
  const account = journalAccount || journalAccountForPayment(method, bankId);
  const receiptNote = receiptName ? ` · Comp: ${receiptName}` : '';
  const payment = {
    ...paid.payment,
    method,
    bankId: method === 'transferencia' ? bankId : null,
    bankName: method === 'transferencia' ? bankName : null,
    journalAccount: account,
    receiptName: receiptName || null,
    receiptNumber: paid.payment.receiptNumber || paid.payment.receipt,
    receipt: paid.payment.receiptNumber || paid.payment.receipt,
    concept: `${paid.payment.concept}${receiptNote}`,
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
      description: `Cobro cuota social (${label}) - Socio: ${member.name} (Cred. ${member.memberId})${receiptNote}`,
      lines: [
        { account, type: 'debit', amount: payment.amount },
        { account: 'Cuotas Sociales', type: 'credit', amount: payment.amount },
      ],
      sourceModule: 'cuotas',
      sourceId: payment.id,
      memberId: member.memberId,
    },
  };
}

/** Aplica el cobro al padrón, al libro de cuenta y al diario. */
export function persistDuesCollection(result, {
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
  if (result.journalEntry) addJournalEntry?.(result.journalEntry);
  return result;
}

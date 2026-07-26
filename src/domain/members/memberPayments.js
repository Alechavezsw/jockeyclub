import { afterCollectDues, duesAmountForMember } from './dues';

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
    concept: `Cuota social · pago ${method}`,
    amount: paidAmount,
    method,
    status: 'paid',
    receipt: `RC-${String(member.memberId).slice(-6)}-${date.replace(/-/g, '')}`,
    period: today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
  };

  const history = [payment, ...(member.paymentHistory || [])];
  const remaining = due - paidAmount;

  if (remaining > 0.01) {
    return {
      member: {
        ...member,
        outstandingBalance: remaining,
        paymentHistory: history,
      },
      payment,
      fullyPaid: false,
    };
  }

  const cleared = afterCollectDues(member, today);
  return {
    member: {
      ...cleared,
      paymentHistory: history,
    },
    payment,
    fullyPaid: true,
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
    concept: `Cuota social anticipada`,
    amount,
    method,
    status: 'paid',
    receipt: `RC-${String(member.memberId).slice(-6)}-${date.replace(/-/g, '')}`,
    period: today.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
  };
  const advanced = afterCollectDues({ ...member, outstandingBalance: amount, nextDueDate: member.nextDueDate }, today);
  return {
    member: {
      ...advanced,
      paymentHistory: [payment, ...(member.paymentHistory || [])],
    },
    payment,
    fullyPaid: true,
  };
}

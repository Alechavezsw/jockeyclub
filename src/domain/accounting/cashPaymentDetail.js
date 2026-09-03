/** Detalle de pagos en efectivo cruzando movimientos de caja + cobranzas. */

import { formatAccessinCashDate } from './cashLedger';

export function isCashMemberPayment(movement) {
  return /pago con efectivo/i.test(String(movement?.typeLabel || ''));
}

export function matchCobranzasForCashMovement(movement, cobranzas = []) {
  if (!movement) return [];
  const memberNumber = String(movement.memberNumber || movement.description || '').replace(/\D/g, '');
  const date = String(movement.date || '').slice(0, 10);
  const amount = Number(movement.amount) || 0;
  if (!memberNumber || !date) return [];

  const sameMemberDate = (cobranzas || []).filter((c) => (
    String(c.memberNumber || '').replace(/\D/g, '') === memberNumber
    && String(c.date || '').slice(0, 10) === date
    && String(c.paymentMethod || '') === 'efectivo'
  ));

  if (!sameMemberDate.length) return [];

  // Preferir el recibo cuyo cashAmount coincide con el movimiento.
  const byReceipt = new Map();
  sameMemberDate.forEach((row) => {
    const key = row.receiptId || row.id;
    if (!byReceipt.has(key)) byReceipt.set(key, []);
    byReceipt.get(key).push(row);
  });

  let best = sameMemberDate;
  let bestScore = -1;
  byReceipt.forEach((lines) => {
    const cashAmt = Number(lines[0]?.cashAmount) || 0;
    const lineSum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const score = cashAmt === amount || lineSum === amount ? 2 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = lines;
    }
  });

  return best.toSorted((a, b) => String(a.type || '').localeCompare(String(b.type || '')));
}

export function buildCashPaymentDetail(movement, cobranzas = [], members = []) {
  if (!movement) return null;
  const lines = matchCobranzasForCashMovement(movement, cobranzas);
  const memberFromLines = lines[0];
  const memberNumber = String(movement.memberNumber || memberFromLines?.memberNumber || '').trim();
  const memberName = memberFromLines?.memberName
    || members.find((m) => String(m.memberId || '').replace(/\D/g, '') === memberNumber.replace(/\D/g, ''))?.name
    || '';
  const receiptId = memberFromLines?.receiptId || '';
  const paymentTotal = Number(movement.amount) || 0;
  const applied = lines.map((line) => ({
    id: line.id,
    date: line.date,
    type: line.type,
    description: line.concept || line.type,
    amount: Number(line.amount) || 0,
    cancelled: Number(line.amount) || 0,
  }));
  const appliedSum = applied.reduce((s, l) => s + l.amount, 0);

  return {
    movementId: movement.id,
    accessinId: movement.accessinId,
    paymentNumber: receiptId ? String(receiptId).replace(/^0+/, '') || receiptId : String(movement.accessinId || ''),
    date: movement.date,
    dateLabel: formatAccessinCashDate(movement.date),
    memberNumber,
    memberName,
    title: `Pago #${receiptId ? String(receiptId).replace(/^0+/, '') : movement.accessinId}${memberNumber ? ` - Socio - ${memberNumber}` : ''} - ${formatAccessinCashDate(movement.date)}`,
    description: memberFromLines
      ? `Abono de ${formatAccessinCashDate(movement.date).replace(/^\d+\s+de\s+/i, '')}`
      : (movement.typeLabel || 'Movimiento de efectivo'),
    voucher: '',
    applied,
    creditApplied: 0,
    surplus: Math.max(0, paymentTotal - appliedSum),
    paymentTotal,
    paymentMethods: [
      { id: 'efectivo', label: 'Efectivo', amount: paymentTotal },
    ],
    typeLabel: movement.typeLabel,
    rawDescription: movement.description,
  };
}

export function cashMovementsSaldo(movements = []) {
  return Math.round(
    (movements || []).reduce((s, m) => s + (Number(m.amount) || 0), 0) * 100
  ) / 100;
}

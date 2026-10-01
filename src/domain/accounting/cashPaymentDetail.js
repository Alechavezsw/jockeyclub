/** Detalle de pagos en efectivo cruzando movimientos de caja + cobranzas. */

import { periodLabelFromKey } from './detailedCurrentAccounts';
import { formatAccessinCashDate } from './cashLedger';
import { duesAmountForMember, duesPayableForMember, toWhatsAppPhone } from '../members/dues';

export function isCashMemberPayment(movement) {
  return /pago con efectivo/i.test(String(movement?.typeLabel || ''));
}

function methodFamily(movement) {
  const label = String(movement?.typeLabel || '').toLowerCase();
  if (/efectivo/.test(label)) return 'efectivo';
  if (/cheque/.test(label)) return 'cheques';
  if (/electr[oó]nico|macro click|click de pago/.test(label)) return 'electronico';
  if (/transfer/.test(label)) return 'transferencia';
  return '';
}

function receiptMethodAmount(row, family) {
  if (family === 'efectivo') return Number(row?.cashAmount) || 0;
  if (family === 'electronico') return Number(row?.electronicAmount) || 0;
  if (family === 'transferencia') return Number(row?.transferAmount) || 0;
  if (family === 'cheques') return Number(row?.checkAmount) || 0;
  return 0;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

export function matchCobranzasForCashMovement(movement, cobranzas = []) {
  if (!movement) return [];
  const memberNumber = String(movement.memberNumber || movement.description || '').replace(/\D/g, '');
  const date = String(movement.date || '').slice(0, 10);
  const amount = Number(movement.amount) || 0;
  if (!memberNumber || !date) return [];

  const family = methodFamily(movement);
  const sameMemberDate = (cobranzas || []).filter((c) => (
    String(c.memberNumber || '').replace(/\D/g, '') === memberNumber
    && String(c.date || '').slice(0, 10) === date
    && (!family || !c.paymentMethod || c.paymentMethod === family || c.paymentMethod === 'otros')
  ));

  if (!sameMemberDate.length) return [];

  const byReceipt = new Map();
  sameMemberDate.forEach((row) => {
    const key = row.receiptId || row.id;
    if (!byReceipt.has(key)) byReceipt.set(key, []);
    byReceipt.get(key).push(row);
  });

  let best = sameMemberDate;
  let bestScore = -1;
  byReceipt.forEach((lines) => {
    const methodAmt = receiptMethodAmount(lines[0], family);
    const lineSum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    let score = 1;
    if (family && lines[0]?.paymentMethod === family) score = 2;
    if (methodAmt === amount || lineSum === amount) score = 4;
    if (score > bestScore) {
      bestScore = score;
      best = lines;
    }
  });

  return best.toSorted((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.type || '').localeCompare(String(b.type || '')));
}

function shiftMonth(year, month, delta) {
  const date = new Date(year, month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function periodKeyOf(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Cuota del período y, si el pago cae después del 10, el recargo del 10 %. */
export function feeImputationLines(movement, member) {
  const paidOn = String(movement?.date || '').slice(0, 10);
  const amount = Math.round((Number(movement?.amount) || 0) * 100) / 100;
  const match = paidOn.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !(amount > 0) || !member) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const current = { year, month };
  const previous = shiftMonth(year, month, -1);
  const order = day <= 10 ? [previous, current] : [current, previous];
  for (const period of order) {
    const lines = linesForFeePeriod(member, period, paidOn, amount);
    if (lines.length) return lines;
  }
  return [];
}

/**
 * Cuota del mes calendario cobrada en ese mes.
 * Un pago de un mes anterior, el recargo y el resto de la caja no entran.
 */
export function currentMonthFeeCollected(movements = [], members = [], monthKey = '') {
  const byNumber = new Map();
  for (const member of members || []) {
    const digits = String(member?.memberId || member?.member_number || member?.memberNumber || '').replace(/\D/g, '');
    if (digits && !byNumber.has(digits)) byNumber.set(digits, member);
  }
  const seen = new Set();
  let total = 0;
  for (const row of movements || []) {
    const date = String(row?.date || '').slice(0, 10);
    if (!monthKey || !date.startsWith(monthKey)) continue;
    const movementType = String(row?.movementType || 'income');
    if (movementType === 'expense' || movementType === 'transfer_out') continue;
    if (row?.status === 'void' || row?.status === 'cancelled') continue;
    const amount = Number(row?.amount) || 0;
    if (amount <= 0) continue;
    const id = String(row?.accessinId ?? row?.id ?? '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const digits = String(row?.memberNumber || row?.description || '').replace(/\D/g, '');
    const member = byNumber.get(digits);
    if (!member) continue;
    for (const line of feeImputationLines(row, member)) {
      if (!String(line.date || '').startsWith(monthKey)) continue;
      if (String(line.type || '') !== 'Cuota') continue;
      total += Number(line.amount) || 0;
    }
  }
  return Math.round(total * 100) / 100;
}

function linesForFeePeriod(member, period, paidOn, amount) {
  const key = periodKeyOf(period.year, period.month);
  const on = new Date(period.year, period.month - 1, 1);
  const dueOn = `${key}-10`;
  const cuota = Math.round((Number(duesAmountForMember(member, on)) || 0) * 100) / 100;
  if (!(cuota > 0)) return [];
  const payable = Math.round((Number(duesPayableForMember(member, { paidOn, dueOn, on })) || 0) * 100) / 100;
  if (Math.abs(payable - amount) > 0.009) return [];
  const label = periodLabelFromKey(key);
  const recargo = Math.round((payable - cuota) * 100) / 100;
  const rows = [{
    id: `cuota-${key}`,
    date: `${key}-01`,
    type: 'Cuota',
    description: label,
    amount: cuota,
    cancelled: cuota,
  }];
  if (recargo > 0) {
    rows.push({
      id: `recargo-${key}`,
      date: `${key}-10`,
      type: 'Recargo de Cuota (10.00 %)',
      description: label,
      amount: recargo,
      cancelled: recargo,
    });
  }
  return rows;
}

function includesRecargo(rows) {
  return (rows || []).some((row) => /recargo/i.test(String(row.type || row.description || '')));
}

export function buildCashPaymentDetail(movement, cobranzas = [], members = []) {
  if (!movement) return null;
  const lines = matchCobranzasForCashMovement(movement, cobranzas);
  const memberFromLines = lines[0];
  const memberNumber = String(movement.memberNumber || memberFromLines?.memberNumber || '').trim();
  const memberDigits = memberNumber.replace(/\D/g, '');
  const member = (members || []).find((row) => (
    String(row.memberId || row.member_number || '').replace(/\D/g, '') === memberDigits
  ));
  const memberName = memberFromLines?.memberName || member?.name || '';
  const receiptId = memberFromLines?.receiptId || '';
  const paymentTotal = Number(movement.amount) || 0;
  const sourced = (Array.isArray(movement.allocations) && movement.allocations.length
    ? movement.allocations
    : lines
  ).map((line) => ({
    id: line.id,
    date: line.date,
    type: line.type,
    description: line.description || line.concept || line.type,
    amount: Number(line.amount) || 0,
    cancelled: Number(line.cancelled ?? line.amount) || 0,
  }));
  const fromFees = feeImputationLines(movement, member);
  const applied = sourced.length && (includesRecargo(sourced) || !fromFees.length)
    ? sourced
    : (fromFees.length ? fromFees : sourced);
  const appliedSum = applied.reduce((s, l) => s + l.amount, 0);
  const paymentNumber = firstText(
    movement.paymentNumber,
    receiptId ? String(receiptId).replace(/^0+/, '') : '',
    movement.accessinId,
  );
  const methodLabel = firstText(movement.typeLabel, memberFromLines?.paymentMethodLabel, 'Pago');

  return {
    movementId: movement.id,
    accessinId: movement.accessinId,
    paymentNumber,
    date: movement.date,
    dateLabel: formatAccessinCashDate(movement.date),
    memberNumber,
    memberName,
    phone: member?.phone || '',
    email: member?.email || '',
    title: `Pago #${paymentNumber}${memberNumber ? ` - Socio - ${memberNumber}` : ''} - ${formatAccessinCashDate(movement.date)}`,
    description: firstText(
      movement.paymentDescription,
      movement.note,
      memberFromLines?.paymentNote,
      methodLabel,
    ),
    voucher: firstText(movement.voucher, movement.comprobante, memberFromLines?.voucher),
    applied,
    creditApplied: Number(movement.creditApplied) || 0,
    surplus: applied.length ? Math.max(0, Math.round((paymentTotal - appliedSum) * 100) / 100) : 0,
    paymentTotal,
    paymentMethods: [
      {
        id: String(movement.accessinId || methodLabel),
        label: methodLabel,
        reference: movement.accessinId ? String(movement.accessinId) : '',
        amount: paymentTotal,
      },
    ],
    typeLabel: movement.typeLabel,
    rawDescription: movement.description,
  };
}

/** WhatsApp al celular del socio y mail a su correo, con el texto del recibo. */
export function cashPaymentShareTargets(detail, formatMoney) {
  if (!detail) return { message: '', whatsappUrl: null, mailUrl: null };
  const total = typeof formatMoney === 'function'
    ? formatMoney(detail.paymentTotal)
    : String(detail.paymentTotal ?? '');
  const greeting = detail.memberName ? `Hola ${detail.memberName}` : 'Hola';
  const message = [
    `${greeting}, te saludamos del Jockey Club San Juan.`,
    '',
    detail.title || 'Recibo de pago',
    detail.description || null,
    `Total: ${total}`,
  ].filter((line) => line != null).join('\n');
  const phone = toWhatsAppPhone(detail.phone);
  const mail = String(detail.email || '').trim();
  const subject = detail.title || 'Recibo de pago';
  return {
    message,
    phone: detail.phone || '',
    email: mail,
    whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null,
    mailUrl: mail
      ? `mailto:${mail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
      : null,
  };
}

export function cashMovementsSaldo(movements = []) {
  return Math.round(
    (movements || []).reduce((s, m) => s + (Number(m.amount) || 0), 0) * 100
  ) / 100;
}

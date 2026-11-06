import { todayAR } from '../../lib/arDate';
import {
  reservationBalanceAfterDeposit,
  reservationDepositAmount,
  reservationTotalPrice,
} from './bookingRules';

/**
 * Armado del pago para comprobante PDF / mail / MD de una reserva.
 * Seña: muestra lo abonado y el saldo. Total: alquiler saldado.
 */
export function buildBookingPaymentReceipt({
  member,
  facility,
  facilityName,
  date,
  time,
  method,
  payFull = false,
  total: totalArg,
  charged: chargedArg,
  deposit: depositArg,
  balanceAfter: balanceArg,
  today = todayAR(),
} = {}) {
  const total = Number(totalArg) > 0
    ? Math.round(Number(totalArg))
    : reservationTotalPrice(facility);
  const deposit = Number(depositArg) > 0
    ? Math.round(Number(depositArg))
    : reservationDepositAmount(total);
  const charged = Number(chargedArg) > 0
    ? Math.round(Number(chargedArg))
    : (payFull ? total : deposit);
  const balanceRemaining = payFull
    ? 0
    : (Number.isFinite(Number(balanceArg))
      ? Math.max(0, Math.round(Number(balanceArg)))
      : reservationBalanceAfterDeposit(total));
  const place = String(facilityName || facility?.name || 'Instalación').trim() || 'Instalación';
  const tag = payFull ? 'TOT' : 'SEN';
  const memberKey = String(member?.memberId || 'SOCIO').replace(/\W/g, '').slice(-6) || 'SOCIO';
  const dayKey = String(today || todayAR()).replace(/\D/g, '').slice(0, 8);
  const receipt = `RSV-${tag}-${memberKey}-${dayKey}`;
  const eventBits = [String(date || '').slice(0, 10), time ? `${time} hs` : ''].filter(Boolean);
  return {
    id: receipt,
    receipt,
    receiptNumber: receipt,
    date: String(today || todayAR()).slice(0, 10),
    amount: charged,
    method: method || 'caja',
    concept: payFull ? `Alquiler total · ${place}` : `Seña 50 % · ${place}`,
    period: eventBits.join(' · ') || place,
    kind: 'reserva',
    bookingScope: payFull ? 'total' : 'deposit',
    facilityName: place,
    eventDate: String(date || '').slice(0, 10) || null,
    eventTime: time || null,
    totalPrice: total,
    depositAmount: deposit,
    balanceRemaining,
  };
}

/** True si el cobro cargado cubre el alquiler completo (no solo la seña). */
export function reservationPaidInFull(reservation) {
  const total = reservationTotalPrice(null, reservation);
  if (!(total > 0)) return false;
  const charged = Number(reservation?.chargedPrice);
  if (Number.isFinite(charged) && charged > 0 && charged >= total - 0.5) return true;
  const notes = String(reservation?.notes || '');
  if (/Pago:\s*total alquiler/i.test(notes)) return true;
  return false;
}

/** Reimprime seña o total desde una fila del libro de reservas. */
export function buildBookingReceiptFromReservation(reservation, {
  member = null,
  payFull = false,
  today = todayAR(),
} = {}) {
  const total = reservationTotalPrice(null, reservation);
  const deposit = Number(reservation?.depositAmount) > 0
    ? Math.round(Number(reservation.depositAmount))
    : reservationDepositAmount(total);
  const paidOn = String(reservation?.createdAt || reservation?.date || today).slice(0, 10);
  return buildBookingPaymentReceipt({
    member: member || {
      memberId: reservation?.memberId,
      name: reservation?.memberName,
    },
    facilityName: reservation?.facilityName,
    date: reservation?.date,
    time: reservation?.time,
    method: reservation?.paymentMethod || 'caja',
    payFull,
    total,
    charged: payFull ? total : deposit,
    deposit,
    balanceAfter: payFull ? 0 : Math.max(0, total - deposit),
    today: paidOn || today,
  });
}

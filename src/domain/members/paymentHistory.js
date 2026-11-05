import { formatInstantAR, hasClock, nowTimeAR, todayAR } from '../../lib/arDate';
import {
  duesAmountForMember,
  duesAmountForTier,
  duesChargeBreakdown,
  duesDueDayForMember,
  firstUnpaidDuesDate,
  isDuesExemptMember,
  monthsBehindOnDues,
  overdueSocialMonths,
  pinDuesDueDate,
} from './dues';

function isDuesPayment(row) {
  const concept = String(row?.concept || '').toLowerCase();
  if (/evento|reserva|inscrip/.test(concept)) return false;
  return true;
}

function latestDuesPaymentDate(history = [], member) {
  const fromHistory = (history || [])
    .filter((p) => p && p.status !== 'void' && isDuesPayment(p) && p.date)
    .map((p) => String(p.date).slice(0, 10))
    .sort((a, b) => b.localeCompare(a))[0] || null;
  const fromMember = member?.lastPaymentDate ? String(member.lastPaymentDate).slice(0, 10) : null;
  if (fromHistory && fromMember) return fromHistory > fromMember ? fromHistory : fromMember;
  return fromHistory || fromMember || null;
}

const METHOD_LABELS = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  debito: 'Débito automático',
  tarjeta: 'Tarjeta',
  caja: 'Caja / Secretaría',
};

function monthLabel(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

function shiftMonths(fromIso, delta) {
  const d = new Date(`${fromIso}T12:00:00`);
  d.setMonth(d.getMonth() + delta);
  return todayAR(d);
}

function paymentAmount(row) {
  const n = Number(row?.amount ?? row?.value ?? row?.monto);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cuota mensual para mora del titular.
 * Un pago cubre la cuota de esa ficha: no se multiplica por adherentes.
 * El grupo familiar se liquida aparte en administración.
 */
export function referenceMonthlyDues(member, history = [], on = new Date()) {
  if (isDuesExemptMember(member)) return 0;
  const fromPay = (history || []).find((p) => paymentAmount(p) > 0);
  if (fromPay) return paymentAmount(fromPay);
  const fromTier = duesAmountForTier(member?.tier, undefined, on);
  if (fromTier > 0) return fromTier;
  return 32000;
}

/**
 * Historial de pagos del socio.
 * Si `paymentHistory` viene como array (aunque vacío), no inventa filas.
 * El historial demo solo aplica a fichas locales sin nube.
 */
export function getMemberPaymentHistory(member, { today = new Date(), allowDemo = false } = {}) {
  if (Array.isArray(member?.paymentHistory)) {
    return [...member.paymentHistory]
      .map(normalizePayment)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  if (member?.id || !allowDemo) return [];

  const todayIso = todayAR(today);
  const baseDue = member?.nextDueDate || todayIso;
  const amount = duesAmountForMember(member) || duesAmountForTier(member?.tier) || 32000;
  const years = Math.max(1, Number(member?.yearsActive) || 2);
  const months = Math.min(18, years * 6);
  const hasDebt = (Number(member?.outstandingBalance) || 0) > 0;

  const history = [];
  for (let i = 1; i <= months; i += 1) {
    // Si hay deuda, el mes más reciente (i=1 relativo al vencimiento) queda pendiente.
    if (hasDebt && i === 1) continue;
    const date = shiftMonths(baseDue, -i);
    const method = i % 5 === 0 ? 'debito' : i % 3 === 0 ? 'transferencia' : i % 2 === 0 ? 'caja' : 'efectivo';
    history.push({
      id: `pay-${member?.memberId || 'm'}-${date}`,
      date,
      concept: `Cuota social · ${monthLabel(date)}`,
      amount,
      method,
      status: 'paid',
      receipt: `RC-${String(member?.memberId || '').slice(-4)}-${date.replace(/-/g, '').slice(2)}`,
      period: monthLabel(date),
    });
  }

  // Cobros puntuales (reservas / eventos) para enriquecer el historial
  if (/vitalicio|fundador/i.test(String(member?.tier || ''))) {
    history.push({
      id: `pay-${member.memberId}-evt`,
      date: shiftMonths(todayIso, -2),
      concept: 'Inscripción evento social',
      amount: 15000,
      method: 'transferencia',
      status: 'paid',
      receipt: `RC-EVT-${String(member.memberId).slice(-4)}`,
      period: null,
    });
  }

  return history
    .map(normalizePayment)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function normalizePayment(row) {
  const amount = paymentAmount(row);
  const date = row.date ? String(row.date).slice(0, 10) : row.date;
  return {
    id: row.id || `pay-${row.date}-${amount}`,
    date,
    time: row.time || '',
    paidAt: row.paidAt || null,
    createdAt: row.createdAt || null,
    concept: row.concept || 'Cuota social',
    amount,
    method: row.method || 'caja',
    methodLabel: METHOD_LABELS[row.method] || row.methodLabel || 'Pago',
    bankName: row.bankName || '',
    status: row.status || 'paid',
    receipt: row.receipt || row.receiptNumber || null,
    receiptNumber: row.receiptNumber || row.receipt || null,
    period: row.period || null,
  };
}

function clockFromPayment(payment) {
  if (payment?.time) return payment.time;
  const stamp = payment?.paidAt || payment?.createdAt;
  if (!stamp || !hasClock(stamp)) return '';
  const raw = String(stamp);
  const instant = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(instant.getTime())) return '';
  return nowTimeAR(instant);
}

/** Fecha de pago + hora de registro. Misma regla para todos los cobros. */
export function paymentWhenStamp(payment) {
  if (!payment) return '';
  const date = String(payment.date || '').slice(0, 10);
  const time = clockFromPayment(payment);
  if (date && time) return `${date}T${time}`;
  return date;
}

/** Fecha y hora del pago de cuota, en es-AR. Vale para todas las fichas. */
export function formatPaymentWhen(payment) {
  if (!payment) return '—';
  const date = String(payment.date || '').slice(0, 10);
  const time = clockFromPayment(payment);
  if (date && time) return formatInstantAR(date, time);
  if (date) return formatInstantAR(date);
  return '—';
}

export function summarizePaymentHistory(history = [], member, { today = new Date() } = {}) {
  const paid = (history || []).filter((p) => p.status === 'paid');
  const totalPaid = paid.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const last = paid[0] || null;
  const lastDuesDate = latestDuesPaymentDate(paid, member);
  if (isDuesExemptMember(member)) {
    return {
      totalPaid,
      paymentsCount: paid.length,
      lastPayment: last,
      lastDuesDate,
      monthsBehind: 0,
      outstanding: 0,
      nextDue: null,
      nextAmount: 0,
      monthlyReference: 0,
    };
  }
  const monthly = referenceMonthlyDues(member, paid, today);
  const stored = Number(member?.outstandingBalance) || 0;
  const fromHistory = lastDuesDate
    ? firstUnpaidDuesDate({ lastPaymentDate: lastDuesDate, today, member })
    : null;
  const fromFicha = pinDuesDueDate(member?.nextDueDate, member);
  // Con saldo, la cuota más vieja impaga gana (ficha/RPC vs último cobro).
  let nextDue;
  if (stored > 0 && fromHistory && fromFicha) {
    nextDue = fromHistory <= fromFicha ? fromHistory : fromFicha;
  } else {
    nextDue = firstUnpaidDuesDate({
      lastPaymentDate: lastDuesDate,
      nextDueDate: member?.nextDueDate,
      today,
      member,
    });
  }
  const standingMember = {
    ...member,
    lastPaymentDate: lastDuesDate || member?.lastPaymentDate || null,
    nextDueDate: nextDue,
  };
  const monthsBehind = monthsBehindOnDues({
    lastPaymentDate: lastDuesDate,
    nextDueDate: nextDue,
    today,
    member,
  });
  const overdue = overdueSocialMonths(standingMember, today);
  const outstanding = Math.max(stored, monthsBehind > 0 ? monthsBehind * monthly : 0);
  const split = duesChargeBreakdown(
    { ...standingMember, outstandingBalance: outstanding },
    { paidOn: today },
  );
  const nextAmount = outstanding > 0 ? (split.total || outstanding) : monthly;

  return {
    totalPaid,
    paymentsCount: paid.length,
    lastPayment: last,
    lastDuesDate,
    monthsBehind: Math.max(monthsBehind, overdue.length),
    outstanding,
    nextDue: overdue[0]?.dueOn || nextDue,
    nextAmount,
    surcharge: outstanding > 0 ? (split.surcharge || 0) : 0,
    dueDay: duesDueDayForMember(member),
    monthlyReference: duesAmountForTier(member?.tier, undefined, today),
  };
}

export { METHOD_LABELS };

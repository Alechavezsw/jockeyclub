import {
  duesAmountForMember,
  duesAmountForTier,
  firstUnpaidDuesDate,
  monthsBehindOnDues,
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
  return d.toISOString().slice(0, 10);
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
export function referenceMonthlyDues(member, history = []) {
  const fromPay = (history || []).find((p) => paymentAmount(p) > 0);
  if (fromPay) return paymentAmount(fromPay);
  const fromTier = duesAmountForTier(member?.tier);
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

  const todayIso = today.toISOString().slice(0, 10);
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
  return {
    id: row.id || `pay-${row.date}-${amount}`,
    date: row.date,
    concept: row.concept || 'Cuota social',
    amount,
    method: row.method || 'caja',
    methodLabel: METHOD_LABELS[row.method] || row.methodLabel || 'Pago',
    status: row.status || 'paid',
    receipt: row.receipt || row.receiptNumber || null,
    period: row.period || null,
  };
}

export function summarizePaymentHistory(history = [], member, { today = new Date() } = {}) {
  const paid = (history || []).filter((p) => p.status === 'paid');
  const totalPaid = paid.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const last = paid[0] || null;
  const lastDuesDate = latestDuesPaymentDate(paid, member);
  const monthsBehind = monthsBehindOnDues({
    lastPaymentDate: lastDuesDate,
    nextDueDate: member?.nextDueDate,
    today,
  });
  const monthly = referenceMonthlyDues(member, paid);
  const stored = Number(member?.outstandingBalance) || 0;
  const outstanding = Math.max(stored, monthsBehind > 0 ? monthsBehind * monthly : 0);
  const nextDue = firstUnpaidDuesDate({
    lastPaymentDate: lastDuesDate,
    nextDueDate: member?.nextDueDate,
    today,
  });
  const nextAmount = outstanding > 0 ? outstanding : monthly;

  return {
    totalPaid,
    paymentsCount: paid.length,
    lastPayment: last,
    lastDuesDate,
    monthsBehind,
    outstanding,
    nextDue,
    nextAmount,
    monthlyReference: duesAmountForTier(member?.tier),
  };
}

export { METHOD_LABELS };

import { duesAmountForMember, duesAmountForTier } from './dues';

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

/**
 * Historial de pagos del socio.
 * Usa `member.paymentHistory` si existe; si no hay filas y el socio viene de BD (`id`),
 * devuelve vacío (no inventa demos). El historial demo solo aplica a fichas locales.
 */
export function getMemberPaymentHistory(member, { today = new Date() } = {}) {
  if (Array.isArray(member?.paymentHistory) && member.paymentHistory.length) {
    return [...member.paymentHistory]
      .map(normalizePayment)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  // Socio persistido en cloud: sin pagos = historial vacío real
  if (member?.id) return [];

  const todayIso = today.toISOString().slice(0, 10);
  const baseDue = member?.nextDueDate || todayIso;
  const amount = duesAmountForMember(member);
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
  if (member?.tier === 'royal' || member?.tier === 'platinum') {
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
  return {
    id: row.id || `pay-${row.date}-${row.amount}`,
    date: row.date,
    concept: row.concept || 'Cuota social',
    amount: Number(row.amount) || 0,
    method: row.method || 'caja',
    methodLabel: METHOD_LABELS[row.method] || row.methodLabel || 'Pago',
    status: row.status || 'paid',
    receipt: row.receipt || null,
    period: row.period || null,
  };
}

export function summarizePaymentHistory(history = [], member) {
  const paid = (history || []).filter((p) => p.status === 'paid');
  const totalPaid = paid.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const last = paid[0] || null;
  const outstanding = Number(member?.outstandingBalance) || 0;
  const nextDue = member?.nextDueDate || null;
  const nextAmount = outstanding > 0 ? outstanding : duesAmountForMember(member);

  return {
    totalPaid,
    paymentsCount: paid.length,
    lastPayment: last,
    outstanding,
    nextDue,
    nextAmount,
    monthlyReference: duesAmountForTier(member?.tier),
  };
}

export { METHOD_LABELS };

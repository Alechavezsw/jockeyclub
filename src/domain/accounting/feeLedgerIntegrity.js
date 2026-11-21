/**
 * Integridad entre ficha operativa y fee_ledger_lines.
 * No inventa pagos ni créditos: detecta, clasifica y bloquea cobros solo-ledger.
 */
import { money } from '../money.js';

export const PERIOD_STATUS = {
  PAGADO: 'pagado',
  PENDIENTE: 'pendiente',
  CONCILIADO_ADMIN: 'conciliado_administrativamente',
  EN_REVISION: 'en_revision',
};

const EPS = 0.009;

function asYm(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return '';
}

function memberNumberOf(member) {
  return String(member?.memberNumber || member?.memberId || member?.id || '').trim();
}

function coveredThroughYm(member) {
  const raw = String(member?.duesCoveredThrough || member?.meta?.duesCoveredThrough || '').trim();
  return asYm(raw);
}

function adminReconcileNote(member, periodYm) {
  const meta = member?.meta && typeof member.meta === 'object' ? member.meta : {};
  const key = Object.keys(meta).find((k) => {
    if (!/LedgerStatus$/i.test(k)) return false;
    const m = String(k).match(/([a-z]+)(\d{4})LedgerStatus/i);
    if (!m) return false;
    const monthNames = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12',
    };
    const mm = monthNames[m[1].toLowerCase()];
    return mm && `${m[2]}-${mm}` === periodYm;
  });
  if (key && /conciliado administrativamente/i.test(String(meta[key] || ''))) {
    return String(meta[key]);
  }
  const rows = Array.isArray(meta.feeLedgerAdminReconcile) ? meta.feeLedgerAdminReconcile : [];
  const hit = rows.find((row) => asYm(row?.period) === periodYm);
  return hit ? String(hit.reason || 'conciliado administrativamente') : '';
}

function paymentCoversPeriod(payments = [], periodYm) {
  return (payments || []).some((payment) => {
    if (!payment || payment.voidedAt || payment.status === 'void' || payment.status === 'anulled') {
      return false;
    }
    if (asYm(payment.paidAt || payment.date) === periodYm) return true;
    const dueOns = Array.isArray(payment.periodDueOns) ? payment.periodDueOns : [];
    if (dueOns.some((d) => asYm(d) === periodYm)) return true;
    const label = String(payment.period || payment.periodLabel || payment.concept || '');
    if (label.includes(periodYm)) return true;
    // MM/YYYY
    const [y, m] = periodYm.split('-');
    if (y && m && label.includes(`${m}/${y}`)) return true;
    return false;
  });
}

function imputationCoversPeriod(imputations = [], periodYm) {
  return (imputations || []).some((row) => (
    row
    && !row.voidedAt
    && asYm(row.dueOn) === periodYm
    && (Number(row.capital) || 0) + (Number(row.surcharge) || 0) > EPS
  ));
}

function periodIsCoveredOperationally(member, periodYm, { payments = [], imputations = [] } = {}) {
  if (!periodYm) return false;
  if (adminReconcileNote(member, periodYm)) return true;
  const covered = coveredThroughYm(member);
  if (covered && covered >= periodYm) return true;
  if (paymentCoversPeriod(payments, periodYm)) return true;
  if (imputationCoversPeriod(imputations, periodYm)) return true;
  const ficha = Number(member?.outstandingBalance) || 0;
  const nextYm = asYm(member?.nextDueDate);
  if (ficha <= EPS && nextYm && nextYm > periodYm) return true;
  return false;
}

/**
 * Estado visible de un período en ledger + ficha.
 */
export function periodLedgerStatus(member, line, {
  payments = [],
  imputations = [],
} = {}) {
  const periodYm = asYm(line?.date || line?.lineDate || line?.periodYm);
  const pending = money(Number(line?.pending) || 0);
  const collected = money(Number(line?.collected) || 0);
  const source = String(line?.source || '');
  const adminNote = adminReconcileNote(member, periodYm);
  if (adminNote || /admin_reconciled/i.test(source)) {
    return PERIOD_STATUS.CONCILIADO_ADMIN;
  }
  const covered = periodIsCoveredOperationally(member, periodYm, { payments, imputations });
  if (pending <= EPS && (collected > EPS || covered)) {
    return PERIOD_STATUS.PAGADO;
  }
  const ficha = Number(member?.outstandingBalance) || 0;
  if (ficha <= EPS && pending > EPS) {
    return PERIOD_STATUS.EN_REVISION;
  }
  if (pending > EPS) return PERIOD_STATUS.PENDIENTE;
  return PERIOD_STATUS.PAGADO;
}

export function periodStatusLabel(status) {
  switch (status) {
    case PERIOD_STATUS.PAGADO:
      return 'Pagado';
    case PERIOD_STATUS.PENDIENTE:
      return 'Pendiente';
    case PERIOD_STATUS.CONCILIADO_ADMIN:
      return 'Conciliado administrativamente';
    case PERIOD_STATUS.EN_REVISION:
      return 'En revisión';
    default:
      return '—';
  }
}

/**
 * Detecta anomalías ficha vs fee_ledger para un socio.
 */
export function detectFeeLedgerFichaAnomalies({
  member,
  ledgerLines = [],
  payments = [],
  imputations = [],
} = {}) {
  if (!member) return [];
  const ficha = money(Number(member.outstandingBalance) || 0);
  const nro = memberNumberOf(member);
  const name = member.name || member.fullName || '';
  const findings = [];
  const lines = (ledgerLines || []).filter((row) => {
    const mn = String(row.memberNumber || row.member_number || '').trim();
    return !mn || mn === nro;
  });

  for (const line of lines) {
    const periodYm = asYm(line.date || line.lineDate || line.periodYm);
    if (!periodYm) continue;
    const pending = money(Number(line.pending) || 0);
    const collected = money(Number(line.collected) || 0);
    const amount = money(Number(line.amount) || 0);
    const status = periodLedgerStatus(member, line, { payments, imputations });
    const covered = periodIsCoveredOperationally(member, periodYm, { payments, imputations });
    const hasPay = paymentCoversPeriod(payments, periodYm);
    const hasImp = imputationCoversPeriod(imputations, periodYm);
    const source = String(line.source || '');

    const base = {
      memberId: member.memberId || member.id,
      memberNumber: nro,
      name,
      period: periodYm,
      fichaBalance: ficha,
      ledgerPending: pending,
      ledgerCollected: collected,
      ledgerAmount: amount,
      difference: money(pending - Math.max(ficha, 0)),
      reconciliationStatus: status,
      evidence: [
        `línea ${line.id || '—'}`,
        `source=${source || '—'}`,
        coveredThroughYm(member) ? `coveredThrough=${coveredThroughYm(member)}` : null,
        member.nextDueDate ? `nextDue=${String(member.nextDueDate).slice(0, 10)}` : null,
        hasPay ? 'pago_periodo=si' : 'pago_periodo=no',
        hasImp ? 'imputacion=si' : 'imputacion=no',
      ].filter(Boolean).join(' · '),
    };

    if (ficha <= EPS && pending > EPS) {
      findings.push({
        ...base,
        code: 'ficha_zero_ledger_pending',
        severity: 'high',
        message: 'Ficha en $0 con línea contable pendiente',
        probableCause: covered
          ? 'liquidacion_o_import_sin_cerrar_ledger'
          : 'ficha_cero_con_ledger_pendiente',
      });
    }
    if (hasImp && pending > EPS) {
      findings.push({
        ...base,
        code: 'paid_period_ledger_open',
        severity: 'high',
        message: 'Período imputado con línea de ledger todavía abierta',
        probableCause: 'pago_imputado_ledger_abierto',
      });
    }
    if (
      collected > EPS
      && !hasPay
      && !/admin_reconciled/i.test(source)
      && !/sync_covered/i.test(source)
      && status !== PERIOD_STATUS.CONCILIADO_ADMIN
    ) {
      findings.push({
        ...base,
        code: 'ledger_collected_without_payment',
        severity: 'medium',
        message: 'Línea cobrada en ledger sin pago local verificable',
        probableCause: 'ledger_cobrado_sin_pago_local',
      });
    }
    if (Math.abs(amount - (collected + pending)) > 0.01) {
      findings.push({
        ...base,
        code: 'amount_mismatch',
        severity: 'medium',
        message: 'Importe de línea distinto de cobrado + pendiente',
        probableCause: 'descuadre_importe_linea',
      });
    }
    const nextYm = asYm(member.nextDueDate);
    if (ficha <= EPS && pending > EPS && nextYm && nextYm <= periodYm) {
      findings.push({
        ...base,
        code: 'next_due_incoherent',
        severity: 'medium',
        message: 'Próximo vencimiento incoherente con pending de ledger',
        probableCause: 'next_due_incoherente_con_pending',
      });
    }
  }

  return findings;
}

/**
 * No cobrar automáticamente montos que solo existen en ledger si la ficha está en 0.
 */
export function shouldBlockLedgerOnlyCollection(member, {
  ledgerLines = [],
  payments = [],
  imputations = [],
} = {}) {
  const ficha = Number(member?.outstandingBalance) || 0;
  if (ficha > EPS) return false;
  const openPeriods = Array.isArray(member?.duesOpenPeriods) ? member.duesOpenPeriods : [];
  const hasOpenObligation = openPeriods.some((row) => Number(row?.capital) > EPS);
  if (hasOpenObligation) return false;
  const findings = detectFeeLedgerFichaAnomalies({
    member,
    ledgerLines,
    payments,
    imputations,
  });
  return findings.some((row) => (
    row.code === 'ficha_zero_ledger_pending' || row.code === 'paid_period_ledger_open'
  ));
}

/**
 * Simula conciliación administrativa en memoria (tests / preview). No persiste.
 */
export function applyAdminLedgerReconciliation(lines = [], periodYm, { reason = '' } = {}) {
  const ym = asYm(periodYm);
  if (!ym) return { lines, closed: 0, amount: 0 };
  let closed = 0;
  let amount = 0;
  const next = (lines || []).map((line) => {
    if (asYm(line.date || line.lineDate || line.periodYm) !== ym) return line;
    const pending = money(Number(line.pending) || 0);
    if (pending <= EPS) return line;
    closed += 1;
    amount = money(amount + pending);
    return {
      ...line,
      collected: money((Number(line.collected) || 0) + pending),
      pending: 0,
      source: `${String(line.source || 'liquidation')}_admin_reconciled`,
      adminReconcileReason: reason || 'conciliado administrativamente',
    };
  });
  return { lines: next, closed, amount, createdPayment: false };
}

/**
 * Al liquidar: si el período ya está cubierto, la línea nace cobrada.
 */
export function normalizeLedgerLineForCoveredPeriod(line, member, {
  payments = [],
  imputations = [],
} = {}) {
  if (!line) return line;
  const periodYm = asYm(line.date || line.lineDate || line.periodYm);
  const amount = money(Number(line.amount) || 0);
  if (!periodYm || !(amount > EPS)) return line;
  if (!periodIsCoveredOperationally(member, periodYm, { payments, imputations })) {
    return line;
  }
  return {
    ...line,
    collected: amount,
    pending: 0,
    collectedAt: line.collectedAt || new Date().toISOString().slice(0, 10),
    source: String(line.source || 'liquidation') === 'liquidation'
      ? 'liquidation_sync_covered'
      : line.source,
  };
}

export function summarizeFeeLedgerIntegrity(findings = []) {
  const byCode = {};
  const byStatus = {};
  for (const row of findings) {
    byCode[row.code] = (byCode[row.code] || 0) + 1;
    byStatus[row.reconciliationStatus] = (byStatus[row.reconciliationStatus] || 0) + 1;
  }
  return {
    anomalyCount: findings.length,
    byCode,
    byStatus,
    memberNumbers: [...new Set(findings.map((row) => row.memberNumber).filter(Boolean))],
  };
}

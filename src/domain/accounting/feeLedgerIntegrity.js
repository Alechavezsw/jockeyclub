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
  EVIDENCIA_PENDIENTE: 'evidencia_pendiente',
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

export function adminReconcileNote(member, periodYm) {
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

/**
 * Pago verificable del período: solo periodDueOns / meta.period / etiqueta explícita.
 * NO usa paid_at del mismo mes calendario.
 */
export function paymentCoversPeriod(payments = [], periodYm) {
  return (payments || []).some((payment) => {
    if (!payment || payment.voidedAt || payment.status === 'void' || payment.status === 'anulled') {
      return false;
    }
    const dueOns = Array.isArray(payment.periodDueOns)
      ? payment.periodDueOns
      : (Array.isArray(payment.meta?.periodDueOns) ? payment.meta.periodDueOns : []);
    if (dueOns.some((d) => asYm(d) === periodYm)) return true;
    const metaPeriod = String(payment.meta?.period || payment.period || '');
    if (metaPeriod.includes(periodYm)) return true;
    const label = String(payment.periodLabel || payment.period || payment.concept || '');
    const [y, m] = periodYm.split('-');
    if (y && m && (label.includes(periodYm) || label.includes(`${m}/${y}`))) return true;
    return false;
  });
}

/**
 * Imputación plena del período (no parcial suelta).
 */
export function imputationFullyCoversPeriod(imputations = [], periodYm, expectedCapital = null) {
  const rows = (imputations || []).filter((row) => (
    row
    && !row.voidedAt
    && String(row.kind || 'cobro') !== 'adelanto'
    && asYm(row.dueOn) === periodYm
  ));
  if (!rows.length) return false;
  if (rows.some((row) => (
    (Number(row.capital) || 0) > EPS
    && (Number(row.capitalOpen ?? row.capital_open) || 0) <= EPS
  ))) {
    return true;
  }
  const imputed = money(rows.reduce(
    (sum, row) => sum + (Number(row.capital) || 0) + (Number(row.surcharge) || 0),
    0,
  ));
  if (expectedCapital != null && Number(expectedCapital) > EPS) {
    return imputed + EPS >= Number(expectedCapital);
  }
  return false;
}

/**
 * Cobertura operativa estricta: admin trazable, duesCoveredThrough, imputación plena,
 * o pago que declara el período. No ficha=0+next_due ni paid_at del mes.
 */
export function periodIsCoveredOperationally(member, periodYm, {
  payments = [],
  imputations = [],
  expectedCapital = null,
} = {}) {
  if (!periodYm) return false;
  if (adminReconcileNote(member, periodYm)) return true;
  const covered = coveredThroughYm(member);
  if (covered && covered >= periodYm) return true;
  if (paymentCoversPeriod(payments, periodYm)) return true;
  if (imputationFullyCoversPeriod(imputations, periodYm, expectedCapital)) return true;
  const openPeriods = Array.isArray(member?.duesOpenPeriods) ? member.duesOpenPeriods : [];
  const periodRow = openPeriods.find((row) => asYm(row?.dueOn) === periodYm);
  if (periodRow && (Number(periodRow.capital) || 0) <= EPS) return true;
  return false;
}

function isLilaSource(source) {
  return /^lila/i.test(String(source || ''));
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
  if (isLilaSource(source) && pending <= EPS && collected > EPS) {
    const hasPay = paymentCoversPeriod(payments, periodYm);
    if (!hasPay) return PERIOD_STATUS.EVIDENCIA_PENDIENTE;
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
    case PERIOD_STATUS.EVIDENCIA_PENDIENTE:
      return 'Evidencia pendiente';
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
    const hasFullImp = imputationFullyCoversPeriod(imputations, periodYm, amount);
    const source = String(line.source || '');
    const adminNote = adminReconcileNote(member, periodYm);
    const isAdmin = Boolean(adminNote || /admin_reconciled/i.test(source));
    const isLila = isLilaSource(source);

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
        hasFullImp ? 'imputacion_plena=si' : 'imputacion_plena=no',
        isAdmin ? 'admin=si' : null,
        isLila ? 'import_lila=si' : null,
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
    if (hasFullImp && pending > EPS) {
      findings.push({
        ...base,
        code: 'paid_period_ledger_open',
        severity: 'high',
        message: 'Período imputado con línea de ledger todavía abierta',
        probableCause: 'pago_imputado_ledger_abierto',
      });
    }
    if (isAdmin && pending <= EPS && !hasPay) {
      findings.push({
        ...base,
        code: 'admin_reconciled_evidence_pending',
        severity: 'low',
        message: 'Conciliado administrativamente · evidencia de comprobante pendiente',
        probableCause: 'conciliado_admin_evidencia_pendiente',
        isDebt: false,
      });
    } else if (isLila && pending <= EPS && collected > EPS && !hasPay) {
      findings.push({
        ...base,
        code: 'imported_lila_evidence_pending',
        severity: 'low',
        message: 'Importación Lila sin pago local verificable (no es deuda)',
        probableCause: 'import_lila_sin_pago_local',
        isDebt: false,
      });
    } else if (
      collected > EPS
      && !hasPay
      && !isAdmin
      && !isLila
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
 * No inventa fecha de cobro.
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
      collectedAtLabel: line.collectedAtLabel || 'conciliación administrativa',
      source: /admin_reconciled/i.test(String(line.source || ''))
        ? line.source
        : `${String(line.source || 'liquidation')}_admin_reconciled`,
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
    debtAnomalyCount: findings.filter((row) => row.isDebt !== false && row.severity !== 'low').length,
    byCode,
    byStatus,
    memberNumbers: [...new Set(findings.map((row) => row.memberNumber).filter(Boolean))],
  };
}

/** Simula cierre contable único por cover (parciales / completos). */
export function applyFeeLedgerCollectionForMonths(lines = [], months = [], cover = null) {
  const ymSet = new Set((months || []).map(asYm).filter(Boolean));
  let remaining = cover == null ? Number.POSITIVE_INFINITY : money(cover);
  let applied = 0;
  const next = (lines || []).map((line) => {
    const ym = asYm(line.date || line.lineDate || line.periodYm);
    if (!ymSet.has(ym) || remaining <= EPS) return line;
    const pending = money(Number(line.pending) || 0);
    if (pending <= EPS) return line;
    const take = money(Math.min(pending, remaining));
    remaining = money(remaining - take);
    applied = money(applied + take);
    return {
      ...line,
      collected: money((Number(line.collected) || 0) + take),
      pending: money(pending - take),
    };
  });
  return { lines: next, applied, remainingCover: Number.isFinite(remaining) ? remaining : null };
}

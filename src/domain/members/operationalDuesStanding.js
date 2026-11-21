/**
 * Estado financiero operativo vs conciliación histórica (fee_ledger).
 *
 * Fuente de verdad operativa: members.outstanding_balance (+ obligaciones abiertas
 * en member_dues_periods / duesOpenPeriods). El auxiliar fee_ledger_lines NUNCA
 * crea deuda exigible por sí solo cuando la ficha está en 0 o a favor.
 */
import { money } from '../money.js';
import {
  PERIOD_STATUS,
  periodLedgerStatus,
  periodStatusLabel,
} from '../accounting/feeLedgerIntegrity.js';
import {
  appMonthlyDebtForMember,
  memberDuesStandingSummary,
} from '../accounting/appMonthlyDebts.js';
import { isDuesExemptMember, socialDuesStoredBalance } from './dues.js';
import { isFamilyDependent } from './households.js';

const EPS = 0.009;

function asYm(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return '';
}

function openObligationCapital(member) {
  const rows = Array.isArray(member?.duesOpenPeriods) ? member.duesOpenPeriods : [];
  return money(rows.reduce((sum, row) => sum + (Number(row?.capital) || 0), 0));
}

/**
 * Períodos del auxiliar con pendiente cuando la ficha no exige cobro.
 * No son deuda confirmada: requieren revisión de Tesorería.
 */
export function buildHistoricalReconciliation(member, {
  ledgerLines = [],
  payments = null,
  imputations = null,
} = {}) {
  const ficha = money(Number(member?.outstandingBalance) || 0);
  const pays = Array.isArray(payments) ? payments : (member?.paymentHistory || []);
  const imps = Array.isArray(imputations) ? imputations : (member?.duesImputations || []);
  const lines = (ledgerLines || []).length
    ? ledgerLines
    : (Array.isArray(member?.feeLedgerLines) ? member.feeLedgerLines : []);

  const periods = [];
  let pendingTotal = 0;
  for (const line of lines) {
    const pending = money(Number(line?.pending) || 0);
    if (pending <= EPS) continue;
    const periodYm = asYm(line?.date || line?.lineDate || line?.periodYm);
    if (!periodYm) continue;
    const status = periodLedgerStatus(member, line, { payments: pays, imputations: imps });
    // Solo diferencias históricas (ficha ≤ 0) o estados de revisión / evidencia.
    if (ficha > EPS && status === PERIOD_STATUS.PENDIENTE) continue;
    if (
      status !== PERIOD_STATUS.EN_REVISION
      && status !== PERIOD_STATUS.CONCILIADO_ADMIN
      && status !== PERIOD_STATUS.EVIDENCIA_PENDIENTE
      && !(ficha <= EPS && pending > EPS)
    ) {
      continue;
    }
    pendingTotal = money(pendingTotal + pending);
    periods.push({
      periodYm,
      pending,
      collected: money(Number(line?.collected) || 0),
      amount: money(Number(line?.amount) || 0),
      source: String(line?.source || ''),
      status,
      statusLabel: periodStatusLabel(status),
      lineId: line?.id || null,
      isExigible: false,
      label: 'Pendiente de conciliación histórica',
    });
  }

  periods.sort((a, b) => String(a.periodYm).localeCompare(String(b.periodYm)));

  return {
    hasDifferences: periods.length > 0,
    pendingTotal,
    periods,
    title: 'Conciliación histórica',
    note: periods.length
      ? 'Diferencias del auxiliar (Lila / Macro Click / débitos). No son deuda exigible confirmada.'
      : null,
  };
}

/**
 * Cálculo único reutilizable: operativo + histórico separados.
 */
export function buildOperationalDuesStanding(member, {
  today = new Date(),
  entries = [],
  ledgerLines = [],
  payments = null,
  imputations = null,
} = {}) {
  const summary = memberDuesStandingSummary(member, { today, entries });
  const historical = buildHistoricalReconciliation(member, {
    ledgerLines,
    payments,
    imputations,
  });

  if (!member) {
    return {
      ...summary,
      operationalStatus: '—',
      capitalExigible: 0,
      interestExigible: 0,
      totalExigible: 0,
      creditBalance: 0,
      historical,
      seal: '—',
    };
  }

  if (isDuesExemptMember(member) || isFamilyDependent(member)) {
    return {
      ...summary,
      operationalStatus: summary.title,
      capitalExigible: 0,
      interestExigible: 0,
      totalExigible: 0,
      creditBalance: 0,
      historical,
      seal: summary.title,
    };
  }

  const outstanding = money(Number(member.outstandingBalance) || 0);
  const stored = socialDuesStoredBalance(member);
  const openCap = openObligationCapital(member);
  const creditBalance = outstanding < -EPS ? money(-outstanding) : 0;

  // Ficha ≤ 0 y sin obligación abierta → no hay deuda exigible, aunque el ledger diga otra cosa.
  if (stored <= EPS && openCap <= EPS) {
    const kind = creditBalance > EPS ? 'credit' : 'clear';
    return {
      ...summary,
      clear: true,
      kind,
      standing: kind === 'credit' ? 'Saldo a favor' : 'Al día',
      title: kind === 'credit' ? 'Saldo a favor' : 'Al día',
      hint: kind === 'credit'
        ? 'Se descuenta en el próximo cobro'
        : (historical.hasDifferences
          ? 'Sin deuda exigible · hay diferencias históricas a revisar'
          : 'Sin deuda de cuota'),
      totalDebt: 0,
      capital: 0,
      interest: 0,
      unallocated: 0,
      credit: creditBalance,
      monthsBehind: 0,
      months: [],
      monthsPhrase: '',
      billing: true,
      debt: null,
      operationalStatus: kind === 'credit' ? 'Saldo a favor' : 'Al día',
      capitalExigible: 0,
      interestExigible: 0,
      totalExigible: 0,
      creditBalance,
      historical,
      seal: kind === 'credit' ? 'Saldo a favor' : 'Al día',
    };
  }

  const debt = summary.debt || appMonthlyDebtForMember(member, { today, entries });
  return {
    ...summary,
    operationalStatus: summary.standing || summary.title,
    capitalExigible: money(Number(summary.capital) || 0),
    interestExigible: money(Number(summary.interest) || 0),
    totalExigible: money(Number(summary.totalDebt) || 0),
    creditBalance: 0,
    historical,
    seal: summary.standing || summary.title || 'Con deuda',
    debt,
  };
}

/** ¿La UI operativa debe mostrar Al día / a favor aunque el ledger tenga pending? */
export function operationalStandingIsClear(standing) {
  if (!standing) return true;
  return Boolean(standing.clear) && money(Number(standing.totalExigible) || 0) <= EPS;
}

/**
 * Estado financiero operativo vs conciliación histórica (fee_ledger / períodos abiertos).
 *
 * Fuente de verdad operativa: members.outstanding_balance.
 * Un período auxiliar abierto no reabre deuda si hay pago verificable o regularización
 * administrativa; esos remanentes van a conciliación. Sí se exige una obligación nueva
 * legítima cuando la ficha no está respaldada en $0.
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
import {
  duesOpenPeriodsOf,
  isDuesExemptMember,
  openDuesObligationCapital,
  openPeriodIsOperationallyCovered,
  socialDuesStoredBalance,
} from './dues.js';
import { isFamilyDependent, memberNumberOf } from './households.js';

const EPS = 0.009;

function asYm(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return '';
}

function ledgerLineMemberNumber(line) {
  const raw = line?.memberNumber ?? line?.member_number ?? line?.memberId ?? line?.member_id;
  if (raw == null || raw === '') return '';
  return String(raw).replace(/\D/g, '') || String(raw).trim();
}

/**
 * Remanentes abiertos ya cubiertos por pago imputado o excepción admin con alcance.
 * No son deuda exigible: discrepancia a validar (no se cierran como pagados).
 */
function openPeriodReconciliationRows(member, { entries = [] } = {}) {
  const ficha = money(Number(member?.outstandingBalance) || 0);
  if (ficha > EPS) return [];
  const rows = duesOpenPeriodsOf(member) || [];
  const out = [];
  for (const row of rows) {
    if (!row || row.voidedAt) continue;
    const pending = money(Number(row.capitalOpen ?? row.capital_open ?? row.capital) || 0);
    if (pending <= EPS) continue;
    const dueOn = String(row.dueOn || row.due_on || '').slice(0, 10);
    const periodYm = asYm(dueOn);
    if (!periodYm) continue;
    // Solo discrepancia: el período tiene respaldo operativo pero sigue abierto.
    if (!openPeriodIsOperationallyCovered(member, dueOn, { entries })) continue;
    out.push({
      periodYm,
      pending,
      collected: 0,
      amount: pending,
      source: 'member_dues_periods',
      status: PERIOD_STATUS.EVIDENCIA_PENDIENTE,
      statusLabel: periodStatusLabel(PERIOD_STATUS.EVIDENCIA_PENDIENTE),
      lineId: row.id || null,
      isExigible: false,
      label: 'Remanente de período abierto · pendiente de validación',
    });
  }
  return out;
}

/**
 * Períodos del auxiliar / abiertos cuando la ficha no exige cobro.
 * No son deuda confirmada: requieren revisión de Tesorería.
 * Filtra estrictamente por número de socio.
 */
export function buildHistoricalReconciliation(member, {
  ledgerLines = [],
  payments = null,
  imputations = null,
  entries = [],
} = {}) {
  const ficha = money(Number(member?.outstandingBalance) || 0);
  const pays = Array.isArray(payments) ? payments : (member?.paymentHistory || []);
  const memberWithPays = Array.isArray(payments)
    ? { ...member, paymentHistory: payments }
    : member;
  const imps = Array.isArray(imputations) ? imputations : (member?.duesImputations || []);
  const nro = memberNumberOf(member) || String(member?.memberNumber || '').replace(/\D/g, '');
  const rawLines = (ledgerLines || []).length
    ? ledgerLines
    : (Array.isArray(member?.feeLedgerLines) ? member.feeLedgerLines : []);
  const lines = (rawLines || []).filter((line) => {
    const lineNro = ledgerLineMemberNumber(line);
    if (!nro) return false;
    if (!lineNro) return false;
    return lineNro === nro;
  });

  const periods = [];
  let pendingTotal = 0;
  const seenYm = new Set();

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
    seenYm.add(periodYm);
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

  for (const row of openPeriodReconciliationRows(memberWithPays, { entries })) {
    if (seenYm.has(row.periodYm)) {
      // Ya hay línea de auxiliar: sumar remanente de período abierto si no estaba.
      const hit = periods.find((p) => p.periodYm === row.periodYm);
      if (hit && money(Number(hit.pending) || 0) + EPS < row.pending) {
        const extra = money(row.pending - Number(hit.pending));
        hit.pending = money(Number(hit.pending) + extra);
        pendingTotal = money(pendingTotal + extra);
        hit.label = 'Discrepancia de imputación · pendiente de validación';
      }
      continue;
    }
    pendingTotal = money(pendingTotal + row.pending);
    seenYm.add(row.periodYm);
    periods.push(row);
  }

  periods.sort((a, b) => String(a.periodYm).localeCompare(String(b.periodYm)));

  return {
    hasDifferences: periods.length > 0,
    pendingTotal,
    periods,
    title: 'Conciliación histórica',
    note: periods.length
      ? 'Diferencias del auxiliar o remanentes abiertos. No son deuda exigible confirmada.'
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
    entries,
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
  const memberForBalance = Array.isArray(payments)
    ? { ...member, paymentHistory: payments }
    : member;
  const stored = socialDuesStoredBalance(memberForBalance, { entries });
  const openCap = openDuesObligationCapital(member);
  // Crédito visible solo si no hay obligación neta (stored ya netea openCap).
  const creditBalance = stored <= EPS && outstanding < -EPS ? money(-outstanding) : 0;

  // Sin deuda neta operativa → no exigible, aunque el auxiliar o períodos digan otra cosa.
  if (stored <= EPS) {
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

  // Obligación abierta sin respaldo de cobro, o saldo positivo de ficha.
  const debt = summary.debt || appMonthlyDebtForMember(member, { today, entries });
  const debtCapital = money((Number(debt?.capital) || 0) + (Number(debt?.unallocated) || 0));
  const capitalExigible = money(
    debtCapital > EPS
      ? debtCapital
      : (Number(summary.capital) || stored || openCap || 0),
  );
  const interestExigible = money(Number(debt?.interest) || Number(summary.interest) || 0);
  const totalExigible = money(
    Number(debt?.totalDebt) > EPS
      ? Number(debt.totalDebt)
      : (Number(summary.totalDebt) > EPS
        ? Number(summary.totalDebt)
        : (capitalExigible + interestExigible)),
  );

  return {
    ...summary,
    clear: false,
    kind: 'debt',
    standing: debt?.standing || summary.standing || 'Con deuda',
    title: debt?.standing || summary.title || 'Con deuda',
    hint: summary.hint || null,
    totalDebt: totalExigible,
    capital: capitalExigible,
    interest: interestExigible,
    unallocated: money(Number(debt?.unallocated) || Number(summary.unallocated) || 0),
    credit: 0,
    monthsBehind: Number(debt?.monthsBehind) || Number(summary.monthsBehind) || 0,
    months: debt?.months || summary.months || [],
    monthsPhrase: summary.monthsPhrase || '',
    billing: true,
    debt,
    operationalStatus: debt?.standing || summary.standing || 'Con deuda',
    capitalExigible,
    interestExigible,
    totalExigible,
    creditBalance: 0,
    historical,
    seal: debt?.standing || summary.standing || 'Con deuda',
  };
}

/** ¿La UI operativa debe mostrar Al día / a favor aunque el ledger tenga pending? */
export function operationalStandingIsClear(standing) {
  if (!standing) return true;
  return Boolean(standing.clear) && money(Number(standing.totalExigible) || 0) <= EPS;
}

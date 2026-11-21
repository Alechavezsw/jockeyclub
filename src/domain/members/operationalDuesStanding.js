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
import {
  isDuesExemptMember,
  openDuesObligationCapital,
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
 * Períodos del auxiliar con pendiente cuando la ficha no exige cobro.
 * No son deuda confirmada: requieren revisión de Tesorería.
 * Filtra estrictamente por número de socio.
 */
export function buildHistoricalReconciliation(member, {
  ledgerLines = [],
  payments = null,
  imputations = null,
} = {}) {
  const ficha = money(Number(member?.outstandingBalance) || 0);
  const pays = Array.isArray(payments) ? payments : (member?.paymentHistory || []);
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
  const openCap = openDuesObligationCapital(member);
  // Crédito visible solo si no hay obligación neta (stored ya netea openCap).
  const creditBalance = stored <= EPS && outstanding < -EPS ? money(-outstanding) : 0;

  // Sin deuda neta (ficha ≤ 0 y openCap cubierto o ausente) → no exigible, aunque el ledger diga otra cosa.
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

  // Obligación abierta o saldo positivo: deuda operativa (aunque outstanding haya quedado en 0).
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

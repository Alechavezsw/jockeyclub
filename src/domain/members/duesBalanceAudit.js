/**
 * Auditoría de saldos de cuota: detecta anomalías, no inventa dinero.
 */
import { money } from '../money.js';
import { detectFeeLedgerFichaAnomalies } from '../accounting/feeLedgerIntegrity.js';
import { duesBalanceDesync, memberCreditBalance, collectionPreview } from './memberPayments.js';
import { lilaUnpaidCapital, socialDuesStoredBalance } from './dues.js';

function paymentKey(payment) {
  const receipt = String(payment?.receiptNumber || payment?.receipt || '').trim();
  const amount = money(Number(payment?.amount) || 0).toFixed(2);
  const paidAt = String(payment?.paidAt || payment?.date || '').slice(0, 10);
  const memberId = String(payment?.memberId || '').trim();
  return [memberId, receipt, amount, paidAt].join('|');
}

/**
 * @param {object} member
 * @param {{ today?: Date, ledgerLines?: object[], payments?: object[], imputations?: object[] }} [opts]
 * @returns {Array<{ code: string, severity: string, message: string, [k: string]: unknown }>}
 */
export function detectMemberDuesAnomalies(member, {
  today = new Date(),
  ledgerLines = null,
  payments = null,
  imputations = null,
} = {}) {
  if (!member) return [];
  const findings = [];
  const desync = duesBalanceDesync(member);
  if (desync) {
    findings.push({
      ...desync,
      memberId: member.memberId || member.id,
      memberNumber: member.memberNumber || member.memberId,
      name: member.name || member.fullName,
    });
  }

  const credit = memberCreditBalance(member);
  const outstanding = money(Number(member.outstandingBalance) || 0);
  if (credit > 0.01 && outstanding > 0.01 && !(Number(member.creditBalance) > 0.01)) {
    // Crédito solo por outstanding negativo o creditBalance; si llegara por otro lado, alertar.
    findings.push({
      code: 'credit_without_trace',
      severity: 'high',
      message: 'Crédito detectado sin outstanding negativo ni creditBalance',
      credit,
      outstanding,
      memberId: member.memberId || member.id,
    });
  }

  const history = Array.isArray(member.paymentHistory) ? member.paymentHistory : [];
  const seen = new Map();
  for (const payment of history) {
    if (payment?.voidedAt || payment?.status === 'void' || payment?.status === 'anulled') continue;
    const key = paymentKey({ ...payment, memberId: member.memberId || member.id });
    const prev = seen.get(key);
    if (prev) {
      findings.push({
        code: 'duplicate_payment',
        severity: 'high',
        message: 'Pago duplicado (mismo recibo/importe/fecha)',
        key,
        memberId: member.memberId || member.id,
      });
    } else {
      seen.set(key, payment);
    }
  }

  const preview = collectionPreview(member, today);
  if (preview.balanceDesync && !findings.some((row) => row.code === preview.balanceDesync.code)) {
    findings.push({
      ...preview.balanceDesync,
      memberId: member.memberId || member.id,
    });
  }

  const stored = socialDuesStoredBalance(member);
  const unpaid = lilaUnpaidCapital(member);
  if (unpaid != null && unpaid > stored + 0.01 && outstanding > 0.01) {
    findings.push({
      code: 'open_months_exceed_balance',
      severity: 'medium',
      message: 'Capital LILA / unpaid mayor que el saldo operativo',
      unpaid,
      stored,
      outstanding,
      memberId: member.memberId || member.id,
    });
  }

  const ledger = Array.isArray(ledgerLines)
    ? ledgerLines
    : (Array.isArray(member.feeLedgerLines) ? member.feeLedgerLines : []);
  if (ledger.length) {
    const ledgerFindings = detectFeeLedgerFichaAnomalies({
      member,
      ledgerLines: ledger,
      payments: Array.isArray(payments) ? payments : (member.paymentHistory || []),
      imputations: Array.isArray(imputations) ? imputations : (member.duesImputations || []),
    });
    for (const row of ledgerFindings) findings.push(row);
  }

  return findings;
}

/**
 * @param {object[]} members
 * @param {{ today?: Date, ledgerLinesByMember?: Map|Record<string, object[]> }} [opts]
 */
export function auditMembersDuesBalances(members = [], opts = {}) {
  const rows = [];
  const byMember = opts.ledgerLinesByMember;
  for (const member of members) {
    const nro = String(member?.memberNumber || member?.memberId || '').trim();
    let ledgerLines = opts.ledgerLines || null;
    if (byMember instanceof Map) ledgerLines = byMember.get(nro) || [];
    else if (byMember && typeof byMember === 'object') ledgerLines = byMember[nro] || [];
    const findings = detectMemberDuesAnomalies(member, { ...opts, ledgerLines });
    for (const finding of findings) rows.push(finding);
  }
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const row of rows) {
    bySeverity[row.severity] = (bySeverity[row.severity] || 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    memberCount: members.length,
    anomalyCount: rows.length,
    bySeverity,
    findings: rows,
  };
}

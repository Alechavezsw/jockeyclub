/**
 * Líneas de cuenta corriente derivadas del detalle de cuotas de Accessin.
 *
 * Separado de feeChartAccounts.js porque es la única parte de ese módulo que consume
 * el snapshot `accessinFeeAccountDetails` (665 kB con DNI de socios), que tiene que
 * estar cargado antes de llamar. Solo lo consumen paneles de administración.
 */

import { feeAccountDetailsSeed } from './feeAccountDetails';

function matchDetailAccount(account, details = feeAccountDetailsSeed().ACCESSIN_FEE_ACCOUNT_DETAILS) {
  if (!account) return null;
  const label = String(account.detailAccountLabel || account.name || '')
    .trim()
    .toUpperCase();
  return (details || []).find((d) => String(d.accountLabel || '').trim().toUpperCase() === label) || null;
}

/** Líneas de C.C. derivadas del detalle Accessin (importe/cobrado/pendiente). */
export function buildFeeAccountLedgerLines(account, details = feeAccountDetailsSeed().ACCESSIN_FEE_ACCOUNT_DETAILS) {
  const detail = matchDetailAccount(account, details);
  if (!detail) return [];
  const baseId = Number(account.accessinId || 0) * 100000;
  return (detail.lines || []).map((line, i) => {
    const collected = Number(line.amount) || 0;
    // En el export de cobros el monto es lo cobrado; el importe de cuota se asume igual.
    const amount = collected;
    const pending = Math.max(0, amount - collected);
    return {
      id: `fcc-${account.id}-${i}`,
      accessinId: baseId + i + 1,
      accountId: account.id,
      memberNumber: String(line.memberNumber || ''),
      memberName: String(line.memberName || ''),
      dni: String(line.dni || ''),
      date: line.feeDate || line.collectedAt || '',
      dateLabel: line.feeDateLabel || line.collectedAtLabel || '',
      collectedAt: line.collectedAt || '',
      collectedAtLabel: line.collectedAtLabel || '',
      type: line.type || '',
      description: line.description || '',
      amount,
      collected,
      pending,
      source: 'accessin',
    };
  });
}

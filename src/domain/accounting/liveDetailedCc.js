/** Cuenta corriente detallada desde la deuda de cuota viva. */

import { appMonthlyDebtForMember } from './appMonthlyDebts';
import { periodLabelFromKey } from './detailedCurrentAccounts';
import { memberNumberOf } from '../members/households';

const EPS = 0.009;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function memberDisplayName(member) {
  const joined = [member?.firstName, member?.lastName].filter(Boolean).join(' ').trim();
  return String(member?.name || joined || '').trim();
}

export function buildLiveDetailedCc(member, { today = new Date() } = {}) {
  if (!member) return null;
  const memberNumber = memberNumberOf(member);
  if (!memberNumber) return null;
  const debt = appMonthlyDebtForMember(member, { today });
  const lines = [];
  let totalOwed = 0;
  let totalAmount = 0;

  for (const month of debt?.months || []) {
    const amount = roundMoney((Number(month.capital) || 0) + (Number(month.interest) || 0));
    if (amount <= EPS) continue;
    totalAmount += amount;
    totalOwed += amount;
    lines.push({
      id: `${memberNumber}-${month.periodKey}`,
      periodKey: month.periodKey,
      feeDate: month.dueOn || `${month.periodKey}-10`,
      amount,
      paid: 0,
      owed: amount,
      type: month.interest > EPS ? 'Cuota + recargo' : 'Cuota',
    });
  }

  if (debt?.unallocated > EPS) {
    const amount = roundMoney(debt.unallocated);
    totalAmount += amount;
    totalOwed += amount;
    lines.push({
      id: `${memberNumber}-otros`,
      periodKey: '',
      feeDate: '',
      amount,
      paid: 0,
      owed: amount,
      type: 'Saldo previo',
    });
  }

  return {
    memberNumber,
    memberName: debt?.memberName || memberDisplayName(member),
    firstName: member.firstName || '',
    lastName: member.lastName || '',
    dni: member.documentNumber || member.dni || '',
    standing: debt?.standing || (totalOwed > EPS ? 'Con saldo' : 'Al día'),
    totalAmount: roundMoney(totalAmount),
    totalOwed: roundMoney(totalOwed),
    lines,
  };
}

export { periodLabelFromKey };

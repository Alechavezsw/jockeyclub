/** Posición viva de tesorería, deuda social y proveedores. */

import { formatISODateLongAR, todayISODateAR } from '../../lib/arDate';
import { firstUnpaidDuesDate } from '../members/dues';
import { memberNumberOf } from '../members/households';
import { getTierDisplayName } from '../members/tiers';
import { currentAccountBalanceOf } from './currentAccountBalances';
import { liveSupplierTotals } from './suppliers';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function memberDisplayName(member) {
  return String(
    member?.name
    || [member?.lastName, member?.firstName].filter(Boolean).join(', ')
    || ''
  ).trim() || '—';
}

export function buildLiveSaldos({
  members = [],
  suppliers = [],
  supplierEntries = [],
  paymentOrders = [],
  cash = {},
  today = new Date(),
  limit = 8,
} = {}) {
  const asOf = todayISODateAR(today);
  const todayDate = new Date(`${asOf}T12:00:00`);
  const suppliersLive = liveSupplierTotals(suppliers, {
    entries: supplierEntries,
    paymentOrders,
  });

  let memberDebt = 0;
  let memberCredit = 0;
  let withDebt = 0;
  let withCredit = 0;
  const debtors = [];

  for (const member of members || []) {
    const balance = currentAccountBalanceOf(member);
    if (balance > 0) {
      memberDebt += balance;
      withDebt += 1;
      const due = firstUnpaidDuesDate({
        lastPaymentDate: member.lastPaymentDate,
        nextDueDate: member.nextDueDate,
        today: todayDate,
      });
      debtors.push({
        id: member.memberId || member.id || memberNumberOf(member),
        memberNumber: memberNumberOf(member),
        name: memberDisplayName(member),
        tierLabel: getTierDisplayName(member.tier) || member.tier || '—',
        balance: roundMoney(balance),
        dueDate: due || member.nextDueDate || '',
        inMora: Boolean(due && due < asOf),
      });
    } else if (balance < 0) {
      memberCredit += Math.abs(balance);
      withCredit += 1;
    }
  }

  const efectivo = roundMoney(cash.efectivo);
  const bancos = roundMoney(cash.bancos);
  const cheques = roundMoney(cash.cheques);
  const cashAndBanks = roundMoney(efectivo + bancos);
  const treasury = roundMoney(
    cash.total == null || cash.total === ''
      ? cashAndBanks + cheques
      : Number(cash.total) || 0
  );

  return {
    asOf,
    asOfLabel: formatISODateLongAR(asOf),
    efectivo,
    bancos,
    cheques,
    cashAndBanks,
    treasury,
    memberDebt: roundMoney(memberDebt),
    memberCredit: roundMoney(memberCredit),
    withDebt,
    withCredit,
    supplierDebt: suppliersLive.debt,
    supplierCredit: suppliersLive.credit,
    supplierNet: suppliersLive.net,
    suppliersWithBalance: suppliersLive.withBalance,
    topDebtors: debtors.toSorted((a, b) => b.balance - a.balance).slice(0, limit),
  };
}

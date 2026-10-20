import { todayISODateAR } from '../../lib/arDate';
import { getPostableAccounts } from './chartOfAccounts';
import { buildPostedEntry } from './journal';
import { ensureTaxAccounts, splitPurchaseTotal, taxAccountId } from './impuestos';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function sumAmount(rows = []) {
  return roundMoney(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
}

export function isTreasuryPaymentAccount(account) {
  if (!account) return false;
  if (account.isCashAccount) return true;
  if (account.code === '1.1.03') return true;
  return /banco|caja|mercado pago/i.test(`${account.name || ''} ${account.code || ''}`);
}

export function expensePaymentAccounts(chart = []) {
  return getPostableAccounts(chart).filter(
    (account) => account.accountType === 'asset' && isTreasuryPaymentAccount(account),
  );
}

export function buildLiveExpenses({ expenses = [], today = new Date() } = {}) {
  const asOf = todayISODateAR(today);
  const month = asOf.slice(0, 7);
  const rows = (expenses || [])
    .filter((row) => row && row.status !== 'void')
    .toSorted((a, b) => String(b.expenseDate || b.createdAt || '').localeCompare(String(a.expenseDate || a.createdAt || '')));
  const pending = rows.filter((row) => row.status === 'pending_approval' || row.status === 'draft');
  const approved = rows.filter((row) => row.status === 'approved');
  const paid = rows.filter((row) => row.status === 'paid');
  const paidMonth = paid.filter((row) => String(row.expenseDate || row.paidAt || '').slice(0, 7) === month);
  const pendingAmount = sumAmount(pending);
  const approvedAmount = sumAmount(approved);
  const paidMonthAmount = sumAmount(paidMonth);
  const toPay = roundMoney(pendingAmount + approvedAmount);
  return {
    asOf,
    month,
    rows,
    pending,
    approved,
    paid,
    paidMonth,
    pendingAmount,
    approvedAmount,
    paidMonthAmount,
    toPay,
    cards: [
      {
        id: 'pending',
        label: 'Pendientes',
        value: pendingAmount,
        caption: `${pending.length} por aprobar`,
        filter: 'pending_approval',
      },
      {
        id: 'approved',
        label: 'Por pagar',
        value: approvedAmount,
        caption: `${approved.length} aprobados`,
        filter: 'approved',
      },
      {
        id: 'paid-month',
        label: 'Pagados del mes',
        value: paidMonthAmount,
        caption: `${paidMonth.length} con asiento en caja o banco`,
        filter: 'paid',
      },
      {
        id: 'to-pay',
        label: 'A desembolsar',
        value: toPay,
        caption: 'Pendientes + por pagar',
        emphasize: true,
        filter: null,
      },
    ],
  };
}

export function createExpenseDraft({
  expenseDate,
  vendorName,
  categoryAccountId,
  paymentAccountId,
  amount,
  concept,
  invoiceNumber = '',
  requestedBy = 'admin-local',
  supplierId = null,
  ivaAliquotId = '',
  fiscalCondition = '',
}) {
  return {
    id: `exp-${Date.now()}`,
    expenseNumber: null,
    expenseDate,
    vendorName: vendorName?.trim() || '',
    supplierId: supplierId || null,
    categoryAccountId,
    paymentAccountId,
    amount: Number(amount),
    concept: concept.trim(),
  invoiceNumber,
  status: 'pending_approval',
  requestedBy,
  approvedBy: null,
  approvedAt: null,
  paidAt: null,
  journalEntryId: null,
  rejectionReason: null,
  ivaAliquotId: ivaAliquotId || '',
  fiscalCondition: fiscalCondition || '',
  createdAt: new Date().toISOString(),
};
}

export function approveExpense(expense, approvedBy = 'admin-local') {
  if (!['pending_approval', 'draft'].includes(expense.status)) {
    throw new Error('Solo se pueden aprobar gastos pendientes.');
  }
  return {
    ...expense,
    status: 'approved',
    approvedBy,
    approvedAt: new Date().toISOString(),
    rejectionReason: null,
  };
}

export function rejectExpense(expense, reason, rejectedBy = 'admin-local') {
  return {
    ...expense,
    status: 'rejected',
    approvedBy: rejectedBy,
    approvedAt: new Date().toISOString(),
    rejectionReason: reason?.trim() || 'Rechazado',
  };
}

export function payExpense(expense, chart) {
  if (expense.status !== 'approved') {
    throw new Error('El gasto debe estar aprobado antes de pagarse.');
  }
  if (!expense.paymentAccountId) {
    throw new Error('Debe indicar cuenta de pago (caja/banco).');
  }

  const fullChart = ensureTaxAccounts(chart);
  const split = expense.ivaAliquotId
    ? splitPurchaseTotal(expense.amount, expense.ivaAliquotId, expense.fiscalCondition || 'exento')
    : null;
  const lines = split?.iva
    ? [
      { accountId: expense.categoryAccountId, debit: split.net, credit: 0 },
      { accountId: taxAccountId(fullChart, 'ivaCredito'), debit: split.iva, credit: 0 },
      { accountId: expense.paymentAccountId, debit: 0, credit: Number(expense.amount) || 0 },
    ]
    : [
      { accountId: expense.categoryAccountId, debit: expense.amount, credit: 0 },
      { accountId: expense.paymentAccountId, debit: 0, credit: expense.amount },
    ];

  const entry = buildPostedEntry({
    date: expense.expenseDate || todayISODateAR(),
    description: `Gasto: ${expense.concept}${expense.vendorName ? ` — ${expense.vendorName}` : ''}`,
    lines,
    sourceModule: 'gastos',
    sourceId: expense.id,
    chart: fullChart,
  });

  return {
    expense: {
      ...expense,
      status: 'paid',
      paidAt: new Date().toISOString(),
      journalEntryId: entry.id,
    },
    journalEntry: entry,
  };
}

export const EXPENSE_STATUS_LABELS = {
  draft: 'Borrador',
  pending_approval: 'Pendiente aprobación',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  paid: 'Pagado',
  void: 'Anulado',
};

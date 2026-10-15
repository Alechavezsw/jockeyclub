import { buildPostedEntry } from './journal';
import { ensureTaxAccounts, splitPurchaseTotal, taxAccountId } from './impuestos';

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
    date: expense.expenseDate || new Date().toISOString().slice(0, 10),
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

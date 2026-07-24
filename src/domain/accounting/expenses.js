import { buildPostedEntry } from './journal';

export function createExpenseDraft({
  expenseDate,
  vendorName,
  categoryAccountId,
  paymentAccountId,
  amount,
  concept,
  invoiceNumber = '',
  requestedBy = 'admin-local',
}) {
  return {
    id: `exp-${Date.now()}`,
    expenseNumber: null,
    expenseDate,
    vendorName: vendorName?.trim() || '',
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

  const entry = buildPostedEntry({
    date: expense.expenseDate || new Date().toISOString().slice(0, 10),
    description: `Gasto: ${expense.concept}${expense.vendorName ? ` — ${expense.vendorName}` : ''}`,
    lines: [
      { accountId: expense.categoryAccountId, debit: expense.amount, credit: 0 },
      { accountId: expense.paymentAccountId, debit: 0, credit: expense.amount },
    ],
    sourceModule: 'gastos',
    sourceId: expense.id,
    chart,
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

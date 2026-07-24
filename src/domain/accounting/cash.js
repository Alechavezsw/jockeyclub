import { buildPostedEntry } from './journal';

export const DEFAULT_CASH_REGISTERS = [
  {
    id: 'cash-gen',
    code: 'CAJA-GEN',
    name: 'Caja General Secretaría',
    location: 'Secretaría Rivadavia',
    accountId: 'coa-1.1.01',
    isActive: true,
  },
  {
    id: 'cash-can',
    code: 'CAJA-CAN',
    name: 'Caja Cantina / Pavilion',
    location: 'Cantina',
    accountId: 'coa-1.1.02',
    isActive: true,
  },
];

export function getOpenSession(sessions, cashRegisterId) {
  return sessions.find((s) => s.cashRegisterId === cashRegisterId && s.status === 'open') || null;
}

export function sessionExpectedBalance(session, movements) {
  const sessionMoves = movements.filter((m) => m.cashSessionId === session.id);
  let balance = Number(session.openingBalance) || 0;
  sessionMoves.forEach((m) => {
    const amt = Number(m.amount) || 0;
    if (m.movementType === 'income' || m.movementType === 'transfer_in') balance += amt;
    if (m.movementType === 'expense' || m.movementType === 'transfer_out') balance -= amt;
    if (m.movementType === 'adjustment') balance += amt; // signed amount stored positive with type
  });
  return balance;
}

export function openCashSession({ cashRegisterId, openingBalance, openedBy = 'admin-local' }) {
  return {
    id: `cs-${Date.now()}`,
    cashRegisterId,
    openedBy,
    openedAt: new Date().toISOString(),
    openingBalance: Number(openingBalance) || 0,
    status: 'open',
    notes: '',
  };
}

export function closeCashSession(session, { countedBalance, closedBy = 'admin-local', movements }) {
  const expected = sessionExpectedBalance(session, movements);
  const counted = Number(countedBalance) || 0;
  const difference = counted - expected;
  return {
    ...session,
    closedBy,
    closedAt: new Date().toISOString(),
    expectedBalance: expected,
    countedBalance: counted,
    difference,
    status: Math.abs(difference) > 0.01 ? 'discrepancy' : 'closed',
  };
}

export function createCashMovement({
  cashSessionId,
  movementType,
  amount,
  concept,
  relatedAccountId,
  memberId = null,
  chart,
  createJournal = true,
}) {
  const movement = {
    id: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cashSessionId,
    movementType,
    amount: Number(amount),
    concept: concept.trim(),
    relatedAccountId,
    memberId,
    createdAt: new Date().toISOString(),
    journalEntryId: null,
  };

  let journalEntry = null;
  if (createJournal && relatedAccountId && chart) {
    // El asiento se completa en el store con la cuenta de caja de la sesión
  }

  return { movement, journalEntry };
}

export function buildCashMovementEntry({
  date,
  concept,
  cashAccountId,
  relatedAccountId,
  amount,
  movementType,
  chart,
}) {
  const amt = Number(amount);
  const isIncome = movementType === 'income' || movementType === 'transfer_in';

  const lines = isIncome
    ? [
        { accountId: cashAccountId, debit: amt, credit: 0 },
        { accountId: relatedAccountId, debit: 0, credit: amt },
      ]
    : [
        { accountId: relatedAccountId, debit: amt, credit: 0 },
        { accountId: cashAccountId, debit: 0, credit: amt },
      ];

  return buildPostedEntry({
    date,
    description: concept,
    lines,
    sourceModule: 'caja',
    chart,
  });
}

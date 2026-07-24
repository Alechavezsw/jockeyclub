import { ACCOUNT_TYPES, getAccountById, resolveAccountId } from './chartOfAccounts';

export function sumDebits(lines) {
  return lines.reduce((sum, l) => sum + (Number(l.debit ?? (l.type === 'debit' ? l.amount : 0)) || 0), 0);
}

export function sumCredits(lines) {
  return lines.reduce((sum, l) => sum + (Number(l.credit ?? (l.type === 'credit' ? l.amount : 0)) || 0), 0);
}

export function isBalanced(lines) {
  const debit = sumDebits(lines);
  const credit = sumCredits(lines);
  return debit > 0 && Math.abs(debit - credit) < 0.005;
}

/** Normaliza líneas legacy {account, type, amount} → {accountId, debit, credit}. */
export function normalizeLines(lines, chart) {
  return lines.map((line, index) => {
    if (line.accountId != null || (line.debit != null || line.credit != null)) {
      return {
        accountId: resolveAccountId(chart, line.accountId ?? line.account) ?? line.accountId,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        memo: line.memo || '',
        lineOrder: line.lineOrder ?? index + 1,
      };
    }
    const amount = Number(line.amount) || 0;
    return {
      accountId: resolveAccountId(chart, line.account),
      debit: line.type === 'debit' ? amount : 0,
      credit: line.type === 'credit' ? amount : 0,
      memo: line.memo || '',
      lineOrder: index + 1,
    };
  });
}

export function toLegacyLines(lines, chart) {
  return lines.map((line) => {
    const account = getAccountById(chart, line.accountId);
    const isDebit = (Number(line.debit) || 0) > 0;
    return {
      account: account?.name ?? line.accountId,
      type: isDebit ? 'debit' : 'credit',
      amount: isDebit ? Number(line.debit) : Number(line.credit),
    };
  });
}

export function validateJournalEntry({ date, description, lines }, chart) {
  const errors = [];
  if (!date) errors.push('La fecha es obligatoria.');
  if (!description?.trim()) errors.push('La glosa / concepto es obligatoria.');
  const normalized = normalizeLines(lines, chart);
  if (normalized.length < 2) errors.push('Se requieren al menos dos líneas (partida doble).');
  if (normalized.some((l) => !l.accountId)) errors.push('Todas las líneas deben tener una cuenta válida.');
  if (normalized.some((l) => l.debit <= 0 && l.credit <= 0)) {
    errors.push('Cada línea debe tener importe en debe o haber.');
  }
  if (!isBalanced(normalized)) {
    errors.push(
      `Asiento desbalanceado: Debe ${sumDebits(normalized).toFixed(2)} ≠ Haber ${sumCredits(normalized).toFixed(2)}.`
    );
  }
  return { ok: errors.length === 0, errors, lines: normalized };
}

export function getAccountBalance(accountId, journalEntries, chart) {
  const account = getAccountById(chart, accountId);
  if (!account) return 0;

  const nature = ACCOUNT_TYPES[account.accountType]?.nature ?? 'debit';
  let balance = 0;

  journalEntries.forEach((entry) => {
    // Sin status (legacy) o posted cuentan; draft/void no
    if (entry.status === 'draft' || entry.status === 'void') return;
    const lines = normalizeLines(entry.lines || [], chart);
    lines.forEach((line) => {
      if (line.accountId !== accountId) return;
      if (nature === 'debit') {
        balance += line.debit - line.credit;
      } else {
        balance += line.credit - line.debit;
      }
    });
  });

  return balance;
}

export function getBalancesByType(journalEntries, chart) {
  const result = { asset: 0, liability: 0, equity: 0, income: 0, expense: 0 };
  chart
    .filter((a) => a.isPostable)
    .forEach((account) => {
      result[account.accountType] += getAccountBalance(account.id, journalEntries, chart);
    });
  return result;
}

export function buildPostedEntry({ date, description, lines, sourceModule = 'manual', sourceId = null, chart }) {
  const validation = validateJournalEntry({ date, description, lines }, chart);
  if (!validation.ok) {
    throw new Error(validation.errors.join(' '));
  }
  return {
    id: `je-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date,
    description: description.trim(),
    concept: description.trim(),
    lines: validation.lines,
    status: 'posted',
    sourceModule,
    sourceId,
    postedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

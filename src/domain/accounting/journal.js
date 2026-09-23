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
  for (const line of normalized) {
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    if (debit > 0 && credit > 0) {
      errors.push('Una línea no puede tener debe y haber a la vez.');
      break;
    }
    if (debit <= 0 && credit <= 0) {
      errors.push('Cada línea debe tener un importe mayor a cero en debe o haber.');
      break;
    }
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
      errors.push('Los importes deben ser números válidos mayores o iguales a cero.');
      break;
    }
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

export function isPostedJournalEntry(entry) {
  return Boolean(entry) && entry.status !== 'draft' && entry.status !== 'void';
}

export function journalDateKey(entry) {
  const raw = String(entry?.date || entry?.entryDate || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

export function compareJournalOldestFirst(a, b) {
  const da = journalDateKey(a);
  const db = journalDateKey(b);
  if (da !== db) return da.localeCompare(db);
  const ca = String(a.createdAt || a.postedAt || '');
  const cb = String(b.createdAt || b.postedAt || '');
  if (ca !== cb) return ca.localeCompare(cb);
  return String(a.id || '').localeCompare(String(b.id || ''));
}

export function postedJournalEntries(entries = []) {
  return (entries || []).filter(isPostedJournalEntry);
}

/** Número de asiento oficial: el más antiguo es 1. */
export function journalOrdinalMap(entries = []) {
  const posted = postedJournalEntries(entries).toSorted(compareJournalOldestFirst);
  return new Map(posted.map((entry, index) => [entry.id, index + 1]));
}

export function journalEntryOrdinal(entries, entryId) {
  return journalOrdinalMap(entries).get(entryId) ?? null;
}

function lineSearchText(line, chart) {
  const name = line.account
    || getAccountById(chart, line.accountId)?.name
    || line.accountId
    || '';
  return `${name} ${line.accountId || ''} ${line.debit || ''} ${line.credit || ''} ${line.amount || ''}`.toLowerCase();
}

export function filterJournalEntries(entries = [], {
  search = '',
  from = '',
  to = '',
  chart = [],
} = {}) {
  const q = String(search || '').trim().toLowerCase();
  const qCompact = q.replace(/\s+/g, '');
  const qDigits = q.replace(/\D/g, '');
  const wantsNumber = /^\d+$/.test(qCompact) || /^n[°º.]?\d+$/i.test(qCompact);
  const fromKey = String(from || '').slice(0, 10);
  const toKey = String(to || '').slice(0, 10);
  const ordinals = journalOrdinalMap(entries);
  return postedJournalEntries(entries)
    .filter((entry) => {
      const date = journalDateKey(entry);
      if (fromKey || toKey) {
        if (!date) return false;
        if (fromKey && date < fromKey) return false;
        if (toKey && date > toKey) return false;
      }
      if (!q) return true;
      if (wantsNumber && String(ordinals.get(entry.id) || '') === qDigits) return true;
      const concept = `${entry.description || ''} ${entry.concept || ''} ${entry.sourceModule || ''} ${date} ${entry.id || ''}`.toLowerCase();
      if (concept.includes(q)) return true;
      return (entry.lines || []).some((line) => {
        const hay = lineSearchText(line, chart);
        if (hay.includes(q)) return true;
        if (qDigits.length >= 3) {
          const amtDigits = String(line.debit || line.credit || line.amount || '').replace(/\D/g, '');
          if (amtDigits.includes(qDigits)) return true;
        }
        return false;
      });
    })
    .toSorted((a, b) => compareJournalOldestFirst(b, a));
}

export function summarizeJournalBook(entries = [], chart = []) {
  let debit = 0;
  let credit = 0;
  let unbalanced = 0;
  for (const entry of entries) {
    const lines = normalizeLines(entry.lines || [], chart);
    const entryDebit = sumDebits(lines);
    const entryCredit = sumCredits(lines);
    debit += entryDebit;
    credit += entryCredit;
    if (!isBalanced(lines)) unbalanced += 1;
  }
  return {
    count: entries.length,
    debit,
    credit,
    unbalanced,
    squared: unbalanced === 0 && entries.length > 0,
  };
}

/**
 * Libro mayor de una cuenta: movimientos en orden cronológico (antiguo → nuevo)
 * y saldo según la naturaleza (activo/gasto débito, pasivo/PN/ingreso crédito).
 */
export function buildMayorLedger(accountId, entries, chart) {
  const account = getAccountById(chart, accountId);
  if (!account) return { lines: [], finalBalance: 0, account: null };
  const nature = ACCOUNT_TYPES[account.accountType]?.nature ?? 'debit';
  let running = 0;
  const chronological = postedJournalEntries(entries).toSorted(compareJournalOldestFirst);
  const lines = [];
  chronological.forEach((entry) => {
    normalizeLines(entry.lines || [], chart).forEach((line) => {
      if (line.accountId !== accountId) return;
      running += nature === 'debit'
        ? line.debit - line.credit
        : line.credit - line.debit;
      lines.push({
        id: `${entry.id}-${line.lineOrder}`,
        entryId: entry.id,
        date: journalDateKey(entry),
        description: entry.description || entry.concept || '',
        debit: line.debit,
        credit: line.credit,
        balance: running,
      });
    });
  });
  return { lines, finalBalance: running, account };
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

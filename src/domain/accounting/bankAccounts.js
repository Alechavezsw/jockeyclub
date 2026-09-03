/** Cuentas bancarias (listado LILA + CRUD local). */

import { ACCESSIN_BANK_ACCOUNTS } from '../../data/seed/accessinBankAccounts';

export { ACCESSIN_BANK_ACCOUNTS, ACCESSIN_BANK_ACCOUNTS_AS_OF } from '../../data/seed/accessinBankAccounts';

export const BANK_CURRENCY_OPTIONS = [
  { id: 'ARS', label: 'Pesos argentinos' },
  { id: 'USD', label: 'Dólares estadounidenses' },
];

export function currencyLabelFor(code) {
  return BANK_CURRENCY_OPTIONS.find((c) => c.id === code)?.label || code || 'Pesos argentinos';
}

export function bankAccountsTotal(accounts = []) {
  return Math.round(
    (accounts || [])
      .filter((a) => a && a.isActive !== false)
      .reduce((s, a) => s + (Number(a.balance) || 0), 0) * 100
  ) / 100;
}

export function filterBankAccounts(accounts = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  let rows = (accounts || []).filter((a) => a && a.isActive !== false);
  if (q) {
    rows = rows.filter((a) => {
      const hay = [a.accessinId, a.bankName, a.subtitle, a.cbu, a.currencyLabel]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }
  return rows.toSorted((a, b) => Number(a.accessinId) - Number(b.accessinId));
}

function nextAccessinId(accounts = []) {
  const max = (accounts || []).reduce((m, a) => Math.max(m, Number(a.accessinId) || 0), 0);
  return max + 1;
}

function slugWallet(name) {
  return `wallet-${String(name || 'banco')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'banco'}-${Date.now().toString(36)}`;
}

export function normalizeBankAccountInput(input = {}, { existing = null, accounts = [] } = {}) {
  const bankName = String(input.bankName || '').trim();
  if (!bankName) throw new Error('El banco es obligatorio.');
  const cbu = String(input.cbu || '').replace(/\s+/g, '');
  if (cbu && !/^\d{22}$/.test(cbu)) {
    throw new Error('El CBU debe tener 22 dígitos.');
  }
  const balance = Number(input.balance);
  if (!Number.isFinite(balance)) throw new Error('El saldo debe ser un número válido.');
  const currency = String(input.currency || existing?.currency || 'ARS').trim() || 'ARS';

  return {
    id: existing?.id || `bank-${Date.now()}`,
    accessinId: existing?.accessinId ?? nextAccessinId(accounts),
    walletId: existing?.walletId || slugWallet(bankName),
    bankName,
    subtitle: String(input.subtitle || '').trim(),
    cbu,
    balance: Math.round(balance * 100) / 100,
    currency,
    currencyLabel: currencyLabelFor(currency),
    isActive: existing?.isActive !== false,
    source: existing?.source || 'manual',
    updatedAt: new Date().toISOString(),
  };
}

export function upsertBankAccount(accounts = [], input = {}) {
  const existing = (accounts || []).find((a) => a.id === input.id) || null;
  const next = normalizeBankAccountInput(input, { existing, accounts });
  if (existing) {
    return (accounts || []).map((a) => (a.id === existing.id ? { ...existing, ...next } : a));
  }
  return [next, ...(accounts || [])];
}

export function softDeleteBankAccount(accounts = [], id) {
  return (accounts || []).map((a) => (
    a.id === id
      ? { ...a, isActive: false, updatedAt: new Date().toISOString() }
      : a
  ));
}

export function applyBankAccountEntry(accounts = [], accountId, { amount, description = '', date } = {}) {
  const delta = Number(amount);
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('Ingresá un monto distinto de cero.');
  }
  const account = (accounts || []).find((a) => a.id === accountId && a.isActive !== false);
  if (!account) throw new Error('Cuenta bancaria no encontrada.');

  const nextBalance = Math.round((Number(account.balance) + delta) * 100) / 100;
  const updatedAccounts = (accounts || []).map((a) => (
    a.id === accountId
      ? { ...a, balance: nextBalance, updatedAt: new Date().toISOString() }
      : a
  ));

  const movement = {
    id: `acm-bank-${Date.now()}`,
    accessinId: Date.now(),
    date: (date || new Date().toISOString()).slice(0, 10),
    walletId: account.walletId,
    walletName: account.bankName,
    walletKind: 'bank',
    typeLabel: delta >= 0 ? 'Entrada bancaria' : 'Egreso bancario',
    movementType: delta >= 0 ? 'income' : 'expense',
    description: description || (delta >= 0 ? 'Entrada' : 'Egreso'),
    memberNumber: '',
    familyGroup: '',
    amount: Math.abs(delta),
    source: 'manual',
    createdAt: new Date().toISOString(),
  };

  return { accounts: updatedAccounts, movement, account: { ...account, balance: nextBalance } };
}

export function movementsForBankAccount(movements = [], account) {
  if (!account?.walletId) return [];
  return (movements || [])
    .filter((m) => m.walletId === account.walletId || m.walletName === account.bankName)
    .toSorted((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/** Merge seed + edits: si el localStorage está vacío/corto, usar seed. */
export function resolveBankAccounts(loaded) {
  if (Array.isArray(loaded) && loaded.length >= ACCESSIN_BANK_ACCOUNTS.length) return loaded;
  return ACCESSIN_BANK_ACCOUNTS;
}

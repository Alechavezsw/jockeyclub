import { describe, expect, it } from 'vitest';
import {
  applyBankAccountEntry,
  applySnapshotBankBalances,
  bankAccountsTotal,
  filterBankAccounts,
  normalizeBankAccountInput,
  resolveBankAccounts,
  softDeleteBankAccount,
  upsertBankAccount,
  movementsForBankAccount,
} from './bankAccounts';

const base = {
  id: 'bank-1',
  accessinId: 1,
  walletId: 'wallet-nacion',
  bankName: 'Banco Nación',
  subtitle: 'Cuenta corriente',
  cbu: '0110599520000001234567',
  balance: 1000,
  currency: 'ARS',
  currencyLabel: 'Pesos argentinos',
  isActive: true,
};

describe('normalizeBankAccountInput', () => {
  it('exige banco, CBU de 22 dígitos y saldo numérico', () => {
    expect(() => normalizeBankAccountInput({})).toThrow(/banco es obligatorio/i);
    expect(() => normalizeBankAccountInput({
      bankName: 'Nación',
      cbu: '123',
      balance: 0,
    })).toThrow(/22 dígitos/i);
    expect(() => normalizeBankAccountInput({
      bankName: 'Nación',
      balance: 'x',
    })).toThrow(/número válido/i);
  });

  it('asigna accessinId y wallet al alta', () => {
    const row = normalizeBankAccountInput({
      bankName: 'Banco San Juan',
      cbu: '0110599520000001234567',
      balance: 250.555,
    }, { accounts: [base] });
    expect(row.accessinId).toBe(2);
    expect(row.balance).toBe(250.56);
    expect(row.walletId).toMatch(/^wallet-banco-san-juan-/);
    expect(row.currency).toBe('ARS');
  });
});

describe('upsert y baja', () => {
  it('alta al frente y edición por id', () => {
    const list = upsertBankAccount([], {
      bankName: 'Banco Nación',
      cbu: '0110599520000001234567',
      balance: 10,
    });
    expect(list).toHaveLength(1);
    const edited = upsertBankAccount(list, {
      id: list[0].id,
      bankName: 'Banco Nación',
      cbu: '0110599520000001234567',
      balance: 99,
    });
    expect(edited).toHaveLength(1);
    expect(edited[0].balance).toBe(99);
  });

  it('softDelete marca inactiva', () => {
    const next = softDeleteBankAccount([base], 'bank-1');
    expect(next[0].isActive).toBe(false);
    expect(bankAccountsTotal(next)).toBe(0);
  });
});

describe('filterBankAccounts y total', () => {
  it('filtra por texto y suma activas', () => {
    const rows = [
      base,
      { ...base, id: 'bank-2', accessinId: 2, bankName: 'Galicia', balance: 500, isActive: false },
    ];
    expect(bankAccountsTotal(rows)).toBe(1000);
    expect(filterBankAccounts(rows, 'nación')).toHaveLength(1);
    expect(filterBankAccounts(rows, 'galicia')).toHaveLength(0);
  });
});

describe('applyBankAccountEntry', () => {
  it('actualiza saldo y arma movimiento', () => {
    const { accounts, movement } = applyBankAccountEntry([base], 'bank-1', {
      amount: -250,
      description: 'Pago proveedor',
      date: '2026-10-20',
    });
    expect(accounts[0].balance).toBe(750);
    expect(movement.movementType).toBe('expense');
    expect(movement.amount).toBe(250);
    expect(movement.walletId).toBe('wallet-nacion');
  });

  it('rechaza monto 0 o cuenta inexistente', () => {
    expect(() => applyBankAccountEntry([base], 'bank-1', { amount: 0 })).toThrow(/distinto de cero/i);
    expect(() => applyBankAccountEntry([base], 'missing', { amount: 10 })).toThrow(/no encontrada/i);
  });
});

describe('movementsForBankAccount / snapshot / resolve', () => {
  it('lista movimientos del wallet', () => {
    const list = movementsForBankAccount([
      { walletId: 'wallet-nacion', date: '2026-10-02', amount: 1 },
      { walletId: 'other', date: '2026-10-03', amount: 2 },
      { walletName: 'Banco Nación', date: '2026-10-01', amount: 3 },
    ], base);
    expect(list.map((m) => m.date)).toEqual(['2026-10-02', '2026-10-01']);
  });

  it('resolveBankAccounts prefiere loaded si alcanza el seed', () => {
    const seed = [base, { ...base, id: 'b2', accessinId: 2 }];
    expect(resolveBankAccounts([base], seed)).toEqual(seed);
    expect(resolveBankAccounts(seed, seed)).toBe(seed);
  });

  it('applySnapshotBankBalances conserva edición local más nueva', () => {
    const current = [{
      ...base,
      balance: 999,
      updatedAt: '2026-10-22T18:00:00.000Z',
    }];
    const snap = [{
      ...base,
      balance: 100,
      updatedAt: '2026-10-22T12:00:00.000Z',
    }];
    expect(applySnapshotBankBalances(current, snap)[0].balance).toBe(999);

    const olderLocal = [{
      ...base,
      balance: 50,
      updatedAt: '2026-10-21T12:00:00.000Z',
    }];
    expect(applySnapshotBankBalances(olderLocal, snap)[0].balance).toBe(100);
  });
});

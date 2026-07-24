import { describe, it, expect } from 'vitest';
import { sumDebits, sumCredits, isBalanced } from './journal';

const balancedLines = [
  { account: 'Caja General', type: 'debit', amount: 1000 },
  { account: 'Cuotas Sociales', type: 'credit', amount: 1000 },
];

const unbalancedLines = [
  { account: 'Caja General', type: 'debit', amount: 1000 },
  { account: 'Cuotas Sociales', type: 'credit', amount: 900 },
];

describe('partida doble', () => {
  it('suma debe y haber en formato legacy {type, amount}', () => {
    expect(sumDebits(balancedLines)).toBe(1000);
    expect(sumCredits(balancedLines)).toBe(1000);
  });

  it('suma debe y haber en formato normalizado {debit, credit}', () => {
    const lines = [
      { accountId: 'a', debit: 500, credit: 0 },
      { accountId: 'b', debit: 0, credit: 500 },
    ];
    expect(sumDebits(lines)).toBe(500);
    expect(sumCredits(lines)).toBe(500);
  });

  it('valida el balance del asiento', () => {
    expect(isBalanced(balancedLines)).toBe(true);
    expect(isBalanced(unbalancedLines)).toBe(false);
    expect(isBalanced([])).toBe(false);
  });
});

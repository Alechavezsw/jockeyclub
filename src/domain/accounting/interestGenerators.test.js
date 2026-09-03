import { describe, expect, it } from 'vitest';
import {
  computeInterestAmount,
  createInterestGenerator,
  runInterestGenerator,
  selectMembersForInterest,
} from './interestGenerators';

describe('interestGenerators', () => {
  it('crea un generador con validación', () => {
    expect(() => createInterestGenerator({ identifier: '' })).toThrow(/identificador/i);
    const g = createInterestGenerator({
      identifier: 'Recargo agosto',
      percentage: 2.5,
      tolerance: 0.1,
      period: 'manual',
    });
    expect(g.identifier).toBe('Recargo agosto');
    expect(g.percentage).toBe(2.5);
  });

  it('calcula interés sobre saldo menos tolerancia', () => {
    expect(computeInterestAmount(10000, 10, 0)).toBe(1000);
    expect(computeInterestAmount(10000, 10, 10000)).toBe(0);
    expect(computeInterestAmount(9999.9, 5, 0.1)).toBeCloseTo(499.99, 2);
  });

  it('filtra socios y genera entradas', () => {
    const generator = createInterestGenerator({
      identifier: 'Test',
      percentage: 10,
      tolerance: 0,
      separateEntries: true,
    });
    const members = [
      { memberId: '100', name: 'A', outstandingBalance: 20000 },
      { memberId: '200', name: 'B', outstandingBalance: 0 },
      { memberId: '300', name: 'C', outstandingBalance: 5000 },
    ];
    expect(selectMembersForInterest(members, generator)).toHaveLength(2);
    const { run, memberBalancePatches } = runInterestGenerator({ generator, members });
    expect(run.entriesCreated).toBe(2);
    expect(run.totalAmount).toBe(2500);
    expect(memberBalancePatches).toHaveLength(2);
  });
});

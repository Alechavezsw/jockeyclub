import { describe, expect, it } from 'vitest';
import { FEE_PACK_CONCEPTS, feePackForPeriod } from './feePackConcepts';

describe('feePackConcepts', () => {
  it('enero coincide con la liquidación de Lila', () => {
    const pack = feePackForPeriod({ accessinId: 814, year: 2026, month: 1 });
    expect(pack.total).toBe(64545500);
    expect(pack.concepts[0]).toMatchObject({
      label: 'ABONO TENIS',
      holders: 59,
      amount: 8500,
      total: 501500,
    });
    const familiar = pack.concepts.find((row) => row.label === 'SOCIO FAMILIAR');
    expect(familiar).toMatchObject({ holders: 1090, amount: 50000, total: 54500000 });
    const sum = pack.concepts.reduce((total, row) => total + row.total, 0);
    expect(sum).toBe(pack.total);
  });

  it('cada pack suma el total de Lila', () => {
    for (const pack of Object.values(FEE_PACK_CONCEPTS)) {
      const sum = pack.concepts.reduce((total, row) => total + row.total, 0);
      expect(sum).toBe(pack.total);
    }
    expect(feePackForPeriod({ accessinId: 1311 }).total).toBe(57843000);
    expect(feePackForPeriod({ accessinId: 1382 }).total).toBe(67677000);
  });
});

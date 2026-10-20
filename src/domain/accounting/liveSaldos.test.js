import { describe, expect, it } from 'vitest';
import { buildLiveSaldos } from './liveSaldos';

const today = new Date('2026-10-19T18:00:00-03:00');

describe('liveSaldos', () => {
  it('arma tesorería, deuda social y proveedores al día', () => {
    const live = buildLiveSaldos({
      today,
      cash: { efectivo: 200, bancos: 50, cheques: 10, total: 260 },
      members: [
        { memberId: '1', name: 'Ana', tier: 'socio_individual', outstandingBalance: 40000, nextDueDate: '2026-10-10' },
        { memberId: '2', name: 'Bruno', tier: 'socio_familiar', outstandingBalance: 10000, nextDueDate: '2026-11-10' },
        { memberId: '3', name: 'Cata', outstandingBalance: -500 },
        { memberId: '4', name: 'Dina', outstandingBalance: 0 },
      ],
      suppliers: [
        { id: 's1', legalName: 'Quiroga', openingBalance: 500000 },
        { id: 's2', legalName: 'Hielo', openingBalance: -200 },
      ],
      supplierEntries: [
        { id: 'e1', supplierId: 's1', status: 'posted', balanceDelta: -1000 },
      ],
    });

    expect(live.asOf).toBe('2026-10-19');
    expect(live.asOfLabel).toBe('19 de octubre de 2026');
    expect(live.treasury).toBe(260);
    expect(live.cashAndBanks).toBe(250);
    expect(live.memberDebt).toBe(50000);
    expect(live.withDebt).toBe(2);
    expect(live.memberCredit).toBe(500);
    expect(live.supplierDebt).toBe(499000);
    expect(live.supplierCredit).toBe(200);
    expect(live.topDebtors[0].name).toBe('Ana');
    expect(live.topDebtors[0].inMora).toBe(true);
    expect(live.topDebtors[0].tierLabel.toLowerCase()).toContain('individual');
    expect(live.topDebtors).toHaveLength(2);
  });

  it('sin movimientos queda en cero', () => {
    const live = buildLiveSaldos({ today, members: [], suppliers: [] });
    expect(live.treasury).toBe(0);
    expect(live.memberDebt).toBe(0);
    expect(live.supplierDebt).toBe(0);
    expect(live.topDebtors).toEqual([]);
  });
});

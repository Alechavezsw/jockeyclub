import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { applyDetailedCcAppDelta, detailedCcArchiveRows } from './detailedCurrentAccounts';

const chart = DEFAULT_CHART_OF_ACCOUNTS;
const cut = '2026-11-03';

function base() {
  return {
    11: {
      memberNumber: '11',
      memberName: 'Socio',
      lines: [{
        id: 1,
        feeDate: '2026-11-10',
        periodKey: '2026-11',
        type: 'Cuota',
        concept: 'Noviembre del 2026',
        value: 40000,
        amount: 40000,
        paid: 0,
        owed: 40000,
      }],
      totalAmount: 40000,
      totalPaid: 0,
      totalOwed: 40000,
    },
  };
}

describe('detailedCcArchiveRows', () => {
  it('deja noviembre en la cuenta y manda octubre para atrás a la descarga', () => {
    const byNumber = {
      11: {
        memberNumber: '11',
        memberName: 'Socio',
        lines: [
          { feeDate: '2026-10-10', periodKey: '2026-10', type: 'Cuota', concept: 'Octubre del 2026', value: 70000 },
          { feeDate: '2026-11-10', periodKey: '2026-11', type: 'Cuota', concept: 'Noviembre del 2026', value: 70000 },
        ],
      },
    };
    const rows = detailedCcArchiveRows(byNumber, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].concept).toBe('Octubre del 2026');
    expect(detailedCcArchiveRows({}, [[ '11', '2026-09-10', 'Cuota', 'Septiembre del 2026', 60000 ]])).toEqual([
      { memberNumber: '11', memberName: '', date: '2026-09-10', type: 'Cuota', concept: 'Septiembre del 2026', value: 60000 },
    ]);
  });
});

describe('applyDetailedCcAppDelta', () => {
  it('un cobro posterior al corte resta y uno del mismo día no entra', () => {
    const next = applyDetailedCcAppDelta(base(), {
      cutDate: cut,
      chartOfAccounts: chart,
      journalEntries: [
        {
          id: 'dentro',
          status: 'posted',
          date: '2026-11-03',
          memberId: '11',
          lines: [
            { accountId: 'coa-1.1.01', debit: 40000, credit: 0 },
            { accountId: 'coa-4.1.01', debit: 0, credit: 40000 },
          ],
        },
        {
          id: 'despues',
          status: 'posted',
          date: '2026-11-06',
          memberId: '11',
          lines: [
            { accountId: 'coa-1.1.01', debit: 10000, credit: 0 },
            { accountId: 'coa-4.1.01', debit: 0, credit: 10000 },
          ],
        },
      ],
    });
    expect(next['11'].totalOwed).toBe(30000);
    expect(next['11'].lines).toHaveLength(2);
    const pay = next['11'].lines.find((line) => line.source === 'app');
    expect(pay.value).toBe(-10000);
    expect(pay.type).toBe('Pago');
  });

  it('una anulación del cobro vuelve a sumar', () => {
    const next = applyDetailedCcAppDelta(base(), {
      cutDate: cut,
      chartOfAccounts: chart,
      journalEntries: [{
        id: 'anula',
        status: 'posted',
        date: '2026-11-06',
        memberId: '11',
        lines: [
          { accountId: 'coa-4.1.01', debit: 10000, credit: 0 },
          { accountId: 'coa-1.1.01', debit: 0, credit: 10000 },
        ],
      }],
    });
    expect(next['11'].totalOwed).toBe(50000);
    expect(next['11'].lines.find((line) => line.source === 'app').value).toBe(10000);
  });

  it('no vuelve a cargar un mes que el libro ya trae y sí suma el mes nuevo', () => {
    const next = applyDetailedCcAppDelta(base(), {
      cutDate: cut,
      feePeriods: [
        {
          id: 'fp-2026-11',
          year: 2026,
          month: 11,
          status: 'processed',
          generatedAt: '2026-11-06',
          pack: { charges: [{ memberId: '11', addAmount: 40000, dueOn: '2026-11-10' }] },
        },
        {
          id: 'fp-2026-12',
          year: 2026,
          month: 12,
          status: 'processed',
          generatedAt: '2026-12-01',
          pack: { charges: [{ memberId: '11', addAmount: 70000, dueOn: '2026-12-10' }] },
        },
      ],
    });
    expect(next['11'].lines.map((line) => line.periodKey)).toEqual(['2026-11', '2026-12']);
    expect(next['11'].totalOwed).toBe(110000);
  });
});

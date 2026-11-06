import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import { buildLiveCashLedger } from './liveCashLedger.js';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts.js';
import { cashMovementsSeed, cashSeed } from './cashLedger';

const cloudChart = [
  {
    id: 'aaaaaaaa-0001-0001-0001-000000000111',
    code: '1.1.01',
    name: 'Caja General',
    accountType: 'asset',
    isPostable: true,
    isCashAccount: true,
  },
  {
    id: 'aaaaaaaa-0004-0004-0004-000000000111',
    code: '4.1.01',
    name: 'Cuotas Sociales',
    accountType: 'income',
    isPostable: true,
    isCashAccount: false,
  },
];

const entry = {
  id: 'je-desk-same-day',
  date: '2026-11-05',
  status: 'posted',
  sourceModule: 'cuotas',
  description: 'Cobro cuota social (Efectivo) - Socio: manuel alejandro Chávez (Cred. 111591)',
  lines: [
    { accountId: 'aaaaaaaa-0001-0001-0001-000000000111', debit: 4400, credit: 0 },
    { accountId: 'aaaaaaaa-0004-0004-0004-000000000111', debit: 0, credit: 4400 },
  ],
};

let ACCESSIN_CASH_MOVEMENTS;
let ACCESSIN_CASH_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots([
    'accessinCashMovements',
    'accessinCashSnapshot',
  ]);
  ({ ACCESSIN_CASH_MOVEMENTS } = cashMovementsSeed());
  ({ ACCESSIN_CASH_SNAPSHOT } = cashSeed());
});

describe('liveCashLedger mismo día del corte', () => {
  it('muestra cobro ERP del día del snapshot Accessin', () => {
    const live = buildLiveCashLedger({
      snapshot: ACCESSIN_CASH_SNAPSHOT,
      movements: ACCESSIN_CASH_MOVEMENTS,
      journalEntries: [entry],
      chartOfAccounts: cloudChart,
      today: new Date('2026-11-05T20:00:00-03:00'),
    });
    const hit = live.ledger.find((r) => r.journalEntryId === entry.id);
    expect(live.cutoff).toBe('2026-11-05');
    expect(hit).toBeTruthy();
    expect(hit.amount).toBe(4400);
    expect(hit.memberNumber).toBe('111591');
  });

  it('resuelve cuentas UUID de nube contra el plan demo', () => {
    const live = buildLiveCashLedger({
      snapshot: { asOf: '2026-11-03', periodTo: '2026-11-03' },
      movements: [],
      journalEntries: [entry],
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
      today: new Date('2026-11-05T20:00:00-03:00'),
    });
    const hit = live.ledger.find((r) => r.journalEntryId === entry.id);
    expect(hit).toBeTruthy();
    expect(hit.amount).toBe(4400);
  });
});

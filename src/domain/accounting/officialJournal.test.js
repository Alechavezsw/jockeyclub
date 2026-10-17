import { describe, expect, it } from 'vitest';
import { isBalanced, normalizeLines, summarizeJournalBook } from './journal';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import {
  buildFeePeriodJournalEntry,
  buildLilaCashJournalEntries,
  buildOfficialJournalEntries,
  groupJournalByMonth,
  journalEntryKind,
  journalMixChips,
  liquidationJournalId,
} from './officialJournal';

describe('libro diario oficial', () => {
  it('arma la liquidación de un mes cerrado en partida doble', () => {
    const entry = buildFeePeriodJournalEntry({
      id: 'fp-1382',
      year: 2026,
      month: 10,
      amount: 63233000,
      generatedAt: '2026-09-09',
      status: 'processed',
    });
    expect(entry.id).toBe(liquidationJournalId(2026, 10));
    expect(entry.date).toBe('2026-09-09');
    expect(entry.description).toMatch(/Octubre del 2026/);
    expect(isBalanced(normalizeLines(entry.lines, DEFAULT_CHART_OF_ACCOUNTS))).toBe(true);
    expect(entry.lines[0].account).toBe('Cuentas a Cobrar');
    expect(entry.lines[1].account).toBe('Cuotas Sociales');
  });

  it('no liquida borradores ni montos en cero', () => {
    expect(buildFeePeriodJournalEntry({
      year: 2026,
      month: 11,
      amount: 0,
      status: 'draft',
    })).toBeNull();
  });

  it('agrupa la caja LILA por día, wallet y sentido', () => {
    const entries = buildLilaCashJournalEntries([
      { date: '2026-10-01', amount: 40000, movementType: 'income', walletKind: 'cash' },
      { date: '2026-10-01', amount: 20000, movementType: 'income', walletKind: 'cash' },
      { date: '2026-10-01', amount: 5000, movementType: 'expense', walletKind: 'cash' },
      { date: '2026-10-01', amount: 100000, movementType: 'income', walletKind: 'bank' },
    ]);
    expect(entries).toHaveLength(3);
    const cashIn = entries.find((row) => row.id.includes('cash-in'));
    const cashOut = entries.find((row) => row.id.includes('cash-out'));
    const bankIn = entries.find((row) => row.id.includes('bank-in'));
    expect(cashIn.lines[0].amount).toBe(60000);
    expect(cashIn.description).toMatch(/2 ingresos/);
    expect(cashOut.lines[0].amount).toBe(5000);
    expect(bankIn.lines[0].account).toBe('Banco Nación');
    expect(entries.every((row) => row.origin === 'lila')).toBe(true);
  });

  it('une liquidaciones, caja LILA, cobros vivos y eventos imputados', () => {
    const book = buildOfficialJournalEntries({
      journalEntries: [{
        id: 'live-1',
        date: '2026-10-17',
        description: 'Cobro cuota social (Efectivo)',
        status: 'posted',
        sourceModule: 'cuotas',
        lines: [
          { account: 'Caja General', type: 'debit', amount: 40000 },
          { account: 'Cuotas Sociales', type: 'credit', amount: 40000 },
        ],
      }],
      feePeriods: [
        { id: 'fp-1382', year: 2026, month: 10, amount: 63233000, generatedAt: '2026-09-09', status: 'processed' },
        { id: 'fp-2026-11', year: 2026, month: 11, amount: 0, status: 'draft' },
      ],
      accessinCashMovements: [
        { date: '2026-10-13', amount: 150000, movementType: 'income', walletKind: 'cash' },
      ],
      cashMovements: [
        { id: 'cm-1', amount: 8000, movementType: 'income', concept: 'Canon pileta', createdAt: '2026-10-17T15:00:00' },
      ],
      reservations: [{
        id: 'res-1',
        facilityId: 'salon_refugio',
        facilityName: 'Salón Refugio',
        date: '2026-10-12',
        imputed: true,
        chargedPrice: 250000,
        memberId: '101',
        memberName: 'Socio Evento',
      }],
    });
    expect(book.some((row) => row.id === 'live-1')).toBe(true);
    expect(book.some((row) => row.id === liquidationJournalId(2026, 10))).toBe(true);
    expect(book.some((row) => row.id === 'je-lila-2026-10-13-cash-in')).toBe(true);
    expect(book.some((row) => row.id === 'je-cash-cm-1')).toBe(true);
    expect(book.some((row) => row.id === 'je-evt-res-1' && row.sourceModule === 'eventos')).toBe(true);
    expect(book.filter((row) => String(row.id).startsWith('je-liq-'))).toHaveLength(10);
    const summary = summarizeJournalBook(book, DEFAULT_CHART_OF_ACCOUNTS);
    expect(summary.squared).toBe(true);
    expect(summary.count).toBe(14);
  });

  it('agrupa el diario por mes y diferencia liquidación, LILA y vivos', () => {
    const months = groupJournalByMonth([
      {
        id: 'je-lila-2026-10-13-cash-in',
        date: '2026-10-13',
        origin: 'lila',
        description: 'Caja · 1 ingreso',
        sourceModule: 'caja',
      },
      {
        id: 'live-1',
        date: '2026-10-13',
        sourceModule: 'cuotas',
        description: 'Cobro cuota social',
      },
      {
        id: 'je-liq-2026-10',
        date: '2026-09-09',
        description: 'Liquidación de cuotas · Octubre del 2026',
        sourceModule: 'cuotas',
      },
    ]);
    expect(months.map((row) => row.key)).toEqual(['2026-10', '2026-09']);
    expect(months[0].mix).toEqual({ liq: 0, lila: 1, live: 1 });
    expect(months[0].days).toHaveLength(1);
    expect(months[0].days[0].mix).toEqual({ liq: 0, lila: 1, live: 1 });
    expect(months[1].mix.liq).toBe(1);
    expect(journalEntryKind(months[1].days[0].entries[0])).toBe('liquidation');
    expect(journalMixChips(months[0].mix).map((chip) => chip.family)).toEqual(['lila', 'live']);
    expect(journalMixChips(months[0].mix).map((chip) => chip.label).join(' ')).not.toMatch(/lila/i);
  });
});

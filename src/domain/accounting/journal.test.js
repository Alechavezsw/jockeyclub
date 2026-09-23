import { describe, it, expect } from 'vitest';
import {
  sumDebits,
  sumCredits,
  isBalanced,
  filterJournalEntries,
  journalEntryOrdinal,
  journalOrdinalMap,
  summarizeJournalBook,
  buildMayorLedger,
  journalDateKey,
} from './journal';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';

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

  it('filtra el diario por día argentino aunque la fecha traiga hora', () => {
    const entries = [
      { id: 'a', date: '2026-09-14T21:44:00.000Z', description: 'Cuota', status: 'posted', lines: [] },
      { id: 'b', date: '2026-09-15', description: 'Gasto', status: 'posted', lines: [] },
      { id: 'c', date: '2026-09-14', description: 'Anulado', status: 'void', lines: [] },
    ];
    const day = filterJournalEntries(entries, { from: '2026-09-14', to: '2026-09-14' });
    expect(day.map((e) => e.id)).toEqual(['a']);
    expect(journalDateKey(entries[0])).toBe('2026-09-14');
  });

  it('numera asientos del más antiguo al más nuevo', () => {
    const entries = [
      { id: 'new', date: '2026-09-14', createdAt: '2026-09-14T18:00:00Z' },
      { id: 'old', date: '2026-09-01', createdAt: '2026-09-01T10:00:00Z' },
    ];
    expect(journalEntryOrdinal(entries, 'old')).toBe(1);
    expect(journalEntryOrdinal(entries, 'new')).toBe(2);
    expect(journalOrdinalMap(entries).get('old')).toBe(1);
  });

  it('excluye asientos sin fecha cuando hay rango y busca por número o importe', () => {
    const dated = {
      id: 'dated',
      date: '2026-08-30',
      description: 'Canon pileta',
      status: 'posted',
      lines: [
        { account: 'Caja General', type: 'debit', amount: 5000 },
        { account: 'Reservas e instalaciones', type: 'credit', amount: 5000 },
      ],
    };
    const entries = [
      dated,
      { id: 'nodate', date: '', description: 'Huérfano', status: 'posted', lines: [] },
    ];
    expect(filterJournalEntries(entries, { from: '2026-08-01', to: '2026-08-31' }).map((e) => e.id))
      .toEqual(['dated']);
    expect(filterJournalEntries([dated], { search: '1' }).map((e) => e.id)).toEqual(['dated']);
    expect(filterJournalEntries(entries, { search: '5000' }).map((e) => e.id)).toEqual(['dated']);
  });

  it('resume el libro: debe = haber y marca desbalanceados', () => {
    const entries = [
      { id: 'ok', date: '2026-08-01', status: 'posted', lines: balancedLines },
      { id: 'bad', date: '2026-08-02', status: 'posted', lines: unbalancedLines },
    ];
    const summary = summarizeJournalBook(entries, DEFAULT_CHART_OF_ACCOUNTS);
    expect(summary.count).toBe(2);
    expect(summary.debit).toBe(2000);
    expect(summary.credit).toBe(1900);
    expect(summary.unbalanced).toBe(1);
    expect(summary.squared).toBe(false);
  });

  it('arma el mayor en orden cronológico con saldo por naturaleza', () => {
    const chart = DEFAULT_CHART_OF_ACCOUNTS;
    const entries = [
      {
        id: 'je-2',
        date: '2026-09-20',
        description: 'Segundo',
        status: 'posted',
        lines: [
          { accountId: 'coa-1.1.01', debit: 3000, credit: 0 },
          { accountId: 'coa-4.1.01', debit: 0, credit: 3000 },
        ],
      },
      {
        id: 'je-1',
        date: '2026-09-10',
        description: 'Primero',
        status: 'posted',
        lines: [
          { accountId: 'coa-1.1.01', debit: 10000, credit: 0 },
          { accountId: 'coa-4.1.01', debit: 0, credit: 10000 },
        ],
      },
    ];
    const mayor = buildMayorLedger('coa-1.1.01', entries, chart);
    expect(mayor.lines.map((l) => l.description)).toEqual(['Primero', 'Segundo']);
    expect(mayor.lines[0].balance).toBe(10000);
    expect(mayor.lines[1].balance).toBe(13000);
    expect(mayor.finalBalance).toBe(13000);

    const income = buildMayorLedger('coa-4.1.01', entries, chart);
    expect(income.finalBalance).toBe(13000);
  });
});

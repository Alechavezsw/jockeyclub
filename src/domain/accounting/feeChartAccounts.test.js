import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_FEE_CHART_ACCOUNTS,
  defaultFeeChartAccounts,
  ledgerLinesFromCharges,
  liveFeeAccountLedgerLines,
  matchFeeLedgerAccountForCategory,
  periodLedgerLines,
  resolveFeeChartAccounts,
  withLiveFeeAccountBalances,
  withProcessedPeriodLines,
} from './feeChartAccounts';

const TODAY = '2026-10-17';

describe('feeChartAccounts', () => {
  it('arma una cuenta por cada categoría que cobra', () => {
    const accounts = defaultFeeChartAccounts(TODAY);
    const names = accounts.flatMap((account) => account.feeCategories);
    expect(names).toEqual(expect.arrayContaining([
      'SOCIO FAMILIAR',
      'SOCIO INDIVIDUAL',
      'SOCIO FAMILIAR (AMET)',
      'SOCIO INDIVIDUAL (AMET)',
      'ABONO TENIS',
    ]));
    expect(names).not.toContain('SOCIO (Vitalicio)');
    expect(accounts.find((account) => account.feeCategories.includes('SOCIO FAMILIAR'))?.id).toBe('fca-31');
    expect(accounts.find((account) => account.feeCategories.includes('SOCIO INDIVIDUAL'))?.id).toBe('fca-33');
    expect(ACCESSIN_FEE_CHART_ACCOUNTS.length).toBeGreaterThanOrEqual(5);
  });

  it('tira el stock LILA y completa categorías que faltan', () => {
    const accounts = resolveFeeChartAccounts([
      {
        id: 'fca-31',
        name: 'SOCIO FAMILIAR',
        feeCategories: ['SOCIO FAMILIAR'],
        balance: 463388625.47,
        source: 'lila',
        isActive: true,
      },
    ], TODAY);
    expect(accounts.find((account) => account.id === 'fca-31')?.balance).toBe(0);
    expect(matchFeeLedgerAccountForCategory(accounts, 'SOCIO FAMILIAR (AMET)')).toBeTruthy();
    expect(matchFeeLedgerAccountForCategory(accounts, 'ABONO TENIS')).toBeTruthy();
  });

  it('parte la liquidación por categoría, con recargo solo en familiar e individual', () => {
    const accounts = defaultFeeChartAccounts(TODAY);
    const member = {
      memberId: '10',
      name: 'Ana',
      cuotaCategories: ['SOCIO FAMILIAR', 'ABONO TENIS'],
    };
    const { lines, deltas } = ledgerLinesFromCharges(
      accounts,
      [member],
      [{ memberId: '10', addAmount: 80000 }],
      { id: 'fp-2026-11', year: 2026, month: 11, generatedAt: '2026-11-11', label: 'Noviembre del 2026' },
    );
    expect(lines).toHaveLength(2);
    const familiar = lines.find((line) => line.accountId === 'fca-31');
    const tenis = lines.find((line) => line.type.includes('ABONO TENIS'));
    expect(familiar.pending).toBe(77000);
    expect(tenis.pending).toBe(10000);
    expect(deltas.get('fca-31')).toBe(77000);
  });

  it('completa sola cada mes liquidado que todavía no está en la cuenta', () => {
    const accounts = defaultFeeChartAccounts(TODAY);
    const familiar = accounts.find((account) => account.id === 'fca-31');
    const members = [
      { memberId: '10', name: 'Ana', status: 'active', cuotaCategories: ['SOCIO FAMILIAR'] },
      { memberId: '11', name: 'Luis', status: 'active', cuotaCategories: ['SOCIO INDIVIDUAL'] },
      { memberId: '12', name: 'Baja', status: 'inactive', cuotaCategories: ['SOCIO FAMILIAR'] },
    ];
    const periods = [
      { id: 'fp-sep', year: 2026, month: 9, status: 'processed' },
      { id: 'fp-oct', year: 2026, month: 10, status: 'processed' },
      { id: 'fp-nov', year: 2026, month: 11, status: 'pending' },
    ];
    const lines = withProcessedPeriodLines(familiar, [], members, periods);
    expect(lines.map((line) => line.description)).toEqual(['Octubre del 2026', 'Septiembre del 2026']);
    expect(lines[0].amount).toBe(70000);
    expect(lines[1].amount).toBe(60000);
    expect(periodLedgerLines(familiar, members, periods[1])).toHaveLength(1);
    const again = withProcessedPeriodLines(familiar, lines, members, periods);
    expect(again).toHaveLength(2);
  });

  it('calcula el pendiente vivo con recargo de octubre', () => {
    const accounts = defaultFeeChartAccounts(TODAY);
    const familiar = accounts.find((account) => account.id === 'fca-31');
    const members = [
      {
        memberId: '10',
        name: 'Ana Pérez',
        status: 'active',
        cuotaCategories: ['SOCIO FAMILIAR'],
        lastPaymentDate: '2026-09-13',
        nextDueDate: '2026-10-10',
        outstandingBalance: 77000,
      },
      {
        memberId: '11',
        name: 'Luis',
        status: 'active',
        cuotaCategories: ['SOCIO INDIVIDUAL'],
        lastPaymentDate: '2026-09-13',
        nextDueDate: '2026-10-10',
        outstandingBalance: 44000,
      },
    ];
    const live = liveFeeAccountLedgerLines(familiar, members, { today: TODAY });
    expect(live).toHaveLength(1);
    expect(live[0].pending).toBe(77000);
    const painted = withLiveFeeAccountBalances(accounts, members, { today: TODAY });
    expect(painted.find((account) => account.id === 'fca-31')?.balance).toBe(77000);
    expect(painted.find((account) => account.id === 'fca-33')?.balance).toBe(44000);
  });
});

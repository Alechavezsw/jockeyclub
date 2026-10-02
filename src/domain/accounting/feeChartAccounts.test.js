import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  ACCESSIN_FEE_CHART_ACCOUNTS,
  filterFeeAccountLedger,
  ledgerLinesFromCharges,
  periodLedgerLines,
  resolveFeeChartAccounts,
  withProcessedPeriodLines,
} from './feeChartAccounts';
import { buildFeeAccountLedgerLines } from './feeAccountLedger';

beforeAll(async () => {
  await loadSnapshots(['accessinFeeAccountDetails']);
});

describe('feeChartAccounts', () => {
  it('conserva el balance guardado de una cuenta de Lila', () => {
    const accounts = resolveFeeChartAccounts([
      { ...ACCESSIN_FEE_CHART_ACCOUNTS[0], balance: 10 },
    ]);
    expect(accounts.find((account) => account.id === 'fca-31')?.balance).toBe(10);
    expect(accounts.find((account) => account.id === 'fca-33')).toBeTruthy();
  });

  it('imputa la liquidación en la cuenta de la categoría', () => {
    const { lines, deltas } = ledgerLinesFromCharges(
      ACCESSIN_FEE_CHART_ACCOUNTS,
      [{ memberId: '10', name: 'Ana', cuotaCategories: ['SOCIO FAMILIAR'] }],
      [{ memberId: '10', addAmount: 70000 }],
      { id: 'fp-2026-11', generatedAt: '2026-11-01', label: 'Noviembre del 2026' },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].accountId).toBe('fca-31');
    expect(lines[0].pending).toBe(70000);
    expect(deltas.get('fca-31')).toBe(70000);
  });

  it('tiene cuentas Accessin SOCIO FAMILIAR e INDIVIDUALES', () => {
    const accounts = resolveFeeChartAccounts(null);
    expect(accounts).toHaveLength(2);
    expect(ACCESSIN_FEE_CHART_ACCOUNTS.find((a) => a.accessinId === 31)?.balance).toBeCloseTo(463388625.47, 2);
    expect(ACCESSIN_FEE_CHART_ACCOUNTS.find((a) => a.accessinId === 33)?.balance).toBeCloseTo(54715510, 2);
  });

  it('completa sola cada mes liquidado que todavía no está en la cuenta', () => {
    const familiar = ACCESSIN_FEE_CHART_ACCOUNTS[0];
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
    expect(lines[0].pending).toBe(70000);
    expect(lines[1].amount).toBe(60000);
    expect(periodLedgerLines(familiar, members, periods[1])).toHaveLength(1);
    const again = withProcessedPeriodLines(familiar, lines, members, periods);
    expect(again).toHaveLength(2);
  });

  it('arma líneas de C.C. desde detalle de cuentas', () => {
    const familiar = ACCESSIN_FEE_CHART_ACCOUNTS[0];
    const lines = buildFeeAccountLedgerLines(familiar);
    expect(lines.length).toBeGreaterThan(1000);
    expect(lines[0].amount).toBeGreaterThan(0);
    expect(lines[0].pending).toBe(0);
  });

  it('filtra por rango de fechas', () => {
    const lines = buildFeeAccountLedgerLines(ACCESSIN_FEE_CHART_ACCOUNTS[1]);
    const filtered = filterFeeAccountLedger(lines, { from: '2026-09-01', to: '2026-09-30' });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((l) => String(l.date || '').startsWith('2026-09') || /septiembre del 2026/i.test(l.dateLabel || ''))).toBe(true);
  });
});

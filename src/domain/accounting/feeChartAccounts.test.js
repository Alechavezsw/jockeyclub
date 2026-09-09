import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_FEE_CHART_ACCOUNTS,
  buildFeeAccountLedgerLines,
  filterFeeAccountLedger,
  resolveFeeChartAccounts,
} from './feeChartAccounts';

describe('feeChartAccounts', () => {
  it('tiene cuentas Accessin SOCIO FAMILIAR e INDIVIDUALES', () => {
    const accounts = resolveFeeChartAccounts(null);
    expect(accounts).toHaveLength(2);
    expect(ACCESSIN_FEE_CHART_ACCOUNTS.find((a) => a.accessinId === 31)?.balance).toBeCloseTo(436210358.44, 2);
    expect(ACCESSIN_FEE_CHART_ACCOUNTS.find((a) => a.accessinId === 33)?.balance).toBeCloseTo(52075510, 2);
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

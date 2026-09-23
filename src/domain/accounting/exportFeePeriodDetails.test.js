import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import { ACCESSIN_FEE_PERIODS } from './feeBilling';
import { feeAccountDetailsForPeriod } from './feeAccountDetails';
import {
  FEE_PERIOD_EXCEL_HEADERS,
  buildFeePeriodExcelAoA,
  buildFeePeriodExportModel,
} from './exportFeePeriodDetails';

beforeAll(async () => {
  await loadSnapshots(['accessinFeeAccountDetails']);
});

describe('exportFeePeriodDetails', () => {
  it('arma filas de enero desde el export LILA', () => {
    const january = ACCESSIN_FEE_PERIODS.find((p) => p.month === 1 && p.year === 2026);
    const model = buildFeePeriodExportModel(january);
    expect(model.label).toBe('Enero del 2026');
    expect(model.rows.length).toBeGreaterThan(0);
    expect(model.rows.every((row) => (
      String(row.feeDate).includes('Enero') || String(row.feeDate).startsWith('2026-01')
    ))).toBe(true);
    const aoa = buildFeePeriodExcelAoA(model);
    expect(aoa[0]).toEqual(FEE_PERIOD_EXCEL_HEADERS);
    expect(aoa.length).toBe(model.rows.length + 1);
  });

  it('mantiene el detalle completo de septiembre', () => {
    const september = ACCESSIN_FEE_PERIODS.find((p) => p.month === 9 && p.year === 2026);
    const accounts = feeAccountDetailsForPeriod(september);
    const model = buildFeePeriodExportModel(september, accounts);
    expect(model.summary.lineCount).toBe(1669);
    expect(model.rows).toHaveLength(1669);
  });
});

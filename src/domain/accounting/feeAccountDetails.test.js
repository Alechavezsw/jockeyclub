import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_FEE_ACCOUNT_DETAILS,
  ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT,
  feeAccountDetailsForPeriod,
  feeAccountDetailsSummary,
  filterFeeAccountLines,
} from './feeAccountDetails';

describe('feeAccountDetails', () => {
  it('carga detalle real septiembre 2026', () => {
    expect(ACCESSIN_FEE_ACCOUNT_DETAILS).toHaveLength(2);
    expect(ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT.totalAmount).toBeCloseTo(90993502.07, 2);
    expect(ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT.lineCount).toBe(1669);
  });

  it('filtra por período y texto', () => {
    const accounts = feeAccountDetailsForPeriod('2026-09');
    expect(accounts).toHaveLength(2);
    const summary = feeAccountDetailsSummary(accounts);
    expect(summary.lineCount).toBe(1669);
    const familiar = accounts.find((a) => /familiar/i.test(a.accountLabel));
    const hits = filterFeeAccountLines(familiar.lines, '10811');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].memberNumber).toBe('10811');
  });
});

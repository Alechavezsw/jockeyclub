import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  feeAccountDetailsForPeriod,
  feeAccountDetailsSeed,
  feeAccountDetailsSummary,
  filterFeeAccountLines,
} from './feeAccountDetails';

let ACCESSIN_FEE_ACCOUNT_DETAILS;
let ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots(['accessinFeeAccountDetails']);
  ({ ACCESSIN_FEE_ACCOUNT_DETAILS, ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT } = feeAccountDetailsSeed());
});

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

  it('abre el detalle de un mes recortando el export de septiembre', () => {
    const january = feeAccountDetailsForPeriod('2026-01');
    expect(january.length).toBeGreaterThan(0);
    expect(january.every((a) => a.periodKey === '2026-01')).toBe(true);
    expect(feeAccountDetailsSummary(january).lineCount).toBeGreaterThan(0);
    expect(january[0].lines.every((l) => (
      String(l.feeDate || '').startsWith('2026-01') || /enero del 2026/i.test(l.description || l.feeDateLabel || '')
    ))).toBe(true);
  });
});

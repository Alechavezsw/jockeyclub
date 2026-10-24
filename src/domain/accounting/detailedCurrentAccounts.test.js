import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  buildDetailedCcAccountEntries,
  detailedCcSeed,
  listDetailedCcMembers,
  listUnpaidFeeMembersForPeriod,
  lookupDetailedCc,
} from './detailedCurrentAccounts';
import { buildAccessinAccountEntries, MEMBER_BALANCES_SNAPSHOTS } from './memberBalances';

let ACCESSIN_DETAILED_CC_AS_OF;
let ACCESSIN_DETAILED_CC_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots(MEMBER_BALANCES_SNAPSHOTS);
  ({ ACCESSIN_DETAILED_CC_AS_OF, ACCESSIN_DETAILED_CC_SNAPSHOT } = detailedCcSeed());
});

describe('detailedCurrentAccounts', () => {
  it('carga snapshot LILA de CC detalladas', () => {
    expect(ACCESSIN_DETAILED_CC_AS_OF).toBe('2026-09-30');
    expect(ACCESSIN_DETAILED_CC_SNAPSHOT.lineCount).toBe(4935);
    expect(ACCESSIN_DETAILED_CC_SNAPSHOT.memberCount).toBe(4934);
    expect(ACCESSIN_DETAILED_CC_SNAPSHOT.unpaidLines).toBe(316);
  });

  it('lookup 11017 con septiembre cancelado', () => {
    const hit = lookupDetailedCc('11017');
    expect(hit).toBeTruthy();
    expect(hit.lines).toHaveLength(1);
    const sep = hit.lines.find((l) => l.id === 3320214);
    expect(sep.periodKey).toBe('2026-09');
    expect(sep.amount).toBe(60000);
    expect(sep.paid).toBe(60000);
    expect(sep.owed).toBe(0);
  });

  it('arma entradas de cuenta desde CC detalladas', () => {
    const entries = buildDetailedCcAccountEntries('11017');
    expect(entries.some((e) => e.type === 'cuota' && e.accessinId === 3320214 && e.value === 60000)).toBe(true);
    expect(entries.some((e) => e.type === 'pago' && e.accessinId === 3320214 && e.value === -60000)).toBe(true);
  });

  it('integra CC en resumen Accessin y lista morosos parciales', () => {
    const entries = buildAccessinAccountEntries('11017');
    expect(entries.some((e) => e.source === 'accessin-cc')).toBe(true);
    const unpaid = listDetailedCcMembers({ onlyUnpaid: true });
    expect(unpaid.length).toBeGreaterThan(100);
    expect(unpaid.every((m) => m.totalOwed > 0)).toBe(true);
  });

  it('lista quienes no pagaron la cuota de septiembre', () => {
    const rows = listUnpaidFeeMembersForPeriod('2026-09');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.owed > 0 && row.memberNumber)).toBe(true);
    expect(rows.find((row) => String(row.memberNumber) === '11017')).toBeUndefined();
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  buildDetailedCcAccountEntries,
  detailedCcSeed,
  listDetailedCcMembers,
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
    expect(ACCESSIN_DETAILED_CC_AS_OF).toBe('2026-09-03');
    expect(ACCESSIN_DETAILED_CC_SNAPSHOT.lineCount).toBe(9837);
    expect(ACCESSIN_DETAILED_CC_SNAPSHOT.memberCount).toBe(4948);
    expect(ACCESSIN_DETAILED_CC_SNAPSHOT.unpaidLines).toBe(841);
  });

  it('lookup 11017 con agosto pagado y septiembre adeudado', () => {
    const hit = lookupDetailedCc('11017');
    expect(hit).toBeTruthy();
    expect(hit.lines).toHaveLength(2);
    const ago = hit.lines.find((l) => l.id === 3171138);
    const sep = hit.lines.find((l) => l.id === 3320214);
    expect(ago.amount).toBe(60000);
    expect(ago.paid).toBe(60000);
    expect(sep.amount).toBe(60000);
    expect(sep.paid).toBe(0);
    expect(sep.owed).toBe(60000);
  });

  it('arma entradas de cuenta desde CC detalladas', () => {
    const entries = buildDetailedCcAccountEntries('11017');
    expect(entries.some((e) => e.type === 'cuota' && e.accessinId === 3171138)).toBe(true);
    expect(entries.some((e) => e.type === 'pago' && e.accessinId === 3171138 && e.value === -60000)).toBe(true);
    expect(entries.some((e) => e.type === 'cuota' && e.accessinId === 3320214)).toBe(true);
  });

  it('integra CC en resumen Accessin y lista morosos parciales', () => {
    const entries = buildAccessinAccountEntries('11017');
    expect(entries.some((e) => e.source === 'accessin-cc')).toBe(true);
    const unpaid = listDetailedCcMembers({ onlyUnpaid: true });
    expect(unpaid.length).toBeGreaterThan(100);
    expect(unpaid.every((m) => m.totalOwed > 0)).toBe(true);
  });
});

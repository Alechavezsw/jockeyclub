import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  buildDetailedCcAccountEntries,
  detailedCcSeed,
  listDetailedCcMembers,
  listUnpaidFeeMembersForPeriod,
  listUnpaidFeeMembersFromFeePeriod,
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
    if (ACCESSIN_DETAILED_CC_AS_OF === '2026-11-03') {
      expect(ACCESSIN_DETAILED_CC_SNAPSHOT.periodTo).toBe('2026-11-03');
      expect(ACCESSIN_DETAILED_CC_SNAPSHOT.memberCount).toBeGreaterThan(7000);
      expect(ACCESSIN_DETAILED_CC_SNAPSHOT.lineCount).toBeGreaterThan(10000);
      expect(ACCESSIN_DETAILED_CC_SNAPSHOT.mismatches).toBe(0);
      return;
    }
    expect(ACCESSIN_DETAILED_CC_AS_OF).toBe('2026-09-30');
    expect(ACCESSIN_DETAILED_CC_SNAPSHOT.lineCount).toBe(4935);
    expect(ACCESSIN_DETAILED_CC_SNAPSHOT.memberCount).toBe(4934);
    expect(ACCESSIN_DETAILED_CC_SNAPSHOT.unpaidLines).toBe(316);
  });

  it('el saldo de cada socio cierra con sus movimientos', () => {
    if (ACCESSIN_DETAILED_CC_AS_OF !== '2026-11-03') return;
    const unpaid = listDetailedCcMembers({ onlyUnpaid: true });
    expect(unpaid.length).toBeGreaterThan(0);
    const sample = unpaid[0];
    const sum = Math.round(sample.lines.reduce((s, line) => s + (Number(line.value) || 0), 0) * 100) / 100;
    expect(sum).toBe(Math.round(sample.totalOwed * 100) / 100);
    const entries = buildDetailedCcAccountEntries(sample.memberNumber);
    expect(entries.some((entry) => entry.source === 'accessin-cc' && entry.value > 0)).toBe(true);
  });

  it('lookup 11017 con septiembre cancelado', () => {
    if (ACCESSIN_DETAILED_CC_AS_OF === '2026-11-03') return;
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
    if (ACCESSIN_DETAILED_CC_AS_OF === '2026-11-03') return;
    const entries = buildDetailedCcAccountEntries('11017');
    expect(entries.some((e) => e.type === 'cuota' && e.accessinId === 3320214 && e.value === 60000)).toBe(true);
    expect(entries.some((e) => e.type === 'pago' && e.accessinId === 3320214 && e.value === -60000)).toBe(true);
  });

  it('integra CC en resumen Accessin y lista morosos parciales', () => {
    const unpaid = listDetailedCcMembers({ onlyUnpaid: true });
    expect(unpaid.length).toBeGreaterThan(100);
    expect(unpaid.every((m) => m.totalOwed > 0)).toBe(true);
    if (ACCESSIN_DETAILED_CC_AS_OF === '2026-11-03') {
      const entries = buildAccessinAccountEntries(unpaid[0].memberNumber);
      expect(entries.some((e) => e.source === 'accessin-cc')).toBe(true);
      return;
    }
    const entries = buildAccessinAccountEntries('11017');
    expect(entries.some((e) => e.source === 'accessin-cc')).toBe(true);
  });

  it('lista quienes no pagaron la cuota de septiembre', () => {
    const rows = listUnpaidFeeMembersForPeriod('2026-09');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.owed > 0 && row.memberNumber)).toBe(true);
    if (ACCESSIN_DETAILED_CC_AS_OF !== '2026-11-03') {
      expect(rows.find((row) => String(row.memberNumber) === '11017')).toBeUndefined();
    }
  });

  it('no lista comisión / presidente aunque el snapshot tenga saldo', () => {
    const byNumber = {
      8377: {
        memberNumber: '8377',
        memberName: 'Carlos Marcelo Laciar',
        socialFee: 'COMISION',
        tier: 'comision',
        lines: [{ periodKey: '2026-11', owed: 266000, amount: 266000 }],
      },
      11017: {
        memberNumber: '11017',
        memberName: 'Socio Familiar',
        socialFee: 'SOCIO FAMILIAR',
        lines: [{ periodKey: '2026-11', owed: 70000, amount: 70000 }],
      },
    };
    const rows = listUnpaidFeeMembersForPeriod('2026-11', byNumber, [
      {
        memberId: '8377',
        name: 'Carlos Marcelo Laciar',
        tier: 'comision',
        cuotaCategories: ['COMISION'],
        status: 'active',
      },
    ]);
    expect(rows.find((row) => String(row.memberNumber) === '8377')).toBeUndefined();
    expect(rows.find((row) => String(row.memberNumber) === '11017')?.owed).toBe(70000);
  });

  it('lista no pagaron desde el pack vivo de fee_period (no snapshot LILA)', () => {
    const feePeriod = {
      year: 2026,
      month: 11,
      status: 'processed',
      pack: {
        charges: [
          { memberId: '11147', addAmount: 70000, memberName: 'Elizabeth Beatriz Onsalo' },
          { memberId: '10559', addAmount: 70000, memberName: 'Egla Anabel Costa' },
          { memberId: '8377', addAmount: 70000, memberName: 'Carlos Marcelo Laciar' },
        ],
      },
    };
    const rows = listUnpaidFeeMembersFromFeePeriod(feePeriod, [
      {
        memberId: '11147',
        name: 'Elizabeth Beatriz Onsalo',
        lastPaymentDate: '2026-11-01',
        unpaidCapital: 0,
        status: 'active',
        tier: 'socio_familiar',
      },
      {
        memberId: '10559',
        name: 'Egla Anabel Costa',
        unpaidCapital: 717000,
        status: 'active',
        tier: 'socio_familiar',
      },
      {
        memberId: '8377',
        name: 'Carlos Marcelo Laciar',
        unpaidCapital: 0,
        status: 'active',
        tier: 'comision',
        cuotaCategories: ['COMISION'],
      },
    ]);
    expect(rows.map((r) => r.memberNumber)).toEqual(['10559']);
    expect(rows[0].owed).toBe(70000);
  });

  it('no mete reservas de salón en “no pagaron” la cuota', () => {
    const byNumber = {
      8377: {
        memberNumber: '8377',
        memberName: 'Carlos Marcelo Laciar',
        socialFee: '',
        lines: [{
          periodKey: '2026-11',
          type: 'Reserva de espacio',
          owed: 170000,
          amount: 170000,
          concept: 'SALON ANHELO',
        }],
      },
      11017: {
        memberNumber: '11017',
        memberName: 'Socio Familiar',
        lines: [{ periodKey: '2026-11', type: 'Cuota', owed: 70000, amount: 70000 }],
      },
    };
    const rows = listUnpaidFeeMembersForPeriod('2026-11', byNumber, []);
    expect(rows.find((row) => String(row.memberNumber) === '8377')).toBeUndefined();
    expect(rows.find((row) => String(row.memberNumber) === '11017')?.owed).toBe(70000);
  });

  it('saca del mes a quienes ya pagaron con débito aunque el snapshot diga deuda', () => {
    const byNumber = {
      11147: {
        memberNumber: '11147',
        memberName: 'Elizabeth Beatriz Onsalo',
        lines: [{ periodKey: '2026-11', owed: 70000, amount: 70000 }],
      },
      10559: {
        memberNumber: '10559',
        memberName: 'Egla Anabel Costa',
        lines: [{ periodKey: '2026-11', owed: 70000, amount: 70000 }],
      },
    };
    const rows = listUnpaidFeeMembersForPeriod('2026-11', byNumber, [
      {
        memberId: '11147',
        lastPaymentDate: '2026-11-01',
        unpaidCapital: 0,
        nextDueDate: '2026-12-10',
        status: 'active',
        tier: 'socio_familiar',
      },
      {
        memberId: '10559',
        unpaidCapital: 717000,
        status: 'active',
        tier: 'socio_familiar',
      },
    ]);
    expect(rows.find((row) => String(row.memberNumber) === '11147')).toBeUndefined();
    expect(rows.find((row) => String(row.memberNumber) === '10559')?.owed).toBe(70000);
  });
});

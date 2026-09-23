import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  applyAccountEntryToMember,
  buildAccessinAccountEntries,
  buildPaymentBoleto,
  createAccountEntry,
  familyBalanceForMember,
  filterMembersForBalances,
  groupEntriesByMonth,
  MEMBER_BALANCES_SNAPSHOTS,
  memberStatusLabel,
  upsertAccountEntry,
} from './memberBalances';

beforeAll(async () => {
  await loadSnapshots(MEMBER_BALANCES_SNAPSHOTS);
});

describe('memberBalances / saldos', () => {
  it('filtra habilitados y por número de socio', () => {
    const members = [
      { memberId: '10536', name: 'Salvatori Pascual', status: 'active', outstandingBalance: 100 },
      { memberId: '99999', name: 'Baja Uno', status: 'inactive', outstandingBalance: 50 },
    ];
    const hit = filterMembersForBalances(members, { status: 'habilitado', query: '10536' });
    expect(hit).toHaveLength(1);
    expect(hit[0].memberId).toBe('10536');
    expect(filterMembersForBalances(members, { status: 'habilitado', query: 'salvatori' })).toHaveLength(1);
  });

  it('arma balance familiar solo para titular', () => {
    const titular = {
      memberId: '100',
      name: 'Titular',
      outstandingBalance: 1000,
      adherents: [{ memberId: '101', name: 'Hijo', outstandingBalance: 200, fromPadron: true }],
    };
    const dep = {
      memberId: '101',
      name: 'Hijo',
      familyPrincipalNumber: '100',
      outstandingBalance: 200,
    };
    expect(familyBalanceForMember(titular, [titular, dep]).amount).toBe(1200);
    expect(familyBalanceForMember(dep, [titular, dep]).isTitular).toBe(false);
  });

  it('genera entradas Accessin con cuota, recargo y pago para un socio con cobranzas', () => {
    const entries = buildAccessinAccountEntries('10743');
    const types = new Set(entries.map((e) => e.type));
    expect(types.has('pago')).toBe(true);
    expect(types.has('recargo') || types.has('cuota')).toBe(true);
    const pago = entries.find((e) => e.type === 'pago' && String(e.accessinId).includes('3343943'));
    expect(pago?.value).toBeLessThan(0);
    expect(Math.abs(pago.value)).toBe(76000);
  });

  it('agrupa por mes con saldo de apertura', () => {
    const groups = groupEntriesByMonth([
      { id: '1', date: '2026-07-01', value: 36000 },
      { id: '2', date: '2026-07-11', value: 2000 },
      { id: '3', date: '2026-07-20', value: -38000 },
      { id: '4', date: '2026-08-01', value: 36000 },
    ], { monthsBack: 2 });
    expect(groups).toHaveLength(2);
    expect(groups[0].openingBalance).toBe(0);
    expect(groups[1].openingBalance).toBe(0);
    expect(groups[1].entries).toHaveLength(1);
  });

  it('al pedir más meses incluye meses vacíos anteriores', () => {
    const rows = [
      { id: '1', date: '2026-08-01', value: 1000 },
      { id: '2', date: '2026-09-01', value: -1000 },
    ];
    const three = groupEntriesByMonth(rows, { monthsBack: 3, asOf: '2026-09' });
    expect(three.map((g) => g.key)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(three[0].entries).toHaveLength(0);
    const six = groupEntriesByMonth(rows, { monthsBack: 6, asOf: '2026-09' });
    expect(six).toHaveLength(6);
    expect(six[0].key).toBe('2026-04');
    expect(six[0].openingLabel).toMatch(/Abril/);
  });

  it('etiqueta pending y suspended', () => {
    expect(memberStatusLabel({ status: 'pending' })).toBe('Pendiente');
    expect(memberStatusLabel({ status: 'suspended' })).toBe('Inhabilitado');
    expect(filterMembersForBalances(
      [{ memberId: '1', name: 'A', status: 'pending' }],
      { status: 'habilitado' },
    )).toHaveLength(0);
  });

  it('aplica una entrada al saldo del socio', () => {
    const entry = createAccountEntry({
      type: 'pago',
      memberNumber: '10536',
      memberName: 'Test',
      value: 4000,
      date: '2026-09-04',
    });
    const next = applyAccountEntryToMember(
      { memberId: '10536', outstandingBalance: 10000 },
      entry,
    );
    expect(next.outstandingBalance).toBe(6000);
    expect(next.lastPaymentDate).toBe('2026-09-04');
  });

  it('crea pago negativo y upsert local', () => {
    const entry = createAccountEntry({
      type: 'pago',
      memberNumber: '10536',
      memberName: 'Test',
      value: 5000,
      date: '2026-09-01',
    });
    expect(entry.value).toBe(-5000);
    const list = upsertAccountEntry([], entry);
    expect(list).toHaveLength(1);
  });

  it('arma boleto de pago', () => {
    const boleto = buildPaymentBoleto(
      { memberId: '11017', name: 'Rodríguez Mariana Andrea', tier: 'familiar', outstandingBalance: 60000 },
      { periodLabel: 'Septiembre del 2026', amount: 60000, dueDate1: '2026-09-10', dueDate2: '2026-09-30', surcharge: 6000 }
    );
    expect(boleto.totalToPay).toBe(60000);
    expect(boleto.dueAmount2).toBe(66000);
    expect(boleto.clubName).toMatch(/JOCKEY/i);
  });
});

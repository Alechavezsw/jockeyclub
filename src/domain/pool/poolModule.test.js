/**
 * Circuito completo de pileta: apto, canon de temporada, medios, invitados y puerta.
 * El canon no es la cuota social.
 */
import { describe, expect, it } from 'vitest';
import { CARD_JOURNAL_ACCOUNT, CASH_JOURNAL_ACCOUNT } from '../members/clubBanks';
import {
  attachPoolMedical,
  DEFAULT_POOL_SETTINGS,
  enableGuestPoolAccess,
  enableMemberPoolAccess,
  evaluatePoolAccess,
  getMedicalStatus,
  isPoolDayCashOpen,
  mergePoolSettings,
  poolAccessReportRows,
  poolCanonByDay,
  poolDayStats,
  poolEntranceVerdict,
  poolMethodLabel,
  poolMethodUsesBank,
  poolMethodUsesCardPos,
  poolMethodUsesCash,
  poolSeasonStats,
  POOL_DESK_PAYMENT_METHODS,
  POOL_PAYMENT_METHODS,
  recordPoolAttendance,
  revokePoolAccess,
  searchPoolMembers,
} from './poolAccess';
import {
  applyPoolAccountPass,
  buildPoolAccountEntries,
  chargePoolCanon,
  POOL_MP_PENDING,
} from './poolCheckout';
import { verifyPoolCanonCircle } from './poolCircle';
import { quoteHouseholdPoolSeason, quotePersonPoolSeason } from './poolSeasonBilling';
import { clubEntryGate } from './seasonDuesGate';

const TODAY = '2026-12-15';
const SEASON_DAY = new Date('2026-12-15T12:00:00-03:00');

function readyMember(overrides = {}) {
  return attachPoolMedical({
    id: 'mem-1',
    memberId: '123',
    name: 'Ana Pérez',
    status: 'active',
    tier: 'socio_familiar',
    cuotaCategories: ['SOCIO FAMILIAR'],
    outstandingBalance: 0,
    birthDate: '1985-04-04',
    documentNumber: '30111222',
    ...overrides,
  }, {
    talonario: '45821',
    uploadedAt: '2026-12-01T12:00:00.000Z',
    validityDays: 365,
  });
}

function recordOk(saved = {}) {
  return async (payload) => ({
    payload,
    journalEntry: { id: saved.journalId || 'j-pool' },
    movement: payload.method === 'efectivo' ? { id: saved.cashId || 'cash-pool' } : null,
  });
}

describe('temporada y apto', () => {
  it('el canon de temporada es $ 90.000 y el invitado del día $ 8.000', () => {
    const settings = mergePoolSettings({});
    expect(settings.memberSeasonFee).toBe(90000);
    expect(settings.memberDayFee).toBe(90000);
    expect(settings.guestDayFee).toBe(8000);
    expect(settings.maxGuestsPerMember).toBe(3);
    expect(settings.maxPayingPerHousehold).toBe(4);
    expect(settings.freeUnderAgeYears).toBe(4);
    expect(settings.seasonLabel).toMatch(/2026\/2027/);
    expect(mergePoolSettings({ memberDayFee: 5000 }).memberSeasonFee).toBe(90000);
  });

  it('sin apto no entra; el talón vigente sí', () => {
    const bare = { memberId: '123', name: 'Ana', status: 'active', outstandingBalance: 0 };
    expect(getMedicalStatus(bare, { today: TODAY }).ok).toBe(false);
    const snap = evaluatePoolAccess(bare, { today: TODAY });
    expect(snap.canEnable).toBe(false);
    expect(snap.canPayCanon).toBe(true);
    expect(snap.blockers.join(' ')).toMatch(/revisaci|apto|m[eé]dic/i);
    const ready = readyMember();
    const open = evaluatePoolAccess(ready, { today: TODAY });
    expect(open.medical.ok).toBe(true);
    expect(open.medical.label).toMatch(/45821/);
    expect(open.canEnable).toBe(true);
    expect(open.seasonAmountDue).toBe(90000);
  });

  it('el canon se cobra sin apto y el ingreso espera la revisación', () => {
    const bare = {
      memberId: '123',
      name: 'Ana Pérez',
      status: 'active',
      outstandingBalance: 0,
      tier: 'socio_familiar',
      birthDate: '1985-04-04',
    };
    expect(() => enableMemberPoolAccess({ member: bare, today: TODAY })).toThrow(/revisaci/i);
    const paid = enableMemberPoolAccess({
      member: bare,
      today: TODAY,
      requireMedical: false,
    });
    expect(paid.entry.payment.amount).toBe(90000);
    expect(paid.entry.payment.scope).toBe('season');
    expect(paid.entry.entered).toBe(false);
    const afterPay = evaluatePoolAccess(bare, { today: TODAY, accesses: paid.accesses });
    expect(afterPay.seasonPaid).toBe(true);
    expect(afterPay.canPayCanon).toBe(false);
    expect(afterPay.alreadyIn).toBe(false);
    expect(afterPay.canEnable).toBe(false);
    expect(poolDayStats(paid.accesses, TODAY)).toMatchObject({ members: 0, collected: 90000 });
    expect(() => enableGuestPoolAccess({
      host: bare,
      guestName: 'Luis',
      accesses: paid.accesses,
      today: TODAY,
    })).toThrow(/habilit/i);
    const withMed = attachPoolMedical(bare, {
      talonario: '45821',
      uploadedAt: '2026-12-01T12:00:00.000Z',
    });
    const visit = enableMemberPoolAccess({
      member: withMed,
      accesses: paid.accesses,
      today: TODAY,
    });
    expect(visit.entry.entered).toBe(true);
    expect(visit.entry.payment.amount).toBe(0);
    expect(evaluatePoolAccess(withMed, { today: TODAY, accesses: visit.accesses }).alreadyIn).toBe(true);
  });

  it('un apto vencido no alcanza', () => {
    const old = attachPoolMedical({
      memberId: '9',
      name: 'Viejo',
      status: 'active',
      outstandingBalance: 0,
    }, {
      fileName: 'apto.pdf',
      uploadedAt: '2024-01-01T12:00:00.000Z',
      validityDays: 365,
    });
    const status = getMedicalStatus(old, { today: TODAY });
    expect(status.ok).toBe(false);
    expect(evaluatePoolAccess(old, { today: TODAY }).canEnable).toBe(false);
  });

  it('un menor de 4 no paga y el quinto del grupo tampoco', () => {
    const child = quotePersonPoolSeason({
      memberId: '50',
      name: 'Nene',
      status: 'active',
      birthDate: '2024-06-01',
    }, { today: SEASON_DAY });
    expect(child.pays).toBe(false);
    expect(child.amount).toBe(0);

    const titular = {
      memberId: '1000',
      name: 'Titular',
      status: 'active',
      birthDate: '1980-01-01',
    };
    const household = [titular];
    for (let n = 1; n <= 5; n += 1) {
      household.push({
        memberId: String(2000 + n),
        name: `Integrante ${n}`,
        status: 'active',
        birthDate: '1990-01-01',
        familyPrincipalNumber: '1000',
      });
    }
    const quote = quoteHouseholdPoolSeason(titular, { today: SEASON_DAY, members: household });
    expect(quote.feePerPerson).toBe(90000);
    expect(quote.payingCount).toBe(4);
    expect(quote.freeCount).toBe(2);
    expect(quote.total).toBe(360000);
  });
});

describe('medios del canon', () => {
  it('ofrece los mismos medios que el club, sin mixto', () => {
    expect(POOL_PAYMENT_METHODS.map((row) => row.id)).toEqual([
      'efectivo',
      'transferencia',
      'tarjeta',
      'debito',
      'mercadopago',
    ]);
    expect(POOL_DESK_PAYMENT_METHODS).not.toContain('mercadopago');
    expect(POOL_DESK_PAYMENT_METHODS).not.toContain('mixto');
    expect(poolMethodLabel('tarjeta')).toBe('Pago POS');
    expect(poolMethodLabel('pos')).toBe('Pago POS');
    expect(poolMethodLabel('debito')).toBe('Débito');
    expect(poolMethodLabel('asistencia')).toBe('Asistencia');
  });

  it('efectivo va a Caja General y deja cargo más pago por el mismo importe', async () => {
    const member = readyMember();
    const { entry } = enableMemberPoolAccess({
      member,
      method: 'efectivo',
      today: TODAY,
    });
    expect(poolMethodUsesCash(entry.payment.method)).toBe(true);
    expect(entry.payment.amount).toBe(90000);
    expect(entry.payment.scope).toBe('season');
    expect(entry.payment.concept).toMatch(/temporada/i);
    const charged = await chargePoolCanon({
      entry,
      member,
      recordPoolCanon: recordOk(),
    });
    expect(charged.journalEntryId).toBe('j-pool');
    expect(charged.cashMovementId).toBe('cash-pool');
    expect(charged.accountEntries).toHaveLength(2);
    expect(charged.accountEntries.map((row) => row.type)).toEqual(['otro', 'pago']);
    expect(charged.accountEntries.map((row) => row.value)).toEqual([90000, -90000]);
    expect(charged.accountEntries.every((row) => row.source === 'pool_canon')).toBe(true);
    const circle = verifyPoolCanonCircle({ entry, charged, method: 'efectivo' });
    expect(circle.ok).toBe(true);
  });

  it('transferencia y débito acreditan en el banco, no en caja', async () => {
    const member = readyMember();
    for (const method of ['transferencia', 'debito']) {
      expect(poolMethodUsesBank(method)).toBe(true);
      expect(poolMethodUsesCash(method)).toBe(false);
      const { entry } = enableMemberPoolAccess({ member, method, today: TODAY });
      const charged = await chargePoolCanon({
        entry,
        member,
        bankId: 'macro',
        recordPoolCanon: async (payload) => {
          expect(payload.bankJournal).toBe('Banco Macro');
          expect(payload.method).toBe(method);
          expect(payload.amount).toBe(90000);
          return { journalEntry: { id: `j-${method}` }, movement: null };
        },
      });
      expect(charged.cashMovementId).toBeNull();
      expect(charged.payment.bankJournal).toBe('Banco Macro');
      expect(verifyPoolCanonCircle({ entry, charged, method }).ok).toBe(true);
    }
  });

  it('Pago POS va a tarjetas a cobrar y el cupón no es efectivo', async () => {
    const member = readyMember();
    expect(poolMethodUsesCardPos('tarjeta')).toBe(true);
    expect(poolMethodUsesCardPos('pos')).toBe(true);
    const { entry } = enableMemberPoolAccess({ member, method: 'tarjeta', today: TODAY });
    const charged = await chargePoolCanon({
      entry,
      member,
      recordPoolCanon: async (payload) => {
        expect(payload.bankJournal).toBe(CARD_JOURNAL_ACCOUNT);
        expect(payload.bankJournal).not.toBe(CASH_JOURNAL_ACCOUNT);
        return { journalEntry: { id: 'j-pos' }, movement: null };
      },
    });
    expect(charged.payment.methodLabel).toBe('Pago POS');
    expect(verifyPoolCanonCircle({
      entry,
      charged,
      method: 'tarjeta',
    }).ok).toBe(true);
    const rows = poolAccessReportRows([{
      ...charged,
      status: 'active',
    }], { today: TODAY });
    expect(rows[0].method).toBe('Pago POS');
    expect(rows[0].amount).toBe(90000);
  });

  it('Mercado Pago no se acredita a mano y un medio raro se rechaza', async () => {
    const member = readyMember();
    const { entry } = enableMemberPoolAccess({ member, method: 'mercadopago', today: TODAY });
    await expect(chargePoolCanon({
      entry,
      member,
      recordPoolCanon: recordOk(),
    })).rejects.toThrow(POOL_MP_PENDING);
    expect(buildPoolAccountEntries({ entry, member })).toEqual([]);
    await expect(chargePoolCanon({
      entry: { ...entry, payment: { ...entry.payment, method: 'mixto' } },
      member,
      recordPoolCanon: recordOk(),
    })).rejects.toThrow(/medio/i);
    expect(() => enableMemberPoolAccess({
      member,
      method: 'mixto',
      today: TODAY,
    })).toThrow(/medio/i);
  });

  it('la asistencia no cobra y no arma cuenta', async () => {
    const member = readyMember();
    const { entry } = recordPoolAttendance({ member, today: TODAY });
    expect(entry.payment.method).toBe('asistencia');
    expect(entry.payment.amount).toBe(0);
    const charged = await chargePoolCanon({ entry, member, recordPoolCanon: recordOk() });
    expect(charged.accountEntries).toEqual([]);
    expect(poolCanonByDay([entry], { month: '2026-12' })).toEqual([]);
  });
});

describe('cuenta del socio', () => {
  it('el pase de pileta no cambia el saldo de cuota', () => {
    const member = readyMember({ outstandingBalance: 70000 });
    const entries = buildPoolAccountEntries({
      entry: {
        id: 'pool-1',
        date: TODAY,
        kind: 'member',
        memberId: '123',
        payment: { amount: 90000, method: 'efectivo' },
      },
      member,
    });
    const next = applyPoolAccountPass([member], entries);
    const row = next.find((item) => item.memberId === '123');
    expect(row.outstandingBalance).toBe(70000);
  });

  it('el invitado se anota en la cuenta del anfitrión', () => {
    const host = readyMember();
    const entries = buildPoolAccountEntries({
      entry: {
        id: 'pool-g',
        date: TODAY,
        kind: 'guest',
        memberId: '123',
        memberName: 'Ana Pérez',
        guestName: 'Luis',
        payment: { amount: 8000, method: 'efectivo' },
      },
      member: host,
    });
    expect(entries[0].memberNumber).toBe('123');
    expect(entries[0].description).toMatch(/Luis/);
    expect(entries[0].value).toBe(8000);
  });
});

describe('puerta, mora e invitados', () => {
  it('en temporada la mora de cuota frena el canon', () => {
    const late = readyMember({ outstandingBalance: 70000, nextDueDate: '2026-12-10' });
    const snap = evaluatePoolAccess(late, { today: TODAY });
    expect(snap.payBlocked).toBe(true);
    expect(snap.canEnable).toBe(false);
    expect(() => enableMemberPoolAccess({ member: late, today: TODAY })).toThrow(/mora/i);
    expect(clubEntryGate(late, { today: SEASON_DAY }).blocked).toBe(true);
    expect(poolEntranceVerdict(late, snap, 70000).status).toBe('denied');
  });

  it('un no socio de pileta paga el canon y la mora de cuota no lo frena', () => {
    const guest = readyMember({
      tier: 'pileta_no_socio',
      cuotaCategories: ['PILETA (No socio)'],
      outstandingBalance: 70000,
    });
    const snap = evaluatePoolAccess(guest, { today: TODAY });
    expect(snap.payBlocked).toBe(false);
    expect(snap.canEnable).toBe(true);
    expect(snap.seasonAmountDue).toBe(90000);
    expect(clubEntryGate(guest, { today: SEASON_DAY }).blocked).toBe(false);
    const verdict = poolEntranceVerdict(guest, { ...snap, seasonPaid: false, paidToday: false }, 0);
    expect(verdict.status).toBe('denied');
    expect(verdict.detail).toMatch(/canon/i);
  });

  it('con temporada paga y apto, la puerta dice que puede ingresar', () => {
    const member = readyMember();
    const first = enableMemberPoolAccess({ member, method: 'efectivo', today: TODAY });
    const later = evaluatePoolAccess(member, { today: '2026-12-20', accesses: first.accesses });
    expect(later.seasonPaid).toBe(true);
    expect(later.seasonAmountDue).toBe(0);
    const verdict = poolEntranceVerdict(member, later, 0);
    expect(verdict.status).toBe('granted');
    expect(verdict.title).toBe('PUEDE INGRESAR');
  });

  it('el invitado se cobra recién cuando el anfitrión ya entró, hasta tres', () => {
    const host = readyMember();
    expect(() => enableGuestPoolAccess({
      host,
      guestName: 'Luis',
      today: TODAY,
    })).toThrow(/habilit/i);
    const opened = enableMemberPoolAccess({ member: host, method: 'efectivo', today: TODAY });
    let accesses = opened.accesses;
    for (const name of ['Luis', 'Mora', 'Teo']) {
      const guest = enableGuestPoolAccess({
        host,
        guestName: name,
        accesses,
        method: 'efectivo',
        today: TODAY,
      });
      expect(guest.entry.kind).toBe('guest');
      expect(guest.entry.payment.amount).toBe(8000);
      expect(guest.entry.payment.concept).toMatch(/invitado/i);
      accesses = guest.accesses;
    }
    expect(() => enableGuestPoolAccess({
      host,
      guestName: 'Cuarto',
      accesses,
      today: TODAY,
    })).toThrow(/m[aá]ximo/i);
    expect(() => enableGuestPoolAccess({
      host,
      guestName: '   ',
      accesses,
      today: TODAY,
    })).toThrow(/nombre/i);
  });

  it('no se habilita dos veces el mismo día y un revocado no suma canon', () => {
    const member = readyMember();
    const first = enableMemberPoolAccess({ member, today: TODAY });
    expect(() => enableMemberPoolAccess({
      member,
      accesses: first.accesses,
      today: TODAY,
    })).toThrow(/hoy/i);
    const revoked = revokePoolAccess(first.accesses, first.entry.id);
    expect(poolDayStats(revoked, TODAY).collected).toBe(0);
    expect(poolDayStats(revoked, TODAY).members).toBe(0);
    const season = poolSeasonStats(revoked, TODAY);
    expect(season.revoked).toBe(1);
    expect(season.seasonCollected).toBe(0);
  });
});

describe('mostrador', () => {
  it('el día y la temporada cuentan socios, invitados y canon por separado', () => {
    const member = readyMember();
    const opened = enableMemberPoolAccess({ member, method: 'efectivo', today: TODAY });
    const guest = enableGuestPoolAccess({
      host: member,
      guestName: 'Luis',
      accesses: opened.accesses,
      method: 'debito',
      today: TODAY,
    });
    const day = poolDayStats(guest.accesses, TODAY);
    expect(day.members).toBe(1);
    expect(day.guests).toBe(1);
    expect(day.collected).toBe(98000);
    const season = poolSeasonStats(guest.accesses, TODAY);
    expect(season.live).toBe(true);
    expect(season.dayCollected).toBe(98000);
    expect(season.seasonCollected).toBe(98000);
    const report = poolAccessReportRows(guest.accesses, { scope: 'day', today: TODAY });
    expect(report.map((row) => row.kind).sort()).toEqual(['Invitado', 'Socio']);
    expect(report.find((row) => row.kind === 'Invitado').method).toBe('Débito');
    expect(poolCanonByDay(guest.accesses, { month: '2026-12' })).toEqual([
      expect.objectContaining({ date: TODAY, amount: 98000, source: 'pool' }),
    ]);
  });

  it('la búsqueda encuentra por apellido, DNI o número', () => {
    const ana = readyMember();
    const luis = readyMember({
      memberId: '456',
      name: 'Luis Gómez',
      documentNumber: '28999111',
    });
    expect(searchPoolMembers([ana, luis], 'gomez').map((row) => row.memberId)).toEqual(['456']);
    expect(searchPoolMembers([ana, luis], '28999111').map((row) => row.memberId)).toEqual(['456']);
    expect(searchPoolMembers([ana, luis], '123').map((row) => row.memberId)).toEqual(['123']);
    expect(searchPoolMembers([ana, luis], 'zzz')).toEqual([]);
  });

  it('la caja de pileta está abierta si hay sesión general o una nota de pileta', () => {
    const registers = [{ id: 'gen', name: 'Caja General', isActive: true }];
    expect(isPoolDayCashOpen([], registers)).toBe(false);
    expect(isPoolDayCashOpen([
      { status: 'open', cashRegisterId: 'gen' },
    ], registers)).toBe(true);
    expect(isPoolDayCashOpen([
      { status: 'closed', cashRegisterId: 'gen' },
    ], registers)).toBe(false);
    expect(isPoolDayCashOpen([
      { status: 'open', cashRegisterId: 'otra', notes: 'Abierta al habilitar pileta' },
    ], registers)).toBe(true);
  });

  it('sin asiento el círculo del canon no cierra', () => {
    const circle = verifyPoolCanonCircle({
      entry: { payment: { amount: 90000, method: 'efectivo' } },
      charged: { payment: { amount: 90000, method: 'efectivo' }, accountEntries: [] },
      method: 'efectivo',
    });
    expect(circle.ok).toBe(false);
    expect(circle.issues.join(' ')).toMatch(/asiento|caja|cuenta/i);
  });
});

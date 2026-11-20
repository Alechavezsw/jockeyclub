import { describe, it, expect } from 'vitest';
import {
  getMedicalStatus,
  attachPoolMedical,
  evaluatePoolAccess,
  poolSearchFlags,
  enableMemberPoolAccess,
  enableGuestPoolAccess,
  recordPoolAttendance,
  poolDayStats,
  searchPoolMembers,
  mergePoolSearchHits,
  memberPoolHistory,
  poolEntranceVerdict,
  poolCanonByDay,
  isPoolDayCashOpen,
} from './poolAccess.js';

const member = {
  memberId: '123',
  name: 'Ana Pérez',
  status: 'active',
};

describe('poolAccess', () => {
  it('detecta revisación faltante y vigente', () => {
    expect(getMedicalStatus(member).ok).toBe(false);
    const withMed = attachPoolMedical(member, {
      fileName: 'apto.pdf',
      uploadedAt: '2026-01-15T10:00:00.000Z',
      validityDays: 365,
    });
    const status = getMedicalStatus(withMed, { today: '2026-08-30' });
    expect(status.ok).toBe(true);
    expect(status.expiresAt).toBe('2027-01-15');
  });

  it('marca revisación con el número del talonario, sin archivo', () => {
    const withMed = attachPoolMedical(member, {
      talonario: '45821',
      uploadedAt: '2026-12-01T12:00:00.000Z',
      validityDays: 365,
      actorName: 'Caja pileta',
    });
    expect(withMed.meta.poolMedicalTalonario).toBe('45821');
    expect(withMed.meta.poolMedicalSource).toBe('talonario');
    const status = getMedicalStatus(withMed, { today: '2026-12-15' });
    expect(status.ok).toBe(true);
    expect(status.label).toMatch(/talón 45821/i);
    expect(status.doc.talonario).toBe('45821');
  });

  it('exige talonario o archivo', () => {
    expect(() => attachPoolMedical(member, {})).toThrow(/talonario|archivo/i);
  });

  it('habilita socio con médico, cobra temporada y registra invitado con tarifa aprobada', () => {
    const withMed = attachPoolMedical(member, { fileName: 'apto.pdf', uploadedAt: '2026-08-01T12:00:00.000Z' });
    const settings = { guestEnabled: true, guestTariffApproved: true, guestDayFee: 5000 };
    const eval_ = evaluatePoolAccess(withMed, { today: '2026-12-05', accesses: [], settings });
    expect(eval_.canEnable).toBe(true);
    expect(eval_.seasonAmountDue).toBe(90000);

    const { entry, accesses } = enableMemberPoolAccess({
      member: withMed,
      accesses: [],
      method: 'efectivo',
      today: '2026-12-05',
      settings,
    });
    expect(entry.kind).toBe('member');
    expect(entry.payment.method).toBe('efectivo');
    expect(entry.payment.amount).toBe(90000);
    expect(entry.payment.scope).toBe('season');

    const again = evaluatePoolAccess(withMed, { today: '2026-12-20', accesses, settings });
    expect(again.seasonPaid).toBe(true);
    expect(again.seasonAmountDue).toBe(0);

    const guest = enableGuestPoolAccess({
      host: withMed,
      guestName: 'Juan Invitado',
      accesses,
      method: 'mercadopago',
      today: '2026-12-05',
      settings,
    });
    expect(guest.entry.kind).toBe('guest');
    expect(poolDayStats(guest.accesses, '2026-12-05').total).toBe(2);
  });

  it('bloquea invitados si la tarifa no está aprobada', () => {
    const withMed = attachPoolMedical(member, { fileName: 'apto.pdf', uploadedAt: '2026-08-01T12:00:00.000Z' });
    const settings = { guestEnabled: true, guestTariffApproved: false };
    const { entry, accesses } = enableMemberPoolAccess({
      member: withMed,
      accesses: [],
      method: 'efectivo',
      today: '2026-12-05',
      settings,
    });
    expect(entry.payment.scope).toBe('season');

    expect(() => enableGuestPoolAccess({
      host: withMed,
      guestName: 'Juan',
      accesses,
      method: 'efectivo',
      today: '2026-12-05',
      settings,
    })).toThrow(/tarifa.*pendiente|tariff|aprobad|deshabilitado/i);
  });

  it('da veredicto de entrada según canon y apto', () => {
    const socio = { memberId: '1', name: 'Ana', status: 'active' };
    expect(poolEntranceVerdict(socio, { alreadyIn: true, paidToday: true }).title).toBe('ASISTIÓ');
    expect(poolEntranceVerdict(socio, {
      alreadyIn: false,
      paidToday: false,
      blockers: ['Sin revisación médica'],
    }).title).toBe('NO INGRESA');
  });

  it('busca socio por nombre, DNI o número', () => {
    const list = [
      { memberId: '10192', name: 'Oscar Fabian Mercado', documentNumber: '22159037' },
      { memberId: '5158', name: 'Martha Zapata', documentNumber: '17554932' },
      { memberId: '88', name: 'Luis Gómez', lastName: 'Gómez', documentNumber: '30111222' },
    ];
    expect(searchPoolMembers(list, 'mercado')).toHaveLength(1);
    expect(searchPoolMembers(list, '10192')[0].name).toMatch(/Oscar/);
    expect(searchPoolMembers(list, '17.554.932')[0].memberId).toBe('5158');
    expect(searchPoolMembers(list, 'gomez')[0].memberId).toBe('88');
    expect(searchPoolMembers(list, '30.111.222')[0].name).toMatch(/Luis/);
    expect(searchPoolMembers(list, 'mercado oscar')[0].memberId).toBe('10192');
    expect(searchPoolMembers(list, 'fab merc')[0].memberId).toBe('10192');
  });

  it('encuentra el nombre aunque el apellido vaya primero', () => {
    const list = [
      { memberId: '10485', name: 'Lucrecia Del Valle Aracena Bordonaro', status: 'active' },
      { memberId: '2', name: 'Lucrecia Pérez', status: 'active' },
    ];
    const hits = searchPoolMembers(list, 'Aracena Bordonaro Lucrecia Del Vall');
    expect(hits[0].memberId).toBe('10485');
    expect(hits.some((member) => member.memberId === '2')).toBe(false);
  });

  it('mezcla hits locales y remotos sin repetir socio', () => {
    const local = [{ memberId: '11268', name: 'Jose Pedro Bonilla' }];
    const remote = [
      { memberId: '11268', name: 'Jose Pedro Bonilla' },
      { memberId: '10146', name: 'Cristian Sergio Bonilla' },
    ];
    const merged = mergePoolSearchHits(local, remote);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.memberId)).toEqual(['11268', '10146']);
  });

  it('lista el historial de pileta del socio', () => {
    const history = memberPoolHistory([
      { id: 'a', memberId: '10192', date: '2026-09-10' },
      { id: 'b', memberId: '9', date: '2026-09-11' },
      { id: 'c', memberId: '10192', date: '2026-09-12' },
    ], '10192');
    expect(history.map((r) => r.id)).toEqual(['c', 'a']);
  });

  it('anota asistencia sin validación si se pide skip', () => {
    // With validateEntry=false, attendance is recorded without checking requirements
    const { entry, accesses } = recordPoolAttendance({
      member,
      accesses: [],
      today: '2026-09-12',
      validateEntry: false, // Skip validation for admin override
    });
    expect(entry.source).toBe('attendance');
    expect(entry.payment.amount).toBe(0);
    expect(entry.payment.scope).toBe('attendance');
    const snap = evaluatePoolAccess(member, { accesses, today: '2026-09-12' });
    expect(snap.alreadyIn).toBe(true);
    // $0 attendance does NOT count as a paid pass
    expect(snap.paidToday).toBe(false);
    expect(snap.seasonPaid).toBe(false);
    expect(poolDayStats(accesses, '2026-09-12').members).toBe(1);
    expect(poolDayStats(accesses, '2026-09-12').collected).toBe(0);
    expect(() => recordPoolAttendance({ member, accesses, today: '2026-09-12', validateEntry: false }))
      .toThrow(/ya está anotado/i);
  });

  it('con validateEntry=true, bloquea asistencia sin apto médico', () => {
    // With full validation, member without medical clearance cannot enter
    expect(() => recordPoolAttendance({
      member,
      accesses: [],
      today: '2026-09-12',
      validateEntry: true,
    })).toThrow(/médic/i);
  });

  it('$0 attendance no cuenta como pago de temporada', () => {
    // This is the critical test: free attendance does NOT grant season rights
    const attendanceAccess = [{
      id: 'att-1',
      date: '2026-12-05',
      kind: 'member',
      memberId: member.memberId,
      payment: { amount: 0, method: 'asistencia', scope: 'attendance' },
      source: 'attendance',
      status: 'active',
    }];
    const snap = evaluatePoolAccess(member, { accesses: attendanceAccess, today: '2026-12-05' });
    expect(snap.alreadyIn).toBe(true);
    expect(snap.paidToday).toBe(false);
    expect(snap.seasonPaid).toBe(false);
  });

  it('después del 10, con mora, no cobra pileta hasta regularizar', () => {
    const debtor = {
      ...attachPoolMedical(member, { fileName: 'apto.pdf', uploadedAt: '2026-09-01T12:00:00.000Z' }),
      tier: 'socio_familiar',
      outstandingBalance: 70000,
      nextDueDate: '2026-10-10',
    };
    const snap = evaluatePoolAccess(debtor, { today: '2026-10-14', accesses: [] });
    expect(snap.payBlocked).toBe(true);
    expect(snap.canEnable).toBe(false);
    expect(() => enableMemberPoolAccess({ member: debtor, accesses: [], today: '2026-10-14' }))
      .toThrow(/mora/i);
    const flags = poolSearchFlags(snap, 70000, (n) => `$${n}`).map((f) => f.label);
    expect(flags[0]).toMatch(/mora/i);
    expect(flags.join(' ')).not.toMatch(/canon impago/i);
  });

  it('en temporada no habilita ni anota si debe la cuota del mes', () => {
    const debtor = {
      ...attachPoolMedical(member, { fileName: 'apto.pdf', uploadedAt: '2026-11-01T12:00:00.000Z' }),
      tier: 'socio_familiar',
      outstandingBalance: 70000,
      nextDueDate: '2026-12-10',
    };
    const snap = evaluatePoolAccess(debtor, { today: '2026-12-12', accesses: [] });
    expect(snap.duesBlocked).toBe(true);
    expect(snap.canEnable).toBe(false);
    expect(() => enableMemberPoolAccess({ member: debtor, accesses: [], today: '2026-12-12' }))
      .toThrow(/mora/i);
    expect(() => recordPoolAttendance({ member: debtor, accesses: [], today: '2026-12-12' }))
      .toThrow(/mora/i);
  });

  it('bloquea invitado si el titular no está habilitado (con tarifa aprobada)', () => {
    // Even with guest tariff approved, if host doesn't have a season pass, block guests
    const settings = { guestEnabled: true, guestTariffApproved: true, guestDayFee: 5000 };
    expect(() => enableGuestPoolAccess({
      host: member, // No season pass paid
      guestName: 'X',
      accesses: [],
      today: '2026-08-30',
      settings,
    })).toThrow(/titular/i);
  });

  it('bloquea invitado si la tarifa no fue aprobada', () => {
    // Even with valid host, unapproved guest tariff blocks guests
    const settings = { guestEnabled: true, guestTariffApproved: false };
    const withMed = attachPoolMedical(member, { fileName: 'apto.pdf', uploadedAt: '2026-08-01T12:00:00.000Z' });
    // Create a season pass
    const { accesses } = enableMemberPoolAccess({
      member: withMed,
      accesses: [],
      method: 'efectivo',
      today: '2026-08-20',
      settings,
    });
    expect(() => enableGuestPoolAccess({
      host: withMed,
      guestName: 'X',
      accesses,
      today: '2026-08-20',
      settings,
    })).toThrow(/deshabilitado|tarifa|pendiente/i);
  });

  it('junta el canon de pileta en un solo renglón por día', () => {
    const rows = poolCanonByDay([
      { date: '2026-09-30', status: 'active', payment: { amount: 8000 } },
      { date: '2026-09-30', status: 'active', payment: { amount: 4000 } },
      { date: '2026-09-29', status: 'active', payment: { amount: 8000 } },
      { date: '2026-09-30', status: 'revoked', payment: { amount: 8000 } },
      { date: '2026-08-30', status: 'active', payment: { amount: 8000 } },
    ], { month: '2026-09' });
    expect(rows).toEqual([
      { id: 'pool-canon-2026-09-30', date: '2026-09-30', label: 'Canon pileta · 2 ingresos', amount: 12000, source: 'pool' },
      { id: 'pool-canon-2026-09-29', date: '2026-09-29', label: 'Canon pileta · 1 ingreso', amount: 8000, source: 'pool' },
    ]);
  });

  it('la caja del día está abierta si hay sesión de Caja General', () => {
    expect(isPoolDayCashOpen(
      [{ status: 'open', cashRegisterId: 'caja-gen' }],
      [{ id: 'caja-gen', name: 'Caja General Secretaría', isActive: true }],
    )).toBe(true);
    expect(isPoolDayCashOpen(
      [{ status: 'closed', cashRegisterId: 'caja-gen', notes: 'Abierta al habilitar pileta' }],
      [{ id: 'caja-gen', name: 'Caja General Secretaría', isActive: true }],
    )).toBe(false);
  });
});

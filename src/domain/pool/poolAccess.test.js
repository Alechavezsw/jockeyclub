import { describe, it, expect } from 'vitest';
import {
  getMedicalStatus,
  attachPoolMedical,
  evaluatePoolAccess,
  enableMemberPoolAccess,
  enableGuestPoolAccess,
  recordPoolAttendance,
  poolDayStats,
  searchPoolMembers,
  mergePoolSearchHits,
  memberPoolHistory,
  poolEntranceVerdict,
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

  it('habilita socio con médico y registra invitado', () => {
    const withMed = attachPoolMedical(member, { fileName: 'apto.pdf', uploadedAt: '2026-08-01T12:00:00.000Z' });
    const eval_ = evaluatePoolAccess(withMed, { today: '2026-08-30', accesses: [] });
    expect(eval_.canEnable).toBe(true);

    const { entry, accesses } = enableMemberPoolAccess({
      member: withMed,
      accesses: [],
      method: 'efectivo',
      today: '2026-08-30',
    });
    expect(entry.kind).toBe('member');
    expect(entry.payment.method).toBe('efectivo');

    const guest = enableGuestPoolAccess({
      host: withMed,
      guestName: 'Juan Invitado',
      accesses,
      method: 'mercadopago',
      today: '2026-08-30',
    });
    expect(guest.entry.kind).toBe('guest');
    expect(poolDayStats(guest.accesses, '2026-08-30').total).toBe(2);
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

  it('anota asistencia sin apto y la suma a ingresos del día', () => {
    const { entry, accesses } = recordPoolAttendance({
      member,
      accesses: [],
      today: '2026-09-12',
    });
    expect(entry.source).toBe('attendance');
    expect(entry.payment.amount).toBe(0);
    const snap = evaluatePoolAccess(member, { accesses, today: '2026-09-12' });
    expect(snap.alreadyIn).toBe(true);
    expect(snap.paidToday).toBe(false);
    expect(poolDayStats(accesses, '2026-09-12').members).toBe(1);
    expect(poolDayStats(accesses, '2026-09-12').collected).toBe(0);
    expect(() => recordPoolAttendance({ member, accesses, today: '2026-09-12' }))
      .toThrow(/ya está anotado/i);
  });

  it('bloquea invitado si el titular no está habilitado', () => {
    expect(() => enableGuestPoolAccess({
      host: member,
      guestName: 'X',
      accesses: [],
      today: '2026-08-30',
    })).toThrow(/titular/i);
  });
});

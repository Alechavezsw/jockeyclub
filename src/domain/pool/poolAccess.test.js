import { describe, it, expect } from 'vitest';
import {
  getMedicalStatus,
  attachPoolMedical,
  evaluatePoolAccess,
  enableMemberPoolAccess,
  enableGuestPoolAccess,
  poolDayStats,
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

  it('bloquea invitado si el titular no está habilitado', () => {
    expect(() => enableGuestPoolAccess({
      host: member,
      guestName: 'X',
      accesses: [],
      today: '2026-08-30',
    })).toThrow(/titular/i);
  });
});

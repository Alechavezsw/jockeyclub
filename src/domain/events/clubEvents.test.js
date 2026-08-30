import { describe, it, expect } from 'vitest';
import {
  evaluateEventRegistration,
  enableMemberEventAccess,
  enableGuestEventAccess,
  countRegistrations,
  eventOpsStats,
} from './clubEvents.js';

const event = {
  id: 'evt-1',
  title: 'Fiesta de prueba',
  ticketPrice: 10000,
  capacity: 10,
  status: 'published',
  incomeAccountId: 'coa-4.1.03',
};

const member = { memberId: '123', name: 'Ana Pérez', status: 'active' };
const chart = [
  { id: 'coa-1.1.01', code: '1.1.01', name: 'Caja General' },
  { id: 'coa-1.1.03', code: '1.1.03', name: 'Banco Nación' },
  { id: 'coa-4.1.03', code: '4.1.03', name: 'Eventos y Fiestas' },
];

describe('clubEvents ops', () => {
  it('habilita socio con pago y luego invitado', () => {
    const eval_ = evaluateEventRegistration(member, event, { registrations: [] });
    expect(eval_.canEnable).toBe(true);

    const { registration, journalEntry } = enableMemberEventAccess({
      event,
      member,
      registrations: [],
      paymentMethod: 'efectivo',
      chart,
    });
    expect(registration.kind).toBe('member');
    expect(registration.paymentMethod).toBe('efectivo');
    expect(journalEntry).toBeTruthy();

    const regs = [registration];
    const guest = enableGuestEventAccess({
      event,
      host: member,
      guestName: 'Juan',
      registrations: regs,
      paymentMethod: 'mercadopago',
      chart,
    });
    expect(guest.registration.kind).toBe('guest');
    expect(countRegistrations([registration, guest.registration], event.id)).toBe(2);
    expect(eventOpsStats([event], [registration, guest.registration]).collected).toBe(20000);
  });

  it('bloquea invitado sin titular', () => {
    expect(() => enableGuestEventAccess({
      event,
      host: member,
      guestName: 'X',
      registrations: [],
      chart,
    })).toThrow(/titular/i);
  });
});

import { describe, it, expect } from 'vitest';
import {
  evaluateEventRegistration,
  enableMemberEventAccess,
  enableGuestEventAccess,
  countRegistrations,
  eventOpsStats,
  buildEventDashboard,
  withoutDemoEventData,
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

  it('arma series de cupo, mix y cobros para los gráficos', () => {
    const gala = { ...event, id: 'evt-1', capacity: 10, ticketPrice: 10000 };
    const after = { id: 'evt-2', title: 'After', capacity: 20, ticketPrice: 0, status: 'published' };
    const regs = [
      { id: 'a', eventId: 'evt-1', kind: 'member', amountPaid: 10000, paymentMethod: 'efectivo', status: 'active', guestsCount: 1 },
      { id: 'b', eventId: 'evt-1', kind: 'guest', amountPaid: 10000, paymentMethod: 'mercadopago', status: 'active', guestsCount: 1 },
      { id: 'c', eventId: 'evt-2', kind: 'member', amountPaid: 0, paymentMethod: null, status: 'active', guestsCount: 1 },
      { id: 'd', eventId: 'evt-1', kind: 'member', amountPaid: 10000, paymentMethod: 'efectivo', status: 'revoked', guestsCount: 1 },
    ];
    const dash = buildEventDashboard([gala, after], regs);
    expect(dash.ops.members).toBe(2);
    expect(dash.ops.guests).toBe(1);
    expect(dash.ops.collected).toBe(20000);
    expect(dash.byEvent[0].used).toBe(2);
    expect(dash.byEvent[0].occupancyPct).toBe(20);
    expect(dash.byEvent[1].occupancyPct).toBe(5);
    expect(dash.payments.efectivo).toBe(10000);
    expect(dash.payments.mercadopago).toBe(10000);
    expect(dash.payments.complimentary).toBe(1);
    expect(dash.mix.memberPct).toBe(67);
    expect(dash.maxCollected).toBe(20000);
  });

  it('saca eventos e inscripciones de muestra', () => {
    const cleaned = withoutDemoEventData(
      [
        { id: 'evt-1', title: 'Cena de Gala Socios Royal & Platinum' },
        { id: 'evt-real', title: 'Copa de polo' },
      ],
      [
        { id: 'ereg-d1', eventId: 'evt-1' },
        { id: 'ereg-live', eventId: 'evt-real' },
      ],
    );
    expect(cleaned.events.map((e) => e.id)).toEqual(['evt-real']);
    expect(cleaned.registrations.map((r) => r.id)).toEqual(['ereg-live']);
  });
});

import { describe, it, expect } from 'vitest';
import { FACILITIES, getFacilityById } from './facilities.js';
import { buildFacilityCatalog } from './facilityConfig.js';
import {
  validateMemberBooking,
  guestCap,
  facilityTurns,
  facilityOffersPaymentButton,
  reservationTotalPrice,
  reservationDepositAmount,
  reservationBalanceAfterDeposit,
  reservationCollectedAmount,
  reservationOpenBalance,
  RESERVATION_DEPOSIT_RATE,
} from './bookingRules.js';

const catalog = buildFacilityCatalog(FACILITIES);
const anhelo = getFacilityById('salon_anhelo', catalog);
const bustos = getFacilityById('salon_bustos', catalog);
const maurin = getFacilityById('salon_maurin', catalog);
const refugio = getFacilityById('salon_refugio', catalog);
const verde = getFacilityById('espacio_verde', catalog);
const now = new Date(2026, 8, 29, 9, 0, 0);

describe('turnos de Lila', () => {
  it('los salones tienen día y noche, y Espacio Verde una jornada', () => {
    expect(facilityTurns(anhelo).map((t) => `${t.time}-${t.endTime}`)).toEqual(['11:00-18:00', '20:00-23:59']);
    expect(facilityTurns(bustos).map((t) => t.endTime)).toEqual(['17:00', '23:59']);
    expect(facilityTurns(maurin)[0].endTime).toBe('17:00');
    expect(facilityTurns(refugio)).toHaveLength(2);
    expect(facilityTurns(verde)).toEqual([{ time: '00:00', endTime: '23:59', label: 'Libre', openDay: true }]);
    expect(catalog.some((f) => f.id === 'salon_eventos')).toBe(false);
  });

  it('Anhelo nace pendiente y el resto aprobada; Refugio está disponible', () => {
    expect(anhelo.rules.createStatus).toBe('pending');
    expect(bustos.rules.createStatus).toBe('approved');
    expect(verde.rules.createStatus).toBe('approved');
    expect(refugio.status).toBe('disponible');
    expect(bustos.rules.limitOneApproved).toBe(true);
    expect(maurin.rules.limitOneApproved).toBe(true);
    expect(anhelo.rules.limitOneApproved).toBe(false);
  });

  it('topes de invitados y anticipación', () => {
    expect(guestCap(bustos)).toBe(60);
    expect(guestCap(maurin)).toBe(40);
    expect(guestCap(anhelo)).toBe(60);
    expect(guestCap(verde)).toBe(20);
    expect(anhelo.rules.hoursPrior).toBe(12);
    expect(verde.rules.hoursPrior).toBe(0);
    expect(anhelo.rules.advanceDays).toBe(90);
    expect(facilityOffersPaymentButton(anhelo)).toBe(true);
    expect(facilityOffersPaymentButton(verde)).toBe(true);
    expect(facilityOffersPaymentButton(bustos)).toBe(true);
    expect(facilityOffersPaymentButton(maurin)).toBe(true);
  });
});

describe('validateMemberBooking', () => {
  const member = { memberId: '100', tier: 'socio_individual' };

  it('acepta el turno de día de Anhelo y lo deja pendiente', () => {
    const result = validateMemberBooking({
      facility: anhelo,
      member,
      date: '2026-10-11',
      time: '11:00',
      now,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('pending');
    expect(result.turn.endTime).toBe('18:00');
  });

  it('no ofrece el turno de las 14', () => {
    const result = validateMemberBooking({
      facility: anhelo,
      member,
      date: '2026-10-11',
      time: '14:00',
      now,
    });
    expect(result.ok).toBe(false);
  });

  it('pide 12 horas de anticipación en salón', () => {
    const result = validateMemberBooking({
      facility: anhelo,
      member,
      date: '2026-09-29',
      time: '11:00',
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/12 horas/);
  });

  it('no deja pasar de 90 días', () => {
    const result = validateMemberBooking({
      facility: verde,
      member,
      date: '2027-01-15',
      time: '11:00',
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/90 días/);
  });

  it('Espacio Verde solo para las categorías habilitadas en Lila', () => {
    const blocked = validateMemberBooking({
      facility: verde,
      member: { memberId: '100', tier: 'grupo_familiar_familiar' },
      date: '2026-10-11',
      time: '00:00',
      now,
    });
    expect(blocked.ok).toBe(false);
    const allowed = validateMemberBooking({
      facility: verde,
      member,
      date: '2026-10-11',
      time: '00:00',
      now,
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.status).toBe('confirmed');
  });

  it('Maurin y Bustos admiten una sola reserva vigente por socio', () => {
    const result = validateMemberBooking({
      facility: maurin,
      member,
      reservations: [{
        memberId: '100',
        facilityId: 'salon_maurin',
        date: '2026-11-07',
        time: '20:00',
        status: 'confirmed',
      }],
      date: '2026-11-28',
      time: '11:00',
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/vigente/);
  });

  it('un adherente no reserva: lo hace el titular', () => {
    const result = validateMemberBooking({
      facility: anhelo,
      member: { memberId: '3501', familyPrincipalNumber: '10009', tier: 'grupo_familiar_familiar' },
      date: '2026-10-11',
      time: '11:00',
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/titular/i);
  });

  it('un turno rechazado no ocupa el horario', () => {
    const result = validateMemberBooking({
      facility: verde,
      member,
      reservations: [{
        facilityId: 'espacio_verde',
        date: '2026-10-11',
        time: '00:00',
        endTime: '23:59',
        status: 'rejected',
      }],
      date: '2026-10-11',
      time: '00:00',
      now,
    });
    expect(result.ok).toBe(true);
  });

  it('Espacio Verde se reserva hoy aunque ya haya pasado el mediodía', () => {
    const afternoon = new Date(2026, 10, 6, 16, 3, 0);
    const result = validateMemberBooking({
      facility: verde,
      member,
      date: '2026-11-06',
      time: '00:00',
      now: afternoon,
      asAdmin: true,
    });
    expect(result.ok).toBe(true);
    expect(result.turn.label).toBe('Libre');
  });
});

describe('seña 50 % de la reserva', () => {
  it('siempre es la mitad del total, aparte de la cuota', () => {
    expect(RESERVATION_DEPOSIT_RATE).toBe(0.5);
    expect(reservationTotalPrice(verde)).toBe(62000);
    expect(reservationDepositAmount(verde)).toBe(31000);
    expect(reservationBalanceAfterDeposit(verde)).toBe(31000);
    expect(reservationDepositAmount(100001)).toBe(50001);
    expect(reservationBalanceAfterDeposit(100001)).toBe(50000);
    expect(reservationDepositAmount({ estimatedPrice: 80000 })).toBe(0);
    expect(reservationDepositAmount(null, { estimatedPrice: 80000 })).toBe(40000);
  });

  it('el saldo abierto es el resto después de la seña', () => {
    const reservation = {
      estimatedPrice: 130000,
      depositAmount: 65000,
      paymentMethod: 'mercadopago',
    };
    expect(reservationCollectedAmount(reservation)).toBe(65000);
    expect(reservationOpenBalance(reservation)).toBe(65000);
    expect(reservationOpenBalance({
      ...reservation,
      chargedPrice: 130000,
    })).toBe(0);
  });
});

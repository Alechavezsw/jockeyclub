import { describe, expect, it } from 'vitest';
import {
  applyEventImputation,
  buildEventImputationEntry,
  findFacilityForReservation,
  isReservationImputed,
  pendingEventReservations,
  reservationChargeAmount,
  revertEventImputation,
} from './eventImputation';

describe('eventImputation', () => {
  it('usa el precio del salón cuando la reserva no trae monto', () => {
    const r = { memberId: '13028', memberName: 'Myriam', facilityName: 'Salón Maurin', date: '2026-08-30' };
    expect(findFacilityForReservation(r)?.id).toBe('salon_maurin');
    expect(reservationChargeAmount(r)).toBe(130000);
    const entry = buildEventImputationEntry(r);
    expect(entry.type).toBe('otro');
    expect(entry.value).toBe(130000);
    expect(entry.memberNumber).toBe('13028');
    expect(entry.description).toMatch(/Maurin/);
  });

  it('respeta estimatedPrice de la reserva viva', () => {
    expect(reservationChargeAmount({
      memberId: '1',
      facilityId: 'salon_bustos',
      estimatedPrice: 99000,
    })).toBe(99000);
  });

  it('respeta el monto propio de la reserva', () => {
    expect(reservationChargeAmount({
      memberId: '1',
      facilityId: 'salon_bustos',
      amount: 99000,
    })).toBe(99000);
  });

  it('exige socio e importe', () => {
    expect(() => buildEventImputationEntry({ facilityName: 'Salón Maurin' })).toThrow(/socio/);
    expect(() => buildEventImputationEntry({ memberId: '1', facilityName: 'Cancha inventada' })).toThrow(/importe/);
  });

  it('saca canceladas e imputadas de la cola', () => {
    const rows = pendingEventReservations([
      { id: '1', facilityId: 'salon_maurin', status: 'confirmed', estimatedPrice: 130000 },
      { id: '2', facilityId: 'salon_maurin', status: 'cancelled', estimatedPrice: 130000 },
      { id: '2b', facilityId: 'salon_maurin', status: 'rejected', estimatedPrice: 130000 },
      { id: '3', facilityId: 'salon_maurin', status: 'confirmed', imputed: true, chargedPrice: 130000 },
      { id: '4', facilityId: 'tenis_trad', status: 'confirmed', estimatedPrice: 8000 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['1']);
  });

  it('imputa al padrón, deja asiento y se puede revertir', () => {
    const members = [{
      memberId: '4240955017912629',
      name: 'Alejandro',
      documentNumber: '31888184',
      outstandingBalance: 1000,
    }];
    const reservation = {
      id: 'res-1',
      memberId: '31888184',
      memberName: 'Alejandro',
      facilityName: 'Salón Anhelo',
      date: '2026-10-20',
      status: 'confirmed',
      estimatedPrice: 170000,
    };
    const applied = applyEventImputation(reservation, members);
    expect(applied.member.outstandingBalance).toBe(1000);
    expect(applied.entry.value).toBe(170000);
    expect(applied.reservation.imputed).toBe(true);
    expect(applied.reservation.chargedPrice).toBe(170000);
    expect(applied.journal.lines[0].account).toBe('Cuentas a Cobrar');
    expect(isReservationImputed(applied.reservation)).toBe(true);

    const reverted = revertEventImputation(applied.reservation, [applied.member]);
    expect(reverted.member.outstandingBalance).toBe(1000);
    expect(reverted.reservation.imputed).toBe(false);
    expect(reverted.reservation.chargedPrice).toBe(0);
  });
});

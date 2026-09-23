import { describe, expect, it } from 'vitest';
import {
  buildEventImputationEntry,
  findFacilityForReservation,
  reservationChargeAmount,
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
});

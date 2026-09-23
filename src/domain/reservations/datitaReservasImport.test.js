import { describe, expect, it } from 'vitest';
import {
  aoaToReservations,
  datitaRowToReservation,
  mapPaymentMethod,
  mapReservaStatus,
  mapSpaceToFacility,
  parseSpanishDate,
  summarizeReservations,
} from './datitaReservasImport.js';

describe('datitaReservasImport', () => {
  it('parsea fechas en español', () => {
    expect(parseSpanishDate('30 de Agosto del 2026')).toBe('2026-08-30');
    expect(parseSpanishDate('29 de Agosto del 2026 a las 17:50', { withTime: true }))
      .toBe('2026-08-29T17:50:00');
  });

  it('mapea espacios a facilityId', () => {
    expect(mapSpaceToFacility('SALON ANHELO')?.facilityId).toBe('salon_anhelo');
    expect(mapSpaceToFacility('ESPACIO VERDE')?.facilityId).toBe('espacio_verde');
    expect(mapSpaceToFacility('Mi Socio')).toBeNull();
  });

  it('mapea estado y pago', () => {
    expect(mapReservaStatus('Aprobado')).toBe('confirmed');
    expect(mapReservaStatus('Cancelado')).toBe('cancelled');
    expect(mapPaymentMethod('Pago por transferencia')).toBe('transferencia');
    expect(mapPaymentMethod('No definido')).toBeNull();
  });

  it('convierte fila del export', () => {
    const r = datitaRowToReservation({
      '#': '27126',
      'NRO DE SOCIO': '9001',
      NOMBRE: 'Julián Andrés',
      APELLIDO: 'MuÑoz',
      'DOCUMENTO DEL RESPONSABLE': 'Arg-DNI 30000111',
      ESPACIO: 'ESPACIO VERDE',
      'CREADO EL': '29 de Agosto del 2026 a las 17:50',
      'FECHA DE LA RESERVA': '30 de Agosto del 2026',
      'HORA INICIO': '11:00',
      'HORA FIN': '23:00',
      ESTADO: 'Aprobado',
      INVITADOS: '0.00',
      'PRECIO ESTIMADO': '62000',
      'FORMA DE PAGO': 'No definido',
      'PRECIO IMPUTADO': '0',
    });
    expect(r).toMatchObject({
      id: 'datita-res-27126',
      facilityId: 'espacio_verde',
      memberId: '9001',
      memberName: 'Julián Andrés MuÑoz',
      date: '2026-08-30',
      time: '11:00',
      endTime: '23:00',
      status: 'confirmed',
      estimatedPrice: 62000,
      chargedPrice: 0,
      source: 'datita',
    });
  });

  it('parsea AOA con cabecera debajo de títulos', () => {
    const aoa = [
      ['', 'Generado el …'],
      ['', 'Espacios de Eventos: …'],
      [
        '#', 'NRO DE SOCIO', 'NOMBRE', 'APELLIDO', 'DOCUMENTO DEL RESPONSABLE',
        'ESPACIO', 'CREADO EL', 'FECHA DE LA RESERVA', 'HORA INICIO', 'HORA FIN',
        'ESTADO', 'INVITADOS', 'PRECIO ESTIMADO', 'FORMA DE PAGO', 'PRECIO IMPUTADO',
        'VOUCHER', 'NUMERO DE TRANSACCION MP', 'NOMBRE ASISTE', 'APELLIDO ASISTE',
        'IDENTIFICADOR EXTERNO',
      ],
      [
        '26896', '9002', 'Laura Beatriz', 'Gómez', 'Arg-DNI 28000222',
        'SALON MAURIN', '22 de Agosto del 2026 a las 19:46', '30 de Agosto del 2026',
        '11:00', '17:00', 'Aprobado', '0.00', '130000', 'No definido', '130000',
        '', '', '', '', '',
      ],
      [
        '25744', '9003', 'Roberto Luis', 'Fernández', 'Arg-DNI 18000333',
        'SALON MAURIN', '16 de Julio del 2026 a las 19:28', '29 de Agosto del 2026',
        '20:00', '23:59', 'Cancelado', '0.00', '130000', 'No definido', '0',
        '', '', '', '', '',
      ],
    ];
    const { reservations, skipped } = aoaToReservations(aoa);
    expect(skipped).toBe(0);
    expect(reservations).toHaveLength(2);
    expect(reservations[0].facilityId).toBe('salon_maurin');
    expect(summarizeReservations(reservations)).toMatchObject({
      total: 2,
      byStatus: { confirmed: 1, cancelled: 1 },
    });
  });
});

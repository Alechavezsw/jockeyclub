import { describe, expect, it } from 'vitest';
import {
  buildLibreDeudaCertificate,
  buildLibreDeudaLetter,
  findMemberForLibreDeuda,
  formatLibreDeudaMemberNumber,
  formatLibreDeudaPlaceDate,
  lastPaidLiquidationPeriod,
} from './libreDeuda';

describe('libreDeuda', () => {
  it('rellena el número de socio como LILA', () => {
    expect(formatLibreDeudaMemberNumber('1')).toBe('00001');
    expect(formatLibreDeudaMemberNumber('01000')).toBe('01000');
  });

  it('escribe la fecha de lugar como LILA', () => {
    expect(formatLibreDeudaPlaceDate('2026-09-26')).toBe('a los 26 dias del mes de Septiembre de 2026 .');
  });

  it('encuentra socio por nro o por ficha', () => {
    const members = [
      { memberId: '45', name: 'Ezequias Ivan Pereyra' },
      { memberId: '1000', name: 'Martina Villegas Sanchez' },
    ];
    expect(findMemberForLibreDeuda(members, '00045 - Ezequias').name).toMatch(/Pereyra/);
    expect(findMemberForLibreDeuda(members, 'Martina').memberId).toBe('1000');
  });

  it('toma la última liquidación paga del detalle o de cobranzas', () => {
    expect(lastPaidLiquidationPeriod('45', '2026-09-26', {
      detailed: {
        lines: [
          { periodKey: '2025-11', paid: 1000, feeDate: '2025-11-10' },
          { periodKey: '2025-12', paid: 1000, feeDate: '2025-12-10' },
          { periodKey: '2026-01', paid: 0, owed: 1000, feeDate: '2026-01-10' },
        ],
      },
      monthly: { months: [] },
      cobranzas: [],
    })).toBe('2025-12');

    expect(lastPaidLiquidationPeriod('1', '2026-09-26', {
      detailed: { lines: [] },
      monthly: { months: [] },
      cobranzas: [
        { memberNumber: '1', date: '2026-09-04', concept: 'Cuota Septiembre del 2026' },
      ],
    })).toBe('2026-09');
  });

  it('arma el cuerpo legal tal cual LILA', () => {
    const cert = buildLibreDeudaCertificate(
      { memberId: '1', name: 'Jonas David Castañeda Rodríguez', documentNumber: '50573357' },
      { asOf: '2026-09-26', issuedAt: new Date('2026-09-26T12:08:00-03:00') }
    );
    const letter = buildLibreDeudaLetter(cert);
    expect(letter.headingMember).toBe('SOCIO 00001');
    expect(letter.paragraphs[0]).toBe('Estimado/a Jonas David Castañeda Rodríguez, DNI 50573357:');
    expect(letter.paragraphs[2]).toBe('CERTIFICO:');
    expect(letter.paragraphs.some((p) => p.includes('no posee saldos pendientes de pago'))).toBe(true);
    expect(letter.paragraphs.some((p) => p.includes('a los 26 dias del mes de Septiembre de 2026 .'))).toBe(true);
    expect(letter.note).toMatch(/información registrada en Accessin/);
  });
});

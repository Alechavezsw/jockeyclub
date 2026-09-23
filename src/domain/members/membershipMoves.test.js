import { describe, expect, it } from 'vitest';
import {
  classifyBajaMotivo,
  decorateBaja,
  parseArDate,
  summarizeBajas,
  uniqueBajas,
} from './membershipMoves';

describe('membershipMoves', () => {
  it('colorea los motivos de baja', () => {
    expect(classifyBajaMotivo('LICENCIA 1 AÑO - CON NOTA FECHA 03/8/26').id).toBe('licencia');
    expect(classifyBajaMotivo('Baja x mora - fecha 10/9/26').id).toBe('mora');
    expect(classifyBajaMotivo('Baja x duplicado- fecha 20/8/26').id).toBe('duplicado');
    expect(classifyBajaMotivo('BAJA CON NOTA AUTORIZADA 11/8/26').id).toBe('renuncia');
    expect(classifyBajaMotivo('Baja x cumplir la mayoría de edad (26 años)').id).toBe('mayoria');
    expect(classifyBajaMotivo('BAJA POR PERTENECER AL G-F DE 9379').id).toBe('grupo');
    expect(classifyBajaMotivo('Baja Familiar').id).toBe('grupo');
    expect(classifyBajaMotivo('Baja Familiar por Mora').id).toBe('mora');
    expect(classifyBajaMotivo('Liga no socio').id).toBe('liga');
    expect(classifyBajaMotivo('baja por afiliarse nuevamente 01/08/2026').id).toBe('reempadron');
  });

  it('parsea fecha argentina y resume colores', () => {
    expect(parseArDate('03/08/2026')).toBe('2026-08-03');
    const rows = uniqueBajas([
      { memberId: '10798', name: 'Monica Vives', date: '2026-08-03', motivo: 'LICENCIA 1 AÑO' },
      { memberId: '10798', name: 'Monica Vives', date: '2026-08-03', motivo: 'LICENCIA 1 AÑO' },
      { memberId: '10446', name: 'Andrea Calvo', date: '2026-08-11', motivo: 'BAJA POR NO PAGAR' },
    ]);
    expect(rows).toHaveLength(2);
    expect(decorateBaja(rows[0]).color).toBeTruthy();
    const summary = summarizeBajas(rows);
    expect(summary.find((s) => s.id === 'mora')?.count).toBe(1);
    expect(summary.find((s) => s.id === 'licencia')?.count).toBe(1);
  });
});

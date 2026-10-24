import { describe, expect, it } from 'vitest';
import {
  countHrByType,
  createHrRecord,
  filterHrByEmployee,
  filterHrByType,
} from './hr';

describe('createHrRecord', () => {
  it('permiso y solicitud quedan pendientes; el resto registrado', () => {
    expect(createHrRecord({
      type: 'falta',
      employeeId: 'e1',
      employeeName: 'Ana',
      title: 'Falta',
    }).status).toBe('registered');
    expect(createHrRecord({
      type: 'permiso',
      employeeId: 'e1',
      employeeName: 'Ana',
      title: 'Médico',
    }).status).toBe('pending');
    expect(createHrRecord({
      type: 'solicitud',
      employeeId: 'e1',
      title: 'Vacaciones',
    }).status).toBe('pending');
  });
});

describe('filtros y conteo', () => {
  const records = [
    createHrRecord({ type: 'falta', employeeId: 'e1', employeeName: 'Ana', title: 'Falta' }),
    createHrRecord({ type: 'novedad', title: 'General', detail: 'Aviso' }),
    createHrRecord({ type: 'tardanza', employeeId: 'e2', employeeName: 'Bob', title: 'Tarde' }),
  ];

  it('filtra por tipo y por empleado (novedad siempre visible)', () => {
    expect(filterHrByType(records, 'falta')).toHaveLength(1);
    expect(filterHrByType(records, 'all')).toHaveLength(3);
    const forE1 = filterHrByEmployee(records, 'e1');
    expect(forE1.map((r) => r.type).sort()).toEqual(['falta', 'novedad']);
  });

  it('cuenta por tipo', () => {
    expect(countHrByType(records)).toMatchObject({
      falta: 1,
      novedad: 1,
      tardanza: 1,
      permiso: 0,
      solicitud: 0,
    });
  });
});

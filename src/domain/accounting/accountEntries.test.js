import { describe, expect, it } from 'vitest';
import {
  createAccountEntry,
  softDeleteAccountEntry,
  upsertAccountEntry,
} from './accountEntries';

describe('createAccountEntry', () => {
  it('exige socio y valor', () => {
    expect(() => createAccountEntry({ value: 100 })).toThrow(/socio/i);
    expect(() => createAccountEntry({ memberNumber: '11017' })).toThrow(/valor/i);
  });

  it('el pago queda negativo y la cuota positiva', () => {
    const pago = createAccountEntry({
      memberNumber: '11017',
      memberName: 'Socio',
      type: 'pago',
      value: 5000,
      description: 'Cobro cuota',
    });
    expect(pago.value).toBe(-5000);
    expect(pago.typeLabel).toBe('Pago');
    expect(pago.isActive).toBe(true);

    const cuota = createAccountEntry({
      memberId: '11017',
      type: 'cuota',
      value: -32000,
    });
    expect(cuota.value).toBe(32000);
    expect(cuota.memberNumber).toBe('11017');
  });
});

describe('upsertAccountEntry', () => {
  it('alta al frente y edición conserva createdAt', () => {
    const first = createAccountEntry({
      id: 'mae-1',
      memberNumber: '1',
      type: 'pago',
      value: 1000,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const list = upsertAccountEntry([], first);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('mae-1');

    const updated = upsertAccountEntry(list, {
      id: 'mae-1',
      memberNumber: '1',
      type: 'pago',
      value: 2000,
      description: 'Corregido',
    });
    expect(updated).toHaveLength(1);
    expect(updated[0].value).toBe(-2000);
    expect(updated[0].description).toBe('Corregido');
    expect(updated[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('softDeleteAccountEntry', () => {
  it('marca isActive false sin borrar la fila', () => {
    const entry = createAccountEntry({
      id: 'mae-del',
      memberNumber: '2',
      type: 'cuota',
      value: 100,
    });
    const next = softDeleteAccountEntry([entry], 'mae-del');
    expect(next).toHaveLength(1);
    expect(next[0].isActive).toBe(false);
  });
});

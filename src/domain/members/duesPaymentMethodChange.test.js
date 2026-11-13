import { describe, expect, it } from 'vitest';
import {
  changeDuesPaymentMethod,
  rewriteDuesCobroConcept,
} from './duesPaymentMethodChange';

describe('changeDuesPaymentMethod', () => {
  const base = {
    id: 'pay-1',
    method: 'efectivo',
    methodLabel: 'Efectivo',
    amount: 70000,
    status: 'paid',
  };

  it('cambia efectivo a transferencia y deja rastro', () => {
    const next = changeDuesPaymentMethod(base, {
      method: 'transferencia',
      bankId: 'macro',
      bankName: 'Banco Macro',
      changedBy: 'user-1',
      changedByName: 'Paula Cuello',
      reason: 'Se cargó efectivo por error',
      today: new Date('2026-11-12T15:00:00Z'),
    });
    expect(next.method).toBe('transferencia');
    expect(next.methodLabel).toMatch(/Transferencia/);
    expect(next.previousMethod).toBe('efectivo');
    expect(next.methodChangedByName).toBe('Paula Cuello');
    expect(next.methodChangeReason).toBe('Se cargó efectivo por error');
    expect(next.methodHistory).toHaveLength(1);
    expect(next.methodHistory[0].from).toBe('efectivo');
    expect(next.methodHistory[0].to).toBe('transferencia');
  });

  it('exige motivo', () => {
    expect(() => changeDuesPaymentMethod(base, {
      method: 'tarjeta',
      reason: 'corto',
    })).toThrow(/motivo/i);
  });

  it('no permite editar mixto', () => {
    expect(() => changeDuesPaymentMethod({ ...base, method: 'mixto' }, {
      method: 'efectivo',
      reason: 'Motivo suficiente para el cambio',
    })).toThrow(/mixto/i);
  });

  it('reescribe el concepto del asiento con el nuevo medio', () => {
    expect(rewriteDuesCobroConcept(
      'Cobro cuota social (Efectivo) - Socio: Ana (Cred. 1)',
      'Transferencia Banco Macro',
    )).toBe('Cobro cuota social (Transferencia Banco Macro) - Socio: Ana (Cred. 1)');
  });
});

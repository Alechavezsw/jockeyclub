import { describe, expect, it } from 'vitest';
import { money } from './money';
import { duesPayableAmount } from './members/dues';

describe('money', () => {
  it('conserva los centavos', () => {
    expect(money(10.03)).toBe(10.03);
    expect(money(100.03 * 1.1)).toBe(110.03);
  });

  it('un importe inválido es cero', () => {
    expect(money(null)).toBe(0);
    expect(money('no')).toBe(0);
  });
});

describe('duesPayableAmount en centavos', () => {
  it('el 10 % no se come los 0,03', () => {
    const paidOn = '2026-11-11';
    const dueOn = '2026-11-10';
    expect(duesPayableAmount(100.03, { paidOn, dueOn, tier: 'socio_familiar' })).toBe(110.03);
  });
});

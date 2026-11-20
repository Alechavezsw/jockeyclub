/**
 * Guards de acreditación que el webhook/RPC deben respetar.
 * Sin dinero real ni mutaciones en producción.
 */
import { describe, expect, it } from 'vitest';
import {
  mpAmountMatchesIntent,
  mpCurrencyOk,
  mpIsPaymentCreditableStatus,
  mpNormalizeStatus,
} from './mpWebhookSecurity';

function shouldCreditPayment({ status, currency, paidAmount, intentAmount, alreadyApplied }) {
  if (alreadyApplied) return { credit: false, reason: 'already' };
  const normalized = mpNormalizeStatus(status);
  if (!mpIsPaymentCreditableStatus(normalized)) return { credit: false, reason: 'not_approved', status: normalized };
  if (!mpCurrencyOk(currency)) return { credit: false, reason: 'currency_mismatch' };
  if (!mpAmountMatchesIntent(paidAmount, intentAmount)) return { credit: false, reason: 'amount_mismatch' };
  return { credit: true, status: normalized };
}

describe('mp apply guards (integración lógica)', () => {
  it('pago aprobado válido acredita', () => {
    expect(shouldCreditPayment({
      status: 'approved',
      currency: 'ARS',
      paidAmount: 40000,
      intentAmount: 40000,
      alreadyApplied: false,
    })).toEqual({ credit: true, status: 'approved' });
  });

  it('pago pendiente no acredita ni emite recibo definitivo', () => {
    expect(shouldCreditPayment({
      status: 'pending',
      currency: 'ARS',
      paidAmount: 40000,
      intentAmount: 40000,
      alreadyApplied: false,
    }).credit).toBe(false);
  });

  it('pago rechazado no habilita servicios', () => {
    expect(shouldCreditPayment({
      status: 'rejected',
      currency: 'ARS',
      paidAmount: 40000,
      intentAmount: 40000,
      alreadyApplied: false,
    })).toMatchObject({ credit: false, reason: 'not_approved' });
  });

  it('authorized no acredita (solo adhesión)', () => {
    expect(shouldCreditPayment({
      status: 'authorized',
      currency: 'ARS',
      paidAmount: 40000,
      intentAmount: 40000,
      alreadyApplied: false,
    }).credit).toBe(false);
  });

  it('importe incorrecto no acredita', () => {
    expect(shouldCreditPayment({
      status: 'approved',
      currency: 'ARS',
      paidAmount: 1000,
      intentAmount: 40000,
      alreadyApplied: false,
    }).reason).toBe('amount_mismatch');
  });

  it('moneda incorrecta no acredita', () => {
    expect(shouldCreditPayment({
      status: 'approved',
      currency: 'USD',
      paidAmount: 40000,
      intentAmount: 40000,
      alreadyApplied: false,
    }).reason).toBe('currency_mismatch');
  });

  it('pago ya acreditado es idempotente', () => {
    expect(shouldCreditPayment({
      status: 'approved',
      currency: 'ARS',
      paidAmount: 40000,
      intentAmount: 40000,
      alreadyApplied: true,
    })).toEqual({ credit: false, reason: 'already' });
  });

  it('pileta y reserva no cruzan con cuota: el kind no cambia la regla de crédito', () => {
    for (const kind of ['pool', 'booking', 'dues']) {
      const ok = shouldCreditPayment({
        status: 'approved',
        currency: 'ARS',
        paidAmount: kind === 'pool' ? 5000 : 20000,
        intentAmount: kind === 'pool' ? 5000 : 20000,
        alreadyApplied: false,
      });
      expect(ok.credit).toBe(true);
    }
  });

  it('débito mensual confirmado vs rechazado', () => {
    expect(shouldCreditPayment({
      status: 'approved',
      currency: 'ARS',
      paidAmount: 70000,
      intentAmount: 70000,
      alreadyApplied: false,
    }).credit).toBe(true);
    expect(shouldCreditPayment({
      status: 'rejected',
      currency: 'ARS',
      paidAmount: 70000,
      intentAmount: 70000,
      alreadyApplied: false,
    }).credit).toBe(false);
  });
});

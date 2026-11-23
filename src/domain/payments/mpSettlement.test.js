import { describe, expect, it } from 'vitest';
import {
  currencyIsArs,
  isApprovedCreditStatus,
  isTennisCharge,
  moneyCents,
  moneyCentsEqual,
  subscriptionDebitCredits,
} from '../../../supabase/functions/_shared/mpSettlement.js';

describe('acreditación de Mercado Pago', () => {
  it('acredita únicamente el estado approved', () => {
    expect(isApprovedCreditStatus('approved')).toBe(true);
    expect(isApprovedCreditStatus(' Approved ')).toBe(true);
    for (const status of ['authorized', 'pending', 'rejected', 'cancelled', 'processed', 'accredited', 'in_process', '']) {
      expect(isApprovedCreditStatus(status)).toBe(false);
      expect(subscriptionDebitCredits(status)).toBe(false);
    }
    expect(subscriptionDebitCredits('approved')).toBe(true);
  });

  it('exige ARS y centavos idénticos', () => {
    expect(currencyIsArs('ARS')).toBe(true);
    expect(currencyIsArs('usd')).toBe(false);
    expect(currencyIsArs('')).toBe(false);
    expect(moneyCents(40000.105)).toBe(4000011);
    expect(moneyCentsEqual(77000, 77000)).toBe(true);
    expect(moneyCentsEqual(70000, 77000)).toBe(false);
    expect(moneyCentsEqual(40000, 40000.01)).toBe(false);
    expect(moneyCentsEqual(40000, 0)).toBe(false);
    expect(moneyCents('no-es-numero')).toBe(null);
  });

  it('separa el abono de tenis de la cuota social', () => {
    expect(isTennisCharge('Abono tenis noviembre', '')).toBe(true);
    expect(isTennisCharge('Cuota social', 'abono_tenis')).toBe(true);
    expect(isTennisCharge('Cuota social · Noviembre de 2026', 'cuota_social')).toBe(false);
    expect(isTennisCharge('Seña salón Anhelo', '')).toBe(false);
  });
});

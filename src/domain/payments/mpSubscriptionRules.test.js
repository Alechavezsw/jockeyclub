import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  confirmedPreapprovalAmount,
  preapprovalAmountUpdate,
  subscriptionAdhesionState,
  subscriptionAmountDrift,
  subscriptionBillingDay,
  subscriptionTariffMayUpdate,
} from '../../../supabase/functions/_shared/mpSubscriptionRules.js';

const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations/20261123230000_subscription_pending_and_debit_capital.sql'),
  'utf8',
);

describe('reglas de la adhesión', () => {
  it('cobra el 10 al familiar y al individual, y el 18 a AMET', () => {
    expect(subscriptionBillingDay({ tier: 'socio_familiar' })).toBe(10);
    expect(subscriptionBillingDay({ tier: 'socio_individual' })).toBe(10);
    expect(subscriptionBillingDay({ tier: 'socio_familiar_amet' })).toBe(18);
    expect(subscriptionBillingDay({ tier: 'socio_individual_amet' })).toBe(18);
    expect(subscriptionBillingDay({
      tier: 'socio_familiar',
      meta: { cuotaCategories: 'SOCIO FAMILIAR (AMET)' },
    })).toBe(18);
  });

  it('deja pendiente una adhesión abierta y reserva el rechazo para un rechazo real', () => {
    expect(subscriptionAdhesionState('')).toBe('pending');
    expect(subscriptionAdhesionState('pending')).toBe('pending');
    expect(subscriptionAdhesionState('in_process')).toBe('pending');
    expect(subscriptionAdhesionState('authorized')).toBe('authorized');
    expect(subscriptionAdhesionState('approved')).toBe('authorized');
    expect(subscriptionAdhesionState('cancelled')).toBe('cancelled');
    expect(subscriptionAdhesionState('paused')).toBe('cancelled');
    expect(subscriptionAdhesionState('rejected')).toBe('rejected');
  });

  it('detecta una tarifa vieja y solo sincroniza lo que Mercado Pago confirma', () => {
    expect(subscriptionAmountDrift(70000, 70000)).toBeNull();
    expect(subscriptionAmountDrift(70000, 68250)).toEqual({ from: 70000, to: 68250 });
    expect(subscriptionTariffMayUpdate('pending')).toBe(true);
    expect(subscriptionTariffMayUpdate('authorized')).toBe(false);
    expect(preapprovalAmountUpdate(68250, 18)).toEqual({
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 68250,
        currency_id: 'ARS',
        billing_day: 18,
        billing_day_proportional: false,
      },
    });
    const intentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const confirmed = confirmedPreapprovalAmount({
      id: 'pre-1',
      status: 'pending',
      external_reference: intentId,
      auto_recurring: { transaction_amount: 68250, currency_id: 'ARS', billing_day: 18 },
    }, { preapprovalId: 'pre-1', intentId, amount: 68250, billingDay: 18 });
    expect(confirmed.ok).toBe(true);
    expect(confirmedPreapprovalAmount({
      id: 'pre-1',
      status: 'authorized',
      external_reference: intentId,
      auto_recurring: { transaction_amount: 68250, currency_id: 'ARS', billing_day: 18 },
    }, { preapprovalId: 'pre-1', intentId, amount: 68250, billingDay: 18 }).reason).toBe('status');
    expect(confirmedPreapprovalAmount({
      id: 'pre-otra',
      status: 'pending',
      external_reference: 'otro',
      auto_recurring: { transaction_amount: 68250, currency_id: 'ARS', billing_day: 10 },
    }, { preapprovalId: 'pre-1', intentId, amount: 68250, billingDay: 10 }).reason).toBe('preapproval');
    expect(confirmedPreapprovalAmount({
      id: 'pre-1',
      status: 'pending',
      external_reference: intentId,
      auto_recurring: { transaction_amount: 70000, currency_id: 'ARS', billing_day: 10 },
    }, { preapprovalId: 'pre-1', intentId, amount: 68250, billingDay: 10 }).reason).toBe('amount');
  });

  it('la migración ata el recargo al débito verificado y no al medio de pago', () => {
    expect(migration).toContain("when v_status in ('pending', 'in_process') then 'pending'");
    expect(migration.indexOf("then 'pending'")).toBeLessThan(migration.indexOf("else 'rejected'"));
    expect(migration).toContain('p_skip_surcharge');
    expect(migration).toContain('preapproval_mismatch');
    expect(migration).toContain('stale_after_close');
    expect(migration).not.toContain('debito_automatico');
    expect(migration).not.toContain('jockey.mp_debit_capital_only');
    expect(migration).toContain('mpDebitMethod');
  });
});

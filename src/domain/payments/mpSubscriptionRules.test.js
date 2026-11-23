import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  preapprovalAmountUpdate,
  subscriptionAdhesionState,
  subscriptionAmountDrift,
  subscriptionBillingDay,
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

  it('detecta una tarifa vieja y arma el ajuste en pesos', () => {
    expect(subscriptionAmountDrift(70000, 70000)).toBeNull();
    expect(subscriptionAmountDrift(70000, 68250)).toEqual({ from: 70000, to: 68250 });
    expect(preapprovalAmountUpdate(68250)).toEqual({
      auto_recurring: { transaction_amount: 68250, currency_id: 'ARS' },
    });
  });

  it('la migración no trata la adhesión pendiente como rechazo y saltea el 10 % del débito', () => {
    expect(migration).toContain("when v_status in ('pending', 'in_process') then 'pending'");
    expect(migration.indexOf("then 'pending'")).toBeLessThan(migration.indexOf("else 'rejected'"));
    expect(migration).toContain('jockey.mp_debit_capital_only');
    expect(migration).toContain('mpDebitMethod');
  });
});

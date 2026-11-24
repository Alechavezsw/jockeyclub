/**
 * Adaptador Mercado Pago Colonia (kind=colonia).
 * Preparado y testeable; live requiere colonia_mp_live=true + edge deploy autorizado.
 */

import { COLONIA_MP_KIND } from './coloniaPayments';
import { assertColoniaFinanceIsolation, moneyArs } from './coloniaLedger';

export const COLONIA_MP_LIVE_SETTING_KEY = 'colonia_mp_live';

export function isColoniaMpLive(settings = {}) {
  if (settings === true) return true;
  if (settings?.enabled === true) return true;
  if (settings?.value?.enabled === true) return true;
  return false;
}

export function buildColoniaMpIntentDraft({
  enrollmentId,
  amount,
  currency = 'ARS',
  guardianEmail = null,
  memberId = null,
  externalGuardianId = null,
  chargeIds = [],
  live = false,
} = {}) {
  const errors = [];
  const value = moneyArs(amount);
  if (!enrollmentId) errors.push({ code: 'enrollment_required', message: 'Falta la inscripción.' });
  if (!(value > 0)) errors.push({ code: 'amount_invalid', message: 'Importe inválido.' });
  if (String(currency || '').toUpperCase() !== 'ARS') {
    errors.push({ code: 'currency_invalid', message: 'Colonia solo acepta ARS.' });
  }
  if (!live) {
    errors.push({
      code: 'mp_colonia_disabled',
      message: 'Mercado Pago Colonia está deshabilitado hasta autorización de despliegue.',
    });
  }

  const draft = {
    kind: COLONIA_MP_KIND,
    amount: value,
    currency: 'ARS',
    chargeScope: 'colonia',
    enrollmentId,
    memberId: memberId || null,
    externalGuardianId: externalGuardianId || null,
    guardianEmail: guardianEmail || null,
    chargeIds: Array.isArray(chargeIds) ? chargeIds : [],
    affectsSocialDues: false,
    affectsMemberOutstandingBalance: false,
    imputeTo: 'colonia',
  };
  assertColoniaFinanceIsolation(draft);
  return { ok: errors.length === 0, errors, draft };
}

/**
 * Validación del payload de webhook/simulación antes de acreditar.
 * Nunca confía solo en el return del browser.
 */
export function validateColoniaMpWebhookPayload({
  intent,
  providerPaymentId,
  amount,
  currency,
  status,
  signatureValid = false,
  timestampFresh = false,
  expectedAmount,
} = {}) {
  const errors = [];
  if (!intent?.id) errors.push({ code: 'intent_missing', message: 'Falta el intent.' });
  if (String(intent?.kind || '').toLowerCase() !== COLONIA_MP_KIND) {
    errors.push({ code: 'kind_mismatch', message: 'El intent no es kind=colonia.' });
  }
  if (String(status || '').toLowerCase() !== 'approved') {
    errors.push({ code: 'status_not_approved', message: 'Solo approved acredita Colonia.' });
  }
  if (!signatureValid) {
    errors.push({ code: 'signature_invalid', message: 'Firma de webhook inválida.' });
  }
  if (!timestampFresh) {
    errors.push({ code: 'timestamp_stale', message: 'Timestamp de webhook vencido o inválido.' });
  }
  if (String(currency || '').toUpperCase() !== 'ARS') {
    errors.push({ code: 'currency_invalid', message: 'Moneda incorrecta.' });
  }
  const paid = moneyArs(amount);
  const expected = moneyArs(expectedAmount ?? intent?.amount);
  if (Math.abs(paid - expected) > 0.01) {
    errors.push({ code: 'amount_mismatch', message: 'Importe incorrecto respecto del intent.' });
  }
  if (!String(providerPaymentId || '').trim()) {
    errors.push({ code: 'provider_payment_missing', message: 'Falta el id de pago del proveedor.' });
  }
  if (!intent?.meta?.enrollment_id && !intent?.enrollmentId) {
    errors.push({ code: 'enrollment_missing', message: 'Intent sin enrollment_id.' });
  }

  return {
    ok: errors.length === 0,
    errors,
    credit: errors.length === 0
      ? {
        intentId: intent.id,
        providerPaymentId: String(providerPaymentId).trim(),
        amount: paid,
        currency: 'ARS',
        status: 'approved',
        enrollmentId: intent.meta?.enrollment_id || intent.enrollmentId,
        affectsSocialDues: false,
      }
      : null,
  };
}

/** Spec para edges (no desplegar hasta autorización). */
export function coloniaMpEdgePatchSpec() {
  return {
    liveDefault: false,
    settingKey: COLONIA_MP_LIVE_SETTING_KEY,
    mpCreate: {
      allowKind: COLONIA_MP_KIND,
      rejectUnlessLive: true,
      metaRequires: ['enrollment_id'],
      forbidChargeScope: ['cuota_social', 'abono_tenis'],
    },
    mpWebhook: {
      branch: 'if kind===colonia → colonia_apply_mp_approved_payment',
      neverCall: ['apply_mp_approved_payment for social', 'registrar_cobro'],
      require: ['signature', 'approved', 'ARS', 'amount match', 'idempotency'],
    },
  };
}

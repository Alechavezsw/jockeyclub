/**
 * Cobranzas Colonia: reutiliza medios de Jockey Connect sin imputar a cuota social.
 * Mercado Pago: adaptador preparado; el webhook productivo requiere autorización aparte.
 */

import { coloniaMethodMeta, COLONIA_PAYMENT_METHOD_KEYS } from './coloniaConstants';
import { assertColoniaFinanceIsolation, moneyArs } from './coloniaLedger';

export const COLONIA_MP_KIND = 'colonia';
export const COLONIA_MP_ADAPTER_STATUS = 'prepared_pending_deploy_authorization';

/**
 * Estado inicial del pago según medio.
 * Efectivo puede confirmarse en mostrador.
 * Transferencia / MP / tarjeta / POS quedan pending hasta confirmación.
 */
export function initialPaymentStatus(method, { operatorConfirmed = false } = {}) {
  const meta = coloniaMethodMeta(method);
  if (!meta) return 'pending';
  if (meta.key === 'efectivo') return 'confirmed';
  if (meta.startsPending) return 'pending';
  if (meta.requiresProvider) return 'pending';
  if (operatorConfirmed && (meta.key === 'tarjeta' || meta.key === 'pos' || meta.key === 'debito')) {
    return 'confirmed';
  }
  return 'pending';
}

export function validateColoniaPaymentInput({
  method,
  amount,
  enrollmentId,
  operatorConfirmed = false,
  externalReference = '',
  coloniaMpLive = false,
} = {}) {
  const input = { coloniaMpLive };
  const errors = [];
  const key = String(method || '').toLowerCase();
  if (!COLONIA_PAYMENT_METHOD_KEYS.includes(key)) {
    errors.push({ code: 'method_unknown', message: 'Medio de pago no habilitado en Jockey Connect.' });
  }
  const value = moneyArs(amount);
  if (!(value > 0)) {
    errors.push({ code: 'amount_invalid', message: 'Indicá un importe mayor a cero.' });
  }
  if (!enrollmentId) {
    errors.push({ code: 'enrollment_required', message: 'Falta la inscripción.' });
  }
  if ((key === 'tarjeta' || key === 'pos' || key === 'debito') && !operatorConfirmed) {
    errors.push({
      code: 'card_confirmation_required',
      message: 'Confirmá el resultado de la terminal/POS antes de acreditar la tarjeta.',
    });
  }
  if (key === 'mercadopago' && !input?.coloniaMpLive) {
    errors.push({
      code: 'mp_adapter_pending',
      message: 'Mercado Pago Colonia está preparado pero deshabilitado (colonia_mp_live=false). No uses el circuito de cuota social.',
    });
  }
  if (key === 'transferencia' && !String(externalReference || '').trim()) {
    errors.push({
      code: 'transfer_reference_required',
      message: 'Registrá referencia o adjunto de la transferencia informada.',
    });
  }

  const status = errors.some((e) => e.code === 'mp_adapter_pending')
    ? null
    : initialPaymentStatus(key, { operatorConfirmed });

  return {
    ok: errors.length === 0,
    errors,
    status,
    method: key,
    amount: value,
  };
}

export function buildColoniaPaymentDraft(input = {}) {
  const checked = validateColoniaPaymentInput({
    ...input,
    coloniaMpLive: Boolean(input.coloniaMpLive),
  });
  if (!checked.ok) {
    const err = new Error(checked.errors[0]?.message || 'Pago inválido');
    err.details = checked.errors;
    throw err;
  }
  const payload = {
    enrollmentId: input.enrollmentId,
    seasonId: input.seasonId || null,
    studentId: input.studentId || null,
    guardianId: input.guardianId || null,
    method: checked.method,
    amount: checked.amount,
    currency: 'ARS',
    status: checked.status,
    externalReference: String(input.externalReference || '').trim() || null,
    receiptUrl: input.receiptUrl || null,
    operatorId: input.operatorId || null,
    operatorName: input.operatorName || null,
    idempotencyKey: input.idempotencyKey || null,
    incomeClass: 'COLONIA',
    affectsSocialDues: false,
    affectsMemberOutstandingBalance: false,
    imputeTo: 'colonia',
  };
  assertColoniaFinanceIsolation(payload);
  return payload;
}

/** Documentación del adaptador MP (sin tocar webhook productivo). */
export function coloniaMercadoPagoAdapterSpec() {
  return {
    status: COLONIA_MP_ADAPTER_STATUS,
    kind: COLONIA_MP_KIND,
    requires: [
      'mp-create: permitir kind=colonia',
      'mp-webhook / apply_mp_approved_payment: ramificar kind=colonia a colonia_payments',
      'No usar chargeScope cuota_social',
      'No tocar members.outstanding_balance',
      'COA ingreso 4.1.06 Colonia',
      'Idempotencia por intent.id',
      'Autorización de despliegue independiente',
    ],
    forbidden: [
      'Imputar como dues/subscription',
      'Reutilizar registrar_cobro',
      'Acreditar pending/rejected/cancelled',
    ],
  };
}

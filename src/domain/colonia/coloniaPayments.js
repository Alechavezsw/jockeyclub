/**
 * Cobranzas Colonia: reutiliza medios de Jockey Connect sin imputar a cuota social.
 * Mercado Pago: adaptador preparado; el webhook productivo requiere autorización aparte.
 */

import { journalAccountForPayment } from '../members/clubBanks';
import { coloniaMethodMeta, COLONIA_PAYMENT_METHOD_KEYS } from './coloniaConstants';
import { assertColoniaFinanceIsolation, moneyArs } from './coloniaLedger';

function deskMethod(method) {
  const key = String(method || '').trim().toLowerCase();
  if (key === 'pos' || key === 'pago pos' || key === 'card') return 'tarjeta';
  return key;
}

/** Efectivo entra en Caja General. */
export function coloniaMethodUsesCash(method) {
  return deskMethod(method) === 'efectivo';
}

/** Pago POS: Tarjetas a cobrar. No es efectivo de caja. */
export function coloniaMethodUsesCard(method) {
  return deskMethod(method) === 'tarjeta';
}

/** Transferencia y débito acreditan en el alias elegido. */
export function coloniaMethodUsesBank(method) {
  const key = deskMethod(method);
  return key === 'transferencia' || key === 'debito';
}

/** Misma cuenta de tesorería que el resto de los cobros del club. */
export function coloniaSettlementAccount(method, bankId) {
  return journalAccountForPayment(deskMethod(method), bankId);
}

export const COLONIA_MP_KIND = 'colonia';
export const COLONIA_MP_ADAPTER_STATUS = 'live';

/**
 * Estado inicial del pago según medio.
 * Efectivo confirma en Caja General. Transferencia y débito confirman en el alias.
 * Pago POS confirma al registrar el cupón. Mercado Pago espera al proveedor.
 */
export function initialPaymentStatus(method, { operatorConfirmed = false } = {}) {
  const meta = coloniaMethodMeta(method);
  if (!meta) return 'pending';
  if (meta.key === 'efectivo') return 'confirmed';
  if (meta.usesBank) return 'confirmed';
  if (meta.requiresProvider) return 'pending';
  if (operatorConfirmed && meta.key === 'tarjeta') return 'confirmed';
  return 'pending';
}

export function validateColoniaPaymentInput({
  method,
  amount,
  enrollmentId,
  operatorConfirmed = false,
  externalReference = '',
} = {}) {
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
  if ((key === 'tarjeta' || key === 'pos' || key === 'pago pos' || key === 'card') && !operatorConfirmed) {
    errors.push({
      code: 'card_confirmation_required',
      message: 'Confirmá el resultado de la terminal/POS antes de acreditar la tarjeta.',
    });
  }
  if ((key === 'transferencia' || key === 'debito') && !String(externalReference || '').trim()) {
    errors.push({
      code: 'transfer_reference_required',
      message: 'Registrá referencia o comprobante del alias.',
    });
  }
  if (key === 'mercadopago') {
    errors.push({
      code: 'mp_adapter_pending',
      message: 'Mercado Pago de Colonia se acredita solo cuando Mercado Pago confirma. No se carga a mano ni como cuota social.',
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

/** El alta se habilita después de cobrar. Mercado Pago espera la confirmación. */
export function coloniaEnrollPayReady({
  method,
  amount,
  operatorConfirmed = false,
  externalReference = '',
  mpApproved = false,
} = {}) {
  const key = String(method || '').toLowerCase();
  const value = moneyArs(amount);
  if (!(value > 0)) return { ok: false, status: null, message: 'No hay importe para cobrar.' };
  if (key === 'efectivo') return { ok: true, status: 'confirmed', message: '' };
  if (key === 'transferencia' || key === 'debito') {
    if (!String(externalReference || '').trim()) {
      return { ok: false, status: null, message: 'Registrá la referencia del alias.' };
    }
    return { ok: true, status: 'confirmed', message: '' };
  }
  if (key === 'tarjeta' || key === 'pos' || key === 'pago pos' || key === 'card') {
    if (!operatorConfirmed) {
      return { ok: false, status: null, message: 'Confirmá el resultado de la terminal antes de inscribir.' };
    }
    return { ok: true, status: 'confirmed', message: '' };
  }
  if (key === 'mercadopago') {
    if (!mpApproved) {
      return { ok: false, status: null, message: 'Esperá que Mercado Pago confirme el pago.' };
    }
    return { ok: true, status: 'confirmed', message: '' };
  }
  return { ok: false, status: null, message: 'Elegí un medio de pago.' };
}

export function buildColoniaPaymentDraft(input = {}) {
  const checked = validateColoniaPaymentInput(input);
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
    bankId: coloniaMethodUsesBank(checked.method) ? (input.bankId || 'macro') : null,
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

/** Saldo que se puede cobrar por Mercado Pago: lo publicado menos lo confirmado y lo que ya está pendiente. */
export function coloniaMpPayable(balanceDue, pending = 0) {
  const due = Number(balanceDue);
  const hold = Number(pending);
  const net = (Number.isFinite(due) ? due : 0) - (Number.isFinite(hold) ? hold : 0);
  return Math.max(0, Math.round(net * 100) / 100);
}

/** Documentación del adaptador MP. El webhook acredita kind=colonia en Colonia, no en cuota social. */
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

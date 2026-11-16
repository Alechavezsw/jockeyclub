/**
 * Circuito completo del canon de pileta (fuente de verdad = Supabase en cloud).
 *
 * 1. Apto médico + cuota al día (si aplica) + socio activo
 * 2. Medio: efectivo/tarjeta → Caja General; transferencia/débito → banco; MP → QR/webhook
 * 3. record_pool_canon / apply_mp → asiento source_module=pileta (Reservas e Instalaciones)
 * 4. Movimiento de caja si el medio usa caja
 * 5. pool_accesses con journal_entry_id (+ cash_movement_id si hubo)
 * 6. Cargo + pago en cuenta del socio (neto 0; no mueve deuda de cuota)
 * 7. Comprobante automático (mail + MD)
 */

import { POOL_DESK_PAYMENT_METHODS, poolMethodUsesCash, poolMethodUsesBank } from './poolAccess';

export const POOL_CIRCLE_STEPS = [
  'apto',
  'caja_o_banco',
  'asiento',
  'pool_access',
  'cuenta_socio',
  'comprobante',
];

/** Comprueba que un cobro de mostrador dejó el rastro mínimo del círculo. */
export function verifyPoolCanonCircle({
  entry,
  charged,
  accountEntries,
  method,
} = {}) {
  const payMethod = String(method || charged?.payment?.method || entry?.payment?.method || '').toLowerCase();
  const issues = [];

  if (!entry && !charged) {
    return { ok: false, issues: ['Sin ingreso de pileta'] };
  }

  if (!POOL_DESK_PAYMENT_METHODS.includes(payMethod) && payMethod !== 'mercadopago') {
    issues.push('Medio de pago fuera del circuito');
  }

  const journalId = charged?.journalEntryId || entry?.journalEntryId || null;
  if (payMethod !== 'mercadopago' && !journalId) {
    issues.push('Falta asiento contable');
  }

  if (poolMethodUsesCash(payMethod) && !(charged?.cashMovementId || entry?.cashMovementId)) {
    issues.push('Falta movimiento de caja');
  }

  if (poolMethodUsesBank(payMethod) && !charged?.payment?.bankJournal && !journalId) {
    issues.push('Falta acreditación en banco');
  }

  const rows = Array.isArray(accountEntries)
    ? accountEntries
    : (Array.isArray(charged?.accountEntries) ? charged.accountEntries : []);
  if (payMethod !== 'mercadopago' && Number(charged?.payment?.amount || entry?.payment?.amount || 0) > 0) {
    if (rows.length < 2) {
      issues.push('Falta cargo/pago en la cuenta del socio');
    } else {
      const cargo = rows.find((r) => r.type === 'otro');
      const pago = rows.find((r) => r.type === 'pago');
      if (!cargo || !pago) issues.push('Cuenta del socio incompleta (cargo + pago)');
    }
  }

  return { ok: issues.length === 0, issues, method: payMethod, journalId };
}

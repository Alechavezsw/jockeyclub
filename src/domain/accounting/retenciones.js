/** Retenciones impositivas / Accessin (resumen CC proveedores). */

import {
  ACCESSIN_RETENCIONES,
  ACCESSIN_RETENCIONES_AS_OF,
  ACCESSIN_RETENCIONES_GENERATED_ON,
  ACCESSIN_RETENCIONES_PERIOD_FROM,
  ACCESSIN_RETENCIONES_PERIOD_TO,
} from '../../data/seed/accessinRetenciones';

export {
  ACCESSIN_RETENCIONES_AS_OF,
  ACCESSIN_RETENCIONES_GENERATED_ON,
  ACCESSIN_RETENCIONES_PERIOD_FROM,
  ACCESSIN_RETENCIONES_PERIOD_TO,
};

export const DEFAULT_RETENCIONES = ACCESSIN_RETENCIONES;

export const RETENCION_STATUS = {
  recorded: 'Registrada',
  void: 'Anulada',
};

export function createRetencion({
  clientName = '',
  supplierName = '',
  paymentOrderNumber = '',
  paymentOrderAmount = 0,
  retentionType = '',
  retentionDate = new Date().toISOString().slice(0, 10),
  retentionAmount = 0,
  lineNumber = null,
  notes = '',
}) {
  const amount = Number(retentionAmount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error('El monto de retención es obligatorio.');
  }
  if (!String(supplierName || '').trim() && !String(clientName || '').trim()) {
    throw new Error('Indique cliente o proveedor.');
  }

  return {
    id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    lineNumber: lineNumber != null ? Number(lineNumber) || null : null,
    clientName: String(clientName || '').trim(),
    supplierName: String(supplierName || '').trim(),
    paymentOrderNumber: String(paymentOrderNumber || '').trim(),
    paymentOrderAmount: Number(paymentOrderAmount) || 0,
    retentionType: String(retentionType || '').trim(),
    retentionDate: String(retentionDate || '').slice(0, 10),
    retentionAmount: amount,
    status: 'recorded',
    notes: String(notes || '').trim(),
    source: 'manual',
    asOf: ACCESSIN_RETENCIONES_AS_OF,
    createdAt: new Date().toISOString(),
  };
}

export function updateRetencion(item, patch = {}) {
  if (!item) throw new Error('Retención no encontrada.');
  const nextAmount = patch.retentionAmount != null
    ? Number(patch.retentionAmount)
    : item.retentionAmount;
  if (!Number.isFinite(nextAmount) || nextAmount === 0) {
    throw new Error('El monto de retención es obligatorio.');
  }
  return {
    ...item,
    ...patch,
    clientName: patch.clientName != null ? String(patch.clientName).trim() : item.clientName,
    supplierName: patch.supplierName != null ? String(patch.supplierName).trim() : item.supplierName,
    paymentOrderNumber: patch.paymentOrderNumber != null
      ? String(patch.paymentOrderNumber).trim()
      : item.paymentOrderNumber,
    paymentOrderAmount: patch.paymentOrderAmount != null
      ? Number(patch.paymentOrderAmount) || 0
      : item.paymentOrderAmount,
    retentionType: patch.retentionType != null ? String(patch.retentionType).trim() : item.retentionType,
    retentionDate: patch.retentionDate != null
      ? String(patch.retentionDate).slice(0, 10)
      : item.retentionDate,
    retentionAmount: nextAmount,
    notes: patch.notes != null ? String(patch.notes).trim() : (item.notes || ''),
    updatedAt: new Date().toISOString(),
  };
}

export function retencionTotals(items = []) {
  const active = items.filter((r) => r.status !== 'void');
  const byType = {};
  let total = 0;
  let paymentOrders = 0;
  for (const r of active) {
    const amt = Number(r.retentionAmount) || 0;
    total += amt;
    paymentOrders += Number(r.paymentOrderAmount) || 0;
    const key = r.retentionType || 'Sin tipo';
    byType[key] = (byType[key] || 0) + amt;
  }
  return {
    count: active.length,
    total,
    paymentOrders,
    byType,
  };
}

export function compareRetenciones(a, b) {
  const da = String(a.retentionDate || '');
  const db = String(b.retentionDate || '');
  if (da !== db) return db.localeCompare(da);
  return (Number(a.lineNumber) || 0) - (Number(b.lineNumber) || 0);
}

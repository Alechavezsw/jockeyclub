/** Entradas de cuenta corriente de proveedores (Accessin / LILA). */

export const SUPPLIER_ENTRY_TYPES = {
  pago: { label: 'Pago', effect: 'credit' },
  saldo_inicial: { label: 'Saldo inicial', effect: 'debit' },
  nota_credito: { label: 'Nota de crédito', effect: 'credit' },
  bonificacion: { label: 'Bonificación / Descuento', effect: 'credit' },
  ajuste: { label: 'Ajuste de Cuenta', effect: 'debit' },
  compensacion: { label: 'Compensación', effect: 'credit' },
  nota_debito: { label: 'Nota de débito', effect: 'debit' },
  devolucion: { label: 'Devolución de Mercadería', effect: 'credit' },
  anticipo: { label: 'Anticipo', effect: 'credit' },
  factura: { label: 'Comprobante / Factura', effect: 'debit' },
  otros: { label: 'Otros', effect: 'debit' },
};

export const SUPPLIER_ENTRY_TYPE_OPTIONS = Object.entries(SUPPLIER_ENTRY_TYPES).map(([id, meta]) => ({
  id,
  label: meta.label,
  effect: meta.effect,
}));

/** Delta sobre saldo Accessin: débito suma deuda; crédito la reduce. */
export function supplierEntryBalanceDelta(type, amount) {
  const amt = Number(amount) || 0;
  const effect = SUPPLIER_ENTRY_TYPES[type]?.effect || 'debit';
  return effect === 'credit' ? -amt : amt;
}

export function createSupplierEntry({
  type = 'pago',
  supplierId,
  supplierName = '',
  accessinCode = '',
  date = new Date().toISOString().slice(0, 10),
  amount = 0,
  concept = '',
  invoiceNumber = '',
  notes = '',
}) {
  if (!SUPPLIER_ENTRY_TYPES[type]) {
    throw new Error('Tipo de entrada inválido.');
  }
  if (!supplierId && !String(supplierName || '').trim()) {
    throw new Error('Seleccioná un proveedor.');
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('El monto debe ser mayor a cero.');
  }

  const typeMeta = SUPPLIER_ENTRY_TYPES[type];
  return {
    id: `sent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    typeLabel: typeMeta.label,
    effect: typeMeta.effect,
    supplierId: supplierId || null,
    supplierName: String(supplierName || '').trim(),
    accessinCode: String(accessinCode || '').trim(),
    date: String(date || '').slice(0, 10),
    amount: value,
    balanceDelta: supplierEntryBalanceDelta(type, value),
    concept: String(concept || '').trim() || typeMeta.label,
    invoiceNumber: String(invoiceNumber || '').trim(),
    notes: String(notes || '').trim(),
    status: 'posted',
    createdAt: new Date().toISOString(),
  };
}

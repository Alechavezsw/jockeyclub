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

export const SUPPLIER_PAYMENT_METHODS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
  mercadopago: 'Mercado Pago',
  otro: 'Otro',
};

/** Delta sobre saldo Accessin: débito suma deuda; crédito la reduce. */
export function supplierEntryBalanceDelta(type, amount, effect) {
  const amt = Number(amount) || 0;
  const resolved = effect === 'credit' || effect === 'debit'
    ? effect
    : (SUPPLIER_ENTRY_TYPES[type]?.effect || 'debit');
  return resolved === 'credit' ? -amt : amt;
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
  expenseCategory = '',
  paymentMethod = '',
  effect = '',
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
  if (type === 'pago' && paymentMethod && !SUPPLIER_PAYMENT_METHODS[paymentMethod]) {
    throw new Error('Forma de pago inválida.');
  }
  if (type === 'otros' && effect && effect !== 'debit' && effect !== 'credit') {
    throw new Error('Indicá si la entrada Otros es deuda o saldo a favor.');
  }

  const typeMeta = SUPPLIER_ENTRY_TYPES[type];
  const resolvedEffect = type === 'otros'
    ? (effect === 'credit' ? 'credit' : 'debit')
    : typeMeta.effect;
  return {
    id: `sent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    typeLabel: typeMeta.label,
    effect: resolvedEffect,
    supplierId: supplierId || null,
    supplierName: String(supplierName || '').trim(),
    accessinCode: String(accessinCode || '').trim(),
    date: String(date || '').slice(0, 10),
    amount: value,
    balanceDelta: supplierEntryBalanceDelta(type, value, resolvedEffect),
    concept: String(concept || '').trim() || typeMeta.label,
    invoiceNumber: String(invoiceNumber || '').trim(),
    notes: String(notes || '').trim(),
    expenseCategory: String(expenseCategory || '').trim(),
    paymentMethod: type === 'pago' ? (paymentMethod || 'transferencia') : '',
    status: 'posted',
    createdAt: new Date().toISOString(),
  };
}

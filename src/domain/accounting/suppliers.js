/** Proveedores del club y movimientos de cuenta corriente (Accessin). */

// El padrón de proveedores vive en ./suppliersSeed. No importarlo acá: este módulo
// lo carga el store del ERP al arrancar y arrastraría CUIT y razón social al chunk
// de entrada del build.

export const SUPPLIER_CATEGORIES = {
  hipica: 'Hípica / Equinos',
  mantenimiento: 'Mantenimiento',
  gastronomia: 'Gastronomía',
  servicios: 'Servicios',
  deportes: 'Deportes / Canchas',
  general: 'General',
};

export function supplierDisplayName(supplier) {
  return String(supplier?.legalName || supplier?.name || '').trim();
}

export function supplierAccessinCode(supplier) {
  return String(supplier?.accessinCode || '').trim();
}

/** Saldo de apertura Accessin (positivo = deuda del club; negativo = a favor). */
export function supplierAccessinBalance(supplier) {
  return Number(supplier?.openingBalance) || 0;
}

export function supplierLabel(supplier) {
  const name = supplierDisplayName(supplier);
  const code = supplierAccessinCode(supplier);
  return code ? `#${code} · ${name}` : name;
}

export function compareSuppliersByAccessin(a, b) {
  const ca = Number(supplierAccessinCode(a)) || 0;
  const cb = Number(supplierAccessinCode(b)) || 0;
  if (ca !== cb) return ca - cb;
  return supplierDisplayName(a).localeCompare(supplierDisplayName(b), 'es');
}

export function accessinBalanceTotals(suppliers = []) {
  let debt = 0;
  let credit = 0;
  let withBalance = 0;
  for (const s of suppliers) {
    const bal = supplierAccessinBalance(s);
    if (bal > 0) {
      debt += bal;
      withBalance += 1;
    } else if (bal < 0) {
      credit += Math.abs(bal);
      withBalance += 1;
    }
  }
  return { debt, credit, net: debt - credit, withBalance };
}

export function createSupplier({
  legalName,
  tradeName = '',
  cuit = '',
  category = 'general',
  email = '',
  phone = '',
  address = '',
  payableAccountId = 'coa-2.1.01',
  notes = '',
  accessinCode = '',
  openingBalance = 0,
}) {
  const name = String(legalName || '').trim();
  if (!name) throw new Error('La razón social es obligatoria.');

  return {
    id: `sup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    legalName: name,
    tradeName: String(tradeName || '').trim(),
    cuit: String(cuit || '').trim(),
    category: SUPPLIER_CATEGORIES[category] ? category : 'general',
    email: String(email || '').trim(),
    phone: String(phone || '').trim(),
    address: String(address || '').trim(),
    payableAccountId: payableAccountId || 'coa-2.1.01',
    notes: String(notes || '').trim(),
    status: 'active',
    accessinCode: String(accessinCode || '').trim(),
    openingBalance: Number(openingBalance) || 0,
    createdAt: new Date().toISOString(),
  };
}

export function updateSupplier(supplier, patch = {}) {
  if (!supplier) throw new Error('Proveedor no encontrado.');
  const nextName = patch.legalName != null ? String(patch.legalName).trim() : supplier.legalName;
  if (!nextName) throw new Error('La razón social es obligatoria.');

  return {
    ...supplier,
    ...patch,
    legalName: nextName,
    tradeName: patch.tradeName != null ? String(patch.tradeName).trim() : supplier.tradeName,
    cuit: patch.cuit != null ? String(patch.cuit).trim() : supplier.cuit,
    category: patch.category && SUPPLIER_CATEGORIES[patch.category] ? patch.category : supplier.category,
    email: patch.email != null ? String(patch.email).trim() : supplier.email,
    phone: patch.phone != null ? String(patch.phone).trim() : supplier.phone,
    address: patch.address != null ? String(patch.address).trim() : supplier.address,
    notes: patch.notes != null ? String(patch.notes).trim() : supplier.notes,
    accessinCode: patch.accessinCode != null
      ? String(patch.accessinCode).trim()
      : (supplier.accessinCode || ''),
    openingBalance: patch.openingBalance != null
      ? Number(patch.openingBalance) || 0
      : (Number(supplier.openingBalance) || 0),
    updatedAt: new Date().toISOString(),
  };
}

export function setSupplierStatus(supplier, status) {
  if (!['active', 'inactive'].includes(status)) {
    throw new Error('Estado de proveedor inválido.');
  }
  return { ...supplier, status, updatedAt: new Date().toISOString() };
}

/** Gastos del proveedor: primero por id, y si no hay id, por nombre. */
export function expensesForSupplier(expenses = [], supplier) {
  if (!supplier) return [];
  const id = String(supplier.id || '');
  const keys = [supplier.legalName, supplier.name, supplier.tradeName]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  return expenses.filter((exp) => {
    if (exp.supplierId) return id && String(exp.supplierId) === id;
    const vendor = String(exp.vendorName || '').toLowerCase();
    return keys.some((k) => vendor && (vendor.includes(k) || k.includes(vendor)));
  });
}

export function entriesForSupplier(entries = [], supplier) {
  if (!supplier?.id) return [];
  const id = String(supplier.id);
  return entries.filter((entry) => (
    String(entry?.supplierId || '') === id && entry.status !== 'void'
  ));
}

/** Órdenes de pago a proveedores (no cobros de socios). */
export function paymentsForSupplier(paymentOrders = [], supplier) {
  if (!supplier) return [];
  const id = String(supplier.id || '');
  const name = supplierDisplayName(supplier).toLowerCase();
  return paymentOrders.filter((order) => {
    if (!order || order.deletedAt || order.orderKind === 'member') return false;
    if (id && order.supplierId && String(order.supplierId) === id) return true;
    const payee = String(order.payee || order.beneficiary || '').trim().toLowerCase();
    return Boolean(name) && payee === name;
  });
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Saldo de cuenta corriente: apertura Accessin + entradas − pagos que
 * todavía no tienen entrada vinculada. El saldo de apertura no se reescribe.
 */
export function supplierRunningBalance(supplier, { entries = [], paymentOrders = [] } = {}) {
  const ownEntries = entriesForSupplier(entries, supplier);
  const linkedOrders = new Set(
    ownEntries.map((entry) => entry.paymentOrderId).filter(Boolean).map(String)
  );
  const linkedEntries = new Set(ownEntries.map((entry) => String(entry.id)));
  const entryDelta = ownEntries.reduce((sum, entry) => sum + (Number(entry.balanceDelta) || 0), 0);
  const extraPayments = paymentsForSupplier(paymentOrders, supplier)
    .filter((order) => (
      !linkedOrders.has(String(order.id))
      && !linkedEntries.has(String(order.entryId || ''))
    ))
    .reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  return roundMoney(supplierAccessinBalance(supplier) + entryDelta - extraPayments);
}

/** Movimientos de la cuenta corriente, con saldo corrido después de la apertura. */
export function supplierAccountMovements(supplier, { entries = [], paymentOrders = [] } = {}) {
  const ownEntries = entriesForSupplier(entries, supplier);
  const linkedOrders = new Set(
    ownEntries.map((entry) => entry.paymentOrderId).filter(Boolean).map(String)
  );
  const linkedEntries = new Set(ownEntries.map((entry) => String(entry.id)));
  const rows = [
    ...ownEntries.map((entry) => ({
      id: entry.id,
      date: entry.date || '',
      kind: entry.typeLabel || entry.type || 'Entrada',
      concept: entry.concept || '',
      invoiceNumber: entry.invoiceNumber || '',
      category: entry.expenseCategory || '',
      delta: Number(entry.balanceDelta) || 0,
    })),
    ...paymentsForSupplier(paymentOrders, supplier)
      .filter((order) => (
        !linkedOrders.has(String(order.id))
        && !linkedEntries.has(String(order.entryId || ''))
      ))
      .map((order) => ({
        id: `pay-${order.id}`,
        date: order.date || order.dueDate || '',
        kind: 'Pago',
        concept: order.concept || order.number || 'Pago',
        invoiceNumber: order.invoiceNumber || '',
        category: '',
        delta: -((Number(order.amount) || 0)),
      })),
  ].toSorted((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));

  let balance = supplierAccessinBalance(supplier);
  return rows.map((row) => {
    balance = roundMoney(balance + row.delta);
    return { ...row, balance };
  });
}

/**
 * Deuda operativa: gastos ERP pendientes/aprobados;
 * si no hay, cae al saldo Accessin de apertura.
 */
export function supplierOpenBalance(expenses = [], supplier) {
  const fromExpenses = expensesForSupplier(expenses, supplier)
    .filter((e) => ['pending_approval', 'approved'].includes(e.status))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  if (fromExpenses) return fromExpenses;
  return supplierAccessinBalance(supplier);
}

export function supplierPaidYtd(expenses = [], supplier, year = new Date().getFullYear()) {
  return expensesForSupplier(expenses, supplier)
    .filter((e) => e.status === 'paid' && String(e.expenseDate || '').startsWith(String(year)))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

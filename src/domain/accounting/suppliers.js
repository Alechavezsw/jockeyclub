/** Proveedores del club y movimientos de cuenta corriente (Accessin). */

import {
  ACCESSIN_SUPPLIERS,
  ACCESSIN_SUPPLIERS_AS_OF,
} from '../../data/seed/accessinSuppliers';

export { ACCESSIN_SUPPLIERS_AS_OF };

export const SUPPLIER_CATEGORIES = {
  hipica: 'Hípica / Equinos',
  mantenimiento: 'Mantenimiento',
  gastronomia: 'Gastronomía',
  servicios: 'Servicios',
  deportes: 'Deportes / Canchas',
  general: 'General',
};

/** Padrón real Accessin (CC proveedores). */
export const DEFAULT_SUPPLIERS = ACCESSIN_SUPPLIERS;

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

/** Gastos vinculados a un proveedor por nombre (match flexible). */
export function expensesForSupplier(expenses = [], supplier) {
  if (!supplier) return [];
  const keys = [supplier.legalName, supplier.name, supplier.tradeName]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  return expenses.filter((exp) => {
    const vendor = String(exp.vendorName || '').toLowerCase();
    return keys.some((k) => vendor && (vendor.includes(k) || k.includes(vendor)));
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

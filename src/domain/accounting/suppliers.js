/** Proveedores del club y movimientos de cuenta corriente. */

export const SUPPLIER_CATEGORIES = {
  hipica: 'Hípica / Equinos',
  mantenimiento: 'Mantenimiento',
  gastronomia: 'Gastronomía',
  servicios: 'Servicios',
  deportes: 'Deportes / Canchas',
  general: 'General',
};

export const DEFAULT_SUPPLIERS = [
  {
    id: 'sup-1',
    legalName: 'Forrajes Cuyo SA',
    tradeName: 'Forrajes Cuyo',
    cuit: '30-71234567-8',
    category: 'hipica',
    email: 'ventas@forrajescuyo.ar',
    phone: '+54 264 420-1100',
    address: 'Av. Libertador 2450, Rivadavia',
    payableAccountId: 'coa-2.1.01',
    notes: 'Alimento equino y fardos.',
    status: 'active',
    createdAt: '2026-01-10T12:00:00.000Z',
  },
  {
    id: 'sup-2',
    legalName: 'San Juan Mantenimientos SRL',
    tradeName: 'SJ Mantenimientos',
    cuit: '30-69887766-1',
    category: 'mantenimiento',
    email: 'admin@sjmantenimientos.ar',
    phone: '+54 264 431-2200',
    address: 'Calle Mendoza 890, Capital',
    payableAccountId: 'coa-2.1.01',
    notes: 'Riego, césped y obras menores.',
    status: 'active',
    createdAt: '2026-02-05T12:00:00.000Z',
  },
  {
    id: 'sup-3',
    legalName: 'Bodega & Catering Rivadavia',
    tradeName: 'Catering Rivadavia',
    cuit: '30-55443322-9',
    category: 'gastronomia',
    email: 'eventos@cateringrivadavia.ar',
    phone: '+54 264 415-7788',
    address: 'República del Líbano 1200 Oeste',
    payableAccountId: 'coa-2.1.01',
    notes: 'Eventos y cantina.',
    status: 'active',
    createdAt: '2026-03-12T12:00:00.000Z',
  },
];

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
  const keys = [supplier.legalName, supplier.tradeName]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  return expenses.filter((exp) => {
    const vendor = String(exp.vendorName || '').toLowerCase();
    return keys.some((k) => vendor && (vendor.includes(k) || k.includes(vendor)));
  });
}

export function supplierOpenBalance(expenses = [], supplier) {
  return expensesForSupplier(expenses, supplier)
    .filter((e) => ['pending_approval', 'approved'].includes(e.status))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

export function supplierPaidYtd(expenses = [], supplier, year = new Date().getFullYear()) {
  return expensesForSupplier(expenses, supplier)
    .filter((e) => e.status === 'paid' && String(e.expenseDate || '').startsWith(String(year)))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

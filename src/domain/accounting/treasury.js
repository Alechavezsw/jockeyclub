/** Módulos de tesorería: cobranzas NN, débitos Galicia, fijos, órdenes de pago. */

export const UNIDENTIFIED_STATUS = {
  pending: 'Pendiente',
  matched: 'Identificada',
  rejected: 'Rechazada',
};

export const DEBIT_STATUS = {
  scheduled: 'Programado',
  sent: 'Enviado',
  settled: 'Acreditado',
  rejected: 'Rechazado',
};

export const PAYMENT_ORDER_STATUS = {
  draft: 'Borrador',
  approved: 'Aprobada',
  paid: 'Pagada',
  cancelled: 'Anulada',
};

export const DEFAULT_UNIDENTIFIED_COLLECTIONS = [
  {
    id: 'nn-1',
    date: '2026-07-20',
    amount: 45000,
    bankRef: 'TRANSF-88421',
    originLabel: 'Transferencia Banco Nación',
    note: 'Sin concepto / CUIT no legible',
    status: 'pending',
    matchedMemberId: null,
    createdAt: '2026-07-20T15:00:00.000Z',
  },
  {
    id: 'nn-2',
    date: '2026-07-22',
    amount: 32000,
    bankRef: 'MP-99102',
    originLabel: 'Mercado Pago',
    note: 'Alias genérico',
    status: 'pending',
    matchedMemberId: null,
    createdAt: '2026-07-22T11:20:00.000Z',
  },
];

export const DEFAULT_GALICIA_DEBITS = [
  {
    id: 'gal-1',
    period: '2026-07',
    memberName: 'Victoria Cantoni',
    memberId: '2020445599881122',
    cbuMask: '****8844',
    amount: 38000,
    status: 'sent',
    scheduledDate: '2026-07-28',
    createdAt: '2026-07-15T10:00:00.000Z',
  },
  {
    id: 'gal-2',
    period: '2026-07',
    memberName: 'Adolfo Sarmiento',
    memberId: '2018776655443322',
    cbuMask: '****1122',
    amount: 45000,
    status: 'scheduled',
    scheduledDate: '2026-07-28',
    createdAt: '2026-07-15T10:00:00.000Z',
  },
];

export const DEFAULT_FIXED_EXPENSES = [
  {
    id: 'fix-1',
    name: 'Energía eléctrica',
    vendorName: 'EDEMSA',
    amount: 285000,
    dayOfMonth: 10,
    accountHint: 'Servicios e Insumos',
    active: true,
  },
  {
    id: 'fix-2',
    name: 'Internet sede',
    vendorName: 'Claro Empresas',
    amount: 42000,
    dayOfMonth: 5,
    accountHint: 'Servicios e Insumos',
    active: true,
  },
];

export const DEFAULT_FIXED_DISCOUNTS = [
  {
    id: 'fd-1',
    name: 'Familiar conviviente',
    percent: 15,
    appliesTo: 'grupo_familiar',
    active: true,
  },
  {
    id: 'fd-2',
    name: 'Vitalicio',
    percent: 100,
    appliesTo: 'vitalicio',
    active: true,
  },
  {
    id: 'fd-3',
    name: 'Staff / cortesía',
    percent: 50,
    appliesTo: 'staff',
    active: false,
  },
];

export const DEFAULT_PAYMENT_ORDERS = [
  {
    id: 'po-1',
    number: 'OP-2026-001',
    date: '2026-07-18',
    payee: 'Forrajes Cuyo SA',
    concept: 'Alimento equino julio',
    amount: 186000,
    status: 'approved',
    paymentMethod: 'transferencia',
    createdAt: '2026-07-18T14:00:00.000Z',
  },
];

export function createUnidentifiedCollection({ date, amount, bankRef, originLabel, note }) {
  if (!amount || Number(amount) <= 0) throw new Error('Importe inválido.');
  return {
    id: `nn-${Date.now()}`,
    date: date || new Date().toISOString().slice(0, 10),
    amount: Number(amount),
    bankRef: String(bankRef || '').trim() || `REF-${Date.now()}`,
    originLabel: String(originLabel || 'Cobranza bancaria').trim(),
    note: String(note || '').trim(),
    status: 'pending',
    matchedMemberId: null,
    createdAt: new Date().toISOString(),
  };
}

export function matchUnidentifiedCollection(item, memberId) {
  if (!item || item.status !== 'pending') throw new Error('Solo se identifican cobranzas pendientes.');
  if (!memberId) throw new Error('Seleccione un socio.');
  return {
    ...item,
    status: 'matched',
    matchedMemberId: memberId,
    matchedAt: new Date().toISOString(),
  };
}

export function rejectUnidentifiedCollection(item, reason = '') {
  return {
    ...item,
    status: 'rejected',
    note: reason ? `${item.note || ''} · Rechazo: ${reason}`.trim() : item.note,
    rejectedAt: new Date().toISOString(),
  };
}

export function createGaliciaDebit({ period, memberName, memberId, cbuMask, amount, scheduledDate }) {
  if (!memberId || !amount) throw new Error('Socio e importe son obligatorios.');
  return {
    id: `gal-${Date.now()}`,
    period: period || new Date().toISOString().slice(0, 7),
    memberName: memberName || '',
    memberId,
    cbuMask: cbuMask || '****0000',
    amount: Number(amount),
    status: 'scheduled',
    scheduledDate: scheduledDate || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  };
}

export function setGaliciaDebitStatus(item, status) {
  if (!DEBIT_STATUS[status]) throw new Error('Estado inválido.');
  return { ...item, status, updatedAt: new Date().toISOString() };
}

export function createFixedExpense({ name, vendorName, amount, dayOfMonth, accountHint }) {
  if (!String(name || '').trim() || !amount) throw new Error('Nombre e importe son obligatorios.');
  return {
    id: `fx-${Date.now()}`,
    name: String(name).trim(),
    vendorName: String(vendorName || '').trim(),
    amount: Number(amount),
    dayOfMonth: Math.min(28, Math.max(1, Number(dayOfMonth) || 1)),
    accountHint: String(accountHint || 'Servicios e Insumos').trim(),
    active: true,
  };
}

export function createFixedDiscount({ name, percent, appliesTo }) {
  if (!String(name || '').trim()) throw new Error('Nombre obligatorio.');
  const p = Number(percent);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('Porcentaje inválido (0-100).');
  return {
    id: `fd-${Date.now()}`,
    name: String(name).trim(),
    percent: p,
    appliesTo: appliesTo || 'general',
    active: true,
  };
}

export function createPaymentOrder({ date, payee, concept, amount, paymentMethod }) {
  if (!String(payee || '').trim() || !amount) throw new Error('Beneficiario e importe son obligatorios.');
  const stamp = new Date();
  const number = `OP-${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`;
  return {
    id: `po-${Date.now()}`,
    number,
    date: date || stamp.toISOString().slice(0, 10),
    payee: String(payee).trim(),
    concept: String(concept || '').trim(),
    amount: Number(amount),
    status: 'draft',
    paymentMethod: paymentMethod || 'transferencia',
    createdAt: stamp.toISOString(),
  };
}

export function setPaymentOrderStatus(order, status) {
  if (!PAYMENT_ORDER_STATUS[status]) throw new Error('Estado inválido.');
  return { ...order, status, updatedAt: new Date().toISOString() };
}

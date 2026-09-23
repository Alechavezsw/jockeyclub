/**
 * Movimientos de cuenta de socio: alta, edición y baja lógica.
 *
 * Vive separado de memberBalances.js a propósito: estas funciones son puras y las
 * necesitan el store del ERP y el historial de pagos del socio, que se cargan al
 * arrancar la app. memberBalances.js importa los snapshots de Accessin (varios MB
 * con DNI de socios), así que importar desde allí arrastraba esos datos al chunk
 * de entrada del build. No agregar imports de ../../data/seed/ en este archivo.
 */

export const ACCOUNT_ENTRY_TYPES = [
  { id: 'pago', label: 'Pago' },
  { id: 'cuota', label: 'Cuota' },
  { id: 'recargo', label: 'Recargo de Cuota (FIJO)' },
  { id: 'descuento', label: 'Descuento' },
  { id: 'interes', label: 'Interés' },
  { id: 'otro', label: 'Otros' },
];

function uid(prefix = 'mae') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function padMember(n) {
  return String(n || '').replace(/\D/g, '') || String(n || '');
}

export function createAccountEntry(input = {}) {
  const type = ACCOUNT_ENTRY_TYPES.some((t) => t.id === input.type) ? input.type : 'pago';
  const typeLabel = ACCOUNT_ENTRY_TYPES.find((t) => t.id === type)?.label || type;
  const memberNumber = padMember(input.memberNumber || input.memberId);
  if (!memberNumber) throw new Error('Indicá el socio.');
  const rawValue = Number(input.value);
  if (!Number.isFinite(rawValue)) throw new Error('El valor es obligatorio.');
  const value = type === 'pago' ? -Math.abs(rawValue) : Math.abs(rawValue);
  return {
    id: input.id || uid('mae'),
    accessinId: input.accessinId || null,
    memberNumber,
    memberName: String(input.memberName || '').trim(),
    date: input.date || new Date().toISOString().slice(0, 10),
    type,
    typeLabel,
    description: String(input.description || '').trim(),
    value,
    voucher: String(input.voucher || '').trim(),
    paymentMethods: input.paymentMethods || [],
    allocations: input.allocations || [],
    isActive: input.isActive !== false,
    source: input.source || 'manual',
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function upsertAccountEntry(list = [], input = {}) {
  const existing = (list || []).find((e) => e.id === input.id) || null;
  const next = createAccountEntry({
    ...existing,
    ...input,
    id: existing?.id || input.id,
    createdAt: existing?.createdAt,
    source: existing?.source || input.source || 'manual',
  });
  if (existing) return (list || []).map((e) => (e.id === existing.id ? next : e));
  return [next, ...(list || [])];
}

export function softDeleteAccountEntry(list = [], id) {
  return (list || []).map((e) => (
    e.id === id ? { ...e, isActive: false, updatedAt: new Date().toISOString() } : e
  ));
}

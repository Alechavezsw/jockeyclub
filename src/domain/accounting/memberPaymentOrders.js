/** Órdenes de pago de socios (cobros Lila): listado, detalle y efecto en la deuda. */

import { LILA_BALANCE_CUT } from './currentAccountBalances';

export const MEMBER_PAYMENT_ORDER_STATUS = {
  pending: 'Pendiente',
  processing: 'En proceso',
  imputed: 'Imputada',
  failed: 'Fallida',
  expired: 'Expirada',
  cancelled: 'Cancelada',
};

/** Lila muestra eliminar en imputada, cancelada, expirada y fallida. En proceso y pendiente no. */
export const DELETABLE_MEMBER_PAYMENT_ORDER_STATUSES = new Set(['imputed', 'failed', 'expired', 'cancelled']);

export const MEMBER_PAYMENT_ORDER_PAGE_SIZE = 30;

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function isMemberPaymentOrder(order) {
  return order?.orderKind === 'member' && !order.deletedAt;
}

export function formatPaymentOrderDate(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '—';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return '—';
  return `${match[3]} de ${month} del ${match[1]}`;
}

export function memberPaymentOrderStatusLabel(status) {
  return MEMBER_PAYMENT_ORDER_STATUS[status] || status || '—';
}

export function canDeleteMemberPaymentOrder(order) {
  return isMemberPaymentOrder(order) && DELETABLE_MEMBER_PAYMENT_ORDER_STATUSES.has(order.status);
}

function balanceMemberNumber(value) {
  return String(value || '').replace(/\D/g, '').replace(/^0+/, '');
}

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function filterMemberPaymentOrders(orders = [], filters = {}) {
  const status = filters.status || '';
  const responsible = fold(filters.responsible);
  const memberNumber = String(filters.memberNumber || '').replace(/\D/g, '');
  return (orders || []).filter((order) => {
    if (!isMemberPaymentOrder(order)) return false;
    if (status && order.status !== status) return false;
    if (responsible && !fold(order.responsible).includes(responsible)) return false;
    if (memberNumber && !String(order.memberNumber || '').replace(/\D/g, '').includes(memberNumber)) return false;
    return true;
  });
}

export function sortMemberPaymentOrders(orders = []) {
  return (orders || []).toSorted((a, b) => (
    String(b.date || '').localeCompare(String(a.date || ''))
    || (Number(b.number) || 0) - (Number(a.number) || 0)
  ));
}

export function pageMemberPaymentOrders(orders = [], page = 1, pageSize = MEMBER_PAYMENT_ORDER_PAGE_SIZE) {
  const size = pageSize > 0 ? pageSize : MEMBER_PAYMENT_ORDER_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil((orders || []).length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return {
    page: current,
    pages,
    rows: (orders || []).slice(start, start + size),
  };
}

/**
 * Al cargar, solo las imputadas posteriores al corte de saldos bajan la deuda.
 * Las anteriores ya están dentro del saldo del padrón.
 */
export function importBalanceDelta(order, cut = LILA_BALANCE_CUT.asOf) {
  if (!order || order.status !== 'imputed') return 0;
  if (String(order.date || '') <= String(cut || '')) return 0;
  const amount = Number(order.amount) || 0;
  return amount > 0 ? -amount : 0;
}

/**
 * Eliminar una imputada devuelve la deuda.
 * Si el cobro es posterior al corte y esta app no lo descontó, el saldo no se toca.
 */
export function memberPaymentOrderDeleteEffect(order, cut = LILA_BALANCE_CUT.asOf) {
  const memberNumber = balanceMemberNumber(order?.memberNumber);
  if (!order || order.status !== 'imputed' || !memberNumber) {
    return { memberNumber, amount: 0, reversesBalance: false };
  }
  const amount = Number(order.amount) || 0;
  if (!(amount > 0)) return { memberNumber, amount: 0, reversesBalance: false };
  const afterCut = String(order.date || '') > String(cut || '');
  if (afterCut && !order.balanceApplied) {
    return { memberNumber, amount: 0, reversesBalance: false };
  }
  return { memberNumber, amount, reversesBalance: true };
}

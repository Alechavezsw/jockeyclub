import { describe, expect, it } from 'vitest';
import {
  canDeleteMemberPaymentOrder,
  filterMemberPaymentOrders,
  formatPaymentOrderDate,
  importBalanceDelta,
  memberPaymentOrderDeleteEffect,
  pageMemberPaymentOrders,
  sortMemberPaymentOrders,
} from './memberPaymentOrders';

const orders = [
  {
    id: '1', orderKind: 'member', number: '100', date: '2026-10-02',
    memberNumber: '10377', responsible: 'Yubel Fabio Rafael', status: 'imputed',
    amount: 70000, balanceApplied: true,
  },
  {
    id: '2', orderKind: 'member', number: '90', date: '2026-10-01',
    memberNumber: '11004', responsible: 'Vera Maria Eugenia', status: 'processing',
    amount: 198000,
  },
  {
    id: '3', orderKind: 'member', number: '80', date: '2026-09-15',
    memberNumber: '10377', responsible: 'Yubel Fabio Rafael', status: 'expired',
    amount: 70000, deletedAt: '2026-10-01',
  },
  {
    id: '4', orderKind: 'supplier', number: 'OP-1', date: '2026-10-02',
    payee: 'Acme', status: 'draft', amount: 10,
  },
];

describe('member payment orders', () => {
  it('formatea la fecha como el listado', () => {
    expect(formatPaymentOrderDate('2026-10-02')).toBe('02 de Octubre del 2026');
    expect(formatPaymentOrderDate('')).toBe('—');
  });

  it('filtra por estado, responsable y número de socio', () => {
    const rows = filterMemberPaymentOrders(orders, {
      status: 'imputed',
      responsible: 'yubel',
      memberNumber: '0377',
    });
    expect(rows.map((row) => row.id)).toEqual(['1']);
  });

  it('ordena por fecha y número, y pagina de a 30', () => {
    const sorted = sortMemberPaymentOrders(filterMemberPaymentOrders(orders, {}));
    expect(sorted.map((row) => row.number)).toEqual(['100', '90']);
    const page = pageMemberPaymentOrders(sorted, 1, 1);
    expect(page.pages).toBe(2);
    expect(page.rows).toHaveLength(1);
  });

  it('permite eliminar imputada, expirada y cancelada', () => {
    expect(canDeleteMemberPaymentOrder(orders[0])).toBe(true);
    expect(canDeleteMemberPaymentOrder(orders[1])).toBe(false);
    expect(canDeleteMemberPaymentOrder({ ...orders[2], deletedAt: null })).toBe(true);
    expect(canDeleteMemberPaymentOrder({ ...orders[1], status: 'cancelled' })).toBe(true);
  });

  it('descuenta en la carga solo lo imputado después del corte', () => {
    expect(importBalanceDelta(orders[0])).toBe(-70000);
    expect(importBalanceDelta({ ...orders[0], date: '2026-09-30' })).toBe(0);
    expect(importBalanceDelta(orders[1])).toBe(0);
  });

  it('al eliminar una imputada devuelve la deuda', () => {
    expect(memberPaymentOrderDeleteEffect(orders[0])).toEqual({
      memberNumber: '10377',
      amount: 70000,
      reversesBalance: true,
    });
    expect(memberPaymentOrderDeleteEffect({
      ...orders[0],
      date: '2026-10-02',
      balanceApplied: false,
    }).reversesBalance).toBe(false);
    expect(memberPaymentOrderDeleteEffect({
      ...orders[0],
      date: '2026-09-15',
      balanceApplied: false,
    })).toMatchObject({ amount: 70000, reversesBalance: true });
    expect(memberPaymentOrderDeleteEffect(orders[1]).reversesBalance).toBe(false);
    expect(memberPaymentOrderDeleteEffect({
      ...orders[0],
      memberNumber: '09782',
    }).memberNumber).toBe('9782');
  });
});

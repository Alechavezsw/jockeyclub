import { describe, expect, it } from 'vitest';
import { buildCashPaymentDetail, cashPaymentShareTargets, currentMonthFeeCollected } from './cashPaymentDetail';

const macro = {
  id: 'acm-603050',
  date: '2026-10-01',
  amount: 39600,
  typeLabel: 'Pago Electrónico desde Macro Click de Pago',
  accessinId: 603050,
  description: '11777',
  memberNumber: '11777',
  movementType: 'income',
};

describe('detalle de un movimiento de caja', () => {
  it('arma el recibo del pago electrónico con la referencia de caja', () => {
    const detail = buildCashPaymentDetail(macro, [], [
      { memberId: '11777', name: 'Gonzalo Vera Trincado', phone: '2645550101', email: 'gonzalo@club.test' },
    ]);
    expect(detail.title).toMatch(/Pago #603050/);
    expect(detail.title).toMatch(/11777/);
    expect(detail.memberName).toBe('Gonzalo Vera Trincado');
    expect(detail.phone).toBe('2645550101');
    expect(detail.email).toBe('gonzalo@club.test');
    expect(detail.paymentTotal).toBe(39600);
    expect(detail.paymentMethods[0]).toMatchObject({
      label: 'Pago Electrónico desde Macro Click de Pago',
      reference: '603050',
      amount: 39600,
    });
    expect(detail.surplus).toBe(0);
  });

  it('imputa las líneas del recibo electrónico y no las de otro medio', () => {
    const detail = buildCashPaymentDetail(macro, [
      {
        id: 'cuota',
        receiptId: '3468560',
        date: '2026-10-01',
        memberNumber: '11777',
        type: 'Cuota',
        concept: 'Septiembre del 2026',
        amount: 36000,
        electronicAmount: 39600,
        paymentMethod: 'electronico',
        paymentNote: 'Pago desde la app - orden #20771 (banco macro)',
        voucher: '1GTRCE74WF-1790047605.p',
      },
      {
        id: 'recargo',
        receiptId: '3468560',
        date: '2026-10-01',
        memberNumber: '11777',
        type: 'Recargo de Cuota (10.00 %)',
        concept: 'Septiembre del 2026',
        amount: 3600,
        paymentMethod: 'electronico',
      },
      {
        id: 'otro',
        receiptId: '999',
        date: '2026-10-01',
        memberNumber: '11777',
        type: 'Cuota',
        concept: 'Otro',
        amount: 1000,
        cashAmount: 1000,
        paymentMethod: 'efectivo',
      },
    ]);
    expect(detail.paymentNumber).toBe('3468560');
    expect(detail.description).toMatch(/orden #20771/);
    expect(detail.voucher).toBe('1GTRCE74WF-1790047605.p');
    expect(detail.applied.map((row) => row.amount)).toEqual([36000, 3600]);
    expect(detail.surplus).toBe(0);
  });

  it('separa la cuota de septiembre y el recargo del 10 %', () => {
    const detail = buildCashPaymentDetail({
      ...macro,
      id: 'acm-603166',
      accessinId: 603166,
      amount: 66000,
      memberNumber: '10676',
      description: '10676',
    }, [], [{
      memberId: '10676',
      name: 'Matias German Guarache',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
    }]);
    expect(detail.applied).toEqual([
      {
        id: 'cuota-2026-09',
        date: '2026-09-01',
        type: 'Cuota',
        description: 'Septiembre del 2026',
        amount: 60000,
        cancelled: 60000,
      },
      {
        id: 'recargo-2026-09',
        date: '2026-09-10',
        type: 'Recargo de Cuota (10.00 %)',
        description: 'Septiembre del 2026',
        amount: 6000,
        cancelled: 6000,
      },
    ]);
    expect(detail.paymentTotal).toBe(66000);
    expect(detail.surplus).toBe(0);
  });

  it('arma WhatsApp al celular y mail al correo del socio', () => {
    const detail = buildCashPaymentDetail(macro, [], [
      { memberId: '11777', name: 'Gonzalo', phone: '2645550101', email: 'gonzalo@club.test' },
    ]);
    const share = cashPaymentShareTargets(detail, (n) => `$ ${n}`);
    expect(share.whatsappUrl).toContain('https://wa.me/5492645550101');
    expect(decodeURIComponent(share.whatsappUrl)).toMatch(/Gonzalo/);
    expect(decodeURIComponent(share.whatsappUrl)).toMatch(/\$ 39600/);
    expect(share.mailUrl).toMatch(/^mailto:gonzalo@club\.test/);
    expect(cashPaymentShareTargets({ ...detail, phone: '', email: '' }).whatsappUrl).toBeNull();
    expect(cashPaymentShareTargets({ ...detail, phone: '', email: '' }).mailUrl).toBeNull();
  });
});

describe('cuota cobrada del mes corriente', () => {
  const members = [
    { memberId: '10567', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] },
    { memberId: '10568', tier: 'socio_individual', cuotaCategories: ['SOCIO INDIVIDUAL'] },
    { memberId: '10676', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] },
  ];

  it('cuenta la cuota de octubre y deja afuera el mes anterior y el resto de la caja', () => {
    expect(currentMonthFeeCollected([
      { accessinId: 1, date: '2026-10-01', amount: 70000, memberNumber: '10567', movementType: 'income' },
      { accessinId: 1, date: '2026-10-01', amount: 70000, memberNumber: '10567', movementType: 'income' },
      { accessinId: 2, date: '2026-10-01', amount: 40000, memberNumber: '10568', movementType: 'income' },
      { accessinId: 3, date: '2026-10-01', amount: 66000, memberNumber: '10676', movementType: 'income' },
      { accessinId: 4, date: '2026-10-01', amount: 115600, memberNumber: '10568', movementType: 'income' },
      { accessinId: 5, date: '2026-09-30', amount: 60000, memberNumber: '10567', movementType: 'income' },
    ], members, '2026-10')).toBe(110000);
  });

  it('después del 10 cuenta la cuota del mes, sin el recargo', () => {
    expect(currentMonthFeeCollected([
      { accessinId: 6, date: '2026-10-15', amount: 77000, memberNumber: '10567', movementType: 'income' },
    ], members, '2026-10')).toBe(70000);
  });
});

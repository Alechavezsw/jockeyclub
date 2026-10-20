import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { payExpense } from './expenses';
import {
  buildLiveImpuestos,
  classifyRetention,
  compraFromExpense,
  createComprobante,
  currentTaxPeriod,
  DEFAULT_FISCAL_PROFILE,
  journalForComprobante,
  liveCompraFromExpense,
  liveVentaFromOtherIncome,
  liquidatePeriod,
  priceLine,
  splitPurchaseTotal,
  voucherTotals,
} from './impuestos';

const ri = { condition: 'responsable_inscripto', iibbPercent: 3, pointOfSale: '1' };

describe('priceLine', () => {
  it('suma el IVA en factura A de un responsable inscripto', () => {
    const line = priceLine({
      quantity: 2,
      unitPrice: 100,
      bonusPercent: 10,
      aliquotId: 'iva-21',
      iibbPercent: 3,
      discriminatesIva: true,
      condition: 'responsable_inscripto',
    });
    expect(line.net).toBe(180);
    expect(line.iva).toBe(37.8);
    expect(line.iibb).toBe(5.4);
    expect(line.total).toBe(223.2);
  });

  it('no discrimina IVA si el club está exento', () => {
    const line = priceLine({
      quantity: 1,
      unitPrice: 121,
      aliquotId: 'iva-21',
      discriminatesIva: true,
      condition: 'exento',
    });
    expect(line.iva).toBe(0);
    expect(line.net).toBe(121);
  });

  it('destapa el IVA incluido en factura B', () => {
    const line = priceLine({
      quantity: 1,
      unitPrice: 121,
      aliquotId: 'iva-21',
      discriminatesIva: false,
      condition: 'responsable_inscripto',
    });
    expect(line.net).toBe(100);
    expect(line.iva).toBe(21);
    expect(line.total).toBe(121);
  });
});

describe('comprobantes y liquidación', () => {
  it('la nota de crédito resta débito fiscal', () => {
    const venta = createComprobante({
      book: 'venta',
      letter: 'A',
      date: '2026-10-05',
      counterpartyName: 'Socio evento',
      lines: [{ quantity: 1, unitPrice: 100, aliquotId: 'iva-21' }],
    }, ri);
    const nota = createComprobante({
      book: 'venta',
      letter: 'NCA',
      date: '2026-10-06',
      counterpartyName: 'Socio evento',
      lines: [{ quantity: 1, unitPrice: 40, aliquotId: 'iva-21' }],
    }, ri);
    expect(voucherTotals(venta, ri).iva).toBe(21);
    expect(voucherTotals(nota, ri).iva).toBe(-8.4);

    const iva = liquidatePeriod({
      period: '2026-10',
      kind: 'iva',
      vouchers: [venta, nota],
      profile: ri,
    });
    expect(iva.debito).toBe(12.6);
    expect(iva.aPagar).toBe(12.6);
  });

  it('el IVA de compras y las retenciones practicadas no se mezclan', () => {
    const compra = createComprobante({
      book: 'compra',
      letter: 'A',
      date: '2026-10-08',
      counterpartyName: 'Proveedor',
      lines: [{ quantity: 1, unitPrice: 200, aliquotId: 'iva-10-5' }],
    }, ri);
    const iva = liquidatePeriod({
      period: '2026-10',
      kind: 'iva',
      vouchers: [compra],
      retenciones: [{
        status: 'recorded',
        retentionDate: '2026-10-09',
        retentionType: 'Retenciones de IVA',
        retentionAmount: 15,
      }],
      profile: ri,
    });
    expect(iva.credito).toBe(21);
    expect(iva.retencionesPracticadas).toBe(15);
    expect(iva.saldo).toBe(-21);
  });

  it('IIBB toma el débito de ventas y resta SIRCREB', () => {
    const venta = createComprobante({
      book: 'venta',
      letter: 'C',
      date: '2026-10-02',
      counterpartyName: 'Cantina',
      lines: [{ quantity: 1, unitPrice: 1000, aliquotId: 'exento' }],
    }, { ...ri, iibbPercent: 3 });
    const sircreb = createComprobante({
      book: 'sircreb',
      date: '2026-10-20',
      counterpartyName: 'Banco',
      amount: 10,
      taxKind: 'iibb',
    });
    const iibb = liquidatePeriod({
      period: '2026-10',
      kind: 'iibb',
      vouchers: [venta, sircreb],
      profile: { ...ri, iibbPercent: 3 },
    });
    expect(voucherTotals(venta, { ...ri, iibbPercent: 3 }).iibb).toBe(30);
    expect(iibb.debito).toBe(30);
    expect(iibb.sircreb).toBe(10);
    expect(iibb.aPagar).toBe(20);
  });

  it('clasifica retenciones de San Juan como IIBB', () => {
    expect(classifyRetention('Retencion IIBB de San Juan')).toBe('iibb');
    expect(classifyRetention('Retenciones de Ganancias')).toBe('ganancias');
  });

  it('el asiento de una venta A queda balanceado', () => {
    const venta = createComprobante({
      book: 'venta',
      letter: 'A',
      date: '2026-10-11',
      counterpartyName: 'Evento',
      paymentTerm: 'contado',
      lines: [{ quantity: 1, unitPrice: 100, aliquotId: 'iva-21' }],
    }, ri);
    const entry = journalForComprobante(venta, DEFAULT_CHART_OF_ACCOUNTS, ri);
    const debit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(venta.totals.total, 2);
  });
});

describe('gastos con IVA', () => {
  it('destapa el crédito fiscal sin cambiar el egreso de caja', () => {
    const split = splitPurchaseTotal(121, 'iva-21', 'responsable_inscripto');
    expect(split).toMatchObject({ net: 100, iva: 21, total: 121 });

    const { journalEntry } = payExpense({
      id: 'exp-1',
      expenseDate: '2026-10-12',
      vendorName: 'Luz',
      concept: 'Servicio',
      amount: 121,
      categoryAccountId: 'coa-5.1.04',
      paymentAccountId: 'coa-1.1.01',
      status: 'approved',
      ivaAliquotId: 'iva-21',
      fiscalCondition: 'responsable_inscripto',
    }, DEFAULT_CHART_OF_ACCOUNTS);

    const caja = journalEntry.lines.find((line) => line.accountId === 'coa-1.1.01');
    const credito = journalEntry.lines.find((line) => line.accountId === 'coa-1.1.04');
    expect(caja.credit).toBe(121);
    expect(credito.debit).toBe(21);
  });

  it('un gasto exento no genera crédito ni comprobante', () => {
    expect(compraFromExpense({
      id: 'exp-2',
      amount: 121,
      ivaAliquotId: 'iva-21',
      fiscalCondition: 'exento',
      expenseDate: '2026-10-12',
      vendorName: 'Luz',
      concept: 'Servicio',
    })).toBeNull();
  });
});

describe('posición fiscal viva', () => {
  it('el período sigue el calendario de San Juan, no UTC', () => {
    expect(currentTaxPeriod(new Date('2026-10-20T00:30:00.000Z'))).toBe('2026-10');
    expect(currentTaxPeriod(new Date('2026-11-01T02:00:00.000Z'))).toBe('2026-10');
  });

  it('un gasto pagado entra como compra aunque el club esté exento', () => {
    const compra = liveCompraFromExpense({
      id: 'exp-luz',
      status: 'paid',
      amount: 80000,
      expenseDate: '2026-10-08',
      vendorName: 'EDEMSA',
      concept: 'Energía',
    }, DEFAULT_FISCAL_PROFILE);
    expect(compra.book).toBe('compra');
    expect(compra.totals.iva).toBe(0);
    expect(compra.totals.total).toBe(80000);
  });

  it('las cuotas de otros ingresos no se facturan; un evento sí entra a IIBB', () => {
    expect(liveVentaFromOtherIncome({
      id: 'oi-cuota',
      date: '2026-10-05',
      group: 'cuotas',
      payerName: 'Socio',
      concept: 'Cuota octubre',
      amount: 70000,
      status: 'posted',
    })).toBeNull();

    const evento = liveVentaFromOtherIncome({
      id: 'oi-fiesta',
      date: '2026-10-12',
      group: 'eventos',
      payerName: 'Quinta',
      concept: 'Salón',
      amount: 1000,
      status: 'posted',
    }, { condition: 'exento', iibbPercent: 3, pointOfSale: '1' });
    expect(evento.totals.iva).toBe(0);
    expect(evento.totals.iibb).toBe(30);
  });

  it('arma el tablero del mes con gastos, ingresos y retenciones sin duplicar comprobantes', () => {
    const gasto = {
      id: 'exp-luz',
      status: 'paid',
      amount: 10000,
      expenseDate: '2026-10-08',
      vendorName: 'Luz',
      concept: 'Energía',
    };
    const live = buildLiveImpuestos({
      period: '2026-10',
      today: new Date('2026-10-19T21:00:00-03:00'),
      profile: DEFAULT_FISCAL_PROFILE,
      expenses: [gasto, { ...gasto, id: 'exp-old', expenseDate: '2026-09-01' }],
      otherIncomes: [{
        id: 'oi-fiesta',
        date: '2026-10-12',
        group: 'eventos',
        payerName: 'Quinta',
        concept: 'Salón',
        amount: 5000,
        status: 'posted',
      }],
      retenciones: [{
        id: 'ret-1',
        status: 'recorded',
        retentionDate: '2026-10-09',
        retentionType: 'Retencion IIBB de San Juan',
        retentionAmount: 250,
        supplierName: 'Banco',
      }],
      vouchers: [createComprobante({
        id: 'cmp-exp-exp-luz',
        book: 'compra',
        letter: 'C',
        date: '2026-10-08',
        counterpartyName: 'Luz',
        sourceId: 'exp-luz',
        lines: [{ quantity: 1, unitPrice: 10000, aliquotId: 'exento' }],
      })],
    });
    expect(live.period).toBe('2026-10');
    expect(live.gastosCount).toBe(1);
    expect(live.ingresosCount).toBe(1);
    expect(live.retencionesAmount).toBe(250);
    expect(live.impliedCount).toBe(1);
    expect(live.board.iva.aPagar).toBe(0);
    expect(live.activity.some((row) => row.origin === 'gasto')).toBe(false);
    expect(live.activity.some((row) => row.origin === 'ingreso')).toBe(true);
  });

  it('el tablero toma ingresos y gastos del libro del mes sin facturar cuotas', () => {
    const live = buildLiveImpuestos({
      period: '2026-10',
      profile: DEFAULT_FISCAL_PROFILE,
      chartOfAccounts: [],
      journalEntries: [{
        date: '2026-10-01',
        status: 'posted',
        lines: [
          { account: 'Cuotas Sociales', type: 'credit', amount: 70000 },
          { account: 'Servicios e Insumos', type: 'debit', amount: 12000 },
        ],
      }],
    });
    expect(live.bookIncome).toBe(70000);
    expect(live.bookExpense).toBe(12000);
    expect(live.cashIn).toBe(0);
    expect(live.board.iva.aPagar).toBe(0);
    expect(live.activity.some((row) => row.originLabel.includes('no se facturan'))).toBe(true);
  });

  it('los cobros de tesorería del mes aparecen aunque no sean ingreso fiscal', () => {
    const live = buildLiveImpuestos({
      period: '2026-10',
      profile: DEFAULT_FISCAL_PROFILE,
      chartOfAccounts: [],
      journalEntries: [{
        date: '2026-10-13',
        status: 'posted',
        lines: [
          { account: 'Banco Nación', type: 'debit', amount: 1462000 },
          { account: 'Cuentas a Cobrar', type: 'credit', amount: 1462000 },
        ],
      }],
    });
    expect(live.cashIn).toBe(1462000);
    expect(live.bookIncome).toBe(0);
    expect(live.activity.some((row) => row.origin === 'cobro' && row.total === 1462000)).toBe(true);
  });

  it('trata Banco Nación como tesorería aunque el plan no lo marque caja', () => {
    const live = buildLiveImpuestos({
      period: '2026-10',
      profile: DEFAULT_FISCAL_PROFILE,
      chartOfAccounts: [{
        id: 'bank-1',
        code: '1.1.03',
        name: 'Banco Nación',
        accountType: 'asset',
        isCashAccount: false,
      }],
      journalEntries: [{
        date: '2026-10-13',
        status: 'posted',
        lines: [
          { account: 'Banco Nación', type: 'debit', amount: 3385635 },
          { account: 'Cuentas a Cobrar', type: 'credit', amount: 3385635 },
        ],
      }],
    });
    expect(live.cashIn).toBe(3385635);
  });
});

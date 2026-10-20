import { describe, expect, it } from 'vitest';
import { todayISODateAR } from '../../lib/arDate';
import {
  buildLiveRetenciones,
  createRetencion,
  filterRetenciones,
  mergeLiveRetenciones,
  retencionTotals,
} from './retenciones';

describe('retenciones', () => {
  it('crea retención con fecha de Argentina y totaliza por tipo', () => {
    const a = createRetencion({
      supplierName: 'Proveedor Demo',
      retentionType: 'Ganancias',
      retentionAmount: 1500,
      paymentOrderAmount: 10000,
    });
    const b = createRetencion({
      supplierName: 'Otro',
      retentionType: 'IVA',
      retentionAmount: 500,
    });
    expect(a.retentionDate).toBe(todayISODateAR());
    expect(a.asOf).toBe(todayISODateAR());
    const totals = retencionTotals([a, b]);
    expect(totals.count).toBe(2);
    expect(totals.total).toBe(2000);
    expect(totals.byType.Ganancias).toBe(1500);
    expect(totals.byType.IVA).toBe(500);
  });

  it('el tablero vivo usa el mes corriente y ignora anuladas', () => {
    const live = buildLiveRetenciones({
      today: new Date('2026-10-19T18:00:00-03:00'),
      retenciones: [
        {
          id: 'r1',
          retentionDate: '2026-10-09',
          retentionType: 'Retenciones de IVA',
          retentionAmount: 15,
          paymentOrderAmount: 200,
          status: 'recorded',
        },
        {
          id: 'r2',
          retentionDate: '2026-09-12',
          retentionType: 'Ganancias',
          retentionAmount: 80,
          paymentOrderAmount: 1000,
          status: 'recorded',
        },
        {
          id: 'r3',
          retentionDate: '2026-10-01',
          retentionType: 'IVA',
          retentionAmount: 40,
          status: 'void',
        },
      ],
    });
    expect(live.asOf).toBe('2026-10-19');
    expect(live.asOfLabel).toBe('19 de octubre de 2026');
    expect(live.count).toBe(2);
    expect(live.total).toBe(95);
    expect(live.monthCount).toBe(1);
    expect(live.monthTotal).toBe(15);
    expect(live.periodFrom).toBe('2026-09-12');
    expect(live.periodTo).toBe('2026-10-09');
  });

  it('suma retenciones de órdenes de pago que todavía no están en el registro', () => {
    const stored = createRetencion({
      supplierName: 'Ya cargado',
      paymentOrderNumber: 'OP-1',
      paymentOrderId: 'po-1',
      retentionAmount: 10,
      retentionDate: '2026-10-02',
    });
    const merged = mergeLiveRetenciones([stored], [
      { id: 'po-1', number: 'OP-1', payee: 'Ya cargado', amount: 100, retentionAmount: 10, date: '2026-10-02' },
      { id: 'po-2', number: 'OP-2', payee: 'Nuevo', amount: 500, retentionAmount: 25, date: '2026-10-18' },
      { id: 'po-m', orderKind: 'member', retentionAmount: 99, date: '2026-10-18' },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.some((row) => row.id === 'ret-op-po-2')).toBe(true);

    const live = buildLiveRetenciones({
      today: new Date('2026-10-19T18:00:00-03:00'),
      retenciones: [stored],
      paymentOrders: [
        { id: 'po-2', number: 'OP-2', payee: 'Nuevo', amount: 500, retentionAmount: 25, date: '2026-10-18' },
      ],
    });
    expect(live.count).toBe(2);
    expect(live.total).toBe(35);
    expect(live.monthTotal).toBe(35);
  });

  it('filtra por mes y tipo', () => {
    const rows = [
      { retentionDate: '2026-10-09', retentionType: 'IVA', retentionAmount: 15, supplierName: 'A' },
      { retentionDate: '2026-09-12', retentionType: 'Ganancias', retentionAmount: 80, supplierName: 'B' },
    ];
    expect(filterRetenciones(rows, { monthKey: '2026-10' })).toHaveLength(1);
    expect(filterRetenciones(rows, { type: 'Ganancias' })[0].supplierName).toBe('B');
  });
});

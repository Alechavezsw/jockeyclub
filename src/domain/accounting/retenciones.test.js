import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  createRetencion,
  retencionesSeed,
  retencionTotals,
} from './retenciones';

let ACCESSIN_RETENCIONES_PERIOD_FROM;
let ACCESSIN_RETENCIONES_PERIOD_TO;

beforeAll(async () => {
  await loadSnapshots(['accessinRetenciones']);
  ({ ACCESSIN_RETENCIONES_PERIOD_FROM, ACCESSIN_RETENCIONES_PERIOD_TO } = retencionesSeed());
});

describe('retenciones', () => {
  it('expone el período Accessin del resumen', () => {
    expect(ACCESSIN_RETENCIONES_PERIOD_FROM).toBe('2026-03-02');
    expect(ACCESSIN_RETENCIONES_PERIOD_TO).toBe('2026-09-02');
  });

  it('crea retención y totaliza por tipo', () => {
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
    const totals = retencionTotals([a, b]);
    expect(totals.count).toBe(2);
    expect(totals.total).toBe(2000);
    expect(totals.byType.Ganancias).toBe(1500);
    expect(totals.byType.IVA).toBe(500);
  });
});

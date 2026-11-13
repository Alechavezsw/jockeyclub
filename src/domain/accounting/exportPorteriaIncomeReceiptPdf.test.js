import { describe, expect, it } from 'vitest';
import {
  porteriaReceiptDetailRows,
  porteriaReceiptFileName,
  porteriaReceiptKindLabel,
  porteriaReceiptMethodLabel,
  porteriaReceiptTimeLabel,
} from './exportPorteriaIncomeReceiptPdf';

describe('exportPorteriaIncomeReceiptPdf', () => {
  const sample = {
    id: 'oi-abc123xyz',
    date: '2026-11-13',
    createdAt: '2026-11-13T16:42:00.000Z',
    concept: 'Rendición portería',
    amount: 26000,
    paymentMethod: 'efectivo',
    paymentMethodLabel: 'Efectivo',
    bookNumber: '145',
    notes: 'Visitas del mediodía',
    renderedBy: 'Adrian Pablo Suarez',
    receivedBy: 'Cajero Demo',
  };

  it('arma el detalle con fecha, hora, monto, medio y quién recibió', () => {
    const rows = Object.fromEntries(porteriaReceiptDetailRows(sample));
    expect(porteriaReceiptKindLabel(sample)).toBe('Rendición portería');
    expect(porteriaReceiptMethodLabel(sample)).toBe('Efectivo');
    expect(rows.Importe).toMatch(/26\.000/);
    expect(rows['Medio de pago']).toBe('Efectivo');
    expect(rows.Rindió).toBe('Adrian Pablo Suarez');
    expect(rows.Recibió).toBe('Cajero Demo');
    expect(rows.Descripción).toBe('Visitas del mediodía');
    expect(rows['Nº de talonario']).toBe('145');
    expect(porteriaReceiptTimeLabel(sample)).toMatch(/\d{2}:\d{2} hs/);
  });

  it('nombra el archivo con talonario y fecha', () => {
    expect(porteriaReceiptFileName(sample)).toMatch(/^recibo-porteria-145-20261113-/);
  });

  it('distingue estacionamiento', () => {
    expect(porteriaReceiptKindLabel({ concept: 'Rendición estacionamiento' }))
      .toBe('Rendición estacionamiento');
  });
});

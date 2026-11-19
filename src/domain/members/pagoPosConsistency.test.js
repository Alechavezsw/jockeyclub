import { describe, expect, it } from 'vitest';
import { OTHER_INCOME_PAYMENT_METHODS, treasuryAccountIdForMethod } from '../accounting/otherIncomes';
import { SUPPLIER_PAYMENT_METHODS } from '../accounting/supplierEntries';
import { reservationCashTreasuryAccount } from '../accounting/reservationCash';
import { POOL_PAYMENT_METHODS, poolMethodLabel, poolMethodUsesCash, poolMethodUsesCardPos } from '../pool/poolAccess';
import { CARD_JOURNAL_ACCOUNT, journalAccountForPayment } from './clubBanks';
import {
  DUES_METHOD_LABELS,
  duesMethodLabel,
  duesMethodNeedsReceipt,
  isCardPosDuesMethod,
  normalizePaymentSplits,
} from './memberPayments';
import { appPaymentRequestMethodLabel } from './appPaymentRequests';

describe('Pago POS consistente en toda la app', () => {
  it('reconoce alias tarjeta / pos / pago pos / card', () => {
    for (const method of ['tarjeta', 'pos', 'pago pos', 'card', 'Tarjeta', 'POS']) {
      expect(isCardPosDuesMethod(method)).toBe(true);
    }
    expect(isCardPosDuesMethod('efectivo')).toBe(false);
    expect(isCardPosDuesMethod('transferencia')).toBe(false);
  });

  it('etiqueta Pago POS en cuotas, ingresos, proveedores y pileta', () => {
    expect(DUES_METHOD_LABELS.tarjeta).toBe('Pago POS');
    expect(DUES_METHOD_LABELS.pos).toBe('Pago POS');
    expect(duesMethodLabel('tarjeta')).toBe('Pago POS');
    expect(duesMethodLabel('pos')).toBe('Pago POS');
    expect(OTHER_INCOME_PAYMENT_METHODS.tarjeta).toBe('Pago POS');
    expect(OTHER_INCOME_PAYMENT_METHODS.pos).toBe('Pago POS');
    expect(SUPPLIER_PAYMENT_METHODS.tarjeta).toBe('Pago POS');
    expect(POOL_PAYMENT_METHODS.find((m) => m.id === 'tarjeta')?.label).toBe('Pago POS');
    expect(poolMethodLabel('tarjeta')).toBe('Pago POS');
    expect(poolMethodLabel('pos')).toBe('Pago POS');
    expect(appPaymentRequestMethodLabel({ meta: { method: 'tarjeta' } })).toBe('Pago POS');
    expect(appPaymentRequestMethodLabel({ meta: { method: 'pos' } })).toBe('Pago POS');
  });

  it('asienta POS en Tarjetas a cobrar (no Caja General)', () => {
    expect(journalAccountForPayment('tarjeta')).toBe(CARD_JOURNAL_ACCOUNT);
    expect(journalAccountForPayment('pos')).toBe(CARD_JOURNAL_ACCOUNT);
    expect(journalAccountForPayment('pago pos')).toBe(CARD_JOURNAL_ACCOUNT);
    expect(reservationCashTreasuryAccount('tarjeta')).toBe('Tarjetas a cobrar');
    expect(reservationCashTreasuryAccount('pos')).toBe('Tarjetas a cobrar');
    expect(reservationCashTreasuryAccount('efectivo')).toBe('Caja General');
    expect(treasuryAccountIdForMethod('tarjeta')).toBe('coa-1.1.09');
    expect(treasuryAccountIdForMethod('pos')).toBe('coa-1.1.09');
    expect(treasuryAccountIdForMethod('efectivo')).toBe('coa-1.1.01');
  });

  it('POS exige comprobante y no usa caja de pileta', () => {
    expect(duesMethodNeedsReceipt('tarjeta')).toBe(true);
    expect(duesMethodNeedsReceipt('pos')).toBe(true);
    expect(poolMethodUsesCash('tarjeta')).toBe(false);
    expect(poolMethodUsesCash('efectivo')).toBe(true);
    expect(poolMethodUsesCardPos('tarjeta')).toBe(true);
    expect(poolMethodUsesCardPos('pos')).toBe(true);
  });

  it('normaliza pos → tarjeta en pago mixto', () => {
    const splits = normalizePaymentSplits([
      { method: 'efectivo', amount: 100 },
      { method: 'pos', amount: 200, receiptName: 'voucher.jpg', receiptAttachment: { path: 'x', name: 'voucher.jpg' } },
    ]);
    expect(splits.map((s) => s.method)).toEqual(['efectivo', 'tarjeta']);
    expect(splits[1].label).toMatch(/Pago POS/i);
  });
});

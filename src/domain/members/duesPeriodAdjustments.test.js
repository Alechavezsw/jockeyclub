import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeDuesPeriodAdjustments,
  adjustmentsForPayment,
  applyDuesPeriodAdjustments,
  periodAdjustmentNote,
  validateDuesPeriodAdjustmentDraft,
} from './duesPeriodAdjustments';
import { collectionPeriodChoices } from './dues';
import { collectionPreview, recordDuesCollection } from './memberPayments';
import { receiptAdjustmentLines } from './exportPaymentReceiptPdf';
import { setRuntimeTierCatalog } from './tiers';

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));

const PAID_ON = new Date('2026-11-25T12:00:00');

const adj = (over) => ({
  id: over.id || `adj-${over.due_on || over.dueOn}`,
  member_id: 'db-1',
  member_number: '100001',
  action: 'set',
  reason: 'Nivelación de la migración',
  created_by_name: 'Ana Admin',
  created_at: '2026-11-25T10:00:00Z',
  ...over,
});

beforeEach(() => {
  setRuntimeTierCatalog([
    { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
    { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 40000, sortOrder: 2 },
  ]);
});

afterEach(() => {
  setRuntimeTierCatalog(null);
});

describe('activeDuesPeriodAdjustments', () => {
  it('ignora anulados y deja uno por mes (el más nuevo)', () => {
    const list = activeDuesPeriodAdjustments({
      duesPeriodAdjustments: [
        adj({ id: 'a', due_on: '2026-09-10', capital: 30000, created_at: '2026-11-20T00:00:00Z' }),
        adj({ id: 'b', due_on: '2026-09-10', capital: 35000, created_at: '2026-11-21T00:00:00Z' }),
        adj({ id: 'c', due_on: '2026-08-10', capital: 50000, voided_at: '2026-11-22T00:00:00Z' }),
      ],
    });
    expect(list.map((row) => [row.id, row.capital])).toEqual([['b', 35000]]);
  });
});

describe('applyDuesPeriodAdjustments', () => {
  const base = [
    { id: '2026-10-10', dueOn: '2026-10-10', monthKey: '2026-10', label: 'Octubre 2026', capital: 70000, lateBase: 70000, surcharge: 7000, payable: 77000, kind: 'overdue', chargeScope: 'social' },
    { id: '2026-11-10', dueOn: '2026-11-10', monthKey: '2026-11', label: 'Noviembre 2026', capital: 70000, lateBase: 70000, surcharge: 7000, payable: 77000, kind: 'overdue', chargeScope: 'social' },
  ];

  it('corrige el capital del mes y recalcula el 10 % de ese mes', () => {
    const member = { tier: 'socio_familiar', duesPeriodAdjustments: [adj({ due_on: '2026-10-10', capital: 40000 })] };
    const rows = applyDuesPeriodAdjustments(member, base, PAID_ON, { chargeScope: 'social' });
    expect(rows[0]).toMatchObject({ dueOn: '2026-10-10', capital: 40000, surcharge: 4000, payable: 44000 });
    expect(rows[0].adjustment).toMatchObject({ by: 'Ana Admin', capital: 40000 });
    expect(rows[1]).toBe(base[1]);
  });

  it('saca un mes que no se debe', () => {
    const member = { tier: 'socio_familiar', duesPeriodAdjustments: [adj({ due_on: '2026-10-10', action: 'remove', capital: null })] };
    const rows = applyDuesPeriodAdjustments(member, base, PAID_ON, { chargeScope: 'social' });
    expect(rows.map((row) => row.dueOn)).toEqual(['2026-11-10']);
  });

  it('agrega un mes pasado que la migración no trajo, con su recargo', () => {
    const member = { tier: 'socio_familiar', duesPeriodAdjustments: [adj({ due_on: '2026-08-10', capital: 63000 })] };
    const rows = applyDuesPeriodAdjustments(member, base, PAID_ON, { chargeScope: 'social' });
    expect(rows.map((row) => row.dueOn)).toEqual(['2026-08-10', '2026-10-10', '2026-11-10']);
    expect(rows[0]).toMatchObject({ capital: 63000, surcharge: 6300, payable: 69300, kind: 'overdue' });
  });

  it('no crea un mes que no empezó ni reabre un mes cubierto', () => {
    const member = {
      tier: 'socio_familiar',
      duesPeriodAdjustments: [
        adj({ due_on: '2026-12-10', capital: 70000 }),
        adj({ due_on: '2026-07-10', capital: 70000 }),
      ],
    };
    const rows = applyDuesPeriodAdjustments(member, base, PAID_ON, {
      chargeScope: 'social',
      coveredDueOns: new Set(['2026-07-10']),
    });
    expect(rows.map((row) => row.dueOn)).toEqual(['2026-10-10', '2026-11-10']);
  });

  it('no suma otro recargo si el libro ya lo tenía anotado', () => {
    const recorded = [{ ...base[0], surcharge: 5000, lateBase: 70000, payable: 75000 }];
    const member = { tier: 'socio_familiar', duesPeriodAdjustments: [adj({ due_on: '2026-10-10', capital: 60000 })] };
    const [row] = applyDuesPeriodAdjustments(member, recorded, PAID_ON, { chargeScope: 'social' });
    expect(row).toMatchObject({ capital: 60000, surcharge: 5000, payable: 65000 });
  });

  it('no toca el abono de tenis', () => {
    const tennis = [{ ...base[0], chargeScope: 'abono_tenis', capital: 12000, surcharge: 0, payable: 12000 }];
    const member = { duesPeriodAdjustments: [adj({ due_on: '2026-10-10', capital: 1 })] };
    expect(applyDuesPeriodAdjustments(member, tennis, PAID_ON, { chargeScope: 'abono_tenis' })).toBe(tennis);
  });
});

describe('Cobrar cuota con ajuste administrativo', () => {
  const member = {
    id: 'db-1',
    memberId: '100001',
    memberNumber: '100001',
    name: 'Socio Prueba',
    tier: 'socio_familiar',
    status: 'active',
    outstandingBalance: 77000,
    nextDueDate: '2026-11-10',
    paymentHistory: [],
  };

  it('los meses a cobrar salen con el capital corregido y el saldo de ficha no cambia', () => {
    const before = collectionPeriodChoices(member, PAID_ON, { chargeScope: 'social' });
    expect(before.length).toBeGreaterThan(0);
    const target = before[0];
    const withAdj = {
      ...member,
      duesPeriodAdjustments: [adj({ due_on: target.dueOn, capital: 50000 })],
    };
    const after = collectionPeriodChoices(withAdj, PAID_ON, { chargeScope: 'social' });
    const row = after.find((r) => r.dueOn === target.dueOn);
    expect(row.capital).toBe(50000);
    expect(row.adjustment.by).toBe('Ana Admin');
    expect(withAdj.outstandingBalance).toBe(77000);
    const preview = collectionPreview(withAdj, PAID_ON, { periodDueOns: [target.dueOn], chargeScope: 'social' });
    expect(preview.quota).toBe(50000);
  });

  it('el cobro lleva el ajuste al recibo y al asiento, y el asiento cierra con el importe', () => {
    const due = collectionPeriodChoices(member, PAID_ON, { chargeScope: 'social' })[0].dueOn;
    const adjustments = [adj({ due_on: due, capital: 50000 })];
    const result = recordDuesCollection(member, {
      method: 'efectivo',
      today: PAID_ON,
      periodDueOns: [due],
      chargeScope: 'social',
      duesPeriodAdjustments: adjustments,
    });
    expect(result.payment.periodAdjustments).toEqual([
      expect.objectContaining({ dueOn: due, capital: 50000, by: 'Ana Admin' }),
    ]);
    expect(result.journalEntry.description).toMatch(/Ajuste adm\.: .*\(Ana Admin\)/);
    const debit = result.journalEntry.lines
      .filter((line) => line.type === 'debit')
      .reduce((sum, line) => sum + line.amount, 0);
    const credit = result.journalEntry.lines
      .filter((line) => line.type === 'credit')
      .reduce((sum, line) => sum + line.amount, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(result.payment.amount, 2);
    expect(result.payment.amount).toBeLessThanOrEqual(55000);
    expect(result.payment.amount).toBeGreaterThanOrEqual(50000);
  });
});

describe('textos del ajuste', () => {
  it('nota del asiento y líneas del comprobante', () => {
    const list = adjustmentsForPayment(
      { duesPeriodAdjustments: [adj({ due_on: '2026-08-10', capital: 63000 })] },
      ['2026-08-10', '2026-09-10'],
    );
    expect(periodAdjustmentNote(list, (n) => `$${n}`)).toMatch(/^Ajuste adm\.: .*\$63000 \(Ana Admin\)$/);
    const lines = receiptAdjustmentLines({ periodAdjustments: list });
    expect(lines).toHaveLength(1);
    expect(lines[0].capital).toBe(63000);
    expect(lines[0].detail).toMatch(/Ajuste adm\. .*cuota corregida \(Ana Admin 25\/11\)/);
  });

  it('valida el borrador del administrador', () => {
    expect(validateDuesPeriodAdjustmentDraft({ dueOn: '2026-12', action: 'set', capital: 1, reason: 'motivo largo' }, PAID_ON))
      .toMatch(/no empezó/);
    expect(validateDuesPeriodAdjustmentDraft({ dueOn: '2026-10', action: 'set', capital: 0, reason: 'motivo largo' }, PAID_ON))
      .toMatch(/mayor que cero/);
    expect(validateDuesPeriodAdjustmentDraft({ dueOn: '2026-10', action: 'set', capital: 1, reason: 'corto' }, PAID_ON))
      .toMatch(/motivo/);
    expect(validateDuesPeriodAdjustmentDraft({ dueOn: '2026-10', action: 'remove', reason: 'no corresponde' }, PAID_ON))
      .toBe('');
  });
});

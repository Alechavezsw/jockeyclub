import { describe, expect, it } from 'vitest';
import { feePackForPeriod } from './feePackConcepts';
import {
  ACCESSIN_FEE_PERIODS,
  applyFeePackEdit,
  feePeriodIsClosed,
  feePeriodNeedsClosure,
  liquidateFeePeriod,
  packEditorFromPeriod,
  resolveFeePeriods,
} from './feeBilling';

const TODAY = new Date('2026-09-30T15:00:00.000Z');

describe('liquidateFeePeriod', () => {
  it('octubre queda procesado con el total de Lila y no se vuelve a liquidar', () => {
    const october = ACCESSIN_FEE_PERIODS.find((p) => p.id === 'fp-1382');
    const september = ACCESSIN_FEE_PERIODS.find((p) => p.id === 'fp-1311');
    const pack = feePackForPeriod(october);
    const septemberPack = feePackForPeriod(september);

    expect(october.status).toBe('processed');
    expect(october.amount).toBe(63233000);
    expect(october.amount).toBe(pack.total);
    expect(october.generatedAt).toBe('2026-09-09');
    expect(october.accessinId).toBe(1382);
    expect(september.status).toBe('processed');
    expect(september.amount).toBe(septemberPack.total);
    expect(feePeriodNeedsClosure(october)).toBe(false);
    expect(feePeriodNeedsClosure(september)).toBe(false);
    expect(() => liquidateFeePeriod(ACCESSIN_FEE_PERIODS, 'fp-1382', [], TODAY))
      .toThrow(/ya está liquidado/);
  });

  it('cerrar un borrador con pack no imputa cuotas', () => {
    const draftList = ACCESSIN_FEE_PERIODS.map((period) => (
      period.id === 'fp-1382' ? { ...period, status: 'draft', generatedAt: null } : period
    ));
    const result = liquidateFeePeriod(draftList, 'fp-1382', [
      { memberId: '10485', status: 'active' },
    ], TODAY);

    expect(result.memberUpdates).toEqual([]);
    expect(result.period.status).toBe('processed');
    expect(result.period.amount).toBe(63233000);
    expect(result.period.generatedAt).toBe('2026-09-30');
    expect(feePeriodNeedsClosure(result.period)).toBe(true);
  });

  it('no vuelve a liquidar un mes ya procesado', () => {
    expect(() => liquidateFeePeriod(ACCESSIN_FEE_PERIODS, 'fp-1311', [], TODAY))
      .toThrow(/ya está liquidado/);
  });

  it('muestra octubre procesado cuando el cierre está guardado', () => {
    const closed = resolveFeePeriods([{
      id: 'fp-1382',
      year: 2026,
      month: 10,
      amount: 63233000,
      generatedAt: '2026-09-09',
      status: 'processed',
    }]);
    const october = closed.find((p) => p.id === 'fp-1382');
    const september = closed.find((p) => p.id === 'fp-1311');
    expect(october.status).toBe('processed');
    expect(october.amount).toBe(63233000);
    expect(october.generatedAt).toBe('2026-09-09');
    expect(september.status).toBe('processed');
    expect(september.amount).toBe(57843000);
  });

  it('no deja editar un período cerrado', () => {
    const september = ACCESSIN_FEE_PERIODS.find((p) => p.id === 'fp-1311');
    expect(feePeriodIsClosed(september)).toBe(true);
    expect(() => applyFeePackEdit(september, packEditorFromPeriod(september)))
      .toThrow(/cerrado/);
  });

  it('edita un período abierto y no imputa cuotas', () => {
    const november = ACCESSIN_FEE_PERIODS.find((p) => p.month === 11);
    const draft = packEditorFromPeriod(november);
    draft.concepts = [{ id: '1', label: 'SOCIO FAMILIAR', holders: 2, amount: 70000 }];
    draft.surcharges = [{ date: '2026-11-10', category: 'SOCIO FAMILIAR', type: 'percentage', value: 10 }];
    const next = applyFeePackEdit(november, draft);
    expect(next.status).toBe('pending');
    expect(next.amount).toBe(140000);
    expect(next.lines).toEqual([
      { identifier: '1', name: 'SOCIO FAMILIAR', holders: 2, unit: 70000, total: 140000 },
    ]);
    expect(next.pack.surcharges[0].rate).toBe('10.00 %');
    const listed = resolveFeePeriods([next]);
    expect(listed.find((p) => p.id === november.id).amount).toBe(140000);
    expect(feePeriodIsClosed(next)).toBe(false);
  });
});

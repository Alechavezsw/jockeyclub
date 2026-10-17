import { describe, expect, it } from 'vitest';
import { feePackForPeriod } from './feePackConcepts';
import {
  ACCESSIN_FEE_PERIODS,
  applyFeePackEdit,
  appOwnsFeePeriod,
  feePeriodIsClosed,
  feePeriodLiquidateBlock,
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

  it('noviembre imputa la cuota viva a titulares, sin recargo ni exentos', () => {
    const members = [
      { memberId: '10', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] },
      { memberId: '11', status: 'active', tier: 'socio_individual', cuotaCategories: ['SOCIO INDIVIDUAL'] },
      { memberId: '8377', status: 'active', tier: 'comision', cuotaCategories: ['COMISION'] },
      {
        memberId: '12',
        status: 'active',
        tier: 'grupo_familiar_familiar',
        familyPrincipalNumber: '10',
        cuotaCategories: ['GRUPO FAMILIAR (Familiar)'],
      },
    ];
    const result = liquidateFeePeriod(
      ACCESSIN_FEE_PERIODS,
      'fp-2026-11',
      members,
      new Date('2026-11-15T12:00:00'),
    );

    expect(result.period.status).toBe('processed');
    expect(result.memberUpdates).toEqual([
      { memberId: '10', addAmount: 70000 },
      { memberId: '11', addAmount: 40000 },
    ]);
    expect(result.period.amount).toBe(110000);
    expect(result.period.generatedAt).toBe('2026-11-15');
    expect(feePeriodNeedsClosure(result.period)).toBe(true);
  });

  it('noviembre con pack editado igual cobra a los titulares', () => {
    const pack = feePackForPeriod(ACCESSIN_FEE_PERIODS.find((p) => p.id === 'fp-1382'));
    const draftList = ACCESSIN_FEE_PERIODS.map((period) => (
      period.id === 'fp-2026-11'
        ? { ...period, status: 'draft', pack, amount: pack.total, generatedAt: null }
        : period
    ));
    const result = liquidateFeePeriod(draftList, 'fp-2026-11', [
      { memberId: '10485', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] },
    ], new Date('2026-11-02T15:00:00.000Z'));

    expect(result.memberUpdates).toEqual([{ memberId: '10485', addAmount: 70000 }]);
    expect(result.period.status).toBe('processed');
    expect(result.period.amount).toBe(70000);
  });

  it('desde noviembre liquida la app y solo el mes en curso', () => {
    const november = ACCESSIN_FEE_PERIODS.find((p) => p.month === 11);
    const october = ACCESSIN_FEE_PERIODS.find((p) => p.month === 10);
    expect(november.status).toBe('draft');
    expect(appOwnsFeePeriod(november)).toBe(true);
    expect(appOwnsFeePeriod(october)).toBe(false);
    expect(feePeriodLiquidateBlock(november, new Date('2026-10-14T15:00:00'))).toMatch(/mes en curso/);
    expect(() => liquidateFeePeriod(ACCESSIN_FEE_PERIODS, 'fp-2026-11', [], new Date('2026-10-14T15:00:00')))
      .toThrow(/mes en curso/);
    const opened = ACCESSIN_FEE_PERIODS.map((period) => (
      period.month === 9 ? { ...period, status: 'draft' } : period
    ));
    expect(() => liquidateFeePeriod(opened, 'fp-1311', [], new Date('2026-09-01T15:00:00')))
      .toThrow(/LILA/);
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
    expect(next.status).toBe('draft');
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

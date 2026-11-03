import { describe, expect, it } from 'vitest';
import { feePackForPeriod } from './feePackConcepts';
import {
  ACCESSIN_FEE_PERIODS,
  applyFeePackEdit,
  appOwnsFeePeriod,
  feePackLinesFromMembers,
  feePeriodIsClosed,
  feePeriodLiquidateBlock,
  feePeriodNeedsClosure,
  feePeriodPrepareBlock,
  liquidateFeePeriod,
  packEditorFromPeriod,
  aggregateFeeChargeDeltas,
  applyFeeChargeDeltasToMembers,
  autoLiquidateFeePeriodOnMonthStart,
  isFeePeriodAutoDay,
  prepareFeePeriodDraft,
  promotePendingFeePeriods,
  refreshFeePeriodWithDiscounts,
  reopenFeePeriod,
  resolveFeePeriods,
} from './feeBilling';

const TODAY = new Date('2026-09-30T15:00:00.000Z');

describe('feePackLinesFromMembers', () => {
  it('ABONO TENIS usa # Accessin 2272 y $12.000 desde octubre', () => {
    const lines = feePackLinesFromMembers([
      { memberId: '1', status: 'active', cuotaCategories: ['ABONO TENIS'] },
      { memberId: '2', status: 'active', cuotaCategories: ['ABONO TENIS'] },
    ], new Date('2026-10-10T12:00:00'));
    expect(lines.find((row) => row.label === 'ABONO TENIS')).toMatchObject({
      id: '2272',
      tierId: 'abono_tenis',
      holders: 2,
      amount: 12000,
      total: 24000,
    });
  });

  it('no incluye COLONIA / LIGA / KARATE (No socio) en el pack', () => {
    const lines = feePackLinesFromMembers([
      { memberId: '1', status: 'active', cuotaCategories: ['COLONIA (No socio)'] },
      { memberId: '2', status: 'active', cuotaCategories: ['LIGA (No socio)', 'SOCIO FAMILIAR'] },
      { memberId: '3', status: 'active', cuotaCategories: ['KARATE (No socio)'] },
    ], new Date('2026-11-10T12:00:00'));
    expect(lines.map((row) => row.tierId)).toEqual(['socio_familiar']);
    expect(lines.some((row) => /colonia|liga|karate/i.test(row.tierId))).toBe(false);
  });

  it('no inventa titulares desde el tier si no hay categoría Accessin', () => {
    const lines = feePackLinesFromMembers([
      { memberId: '1', status: 'active', tier: 'socio_individual', cuotaCategories: [] },
      { memberId: '2', status: 'active', tier: 'socio_individual', cuotaCategories: ['–'] },
      { memberId: '3', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] },
    ], new Date('2026-11-10T12:00:00'));
    expect(lines.map((row) => row.tierId)).toEqual(['socio_familiar']);
    expect(lines.find((row) => row.tierId === 'socio_individual')).toBeUndefined();
  });
});

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

    expect(result.period.status).toBe('pending');
    expect(result.period.availableAt).toBe('2026-11-16');
    expect(result.memberUpdates).toEqual([]);
    expect(result.pendingCharges).toEqual([
      { memberId: '10', addAmount: 70000, tierId: 'socio_familiar', category: 'SOCIO FAMILIAR' },
      { memberId: '11', addAmount: 40000, tierId: 'socio_individual', category: 'SOCIO INDIVIDUAL' },
    ]);
    expect(result.period.amount).toBe(110000);
    expect(result.period.generatedAt).toBe('2026-11-15');
    expect(result.period.pack.concepts.every((row) => Number(row.amount) > 0)).toBe(true);
    expect(result.period.pack.concepts.some((row) => /comision|vitalicio|fundador|grupo_familiar/i.test(row.tierId))).toBe(false);
    expect(feePeriodNeedsClosure(result.period)).toBe(true);
  });

  it('a las 00 h del día siguiente el Pendiente pasa a Procesada e imputa', () => {
    const members = [
      { memberId: '10', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] },
    ];
    const generated = liquidateFeePeriod(
      ACCESSIN_FEE_PERIODS,
      'fp-2026-11',
      members,
      new Date('2026-11-01T18:00:00'),
    );
    expect(generated.period.status).toBe('pending');
    expect(generated.period.availableAt).toBe('2026-11-02');

    const sameDay = promotePendingFeePeriods(generated.periods, new Date('2026-11-01T23:30:00'));
    expect(sameDay.promoted).toHaveLength(0);

    const nextDay = promotePendingFeePeriods(generated.periods, new Date('2026-11-02T00:05:00'));
    expect(nextDay.promoted).toHaveLength(1);
    expect(nextDay.promoted[0].status).toBe('processed');
    expect(nextDay.memberUpdates).toEqual([
      { memberId: '10', addAmount: 70000, tierId: 'socio_familiar', category: 'SOCIO FAMILIAR' },
    ]);
  });


  it('el abono de tenis del adherente se liquida en el titular', () => {
    const result = liquidateFeePeriod(
      ACCESSIN_FEE_PERIODS,
      'fp-2026-11',
      [
        { memberId: '10', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] },
        {
          memberId: '12',
          status: 'active',
          tier: 'grupo_familiar_familiar',
          familyPrincipalNumber: '10',
          cuotaCategories: ['GRUPO FAMILIAR (Familiar)', 'ABONO TENIS'],
        },
      ],
      new Date('2026-11-02T15:00:00.000Z'),
    );
    expect(result.pendingCharges).toEqual([
      { memberId: '10', addAmount: 12000, tierId: 'abono_tenis', category: 'ABONO TENIS' },
      { memberId: '10', addAmount: 70000, tierId: 'socio_familiar', category: 'SOCIO FAMILIAR' },
    ]);
    expect(result.memberUpdates).toEqual([]);
    expect(result.period.status).toBe('pending');
    expect(result.period.amount).toBe(82000);
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

    expect(result.pendingCharges).toEqual([
      { memberId: '10485', addAmount: 70000, tierId: 'socio_familiar', category: 'SOCIO FAMILIAR' },
    ]);
    expect(result.memberUpdates).toEqual([]);
    expect(result.period.status).toBe('pending');
    expect(result.period.amount).toBe(70000);
  });

  it('desde noviembre liquida la app; octubre sigue en LILA', () => {
    const november = ACCESSIN_FEE_PERIODS.find((p) => p.month === 11);
    const october = ACCESSIN_FEE_PERIODS.find((p) => p.month === 10);
    expect(november.status).toBe('draft');
    expect(appOwnsFeePeriod(november)).toBe(true);
    expect(appOwnsFeePeriod(october)).toBe(false);
    expect(feePeriodLiquidateBlock(november, new Date('2026-10-14T15:00:00'))).toBe('');
    expect(feePeriodLiquidateBlock(november, new Date('2026-11-02T15:00:00'))).toBe('');
    expect(feePeriodLiquidateBlock(november, new Date('2026-09-14T15:00:00'))).toMatch(/mes en curso|mes siguiente/);
    const opened = ACCESSIN_FEE_PERIODS.map((period) => (
      period.month === 9 ? { ...period, status: 'draft' } : period
    ));
    expect(() => liquidateFeePeriod(opened, 'fp-1311', [], new Date('2026-09-01T15:00:00')))
      .toThrow(/LILA/);
  });

  it('en octubre se puede cargar y liquidar el borrador de noviembre', () => {
    const inOctober = new Date('2026-10-31T15:00:00');
    expect(feePeriodPrepareBlock(
      ACCESSIN_FEE_PERIODS.find((p) => p.month === 11),
      inOctober,
    )).toBe('');
    expect(feePeriodLiquidateBlock(
      ACCESSIN_FEE_PERIODS.find((p) => p.month === 11),
      inOctober,
    )).toBe('');
    const drafted = prepareFeePeriodDraft(
      ACCESSIN_FEE_PERIODS,
      'fp-2026-11',
      [{ memberId: '10485', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] }],
      inOctober,
    );
    expect(drafted.period.status).toBe('draft');
    expect(drafted.period.amount).toBe(70000);
    expect(drafted.period.pack.preparedFrom).toBe('padron');
    expect(drafted.period.pack.charges).toEqual([]);
    const closed = liquidateFeePeriod(
      drafted.periods,
      'fp-2026-11',
      [{ memberId: '10485', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] }],
      inOctober,
    );
    expect(closed.period.status).toBe('pending');
    expect(closed.period.availableAt).toBeTruthy();
    const afterMidnight = promotePendingFeePeriods(
      closed.periods,
      new Date(`${closed.period.availableAt}T00:05:00`),
    );
    expect(afterMidnight.promoted[0].status).toBe('processed');
  });

  it('un error grave reabre un mes de la app y devuelve las deudas', () => {
    const closed = liquidateFeePeriod(
      ACCESSIN_FEE_PERIODS,
      'fp-2026-11',
      [{ memberId: '10', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR', 'ABONO TENIS'] }],
      new Date('2026-11-15T12:00:00'),
    );
    expect(closed.period.pack.charges).toEqual(closed.pendingCharges);
    expect(closed.pendingCharges.map((row) => row.tierId)).toEqual(['abono_tenis', 'socio_familiar']);
    // Antes de las 00 h: anular Pendiente no revierte deudas (aún no se imputaron).
    const cancelPending = reopenFeePeriod(closed.period, 'Se liquidó con la tarifa vieja');
    expect(cancelPending.period.status).toBe('draft');
    expect(cancelPending.reversals).toEqual([]);

    const processed = promotePendingFeePeriods(
      closed.periods,
      new Date(`${closed.period.availableAt}T00:05:00`),
    ).promoted[0];
    const reopened = reopenFeePeriod(processed, 'Se liquidó con la tarifa vieja');
    expect(reopened.period.status).toBe('draft');
    expect(reopened.period.amount).toBe(0);
    expect(reopened.period.generatedAt).toBeNull();
    expect(reopened.reversals).toEqual(closed.pendingCharges);
    expect(reopened.period.pack.reopens).toHaveLength(1);
    expect(() => reopenFeePeriod(processed, 'corto')).toThrow(/error grave/);
    expect(() => reopenFeePeriod(ACCESSIN_FEE_PERIODS.find((p) => p.id === 'fp-1382'), 'Error grave de octubre'))
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

  it('no deja que un pending vacío de diciembre pise el borrador seed', () => {
    const listed = resolveFeePeriods([{
      id: 'fp-2026-12',
      year: 2026,
      month: 12,
      amount: 0,
      generatedAt: null,
      status: 'pending',
      pack: null,
      lines: [],
    }]);
    const december = listed.find((p) => p.id === 'fp-2026-12');
    expect(december.status).toBe('draft');
    expect(december.amount).toBe(0);
    expect(december.generatedAt).toBeNull();
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
      { identifier: '1', tierId: undefined, name: 'SOCIO FAMILIAR', holders: 2, unit: 70000, total: 140000 },
    ]);
    expect(next.pack.surcharges[0].rate).toBe('10.00 %');
    const listed = resolveFeePeriods([next]);
    expect(listed.find((p) => p.id === november.id).amount).toBe(140000);
    expect(feePeriodIsClosed(next)).toBe(false);
  });

  it('el borrador de noviembre trae los recargos 10 % familiar e individual', () => {
    const november = ACCESSIN_FEE_PERIODS.find((p) => p.month === 11);
    const draft = packEditorFromPeriod(november);
    expect(draft.surcharges).toEqual([
      { date: '2026-11-10', category: 'SOCIO FAMILIAR', type: 'percentage', value: 10 },
      { date: '2026-11-10', category: 'SOCIO INDIVIDUAL', type: 'percentage', value: 10 },
    ]);
    const prepared = prepareFeePeriodDraft(
      ACCESSIN_FEE_PERIODS,
      november.id,
      [{ memberId: '1', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] }],
      '2026-11-01',
    ).period;
    expect(prepared.pack.surcharges).toHaveLength(2);
    expect(prepared.pack.surcharges.map((row) => row.category)).toEqual([
      'SOCIO FAMILIAR',
      'SOCIO INDIVIDUAL',
    ]);
    expect(prepared.pack.surcharges[0].rate).toBe('10.00 %');
    expect(prepared.pack.surcharges[0].date).toMatch(/10 de Noviembre del 2026/i);
  });

  it('el día 1 genera sola desde el padrón (altas/bajas); el resto del mes no', () => {
    const dayOne = new Date('2026-11-01T12:00:00-03:00');
    const dayTwo = new Date('2026-11-02T12:00:00-03:00');
    expect(isFeePeriodAutoDay(dayOne)).toBe(true);
    expect(isFeePeriodAutoDay(dayTwo)).toBe(false);

    const members = [
      { memberId: '10485', status: 'active', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] },
      { memberId: '10486', status: 'baja', tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] },
    ];
    const first = autoLiquidateFeePeriodOnMonthStart(ACCESSIN_FEE_PERIODS, members, dayOne, { by: 'test' });
    expect(first.ran).toBe(true);
    expect(first.period.status).toBe('pending');
    expect(first.period.pack.autoFromPadronAt).toBe('2026-11-01');
    expect(first.period.pack.history.at(-1).type).toBe('auto_generated');
    expect(first.pendingCharges.some((row) => row.memberId === '10485')).toBe(true);
    expect(first.pendingCharges.some((row) => row.memberId === '10486')).toBe(false);

    const again = autoLiquidateFeePeriodOnMonthStart(first.periods, members, dayOne);
    expect(again.ran).toBe(false);
    expect(again.reason).toBe('already_generated');

    const skip = autoLiquidateFeePeriodOnMonthStart(ACCESSIN_FEE_PERIODS, members, dayTwo);
    expect(skip.ran).toBe(false);
    expect(skip.reason).toBe('not_day_one');

    const catchUp = autoLiquidateFeePeriodOnMonthStart(
      ACCESSIN_FEE_PERIODS,
      members,
      dayTwo,
      { catchUp: true, by: 'test' },
    );
    expect(catchUp.ran).toBe(true);
    expect(catchUp.period.status).toBe('pending');
    expect(catchUp.period.availableAt).toBe('2026-11-02');
    const promoted = promotePendingFeePeriods(catchUp.periods, dayTwo);
    expect(promoted.promoted).toHaveLength(1);
    expect(promoted.memberUpdates.some((row) => row.memberId === '10485')).toBe(true);
  });

  it('al imputar suma el mes nuevo sobre el saldo previo', () => {
    const deltas = aggregateFeeChargeDeltas([
      { memberId: '111591', addAmount: 40000 },
    ]);
    const next = applyFeeChargeDeltasToMembers(
      [{ memberId: '111591', outstandingBalance: 32000, tier: 'socio_individual' }],
      deltas,
    );
    expect(next[0].outstandingBalance).toBe(72000);
  });

  it('liquidación aplica bonificaciones en cargos y total', () => {
    const members = [
      {
        memberId: '9216',
        status: 'active',
        tier: 'socio_familiar',
        cuotaCategories: ['SOCIO FAMILIAR'],
      },
      {
        memberId: '11',
        status: 'active',
        tier: 'socio_individual',
        cuotaCategories: ['SOCIO INDIVIDUAL'],
      },
    ];
    const discountRules = [{
      id: 'amdis-9216',
      category: 'members',
      memberIds: ['9216'],
      memberNumber: '9216',
      valueType: 'percent',
      value: 100,
      validFrom: '2026-06-12',
      validTo: '2027-04-30',
      isActive: true,
    }];
    const result = liquidateFeePeriod(
      ACCESSIN_FEE_PERIODS,
      'fp-2026-11',
      members,
      new Date('2026-11-02T12:00:00'),
      { discountRules },
    );
    expect(result.pendingCharges).toEqual([
      { memberId: '11', addAmount: 40000, tierId: 'socio_individual', category: 'SOCIO INDIVIDUAL' },
    ]);
    expect(result.period.amount).toBe(40000);
    expect(result.period.pack.charges).toEqual(result.pendingCharges);
  });

  it('reaplica bonificaciones al mes vigente ya generado', () => {
    const members = [
      {
        memberId: '9216',
        status: 'active',
        tier: 'socio_familiar',
        cuotaCategories: ['SOCIO FAMILIAR'],
      },
      {
        memberId: '11',
        status: 'active',
        tier: 'socio_individual',
        cuotaCategories: ['SOCIO INDIVIDUAL'],
      },
    ];
    const discountRules = [{
      id: 'amdis-9216',
      category: 'members',
      memberIds: ['9216'],
      memberNumber: '9216',
      valueType: 'percent',
      value: 100,
      validFrom: '2026-06-12',
      validTo: '2027-04-30',
      isActive: true,
    }];
    const gross = {
      id: 'fp-2026-11',
      year: 2026,
      month: 11,
      status: 'pending',
      amount: 110000,
      pack: {
        charges: [
          { memberId: '9216', addAmount: 70000, tierId: 'socio_familiar', category: 'SOCIO FAMILIAR' },
          { memberId: '11', addAmount: 40000, tierId: 'socio_individual', category: 'SOCIO INDIVIDUAL' },
        ],
        total: 110000,
        history: [],
      },
    };
    const refreshed = refreshFeePeriodWithDiscounts(
      gross,
      members,
      { discountRules, by: 'test' },
      new Date('2026-11-02T12:00:00'),
    );
    expect(refreshed.changed).toBe(true);
    expect(refreshed.period.amount).toBe(40000);
    expect(refreshed.period.pack.charges).toEqual([
      { memberId: '11', addAmount: 40000, tierId: 'socio_individual', category: 'SOCIO INDIVIDUAL' },
    ]);
    expect(refreshed.deltas).toEqual([]);

    const processed = { ...gross, status: 'processed' };
    const adjusted = refreshFeePeriodWithDiscounts(
      processed,
      members,
      { discountRules },
      new Date('2026-11-02T12:00:00'),
    );
    expect(adjusted.deltas).toEqual([{ memberId: '9216', amount: -70000 }]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ACCESSIN_MONTHLY_BALANCE_AS_OF,
  ACCESSIN_MONTHLY_BALANCE_SECTIONS,
  findMonthlyBalanceSection,
  filterMonthlyBalanceDetailRows,
  monthlyBalanceCards,
  monthlyBalanceDetailColumns,
  resolveMonthlyBalanceDetail,
} from './monthlyBalance';

function lineByLabel(sectionId, re) {
  const section = findMonthlyBalanceSection(ACCESSIN_MONTHLY_BALANCE_SECTIONS, sectionId);
  return section?.lines.find((line) => re.test(line.label));
}

describe('balance mensual LILA', () => {
  it('arma las cards del snapshot de agosto 2026', () => {
    const cards = monthlyBalanceCards();
    expect(ACCESSIN_MONTHLY_BALANCE_AS_OF).toBe('2026-08-31');
    expect(cards.periodFrom).toBe('2026-08-01');
    expect(cards.periodTo).toBe('2026-08-31');
    expect(cards.totalIncome).toBe(55669509.02);
    expect(cards.totalIncomeCash).toBe(61716509.02);
    expect(cards.totalExpenses).toBe(0);
    expect(cards.cashOnHand).toBe(680356959.84);
    expect(cards.closingCash).toBe(742073468.86);
    expect(cards.complete).toBe(true);
    expect(cards.sourceFolder).toMatch(/general/i);
  });

  it('encuentra secciones y enlaza líneas con su hoja de detalle', () => {
    expect(findMonthlyBalanceSection(ACCESSIN_MONTHLY_BALANCE_SECTIONS, 'saldos_de_caja')?.title)
      .toBe('SALDOS DE CAJA');
    expect(lineByLabel('liquidacion', /cuotas imputadas/i)?.detailKey)
      .toBe('cuotas_imputadas_en_cuent');
    expect(lineByLabel('ingresos_por_tipo_de_entrada', /^ingresos de reservas$/i)?.detailKey)
      .toBe('7_in_de_reservas');
    expect(lineByLabel('ingresos_por_tipo_de_entrada', /^ingresos de recargos de cuotas atrasadas$/i)?.detailKey)
      .toBe('2_in_de_recargos_de_cuotas_at');
    expect(lineByLabel('ingresos_por_tipo_de_entrada', /^otros ingresos por intereses$/i)?.detailKey)
      .toBe('3_otros_in_intereses');
  });

  it('filtra el detalle por socio, DNI o concepto', () => {
    const rows = [
      { nro_de_socio: '100116', nombre: 'Ignacio', apellido: 'Ranea Paz', dni: '27527974', concepto: 'SALON ANHELO', monto: 170000 },
      { nro_de_socio: '9819', nombre: 'Marcelo', apellido: 'Duran', dni: '22957919', concepto: 'Agosto del 2026', monto: 60000 },
    ];
    expect(filterMonthlyBalanceDetailRows(rows, 'ranea')).toHaveLength(1);
    expect(filterMonthlyBalanceDetailRows(rows, '100116')).toHaveLength(1);
    expect(filterMonthlyBalanceDetailRows(rows, '22957919')).toHaveLength(1);
    expect(filterMonthlyBalanceDetailRows(rows, 'zzz')).toHaveLength(0);
  });

  it('resuelve hojas de detalle y columnas visibles', () => {
    expect(resolveMonthlyBalanceDetail({ reservas: { title: 'Reservas' } }, 'reservas')?.title)
      .toBe('Reservas');
    expect(resolveMonthlyBalanceDetail({}, 'nope')).toBeNull();
    expect(monthlyBalanceDetailColumns({
      headers: ['#', 'NRO DE SOCIO', 'NOMBRE', 'MONTO'],
    }).map((col) => col.key)).toEqual(['nro_de_socio', 'nombre', 'monto']);
  });
});

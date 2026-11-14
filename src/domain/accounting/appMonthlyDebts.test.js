import { describe, expect, it } from 'vitest';
import { listDebtPeriods, listMonthlyDebtors } from './monthlyDebts';
import {
  appMonthlyDebtForMember,
  buildAppMonthlyDebts,
  duesStandingDisplayAmount,
  memberDuesStandingSummary,
} from './appMonthlyDebts';

const TODAY = '2026-10-17';

function familiar(extra = {}) {
  return {
    memberId: '4240',
    name: 'Ana Pérez',
    firstName: 'Ana',
    lastName: 'Pérez',
    documentNumber: '30111222',
    tier: 'socio_familiar',
    status: 'active',
    lastPaymentDate: '2026-09-13',
    nextDueDate: '2026-10-10',
    outstandingBalance: 70000,
    ...extra,
  };
}

describe('appMonthlyDebts', () => {
  it('desde el 11 la cuota del mes impaga está en mora', () => {
    expect(appMonthlyDebtForMember(familiar(), { today: new Date('2026-10-11T12:00:00') }).standing).toBe('En mora');
  });

  it('parte octubre con recargo del 10 % después del día 10', () => {
    const row = appMonthlyDebtForMember(familiar(), { today: TODAY });
    expect(row.months).toHaveLength(1);
    expect(row.months[0].periodKey).toBe('2026-10');
    expect(row.months[0].capital).toBe(70000);
    expect(row.months[0].interest).toBe(7000);
    expect(row.totalDebt).toBe(77000);
    expect(row.unallocated).toBe(0);
    expect(row.standing).toBe('En mora');
  });

  it('no aplica recargo a AMET y usa la tarifa de octubre', () => {
    const row = appMonthlyDebtForMember(
      familiar({
        tier: 'socio_familiar_amet',
        nextDueDate: '2026-10-18',
        outstandingBalance: 68250,
      }),
      { today: '2026-10-19' },
    );
    expect(row.months[0].capital).toBe(68250);
    expect(row.months[0].interest).toBe(0);
    expect(row.totalDebt).toBe(68250);
    expect(row.dueDay).toBe(18);
  });

  it('reparte saldo de capital en meses enteros y suma el 10 % encima en cada mes en mora', () => {
    const row = appMonthlyDebtForMember(
      familiar({
        lastPaymentDate: '2026-08-13',
        nextDueDate: '2026-09-10',
        outstandingBalance: 500000,
      }),
      { today: TODAY },
    );
    expect(row.months.map((m) => m.periodKey)).toEqual([
      '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-09', '2026-10',
    ]);
    const sep = row.months.find((m) => m.periodKey === '2026-09');
    const oct = row.months.find((m) => m.periodKey === '2026-10');
    const jul = row.months.find((m) => m.periodKey === '2026-07');
    expect(sep).toMatchObject({ capital: 70000, interest: 7000 });
    expect(oct).toMatchObject({ capital: 70000, interest: 7000 });
    expect(jul).toMatchObject({ capital: 70000, interest: 7000 });
    expect(row.capital).toBe(490000);
    expect(row.interest).toBe(49000);
    expect(row.unallocated).toBe(10000);
    expect(row.totalDebt).toBe(549000);
    expect(row.standing).toBe('En mora');
  });

  it('no inventa un mes a resto: el sobrante queda sin imputar', () => {
    const row = appMonthlyDebtForMember(
      familiar({
        lastPaymentDate: '2026-08-13',
        nextDueDate: '2026-09-10',
        outstandingBalance: 376000,
      }),
      { today: new Date('2026-11-12T12:00:00') },
    );
    expect(row.months.every((m) => m.capital === 70000)).toBe(true);
    expect(row.months.find((m) => m.periodKey === '2026-10')).toMatchObject({ capital: 70000, interest: 7000 });
    expect(row.months.find((m) => m.periodKey === '2026-11')).toMatchObject({ capital: 70000, interest: 7000 });
    expect(row.unallocated).toBe(26000);
    expect(row.capital).toBe(350000);
    expect(row.interest).toBe(35000);
  });

  it('si ya pagó este mes, el saldo previo se parte hacia atrás con mora de cada mes vencido', () => {
    const row = appMonthlyDebtForMember(
      familiar({
        lastPaymentDate: '2026-10-12',
        nextDueDate: '2026-11-10',
        outstandingBalance: 140000,
      }),
      { today: TODAY },
    );
    expect(row.months.map((m) => m.periodKey)).toEqual(['2026-08', '2026-09']);
    expect(row.months[0]).toMatchObject({ capital: 70000, interest: 7000 });
    expect(row.months[1]).toMatchObject({ capital: 70000, interest: 7000 });
    expect(row.unallocated).toBe(0);
    expect(row.totalDebt).toBe(154000);
    expect(row.standing).toBe('Con saldo');
  });

  it('estima la cuota impaga si el vencimiento pasó y el saldo aún no está persistido', () => {
    const row = appMonthlyDebtForMember(
      familiar({ outstandingBalance: 0 }),
      { today: TODAY },
    );
    expect(row.months[0].periodKey).toBe('2026-10');
    expect(row.months[0].capital).toBe(70000);
    expect(row.months[0].interest).toBe(7000);
    expect(row.totalDebt).toBe(77000);
  });

  it('omite comisión aunque tenga saldo de padrón', () => {
    expect(appMonthlyDebtForMember(
      familiar({
        memberId: '8377',
        tier: 'comision',
        cuotaCategories: ['COMISION'],
        outstandingBalance: 1466000,
        nextDueDate: null,
      }),
      { today: TODAY },
    )).toBeNull();
  });

  it('omite al socio al día y al vitalicio sin saldo', () => {
    expect(appMonthlyDebtForMember(
      familiar({
        outstandingBalance: 0,
        lastPaymentDate: '2026-10-12',
        nextDueDate: '2026-11-10',
      }),
      { today: TODAY },
    )).toBeNull();
    expect(appMonthlyDebtForMember(
      familiar({
        tier: 'socio_vitalicio',
        outstandingBalance: 0,
        lastPaymentDate: '2026-09-13',
      }),
      { today: TODAY },
    )).toBeNull();
  });

  it('memberDuesStandingSummary alinea capital + recargo con Consultar deuda', () => {
    const standing = memberDuesStandingSummary(familiar(), { today: TODAY });
    expect(standing.clear).toBe(false);
    expect(standing.totalDebt).toBe(77000);
    expect(standing.capital).toBe(70000);
    expect(standing.interest).toBe(7000);
    expect(standing.monthsPhrase).toMatch(/Octubre de 2026/);
    expect(duesStandingDisplayAmount(standing, (n) => `$${n}`)).toBe('$77000');

    const clear = memberDuesStandingSummary(
      familiar({
        outstandingBalance: 0,
        lastPaymentDate: '2026-10-12',
        nextDueDate: '2026-11-10',
      }),
      { today: TODAY },
    );
    expect(clear.clear).toBe(true);
    expect(clear.title).toBe('Al día');
    expect(duesStandingDisplayAmount(clear)).toBe('Al día');
  });

  it('familiar + abono tenis $12.000: 11 meses = $979.000', () => {
    const standing = memberDuesStandingSummary(
      familiar({
        memberId: '10896',
        cuotaCategories: ['SOCIO FAMILIAR', 'ABONO TENIS'],
        outstandingBalance: 902000,
        unpaidCapital: 902000,
        nextDueDate: '2026-01-10',
        lastPaymentDate: null,
      }),
      { today: new Date('2026-11-12T15:00:00-03:00') },
    );
    expect(standing.clear).toBe(false);
    expect(standing.months).toHaveLength(11);
    expect(standing.capital).toBe(902000);
    expect(standing.interest).toBe(77000);
    expect(standing.totalDebt).toBe(979000);
    expect(standing.months.every((row) => row.capital === 82000 && row.interest === 7000)).toBe(true);
  });

  it('incluye baja con deuda previa y arma el listado filtrable por mes', () => {
    const snapshot = buildAppMonthlyDebts(
      [
        familiar({ memberId: '10', outstandingBalance: 70000 }),
        familiar({
          memberId: '20',
          name: 'Luis Gómez',
          documentNumber: '22999888',
          lastPaymentDate: '2026-08-13',
          nextDueDate: '2026-09-10',
          outstandingBalance: 140000,
        }),
        familiar({
          memberId: '30',
          status: 'inactive',
          outstandingBalance: 40000,
          lastPaymentDate: '2026-10-12',
          nextDueDate: '2026-11-10',
        }),
        familiar({
          memberId: '40',
          outstandingBalance: 0,
          lastPaymentDate: '2026-10-12',
          nextDueDate: '2026-11-10',
        }),
      ],
      {
        today: TODAY,
        accountEntries: [
          {
            id: 'mae-1',
            memberNumber: '10',
            date: '2026-10-10',
            type: 'cuota',
            typeLabel: 'Cuota',
            description: 'Cuota octubre',
            value: 70000,
            isActive: true,
          },
        ],
      },
    );

    expect(snapshot.memberCount).toBe(3);
    expect(snapshot.asOf).toBe(TODAY);
    expect(listDebtPeriods(snapshot.byNumber).some((p) => p.periodKey === '2026-10')).toBe(true);

    const oct = listMonthlyDebtors({ byNumber: snapshot.byNumber, periodKey: '2026-10' });
    expect(oct.map((m) => m.memberNumber).sort()).toEqual(['10', '20']);
    const ana = oct.find((m) => m.memberNumber === '10');
    expect(ana.capital).toBe(70000);
    expect(ana.interest).toBe(7000);
    expect(ana.lines).toHaveLength(1);
    expect(ana.lines[0].type).toBe('Cuota');

    const search = listMonthlyDebtors({ byNumber: snapshot.byNumber, query: '22999888' });
    expect(search.map((m) => m.memberNumber)).toEqual(['20']);
  });
});

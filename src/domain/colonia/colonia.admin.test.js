import { describe, expect, it } from 'vitest';
import {
  COLONIA_ACCOUNT_HEADERS,
  COLONIA_ACCOUNT_SHEETS,
  COLONIA_REPORT_HEADERS,
  COLONIA_REPORT_SHEETS,
  coloniaAccountCells,
  coloniaAccountOnSheet,
  coloniaAccountStatus,
  coloniaReminderCopy,
  coloniaReportCells,
  coloniaReportRows,
  coloniaSocioHits,
  enrollmentMatchesRoster,
  householdKids,
  householdSearchPool,
  planChildSlots,
} from './coloniaDesk';
import {
  buildColoniaAccountRows,
  buildColoniaCharge,
  buildColoniaEnrollmentsCsv,
  buildColoniaMonthRows,
  buildColoniaReceipt,
  coloniaAccountMonths,
  coloniaNextMonthLabel,
  summarizeColoniaAccount,
  assertColoniaFinanceIsolation,
} from './coloniaLedger';
import {
  buildColoniaPaymentDraft,
  coloniaEnrollPayReady,
  coloniaMpPayable,
  coloniaSettlementAccount,
  initialPaymentStatus,
  validateColoniaPaymentInput,
} from './coloniaPayments';
import { enrollmentIdentityKey, validateEnrollmentDraft } from './coloniaEnrollment';
import { validateColoniaAge } from './coloniaAge';
import { COLONIA_PLAN_KEYS, COLONIA_SEASON_2026_2027, COLONIA_SECTIONS } from './coloniaConstants';
import { COLONIA_OFFICIAL_TARIFFS_2026_2027, evaluatePromotionCharge, planAmountFor } from './coloniaTariffs';

const pad = [
  { id: 'a', memberId: '8770', fullName: 'Titular Gómez', phone: '2644001122' },
  { id: 'b', memberId: '10632', fullName: 'Ana López', documentNumber: '30111222' },
  { id: 'c', memberId: '9001', fullName: 'Bruno Díaz', documentNumber: '8770' },
];

const roster = [
  {
    id: 'e1',
    source: 'admin',
    status: 'confirmada',
    plan_key: 'cuota',
    student: { full_name: 'Ana López', member_kind: 'socio', member_number: '10632', document_number: '30111222' },
    guardian: { full_name: 'Marta López', phone: '2644111222', email: 'marta@correo.com' },
  },
  {
    id: 'e2',
    source: 'portal',
    status: 'pendiente',
    plan_key: 'temporada',
    student: { full_name: 'Bruno Díaz', member_kind: 'socio', member_number: '9001', document_number: '40999888' },
    guardian: { full_name: 'Luis Díaz', phone: '2644222333' },
  },
  {
    id: 'e3',
    source: 'external',
    status: 'cancelada',
    plan_key: 'cuota',
    student: { full_name: 'Cami Ruiz', member_kind: 'no_socio', document_number: '50111000' },
    guardian: { full_name: 'Eva Ruiz', phone: '2644333444' },
  },
  {
    id: 'e4',
    source: 'admin',
    status: 'observada',
    plan_key: 'promo_2',
    student: { full_name: 'Delfina Paz', member_kind: 'socio', member_number: '1200' },
    guardian: { full_name: 'Nora Paz' },
  },
  {
    id: 'e5',
    source: 'portal',
    status: 'confirmada',
    plan_key: 'cuota',
    student: { full_name: 'Elena Soto', member_kind: 'socio', member_number: '1300', document_number: '44111222' },
    guardian: { full_name: 'Rita Soto', phone: '2644555666' },
  },
];

describe('administración Colonia — padrón y fichas', () => {
  it('el número exacto encuentra al socio aunque lleve ceros', () => {
    expect(coloniaSocioHits(pad, '10632').map((row) => row.memberId)).toEqual(['10632']);
    expect(coloniaSocioHits(pad, '010632').map((row) => row.memberId)).toEqual(['10632']);
    expect(coloniaSocioHits(pad, '0010632').map((row) => row.memberId)).toEqual(['10632']);
  });

  it('un prefijo o una letra no inventan el número', () => {
    expect(coloniaSocioHits(pad, '877')).toEqual([]);
    expect(coloniaSocioHits(pad, '08770a')).toEqual([]);
  });

  it('el DNI entero sí entra, aunque coincida con otro número de socio', () => {
    expect(coloniaSocioHits(pad, '30111222').map((row) => row.memberId)).toEqual(['10632']);
    const both = coloniaSocioHits(pad, '8770').map((row) => row.memberId);
    expect(both).toContain('8770');
    expect(both).toContain('9001');
  });

  it('la ficha busca por nombre, número o DNI y no por un pedazo', () => {
    expect(roster.filter((row) => enrollmentMatchesRoster(row, 'ana')).map((row) => row.id)).toEqual(['e1']);
    expect(roster.filter((row) => enrollmentMatchesRoster(row, '10632')).map((row) => row.id)).toEqual(['e1']);
    expect(roster.filter((row) => enrollmentMatchesRoster(row, '010632')).map((row) => row.id)).toEqual(['e1']);
    expect(roster.filter((row) => enrollmentMatchesRoster(row, '50111000')).map((row) => row.id)).toEqual(['e3']);
    expect(roster.filter((row) => enrollmentMatchesRoster(row, '106'))).toEqual([]);
    expect(roster.filter((row) => enrollmentMatchesRoster(row, ''))).toHaveLength(roster.length);
  });

  it('el grupo familiar deja afuera al titular y a quien está fuera de edad', () => {
    const anchor = { memberId: '100', meta: { familyPrincipalNumber: '100' } };
    const list = [
      anchor,
      { memberId: '101', meta: { familyPrincipalNumber: '100' }, birthDate: '2016-04-01' },
      { memberId: '102', meta: { familyPrincipalNumber: '100' }, birthDate: '2018-01-01' },
      { memberId: '103', meta: { familyPrincipalNumber: '100' }, birthDate: '1990-01-01' },
    ];
    expect(householdKids(list, anchor, '2026-12-14').map((row) => row.memberId)).toEqual(['101', '102']);
  });

  it('el buscador del hijo solo mira el grupo del socio elegido', () => {
    const anchor = { memberId: '100', name: 'Titular Gómez', meta: { familyPrincipalNumber: '100' } };
    const ana = { memberId: '101', name: 'Ana Gómez', documentNumber: '30111222', meta: { familyPrincipalNumber: '100' }, birthDate: '2016-04-01' };
    const bruno = { memberId: '102', name: 'Bruno Gómez', meta: { familyPrincipalNumber: '100' }, birthDate: '2018-01-01' };
    const ajeno = { memberId: '8770', name: 'Otro Club', meta: { familyPrincipalNumber: '8770' }, birthDate: '2015-01-01' };
    const pool = householdSearchPool([anchor, ana, bruno, ajeno], anchor, '2026-12-14');
    expect(pool.map((row) => row.memberId)).toEqual(['101', '102']);
    expect(coloniaSocioHits(pool, '30111222').map((row) => row.memberId)).toEqual(['101']);
    expect(coloniaSocioHits(pool, '8770')).toEqual([]);
    expect(householdSearchPool([anchor], anchor, '2026-12-14')).toEqual([]);
  });

  it('los planes piden uno, dos o tres hijos', () => {
    expect(planChildSlots(COLONIA_PLAN_KEYS.cuota)).toBe(1);
    expect(planChildSlots(COLONIA_PLAN_KEYS.temporada)).toBe(1);
    expect(planChildSlots(COLONIA_PLAN_KEYS.hermano_4)).toBe(1);
    expect(planChildSlots(COLONIA_PLAN_KEYS.promo_2)).toBe(2);
    expect(planChildSlots(COLONIA_PLAN_KEYS.promo_3)).toBe(3);
  });
});

describe('administración Colonia — cuenta y hojas', () => {
  const rows = buildColoniaAccountRows({
    enrollments: roster,
    charges: [
      { enrollment_id: 'e1', concept: 'colonia_cuota', amount: 150000, status: 'posted' },
      { enrollment_id: 'e2', concept: 'colonia_temporada', amount: 390000, status: 'posted' },
      { enrollment_id: 'e4', concept: 'colonia_promocion', amount: 280000, status: 'posted' },
      { enrollment_id: 'e5', concept: 'colonia_cuota', amount: 150000, status: 'posted' },
    ],
    payments: [
      { enrollment_id: 'e2', amount: 390000, status: 'confirmed' },
      { enrollment_id: 'e1', amount: 150000, status: 'confirmed' },
      { enrollment_id: 'e1', amount: 10000, status: 'pending' },
      { enrollment_id: 'e5', amount: 150000, status: 'confirmed' },
    ],
    tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
    today: new Date(2026, 10, 24),
  });

  it('separa falta, pago por confirmar, próximo mes y pagó', () => {
    const byId = Object.fromEntries(rows.map((row) => [row.enrollment.id, row.status]));
    expect(byId.e1).toBe('pendiente');
    expect(byId.e2).toBe('pago');
    expect(byId.e3).toBeUndefined();
    expect(byId.e4).toBe('falta');
    expect(byId.e5).toBe('proximo');
  });

  it('las hojas de cuenta filtran sin perder a nadie en Todos', () => {
    expect(COLONIA_ACCOUNT_SHEETS.map((sheet) => sheet.key)).toEqual(['falta', 'proximo', 'pagaron', 'todos']);
    const falta = rows.filter((row) => coloniaAccountOnSheet(row, 'falta'));
    expect(falta.map((row) => row.enrollment.id).sort()).toEqual(['e1', 'e4']);
    expect(rows.filter((row) => coloniaAccountOnSheet(row, 'pagaron')).map((row) => row.enrollment.id)).toEqual(['e2']);
    expect(rows.filter((row) => coloniaAccountOnSheet(row, 'proximo')).map((row) => row.enrollment.id)).toEqual(['e5']);
    expect(rows.filter((row) => coloniaAccountOnSheet(row, 'todos'))).toHaveLength(rows.length);
  });

  it('la fila de Excel nombra el estado y no mezcla la cuota social', () => {
    const ana = rows.find((row) => row.enrollment.id === 'e1');
    const cells = coloniaAccountCells(ana);
    expect(cells[0]).toBe('Ana López');
    expect(cells[13]).toBe('Pago por confirmar');
    expect(COLONIA_ACCOUNT_HEADERS).toContain('Falta');
    expect(COLONIA_ACCOUNT_HEADERS).not.toContain('Cuota social');
    expect(coloniaAccountStatus({ status: 'proximo' })).toBe('Próximo mes');
  });

  it('el aviso de WhatsApp, MD y mail habla de Colonia y no de la cuota social', () => {
    const text = coloniaReminderCopy({
      name: 'Ana López',
      amountLabel: '$ 150.000',
      nextLabel: 'diciembre',
      status: 'falta',
    });
    expect(text).toContain('cuenta de Colonia');
    expect(text).toContain('aparte de la cuota social');
    expect(text).toContain('Ana López');
    const next = coloniaReminderCopy({
      name: 'Ana López',
      amountLabel: '$ 150.000',
      nextLabel: 'diciembre',
      status: 'proximo',
    });
    expect(next).toContain('diciembre');
  });

  it('la temporada saldada no anuncia el mes que viene', () => {
    const bruno = rows.find((row) => row.enrollment.id === 'e2');
    expect(bruno.nextAmount).toBe(0);
    expect(bruno.owed).toBe(0);
  });

  it('la hoja Próximo mes lleva el importe de la cuota ya saldada', () => {
    const elena = rows.find((row) => row.enrollment.id === 'e5');
    const cells = coloniaAccountCells(elena);
    expect(cells[11].toLowerCase()).toContain('diciembre');
    expect(cells[12]).toBe(150000);
    expect(cells[13]).toBe('Próximo mes');
  });
});

describe('administración Colonia — cuenta por mes', () => {
  const season = COLONIA_SEASON_2026_2027;
  const enrollments = [
    {
      id: 'mes',
      status: 'confirmada',
      plan_key: 'cuota',
      student: { full_name: 'Ana López', member_kind: 'socio' },
    },
    {
      id: 'temp',
      status: 'confirmada',
      plan_key: 'temporada',
      student: { full_name: 'Bruno Díaz', member_kind: 'socio' },
    },
    {
      id: 'herm',
      status: 'confirmada',
      plan_key: 'hermano_4',
      student: { full_name: 'Cami Ruiz', member_kind: 'socio' },
    },
  ];

  it('la temporada de verano va de noviembre a febrero', () => {
    expect(coloniaAccountMonths(season, new Date(2026, 10, 24)).map((month) => month.key))
      .toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('un pago cubre noviembre y deja la cuota de diciembre', () => {
    const shared = {
      enrollments,
      charges: [
        { enrollment_id: 'temp', amount: 440000, status: 'posted', created_at: '2026-12-02' },
        { enrollment_id: 'herm', amount: 410000, status: 'posted', created_at: '2026-11-24' },
      ],
      payments: [{ enrollment_id: 'mes', amount: 200000, status: 'confirmed', confirmed_at: '2026-12-05' }],
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      season,
    };
    const november = buildColoniaMonthRows({ ...shared, monthKey: '2026-11', today: new Date(2026, 11, 15) });
    const december = buildColoniaMonthRows({ ...shared, monthKey: '2026-12', today: new Date(2026, 11, 15) });
    const january = buildColoniaMonthRows({ ...shared, monthKey: '2027-01', today: new Date(2026, 11, 15) });
    const anaNov = november.find((row) => row.enrollment.id === 'mes');
    const anaDec = december.find((row) => row.enrollment.id === 'mes');
    const anaJan = january.find((row) => row.enrollment.id === 'mes');
    expect(anaNov).toMatchObject({ status: 'pago', owed: 0, summary: { totalCollected: 200000 } });
    expect(anaDec).toMatchObject({ status: 'falta', owed: 150000, summary: { totalCollected: 0 } });
    expect(anaJan).toMatchObject({ status: 'proximo', owed: 0, nextAmount: 150000 });
    expect(december.map((row) => row.enrollment.id)).toContain('temp');
    expect(january.map((row) => row.enrollment.id)).not.toContain('temp');
    expect(november.find((row) => row.enrollment.id === 'herm')).toMatchObject({ status: 'falta', owed: 410000 });
    expect(december.map((row) => row.enrollment.id)).not.toContain('herm');
  });

  it('el segundo hermano no repite el plan y un pago pendiente no se da por cobrado', () => {
    const shared = {
      enrollments: [
        {
          id: 'mayor',
          status: 'confirmada',
          plan_key: 'promo_2',
          student: { full_name: 'Mayor', member_kind: 'socio' },
        },
        {
          id: 'menor',
          status: 'confirmada',
          plan_key: 'promo_2',
          student: { full_name: 'Menor', member_kind: 'no_socio' },
        },
      ],
      charges: [
        { enrollment_id: 'mayor', concept: 'colonia_inscripcion', amount: 50000, status: 'posted', created_at: '2026-11-24' },
        { enrollment_id: 'mayor', concept: 'colonia_promocion', amount: 280000, status: 'posted', created_at: '2026-11-24' },
        { enrollment_id: 'menor', concept: 'colonia_inscripcion', amount: 50000, status: 'posted', created_at: '2026-11-24' },
        { enrollment_id: 'menor', concept: 'colonia_cuota', amount: 180000, status: 'void', created_at: '2026-11-24' },
      ],
      payments: [
        { enrollment_id: 'mayor', amount: 330000, status: 'confirmed' },
        { enrollment_id: 'mayor', amount: 10000, status: 'pending' },
      ],
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      periodicity: 'monthly',
      season,
      today: new Date(2026, 10, 24),
    };
    const november = buildColoniaMonthRows({ ...shared, monthKey: '2026-11' });
    const december = buildColoniaMonthRows({ ...shared, monthKey: '2026-12' });
    expect(november.find((row) => row.enrollment.id === 'mayor')).toMatchObject({
      status: 'pendiente',
      owed: 0,
      summary: { totalCollected: 330000 },
    });
    expect(november.find((row) => row.enrollment.id === 'menor')).toMatchObject({ status: 'falta', owed: 50000 });
    expect(december.find((row) => row.enrollment.id === 'mayor')).toMatchObject({ status: 'proximo', nextAmount: 280000 });
    expect(december.find((row) => row.enrollment.id === 'menor')).toMatchObject({ status: 'pago', nextAmount: 0 });
  });
});

describe('administración Colonia — reportes', () => {
  it('cada hoja recorta el padrón de inscriptos', () => {
    expect(COLONIA_REPORT_SHEETS).toHaveLength(10);
    expect(coloniaReportRows(roster, 'admin').map((row) => row.id)).toEqual(['e1', 'e4']);
    expect(coloniaReportRows(roster, 'portal').map((row) => row.id)).toEqual(['e2', 'e5']);
    expect(coloniaReportRows(roster, 'externas').map((row) => row.id)).toEqual([]);
    expect(coloniaReportRows(roster, 'pendientes').map((row) => row.id).sort()).toEqual(['e2', 'e4']);
    expect(coloniaReportRows(roster, 'confirmadas').map((row) => row.id)).toEqual(['e1', 'e5']);
    expect(coloniaReportRows(roster, 'canceladas').map((row) => row.id)).toEqual(['e3']);
    expect(coloniaReportRows(roster, 'no_socios').map((row) => row.id)).toEqual([]);
    expect(coloniaReportRows(roster, 'socios')).toHaveLength(4);
    expect(coloniaReportRows(roster, 'resumen')).toHaveLength(4);
    expect(coloniaReportRows(roster, 'inscriptos').map((row) => row.id)).not.toContain('e3');
    expect(coloniaReportRows(roster, 'inscriptos')).toHaveLength(4);
  });

  it('la celda de reporte distingue socio y no socio', () => {
    const cells = coloniaReportCells(roster[2]);
    expect(cells[0]).toBe('Cami Ruiz');
    expect(cells[1]).toBe('No socio');
    expect(cells[6]).toBe('external');
    expect(COLONIA_REPORT_HEADERS[0]).toBe('Alumno');
  });

  it('el CSV de inscriptos sale en español', () => {
    const csv = buildColoniaEnrollmentsCsv(roster);
    expect(csv.split('\n')[0]).toContain('alumno');
    expect(csv).toContain('Ana López');
    expect(csv).toContain('no_socio');
  });
});

describe('administración Colonia — inscripción y cobro', () => {
  const season = {
    enrollmentOpensOn: '2026-11-01',
    enrollmentClosesOn: '2026-12-20',
    activitiesStartOn: '2026-12-14',
    ageMin: 3,
    ageMax: 15,
  };

  it('la inscripción de secretaría exige alumno, edad y responsable', () => {
    const bad = validateEnrollmentDraft({
      student: { fullName: '', birthDate: '2025-01-01' },
      guardian: {},
      season,
      todayIso: '2026-11-24',
    });
    expect(bad.ok).toBe(false);
    const ok = validateEnrollmentDraft({
      student: {
        fullName: 'Ana López',
        birthDate: '2016-04-01',
        documentNumber: '30111222',
        memberKind: 'socio',
        memberNumber: '10632',
      },
      guardian: { fullName: 'Marta López', phone: '2644111222' },
      planKey: 'cuota',
      season,
      todayIso: '2026-11-24',
    });
    expect(ok.ok).toBe(true);
  });

  it('la promo de hermanos sigue cerrada hasta definir la periodicidad', () => {
    const promo = evaluatePromotionCharge({
      planKey: 'promo_2',
      season: { promotionPeriodicity: null },
      siblingCount: 2,
      memberKinds: ['socio', 'socio'],
    });
    expect(promo.ok).toBe(false);
    expect(promo.errors.some((error) => error.code === 'promo_periodicity_undefined')).toBe(true);
  });

  it('los medios de caja confirman y Mercado Pago sigue bloqueado', () => {
    expect(initialPaymentStatus('efectivo')).toBe('confirmed');
    expect(validateColoniaPaymentInput({
      method: 'efectivo',
      amount: 50000,
      enrollmentId: 'e1',
    }).ok).toBe(true);
    for (const method of ['tarjeta', 'pos']) {
      expect(initialPaymentStatus(method, { operatorConfirmed: true })).toBe('confirmed');
      expect(validateColoniaPaymentInput({
        method,
        amount: 50000,
        enrollmentId: 'e1',
        operatorConfirmed: true,
      }).ok).toBe(true);
    }
    const debit = validateColoniaPaymentInput({
      method: 'debito',
      amount: 50000,
      enrollmentId: 'e1',
      externalReference: 'DB-1',
      bankId: 'macro',
    });
    expect(debit.ok).toBe(true);
    expect(debit.status).toBe('confirmed');
    const transfer = validateColoniaPaymentInput({
      method: 'transferencia',
      amount: 50000,
      enrollmentId: 'e1',
      externalReference: 'TR-1',
    });
    expect(transfer.ok).toBe(true);
    expect(transfer.status).toBe('confirmed');
    expect(coloniaSettlementAccount('efectivo')).toBe('Caja General');
    expect(coloniaSettlementAccount('tarjeta')).toBe('Tarjetas a cobrar');
    expect(coloniaSettlementAccount('pos')).toBe('Tarjetas a cobrar');
    expect(coloniaSettlementAccount('transferencia', 'macro')).toBe('Banco Macro');
    expect(coloniaSettlementAccount('debito', 'mercadopago')).toBe('Mercado Pago');
    expect(coloniaSettlementAccount('mercadopago')).toBe('Mercado Pago');
    const mp = validateColoniaPaymentInput({
      method: 'mercadopago',
      amount: 50000,
      enrollmentId: 'e1',
    });
    expect(mp.ok).toBe(false);
    expect(mp.errors[0].code).toBe('mp_adapter_pending');
    expect(coloniaEnrollPayReady({ method: 'efectivo', amount: 200000 }).status).toBe('confirmed');
    expect(coloniaEnrollPayReady({ method: 'tarjeta', amount: 200000 }).ok).toBe(false);
    expect(coloniaEnrollPayReady({ method: 'tarjeta', amount: 200000, operatorConfirmed: true }).ok).toBe(true);
    expect(coloniaEnrollPayReady({ method: 'transferencia', amount: 200000, externalReference: 'TR-9' }).status).toBe('confirmed');
    expect(coloniaEnrollPayReady({ method: 'debito', amount: 200000 }).ok).toBe(false);
    expect(coloniaEnrollPayReady({ method: 'debito', amount: 200000, externalReference: 'DB-9' }).status).toBe('confirmed');
    expect(coloniaEnrollPayReady({ method: 'mercadopago', amount: 200000 }).ok).toBe(false);
    expect(coloniaEnrollPayReady({ method: 'mercadopago', amount: 200000, mpApproved: true }).ok).toBe(true);
    expect(coloniaMpPayable(200000, 50000)).toBe(150000);
    expect(coloniaMpPayable(10000, 10000)).toBe(0);
  });

  it('el cargo y el recibo viven en la cuenta de Colonia', () => {
    const charge = buildColoniaCharge({
      enrollmentId: 'e1',
      concept: 'colonia_inscripcion',
      amount: 50000,
    });
    expect(charge.concept).toBe('colonia_inscripcion');
    expect(charge.amount).toBe(50000);
    const receipt = buildColoniaReceipt({
      payment: { status: 'confirmed', amount: 50000, method: 'efectivo' },
      student: { full_name: 'Ana López' },
    });
    expect(receipt.conceptLabel).toBe('Colonia de Verano');
    expect(receipt.fiscalClaim).toBe(false);
    expect(buildColoniaReceipt({ payment: { status: 'pending', amount: 50000 } })).toBeNull();
    const summary = summarizeColoniaAccount({
      charges: [charge],
      payments: [{ amount: 20000, status: 'confirmed' }],
    });
    expect(summary.balanceDue).toBe(30000);
    expect(() => assertColoniaFinanceIsolation({ affectsMemberOutstandingBalance: true })).toThrow(/outstanding_balance/i);
  });

  it('el borrador de pago no acepta un medio ajeno', () => {
    expect(() => buildColoniaPaymentDraft({
      method: 'mixto',
      amount: 1000,
      enrollmentId: 'e1',
    })).toThrow(/no habilitado/i);
  });

  it('cobranzas salió del menú y configuración vive en el sistema', () => {
    expect(COLONIA_SECTIONS.map((item) => item.key)).not.toContain('cobranzas');
    expect(COLONIA_SECTIONS.map((item) => item.key)).not.toContain('configuracion');
    expect(COLONIA_SECTIONS.at(-1).key).toBe('resumen');
    expect(COLONIA_SECTIONS.some((item) => item.key === 'cuenta')).toBe(true);
  });

  it('las tarifas de socio y no socio no se cruzan', () => {
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'cuota')).toBe(150000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'cuota')).toBe(180000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'temporada')).toBe(390000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'promo_3')).toBe(500000);
  });

  it('la ficha también encuentra al responsable y ignora un acento', () => {
    expect(roster.filter((row) => enrollmentMatchesRoster(row, 'marta')).map((row) => row.id)).toEqual(['e1']);
    expect(roster.filter((row) => enrollmentMatchesRoster(row, 'Díaz')).map((row) => row.id)).toEqual(['e2']);
  });

  it('si ningún chico entra en edad, el grupo igual deja elegir al resto', () => {
    const anchor = { memberId: '100', meta: { familyPrincipalNumber: '100' } };
    const list = [
      anchor,
      { memberId: '201', meta: { familyPrincipalNumber: '100' }, birthDate: '1988-01-01' },
    ];
    expect(householdKids(list, anchor, '2026-12-14').map((row) => row.memberId)).toEqual(['201']);
  });

  it('la edad de Colonia incluye los 3 y los 15 y deja afuera los 2 y los 16', () => {
    const bounds = { activitiesStartOn: '2026-12-14', ageMin: 3, ageMax: 15 };
    expect(validateColoniaAge('2023-12-14', bounds).ok).toBe(true);
    expect(validateColoniaAge('2011-12-14', bounds).ok).toBe(true);
    expect(validateColoniaAge('2024-12-15', bounds).ok).toBe(false);
    expect(validateColoniaAge('2010-12-13', bounds).ok).toBe(false);
  });

  it('no se inscribe dos veces al mismo DNI ni fuera de la ventana', () => {
    const again = validateEnrollmentDraft({
      student: {
        fullName: 'Ana López',
        birthDate: '2016-04-01',
        documentNumber: '30111222',
        memberKind: 'socio',
        memberNumber: '10632',
      },
      guardian: { fullName: 'Marta López', phone: '2644111222' },
      planKey: 'cuota',
      season,
      todayIso: '2026-11-24',
      existingKeys: [enrollmentIdentityKey({ fullName: 'Ana López', documentNumber: '30111222', birthDate: '2016-04-01' })],
    });
    expect(again.ok).toBe(false);
    expect(again.errors.some((error) => error.code === 'duplicate_enrollment')).toBe(true);
    const late = validateEnrollmentDraft({
      student: {
        fullName: 'Ana López',
        birthDate: '2016-04-01',
        documentNumber: '30111222',
        memberKind: 'socio',
        memberNumber: '10632',
      },
      guardian: { fullName: 'Marta López', phone: '2644111222' },
      planKey: 'cuota',
      season,
      todayIso: '2026-12-21',
    });
    expect(late.errors.some((error) => error.code === 'outside_enrollment_window')).toBe(true);
  });

  it('tarjeta sin confirmar y transferencia sin referencia no se acreditan', () => {
    expect(validateColoniaPaymentInput({
      method: 'tarjeta',
      amount: 50000,
      enrollmentId: 'e1',
    }).errors.some((error) => error.code === 'card_confirmation_required')).toBe(true);
    expect(validateColoniaPaymentInput({
      method: 'transferencia',
      amount: 50000,
      enrollmentId: 'e1',
    }).errors.some((error) => error.code === 'transfer_reference_required')).toBe(true);
    expect(validateColoniaPaymentInput({
      method: 'efectivo',
      amount: 0,
      enrollmentId: 'e1',
    }).ok).toBe(false);
  });

  it('un cargo anulado no suma y un cargo negativo no existe', () => {
    const summary = summarizeColoniaAccount({
      charges: [
        { amount: 50000, status: 'posted' },
        { amount: 99999, status: 'void' },
      ],
      payments: [],
    });
    expect(summary.totalContracted).toBe(50000);
    expect(() => buildColoniaCharge({
      enrollmentId: 'e1',
      concept: 'colonia_inscripcion',
      amount: -1,
    })).toThrow(/negativo/i);
  });

  it('el cuarto hermano exige cuatro integrantes y no inventa cuota', () => {
    const promo = evaluatePromotionCharge({
      planKey: 'hermano_4',
      season: { promotionPeriodicity: 'season' },
      siblingCount: 4,
      memberKinds: ['socio', 'socio', 'socio', 'socio'],
    });
    expect(promo.ok).toBe(true);
    expect(promo.warnings.some((warning) => warning.code === 'fourth_sibling_inscription_only')).toBe(true);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'hermano_4')).toBe(410000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'hermano_4')).toBe(500000);
  });

  it('el mes que viene se nombra en español', () => {
    expect(coloniaNextMonthLabel(new Date(2026, 10, 24)).toLowerCase()).toContain('diciembre');
    expect(coloniaNextMonthLabel(new Date(2026, 11, 1)).toLowerCase()).toContain('enero');
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/chartOfAccounts';
import {
  DEFAULT_CANON_PAYMENTS,
  DEFAULT_CONCESSIONS,
  buildCanonJournalEntry,
  buildExpiryCalendar,
  checklistProgress,
  createCanonPayment,
  createConcession,
  exportConcessionsCsv,
  findConcessionByPortalCode,
  findSpaceOverlap,
  getCanonDebt,
  getConcessionExpiryStatus,
  missingRequiredDocuments,
  renewConcession,
  setChecklistItem,
  summarizeConcessions,
  syncConcessionAlerts,
  syncConcessionExpiryAlerts,
} from './concessions';

describe('getConcessionExpiryStatus', () => {
  it('marca vencida / por vencer / vigente', () => {
    const today = new Date('2026-07-24T12:00:00');
    expect(getConcessionExpiryStatus({ endDate: '2026-07-01', noticeDays: 30 }, { today }).status).toBe('expired');
    expect(getConcessionExpiryStatus({ endDate: '2026-08-10', noticeDays: 30 }, { today }).status).toBe('expiring');
    expect(getConcessionExpiryStatus({ endDate: '2027-01-01', noticeDays: 30 }, { today }).status).toBe('active');
  });
});

describe('syncConcessionExpiryAlerts / syncConcessionAlerts', () => {
  it('genera alertas solo para vencidas o por vencer', () => {
    const today = new Date('2026-07-24T12:00:00');
    const alerts = syncConcessionExpiryAlerts(
      [{ id: 'manual', source: 'manual', isActive: true }],
      [
        { id: 'a', name: 'A', concessionaire: 'X', endDate: '2026-07-01', monthlyFee: 1, noticeDays: 30 },
        { id: 'b', name: 'B', concessionaire: 'Y', endDate: '2027-01-01', monthlyFee: 1, noticeDays: 30, documents: [
          { id: 'd1', type: 'contrato', name: 'c' },
          { id: 'd2', type: 'seguro', name: 's' },
          { id: 'd3', type: 'habilitacion', name: 'h' },
        ] },
      ],
      today
    );
    expect(alerts.filter((a) => a.source === 'concession_expiry')).toHaveLength(1);
    expect(alerts.some((a) => a.source === 'manual')).toBe(true);
  });

  it('genera alertas de documentación faltante', () => {
    const today = new Date('2026-07-24T12:00:00');
    const alerts = syncConcessionAlerts(
      [],
      [
        {
          id: 'c3',
          name: 'Parking',
          concessionaire: 'Parking SA',
          endDate: '2027-01-01',
          noticeDays: 30,
          monthlyFee: 100,
          documents: [{ id: 'd1', type: 'contrato', name: 'c' }],
        },
      ],
      today
    );
    const docAlerts = alerts.filter((a) => a.source === 'concession_docs');
    expect(docAlerts).toHaveLength(1);
    expect(docAlerts[0].metadata.missingDocs).toContain('seguro');
    expect(docAlerts[0].metadata.missingDocs).toContain('habilitacion');
  });
});

describe('summarizeConcessions / renew', () => {
  it('renueva extendiendo endDate', () => {
    const renewed = renewConcession(
      { endDate: '2026-08-01', monthlyFee: 100000 },
      { months: 12, today: new Date('2026-07-24T12:00:00') }
    );
    expect(renewed.endDate >= '2027-07-01').toBe(true);
    expect(renewed.statusManual).toBe('active');
  });

  it('append renewalHistory con fee y renewedBy', () => {
    const renewed = renewConcession(
      { endDate: '2026-08-01', monthlyFee: 100000, renewalHistory: [] },
      { months: 6, today: new Date('2026-07-24T12:00:00'), monthlyFee: 120000, renewedBy: 'admin' }
    );
    expect(renewed.renewalHistory).toHaveLength(1);
    expect(renewed.renewalHistory[0].previousFee).toBe(100000);
    expect(renewed.renewalHistory[0].newFee).toBe(120000);
    expect(renewed.renewalHistory[0].renewedBy).toBe('admin');
    expect(renewed.renewalHistory[0].months).toBe(6);
    expect(renewed.monthlyFee).toBe(120000);
  });

  it('resume totales', () => {
    const { totals } = summarizeConcessions(
      [
        { id: '1', endDate: '2026-07-01', noticeDays: 30, monthlyFee: 100, statusManual: 'active' },
        { id: '2', endDate: '2027-01-01', noticeDays: 30, monthlyFee: 200, statusManual: 'active' },
      ],
      new Date('2026-07-24T12:00:00')
    );
    expect(totals.expired).toBe(1);
    expect(totals.active).toBe(1);
  });
});

describe('findSpaceOverlap', () => {
  const concessions = [
    {
      id: 'a',
      spaceId: 'space-pavilion',
      startDate: '2025-01-01',
      endDate: '2026-06-30',
      statusManual: 'active',
    },
    {
      id: 'b',
      spaceId: 'space-proshop',
      startDate: '2025-01-01',
      endDate: '2026-12-31',
      statusManual: 'active',
    },
  ];

  it('detecta solapamiento en el mismo espacio', () => {
    const conflict = findSpaceOverlap(concessions, {
      spaceId: 'space-pavilion',
      startDate: '2026-05-01',
      endDate: '2027-05-01',
    });
    expect(conflict?.id).toBe('a');
  });

  it('ignora excludeId y espacios distintos', () => {
    expect(findSpaceOverlap(concessions, {
      spaceId: 'space-pavilion',
      startDate: '2026-05-01',
      endDate: '2027-05-01',
      excludeId: 'a',
    })).toBeNull();

    expect(findSpaceOverlap(concessions, {
      spaceId: 'space-proshop',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    })?.id).toBe('b');
  });
});

describe('checklist', () => {
  it('calcula progreso de alta/baja', () => {
    let conc = { checklist: {} };
    conc = setChecklistItem(conc, 'contrato', true);
    conc = setChecklistItem(conc, 'seguro', true);
    const progress = checklistProgress(conc);
    expect(progress.done).toBe(2);
    expect(progress.entry.done).toBe(2);
    expect(progress.exit.done).toBe(0);
    expect(progress.pct).toBe(25);
  });
});

describe('canon debt', () => {
  it('calcula meses impagos hasta today', () => {
    const conc = {
      id: 'conc-1',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      monthlyFee: 100000,
    };
    const payments = [
      createCanonPayment({ concessionId: 'conc-1', amount: 100000, period: '2026-01' }),
      createCanonPayment({ concessionId: 'conc-1', amount: 100000, period: '2026-03' }),
    ];
    const debt = getCanonDebt(conc, payments, { today: new Date('2026-07-15') });
    expect(debt.expectedMonths).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ]);
    expect(debt.unpaidMonths).toEqual(['2026-02', '2026-04', '2026-05', '2026-06', '2026-07']);
    expect(debt.totalDebt).toBe(500000);
  });

  it('usa DEFAULT_CANON_PAYMENTS para conc-1 parcialmente al día', () => {
    const conc = DEFAULT_CONCESSIONS.find((c) => c.id === 'conc-1');
    const debt = getCanonDebt(conc, DEFAULT_CANON_PAYMENTS, { today: new Date('2026-07-24') });
    expect(debt.paidMonths).toContain('2026-05');
    expect(debt.paidMonths).toContain('2026-06');
    expect(debt.unpaidMonths.length).toBeGreaterThan(0);
  });

  it('genera asiento contable de canon', () => {
    const conc = DEFAULT_CONCESSIONS[0];
    const payment = DEFAULT_CANON_PAYMENTS[0];
    const entry = buildCanonJournalEntry(payment, conc, DEFAULT_CHART_OF_ACCOUNTS);
    expect(entry.status).toBe('posted');
    expect(entry.lines.some((l) => l.accountId === 'coa-1.1.01' && l.debit === 850000)).toBe(true);
    expect(entry.lines.some((l) => l.accountId === 'coa-4.1.04' && l.credit === 850000)).toBe(true);
  });
});

describe('calendar and csv', () => {
  it('lista vencimientos del mes', () => {
    const july = buildExpiryCalendar(DEFAULT_CONCESSIONS, { year: 2026, month: 6 });
    expect(july.some((e) => e.concessionId === 'conc-2' && e.date === '2026-07-31')).toBe(true);

    const august = buildExpiryCalendar(DEFAULT_CONCESSIONS, { year: 2026, month: 7 });
    expect(august.some((e) => e.concessionId === 'conc-1' && e.date === '2026-08-15')).toBe(true);
    expect(august.every((e) => e.type === 'expiry')).toBe(true);
  });

  it('exporta CSV con BOM', () => {
    const csv = exportConcessionsCsv(DEFAULT_CONCESSIONS.slice(0, 1));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Restaurante The Pavilion');
    expect(csv).toContain('PAV-8842');
  });
});

describe('portal code and documents', () => {
  it('encuentra concesión por portal code', () => {
    expect(findConcessionByPortalCode(DEFAULT_CONCESSIONS, 'pav-8842')?.id).toBe('conc-1');
    expect(findConcessionByPortalCode(DEFAULT_CONCESSIONS, 'INVALID')).toBeNull();
  });

  it('createConcession asigna spaceId y portalCode', () => {
    const conc = createConcession({
      name: 'Test',
      concessionaire: 'Test SA',
      endDate: '2027-01-01',
      spaceId: 'space-eventos',
    });
    expect(conc.spaceId).toBe('space-eventos');
    expect(conc.portalCode).toMatch(/^EVT-\d{4}$/);
    expect(conc.checklist).toBeDefined();
  });

  it('detecta documentos requeridos faltantes en seed', () => {
    expect(missingRequiredDocuments(DEFAULT_CONCESSIONS[0])).toEqual([]);
    expect(missingRequiredDocuments(DEFAULT_CONCESSIONS[2])).toEqual(['seguro']);
    expect(missingRequiredDocuments(DEFAULT_CONCESSIONS[3])).toEqual(['contrato', 'seguro', 'habilitacion']);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  ACCOUNTING_REPORT_TYPES,
  createAccountingReportRecord,
  prependAccountingReport,
  reportsForType,
} from './accountingReports';
import { buildSurchargeComposition, SURCHARGE_COMPOSITION_SNAPSHOTS } from './surchargeComposition';
import { buildLibreDeudaCertificate, LIBRE_DEUDA_SNAPSHOTS } from './libreDeuda';

beforeAll(async () => {
  await loadSnapshots([...LIBRE_DEUDA_SNAPSHOTS, ...SURCHARGE_COMPOSITION_SNAPSHOTS]);
});

describe('accountingReports', () => {
  it('incluye libros, estados y reportes de socios', () => {
    const ids = ACCOUNTING_REPORT_TYPES.map((t) => t.id);
    expect(ids).toEqual([
      'diary', 'mayor', 'results', 'balance_sheet', 'trial', 'gestion',
      'recargos', 'libre_deuda', 'detailed_cc', 'family_balances',
    ]);
  });

  it('guarda historial por tipo', () => {
    const rec = createAccountingReportRecord({ reportType: 'recargos', summary: 'ok' });
    const list = prependAccountingReport([], rec);
    expect(reportsForType(list, 'recargos')).toHaveLength(1);
    expect(reportsForType(list, 'libre_deuda')).toHaveLength(0);
  });

  it('compone recargos cobrados y adeudados', () => {
    const report = buildSurchargeComposition({ memberNumber: '10743' });
    expect(report.rows.length).toBeGreaterThan(0);
    expect(report.total).toBeGreaterThan(0);
    expect(report.byKind.length).toBeGreaterThan(0);
  });

  it('exige socio en libre deuda', () => {
    expect(() => buildLibreDeudaCertificate(null)).toThrow(/Socio/);
  });

  it('arma certificado de libre deuda con el texto LILA', () => {
    const cert = buildLibreDeudaCertificate(
      { memberId: '1', name: 'Tomás Andrés Peñaloza Martínez', documentNumber: '50000444', tier: 'familiar' },
      { asOf: '2026-09-26', extraInfo: 'póliza vigente', issuedAt: new Date('2026-09-26T12:08:00-03:00') }
    );
    expect(cert.letter.headingTitle).toBe('DOCUMENTO LIBRE DEUDA');
    expect(cert.constancia).toMatch(/no posee saldos pendientes de pago en el sistema Jockey Club/);
    expect(cert.constancia).toMatch(/CUIT 30-53106908-7/);
    expect(cert.constancia).toMatch(/póliza vigente/);
    expect(cert.letter.stamp).toMatch(/26 DE SEPTIEMBRE DEL 2026 A LAS/);
    expect(cert.isClear).toBe(true);
  });
});

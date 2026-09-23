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

  it('arma certificado de libre deuda con saldo LILA', () => {
    const cert = buildLibreDeudaCertificate(
      { memberId: '1', name: 'Tomás Andrés Peñaloza Martínez', documentNumber: '50000444', tier: 'familiar' },
      { asOf: '2026-09-03', extraInfo: 'póliza vigente' }
    );
    expect(cert.constancia).toMatch(/deja constancia póliza vigente del mismo/);
    expect(cert.isClear).toBe(true);
  });
});

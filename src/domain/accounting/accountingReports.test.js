import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_REPORT_TYPES,
  createAccountingReportRecord,
  prependAccountingReport,
  reportsForType,
} from './accountingReports';
import { buildSurchargeComposition } from './surchargeComposition';
import { buildLibreDeudaCertificate } from './libreDeuda';

describe('accountingReports', () => {
  it('incluye los tipos LILA de contabilidad', () => {
    const ids = ACCOUNTING_REPORT_TYPES.map((t) => t.id);
    expect(ids).toEqual(['recargos', 'libre_deuda', 'detailed_cc', 'family_balances']);
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
      { memberId: '1', name: 'Jonas David Castañeda Rodríguez', documentNumber: '50573357', tier: 'familiar' },
      { asOf: '2026-09-03', extraInfo: 'póliza vigente' }
    );
    expect(cert.constancia).toMatch(/deja constancia póliza vigente del mismo/);
    expect(cert.isClear).toBe(true);
  });
});

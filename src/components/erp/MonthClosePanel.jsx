import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { createAccountingReportRecord } from '../../domain/accounting/accountingReports';
import { exportMonthClosePdf } from '../../domain/accounting/exportMonthClosePdf';
import { formatCurrency } from '../../domain/accounting/journal';
import { buildMonthCloseReport } from '../../domain/accounting/monthClose';
import { formatISODateLongAR } from '../../lib/arDate';

function LineTable({ lines, totalLabel, total }) {
  return (
    <table className="balance-table">
      <tbody>
        {lines.map((line) => (
          <tr key={line.label} className="balance-row-account">
            <td>{line.bank ? `${line.label} · extracto` : line.label}</td>
            <td style={{ textAlign: 'right' }}>{formatCurrency(line.amount)}</td>
          </tr>
        ))}
        <tr className="balance-row-total">
          <td>{totalLabel}</td>
          <td style={{ textAlign: 'right' }}>{formatCurrency(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export default function MonthClosePanel({
  journalEntries = [],
  chartOfAccounts = [],
  members = [],
  feePeriods = [],
  cashMovements = [],
  pendingCollections = [],
  onRecordReport,
}) {
  const [monthKey, setMonthKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const report = useMemo(
    () => buildMonthCloseReport({
      journalEntries,
      chart: chartOfAccounts,
      monthKey,
      members,
      movements: cashMovements,
      feePeriods,
      pendingCollections,
    }),
    [journalEntries, chartOfAccounts, monthKey, members, cashMovements, feePeriods, pendingCollections],
  );

  const download = async () => {
    setError('');
    if (!report) {
      setError('No hay un mes para cerrar.');
      return;
    }
    setBusy(true);
    try {
      const fileName = await exportMonthClosePdf(report);
      onRecordReport?.(createAccountingReportRecord({
        reportType: 'cierre',
        filters: { monthKey: report.monthKey },
        summary: `${report.label} · ${report.statusLabel}`,
        fileName,
      }));
    } catch (err) {
      setError(err.message || 'No se pudo generar el informe.');
    } finally {
      setBusy(false);
    }
  };

  if (!report) {
    return <p className="mb-folio-status">Todavía no hay asientos para cerrar un mes.</p>;
  }

  const period = report.periodFrom
    ? `${formatISODateLongAR(report.periodFrom)}${report.periodTo && report.periodTo !== report.periodFrom ? ` — ${formatISODateLongAR(report.periodTo)}` : ''}`
    : report.label;

  return (
    <section className="er-block mc-close">
      <div className="er-block-head">
        <h4>Informe de cierre</h4>
        <span>{report.statusLabel}</span>
      </div>
      <p className="mb-folio-meta">
        El orden es corte, pagos, cajas, cuentas corrientes, resumen y saldos del mes siguiente.
      </p>

      <div className="mc-tools">
        <label>
          <span className="form-label">Mes</span>
          <select
            className="form-input"
            value={report.monthKey}
            onChange={(event) => setMonthKey(event.target.value)}
          >
            {report.months.map((month) => (
              <option key={month.key} value={month.key}>
                {month.label} · {month.closed ? 'Cerrado' : 'En curso'}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-tan" disabled={busy} onClick={() => { void download(); }}>
          <Download size={16} aria-hidden="true" />
          {busy ? 'Generando…' : 'Descargar PDF'}
        </button>
      </div>

      {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}

      <p className="jd-day-caption">
        <time dateTime={report.periodFrom || undefined}>{period}</time>
        <em>{report.entryCount === 1 ? '1 asiento' : `${report.entryCount} asientos`}</em>
      </p>

      <dl className="mb-folio-kpis">
        <div className={['mb-folio-kpi', report.result >= 0 ? 'is-net' : 'is-out'].join(' ')}>
          <dt>Resultado</dt>
          <dd>{formatCurrency(report.result)}</dd>
          <p>Ingresos menos egresos</p>
        </div>
        <div className="mb-folio-kpi is-in">
          <dt>Ingresos</dt>
          <dd>{formatCurrency(report.incomeTotal)}</dd>
          <p>Cuentas de ingreso del mes</p>
        </div>
        <div className="mb-folio-kpi is-out">
          <dt>Egresos</dt>
          <dd>{formatCurrency(report.expenseTotal)}</dd>
          <p>Cuentas de gasto del mes</p>
        </div>
        <div className="mb-folio-kpi is-cash">
          <dt>Banco Nación</dt>
          <dd>{formatCurrency(report.bankAmount)}</dd>
          <p>Saldo de libro para el extracto</p>
        </div>
      </dl>

      <ol className="mc-steps">
        {report.steps.map((step) => (
          <li key={step.id} className={`mc-step is-${step.tone}`}>
            <h5><span>{step.order}</span> {step.title}</h5>
            <p>{step.detail}</p>
            {step.lines.length > 0 ? (
              <LineTable
                lines={step.lines}
                totalLabel={
                  step.id === 'summary' ? 'Resultado'
                    : step.id === 'accounts' ? 'Total recaudado'
                      : step.id === 'carry' ? 'Abre el mes siguiente'
                        : 'Total caja y bancos'
                }
                total={step.id === 'summary' ? report.result : step.id === 'accounts' ? report.collected.recaudado : report.cashTotal}
              />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mc-signs" aria-label="Firmas del cierre">
        {['Tesorería', 'Contador', 'Administración'].map((role) => (
          <div key={role} className="mc-sign">
            <strong>{role}</strong>
            <span>Firma y sello</span>
          </div>
        ))}
      </div>
    </section>
  );
}

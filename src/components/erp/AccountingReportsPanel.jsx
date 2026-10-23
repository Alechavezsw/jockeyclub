import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { memberNumberOf } from '../../domain/members/households';
import {
  ACCOUNTING_REPORT_TYPES,
  accountingReportTypeLabel,
  createAccountingReportRecord,
  formatReportGeneratedAt,
} from '../../domain/accounting/accountingReports';
import { findMemberForLibreDeuda } from '../../domain/accounting/libreDeuda';
import { buildSurchargeComposition } from '../../domain/accounting/surchargeComposition';
import { exportSurchargeCompositionPdf } from '../../domain/accounting/exportSurchargeCompositionPdf';
import { exportDetailedCcPdf } from '../../domain/accounting/exportDetailedCcPdf';
import { buildLiveDetailedCc } from '../../domain/accounting/liveDetailedCc';
import { buildLiveFamilyGroupBalances } from '../../domain/accounting/liveFamilyGroupBalances';
import { exportFamilyGroupBalancesPdf } from '../../domain/accounting/exportFamilyGroupBalancesPdf';
import { exportAccountingReport, buildAccountingPack } from '../../domain/accounting/exportAccountingPack';
import { exportJournalPdf } from '../../domain/accounting/exportJournalPdf';
import MonthClosePanel from './MonthClosePanel';
import { exportJournalExcel } from '../../domain/accounting/exportJournalExcel';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../domain/accounting/chartOfAccounts';
import { formatCurrency } from '../../domain/accounting/journal';

const BOOK_REPORTS = [
  {
    id: 'diary',
    title: 'Libro diario',
    copy: 'Asientos oficiales, en orden, con debe y haber.',
    formats: ['pdf', 'xlsx'],
  },
  {
    id: 'mayor',
    title: 'Libro mayor',
    copy: 'Movimientos y saldo de cada cuenta con actividad.',
    formats: ['pdf', 'xlsx'],
  },
  {
    id: 'results',
    title: 'Estado de resultados',
    copy: 'Ingresos, egresos y superávit o déficit del ejercicio.',
    formats: ['pdf', 'xlsx'],
  },
  {
    id: 'balance_sheet',
    title: 'Balance patrimonial',
    copy: 'Activo, pasivo y patrimonio, con el resultado ya sumado.',
    formats: ['pdf', 'xlsx'],
  },
  {
    id: 'trial',
    title: 'Balance de comprobación',
    copy: 'Saldos por naturaleza para controlar la partida doble.',
    formats: ['pdf', 'xlsx'],
  },
  {
    id: 'gestion',
    title: 'Gestión del ejercicio',
    copy: 'Mix de ingresos, origen del cobro y pulso mes a mes.',
    formats: ['pdf', 'xlsx'],
  },
];

const MEMBER_REPORTS = [
  {
    id: 'recargos',
    title: 'Composición de recargos',
    copy: 'El 10 % de mora cobrado y el que todavía adeuda, con o sin socio.',
    formats: ['pdf'],
  },
  {
    id: 'libre_deuda',
    title: 'Libre deuda',
    copy: 'Certificado con el saldo de cuota vivo del socio.',
    formats: [],
    opens: 'libre_deuda',
  },
  {
    id: 'detailed_cc',
    title: 'Cuenta corriente detallada',
    copy: 'Deuda de cuota mes a mes de un socio.',
    formats: ['pdf'],
  },
  {
    id: 'family_balances',
    title: 'Saldo de grupo familiar',
    copy: 'Saldo de cuota del socio titular de cada grupo.',
    formats: ['pdf'],
    opens: 'family_balances',
  },
];

export default function AccountingReportsPanel({
  members = [],
  reports = [],
  onRecordReport,
  journalEntries = [],
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS,
  onOpenLibreDeuda,
  onOpenFamilyBalances,
  feePeriods = [],
  cashMovements = [],
  pendingCollections = [],
}) {
  const [reportType, setReportType] = useState('results');
  const [memberQuery, setMemberQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  const pack = useMemo(
    () => buildAccountingPack(journalEntries, chartOfAccounts),
    [journalEntries, chartOfAccounts],
  );
  const history = useMemo(
    () => (reports || []).filter((row) => row && row.status !== 'deleted').slice(0, 20),
    [reports],
  );
  const typeLabel = accountingReportTypeLabel(reportType);
  const needsMemberForm = reportType === 'recargos' || reportType === 'detailed_cc';

  const resolveMember = () => findMemberForLibreDeuda(members, memberQuery)
    || (members || []).find((m) => String(m.name || '').toLowerCase().includes(memberQuery.trim().toLowerCase()));

  const record = (type, fileName, summary, filters) => {
    onRecordReport?.(createAccountingReportRecord({
      reportType: type,
      filters,
      summary,
      fileName,
    }));
  };

  const downloadBook = async (type, format) => {
    setError('');
    setBusy(`${type}-${format}`);
    try {
      if (type === 'diary') {
        const result = format === 'xlsx'
          ? await exportJournalExcel(journalEntries, { chart: chartOfAccounts })
          : await exportJournalPdf(journalEntries, { chart: chartOfAccounts });
        const fileName = typeof result === 'string' ? result : (result?.fileName || `jockey_club_libro_diario.${format === 'xlsx' ? 'xlsx' : 'pdf'}`);
        record(type, fileName, `${journalEntries.length} asientos`, { format });
        return;
      }
      const result = await exportAccountingReport({
        reportType: type,
        format,
        journalEntries,
        chart: chartOfAccounts,
      });
      record(type, result.fileName, result.summary, { format });
    } catch (err) {
      setError(err.message || 'No se pudo generar el reporte.');
    } finally {
      setBusy(null);
    }
  };

  const downloadFamily = async () => {
    setError('');
    setBusy('family_balances-pdf');
    try {
      const book = buildLiveFamilyGroupBalances(members, { onlyWithBalance: true });
      const fileName = await exportFamilyGroupBalancesPdf({
        groups: book.groups,
        asOfLabel: book.asOfLabel,
      });
      record('family_balances', fileName, `${book.groups.length} grupos`, { onlyWithBalance: true });
    } catch (err) {
      setError(err.message || 'No se pudo generar el reporte.');
    } finally {
      setBusy(null);
    }
  };

  const handleMemberReport = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(`${reportType}-pdf`);
    try {
      let fileName = '';
      let summary = '';
      const filters = { memberQuery, from, to };

      if (reportType === 'recargos') {
        const member = memberQuery.trim() ? resolveMember() : null;
        if (memberQuery.trim() && !member) throw new Error('Socio. Es obligatorio');
        const nro = member ? memberNumberOf(member) : '';
        const report = buildSurchargeComposition({
          members,
          memberNumber: nro,
          from,
          to,
        });
        fileName = await exportSurchargeCompositionPdf(report);
        summary = `${report.rows.length} recargos · $ ${report.total.toLocaleString('es-AR')}`;
      } else if (reportType === 'detailed_cc') {
        const member = resolveMember();
        if (!member) throw new Error('Socio. Es obligatorio');
        const detail = buildLiveDetailedCc(member);
        if (!detail) throw new Error('Socio. Es obligatorio');
        fileName = await exportDetailedCcPdf(detail);
        summary = `${detail.memberNumber} · ${detail.standing}`;
      }

      record(reportType, fileName, summary, filters);
    } catch (err) {
      setError(err.message || 'No se pudo generar el reporte.');
    } finally {
      setBusy(null);
    }
  };

  const rerun = (row) => {
    if (row.reportType === 'libre_deuda') {
      onOpenLibreDeuda?.();
      return;
    }
    if (row.reportType === 'family_balances') {
      void downloadFamily();
      return;
    }
    setReportType(row.reportType);
    const filters = row.filters || {};
    setMemberQuery(filters.memberQuery || '');
    setFrom(filters.from || '');
    setTo(filters.to || '');
    if (BOOK_REPORTS.some((item) => item.id === row.reportType)) {
      void downloadBook(row.reportType, filters.format === 'xlsx' ? 'xlsx' : 'pdf');
    }
  };

  const renderCard = (item) => (
    <article key={item.id} className={['ar-card', reportType === item.id ? 'is-on' : ''].filter(Boolean).join(' ')}>
      <button type="button" className="ar-card-pick" onClick={() => {
        setReportType(item.id);
        setError('');
        if (item.opens === 'libre_deuda') onOpenLibreDeuda?.();
      }}>
        <span className="ar-card-kicker">{item.formats.includes('xlsx') ? 'PDF · Excel' : 'PDF'}</span>
        <h4>{item.title}</h4>
        <p>{item.copy}</p>
      </button>
      <div className="ar-card-actions">
        {item.opens ? (
          <button
            type="button"
            className="btn btn-tan"
            onClick={() => {
              setReportType(item.id);
              if (item.opens === 'libre_deuda') onOpenLibreDeuda?.();
              if (item.opens === 'family_balances') onOpenFamilyBalances?.();
            }}
          >
            Abrir
          </button>
        ) : null}
        {item.formats.includes('pdf') ? (
          <button
            type="button"
            className="btn btn-tan"
            disabled={Boolean(busy)}
            onClick={() => {
              setReportType(item.id);
              if (item.id === 'family_balances') {
                void downloadFamily();
                return;
              }
              if (MEMBER_REPORTS.some((row) => row.id === item.id)) return;
              void downloadBook(item.id, 'pdf');
            }}
          >
            <FileText size={14} aria-hidden="true" />
            {busy === `${item.id}-pdf` ? 'Generando…' : 'PDF'}
          </button>
        ) : null}
        {item.formats.includes('xlsx') ? (
          <button
            type="button"
            className="btn btn-tan"
            disabled={Boolean(busy)}
            onClick={() => {
              setReportType(item.id);
              void downloadBook(item.id, 'xlsx');
            }}
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            {busy === `${item.id}-xlsx` ? 'Generando…' : 'Excel'}
          </button>
        ) : null}
      </div>
    </article>
  );

  return (
    <div className="fade-in mb-folio ar-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Contabilidad</p>
          <h3 className="mb-folio-title">Reportes descargables</h3>
          <p className="mb-folio-meta">
            PDF y Excel del diario oficial. Abajo, certificados con la cuota viva.
          </p>
        </div>
        <span className="mb-folio-seal">Vivo</span>
      </header>

      <dl className="mb-folio-kpis">
        <div className="mb-folio-kpi">
          <dt>Asientos</dt>
          <dd>{pack.asientos.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi is-net">
          <dt>Ingresos</dt>
          <dd>{formatCurrency(pack.totals.ingresos)}</dd>
        </div>
        <div className="mb-folio-kpi is-out">
          <dt>Egresos</dt>
          <dd>{formatCurrency(pack.totals.gastos)}</dd>
        </div>
        <div className={['mb-folio-kpi', pack.totals.resultado >= 0 ? 'is-net' : 'is-out'].join(' ')}>
          <dt>Resultado</dt>
          <dd>{formatCurrency(pack.totals.resultado)}</dd>
        </div>
      </dl>

      {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}

      <MonthClosePanel
        journalEntries={journalEntries}
        chartOfAccounts={chartOfAccounts}
        members={members}
        feePeriods={feePeriods}
        cashMovements={cashMovements}
        pendingCollections={pendingCollections}
        onRecordReport={onRecordReport}
      />

      <section className="er-block">
        <div className="er-block-head">
          <h4>Libros y estados</h4>
          <span>{ACCOUNTING_REPORT_TYPES.length} modelos</span>
        </div>
        <div className="ar-catalog">{BOOK_REPORTS.map(renderCard)}</div>
      </section>

      <section className="er-block">
        <div className="er-block-head">
          <h4>Socios</h4>
          <span>Cuota viva</span>
        </div>
        <div className="ar-catalog">{MEMBER_REPORTS.map(renderCard)}</div>
      </section>

      {needsMemberForm ? (
        <form className="ar-emit" onSubmit={handleMemberReport}>
          <div className="er-block-head">
            <h4>{typeLabel}</h4>
            <span>PDF</span>
          </div>

          {reportType === 'recargos' ? (
            <div className="ar-filters">
              <label>
                <span className="form-label">Socio</span>
                <input className="form-input" list="arep-members" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Nro. o nombre (opcional)" />
              </label>
              <label>
                <span className="form-label">Desde</span>
                <input type="date" className="form-input" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                <span className="form-label">Hasta</span>
                <input type="date" className="form-input" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          ) : null}

          {reportType === 'detailed_cc' ? (
            <div className="ar-filters">
              <label>
                <span className="form-label">Socio</span>
                <input className="form-input" list="arep-members" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Nro. o nombre" required />
              </label>
            </div>
          ) : null}

          <datalist id="arep-members">
            {(members || []).slice(0, 800).map((m) => (
              <option key={m.memberId || m.id} value={`${memberNumberOf(m)} - ${m.name}`} />
            ))}
          </datalist>

          <div className="ar-card-actions">
            <button type="submit" className="btn btn-tan" disabled={Boolean(busy)}>
              <Download size={14} aria-hidden="true" />
              {busy === `${reportType}-pdf` ? 'Generando…' : 'Descargar PDF'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="er-block">
        <div className="er-block-head">
          <h4>Generados</h4>
          <span>{history.length} recientes</span>
        </div>
        <div className="table-responsive">
          <table className="balance-table">
            <thead>
              <tr>
                <th>Reporte</th>
                <th>Generado</th>
                <th>Archivo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4} className="mb-folio-empty">Todavía no se descargó ningún reporte en esta sesión.</td>
                </tr>
              ) : history.map((row) => (
                <tr key={row.id} className="balance-row-account">
                  <td>{row.reportTypeLabel}</td>
                  <td>
                    {formatReportGeneratedAt(row.generatedAt)}
                    {row.summary ? <div className="disc-field-hint">{row.summary}</div> : null}
                  </td>
                  <td>{row.fileName || '—'}</td>
                  <td>
                    <button type="button" className="mb-folio-link" onClick={() => rerun(row)}>
                      Volver a generar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { memberNumberOf } from '../../domain/members/households';
import {
  ACCOUNTING_REPORT_TYPES,
  accountingReportTypeLabel,
  createAccountingReportRecord,
  formatReportGeneratedAt,
} from '../../domain/accounting/accountingReports';
import {
  buildLibreDeudaCertificate,
  findMemberForLibreDeuda,
  LIBRE_DEUDA_SNAPSHOTS,
} from '../../domain/accounting/libreDeuda';
import { exportLibreDeudaPdf } from '../../domain/accounting/exportLibreDeudaPdf';
import {
  buildSurchargeComposition,
  SURCHARGE_COMPOSITION_SNAPSHOTS,
} from '../../domain/accounting/surchargeComposition';
import { requireSnapshots } from '../../data/snapshots';
import { exportSurchargeCompositionPdf } from '../../domain/accounting/exportSurchargeCompositionPdf';
import { exportDetailedCcPdf } from '../../domain/accounting/exportDetailedCcPdf';
import { exportFamilyGroupBalancesPdf } from '../../domain/accounting/exportFamilyGroupBalancesPdf';
import { exportAccountingReport } from '../../domain/accounting/exportAccountingPack';
import { exportJournalPdf } from '../../domain/accounting/exportJournalPdf';
import { exportJournalExcel } from '../../domain/accounting/exportJournalExcel';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../domain/accounting/chartOfAccounts';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function wrapSelection(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || 'texto';
  return {
    next: `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`,
  };
}

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
    copy: 'Recargos cobrados y adeudados, con o sin socio.',
    formats: ['pdf'],
  },
  {
    id: 'libre_deuda',
    title: 'Libre deuda',
    copy: 'Certificado de un socio a una fecha de corte.',
    formats: ['pdf'],
  },
  {
    id: 'detailed_cc',
    title: 'Cuenta corriente detallada',
    copy: 'Movimientos de la cuenta de un socio.',
    formats: ['pdf'],
  },
  {
    id: 'family_balances',
    title: 'Saldo de grupo familiar',
    copy: 'Saldos agrupados por familia, con filtro opcional.',
    formats: ['pdf'],
  },
];

export default function AccountingReportsPanel({
  members = [],
  reports = [],
  onRecordReport,
  journalEntries = [],
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS,
}) {
  const [reportType, setReportType] = useState('results');
  const [memberQuery, setMemberQuery] = useState('');
  const [asOf, setAsOf] = useState(todayIso);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [extraInfo, setExtraInfo] = useState('');
  const [familyQuery, setFamilyQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const extraRef = useRef(null);

  const history = useMemo(
    () => (reports || []).filter((row) => row && row.status !== 'deleted').slice(0, 20),
    [reports],
  );
  const typeLabel = accountingReportTypeLabel(reportType);
  const needsMemberForm = MEMBER_REPORTS.some((item) => item.id === reportType);

  const applyExtraMark = (before, after) => {
    const el = extraRef.current;
    if (!el) return;
    const { next } = wrapSelection(el, before, after);
    setExtraInfo(next);
  };

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

  const handleMemberReport = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(`${reportType}-pdf`);
    try {
      let fileName = '';
      let summary = '';
      const filters = { memberQuery, asOf, from, to, extraInfo, familyQuery };

      if (reportType === 'libre_deuda') {
        const member = resolveMember();
        if (!member) throw new Error('Socio. Es obligatorio');
        await requireSnapshots(LIBRE_DEUDA_SNAPSHOTS);
        const cert = buildLibreDeudaCertificate(member, { asOf, extraInfo, allMembers: members });
        await exportLibreDeudaPdf(cert);
        fileName = `jockey_club_libre_deuda_${cert.memberNumber}_${cert.asOf}.pdf`;
        summary = `${cert.memberNumber} · ${cert.statusLabel}`;
      } else if (reportType === 'recargos') {
        const member = memberQuery.trim() ? resolveMember() : null;
        if (memberQuery.trim() && !member) throw new Error('Socio. Es obligatorio');
        const nro = member ? memberNumberOf(member) : '';
        await requireSnapshots(SURCHARGE_COMPOSITION_SNAPSHOTS);
        const report = buildSurchargeComposition({ memberNumber: nro, from, to });
        fileName = await exportSurchargeCompositionPdf(report);
        summary = `${report.rows.length} recargos · $ ${report.total.toLocaleString('es-AR')}`;
      } else if (reportType === 'detailed_cc') {
        const member = resolveMember();
        if (!member) throw new Error('Socio. Es obligatorio');
        fileName = await exportDetailedCcPdf(memberNumberOf(member));
        summary = memberNumberOf(member);
      } else if (reportType === 'family_balances') {
        fileName = await exportFamilyGroupBalancesPdf({ query: familyQuery });
        summary = familyQuery ? `Filtro ${familyQuery}` : 'Todos los grupos';
      }

      record(reportType, fileName, summary, filters);
    } catch (err) {
      setError(err.message || 'No se pudo generar el reporte.');
    } finally {
      setBusy(null);
    }
  };

  const rerun = (row) => {
    setReportType(row.reportType);
    const filters = row.filters || {};
    setMemberQuery(filters.memberQuery || '');
    setAsOf(filters.asOf || todayIso());
    setFrom(filters.from || '');
    setTo(filters.to || '');
    setExtraInfo(filters.extraInfo || '');
    setFamilyQuery(filters.familyQuery || '');
    if (BOOK_REPORTS.some((item) => item.id === row.reportType)) {
      void downloadBook(row.reportType, filters.format === 'xlsx' ? 'xlsx' : 'pdf');
    }
  };

  const renderCard = (item) => (
    <article key={item.id} className={['ar-card', reportType === item.id ? 'is-on' : ''].filter(Boolean).join(' ')}>
      <button type="button" className="ar-card-pick" onClick={() => { setReportType(item.id); setError(''); }}>
        <h4>{item.title}</h4>
        <p>{item.copy}</p>
      </button>
      <div className="ar-card-actions">
        {item.formats.includes('pdf') ? (
          <button
            type="button"
            className="btn btn-tan"
            disabled={Boolean(busy)}
            onClick={() => {
              setReportType(item.id);
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
            PDF y Excel de libros, estados y gestión. Abajo, los certificados de socios.
          </p>
        </div>
        <span className="mb-folio-seal">{ACCOUNTING_REPORT_TYPES.length} modelos</span>
      </header>

      {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}

      <section className="er-block">
        <h4>Libros y estados</h4>
        <div className="ar-catalog">{BOOK_REPORTS.map(renderCard)}</div>
      </section>

      <section className="er-block">
        <h4>Socios</h4>
        <div className="ar-catalog">{MEMBER_REPORTS.map(renderCard)}</div>
      </section>

      {needsMemberForm ? (
        <form className="er-block" onSubmit={handleMemberReport}>
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

          {reportType === 'libre_deuda' ? (
            <>
              <div className="ar-filters">
                <label>
                  <span className="form-label">Fecha</span>
                  <input type="date" className="form-input" value={asOf} onChange={(e) => setAsOf(e.target.value)} required />
                </label>
                <label>
                  <span className="form-label">Socio</span>
                  <input className="form-input" list="arep-members" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Nro. o nombre" required />
                </label>
              </div>
              <label className="ar-extra">
                <span className="form-label">Información extra (opcional)</span>
                <div className="ar-extra-tools">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyExtraMark('**', '**')}>Negrita</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyExtraMark('*', '*')}>Itálica</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyExtraMark('_', '_')}>Subrayado</button>
                </div>
                <textarea
                  ref={(el) => { extraRef.current = el; }}
                  className="form-input"
                  rows={4}
                  value={extraInfo}
                  onChange={(e) => setExtraInfo(e.target.value)}
                  placeholder="Este texto aparece en: dejo constancia [información extra] del mismo…"
                />
              </label>
            </>
          ) : null}

          {reportType === 'detailed_cc' ? (
            <div className="ar-filters">
              <label>
                <span className="form-label">Socio</span>
                <input className="form-input" list="arep-members" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Nro. o nombre" required />
              </label>
            </div>
          ) : null}

          {reportType === 'family_balances' ? (
            <div className="ar-filters">
              <label>
                <span className="form-label">Grupo familiar</span>
                <input className="form-input" value={familyQuery} onChange={(e) => setFamilyQuery(e.target.value)} placeholder="Nombre del grupo (opcional)" />
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

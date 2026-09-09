import { useMemo, useRef, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { memberNumberOf } from '../../domain/members/households';
import {
  ACCOUNTING_REPORT_TYPES,
  accountingReportTypeLabel,
  createAccountingReportRecord,
  formatReportGeneratedAt,
  reportsForType,
} from '../../domain/accounting/accountingReports';
import {
  buildLibreDeudaCertificate,
  findMemberForLibreDeuda,
} from '../../domain/accounting/libreDeuda';
import { exportLibreDeudaPdf } from '../../domain/accounting/exportLibreDeudaPdf';
import { buildSurchargeComposition } from '../../domain/accounting/surchargeComposition';
import { exportSurchargeCompositionPdf } from '../../domain/accounting/exportSurchargeCompositionPdf';
import { exportDetailedCcPdf } from '../../domain/accounting/exportDetailedCcPdf';
import { exportFamilyGroupBalancesPdf } from '../../domain/accounting/exportFamilyGroupBalancesPdf';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

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

export default function AccountingReportsPanel({
  members = [],
  reports = [],
  onRecordReport,
}) {
  const [reportType, setReportType] = useState('recargos');
  const [memberQuery, setMemberQuery] = useState('');
  const [asOf, setAsOf] = useState(todayIso);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [extraInfo, setExtraInfo] = useState('');
  const [familyQuery, setFamilyQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const extraRef = useRef(null);

  const history = useMemo(() => reportsForType(reports, reportType), [reports, reportType]);
  const typeLabel = accountingReportTypeLabel(reportType);

  const applyExtraMark = (before, after) => {
    const el = extraRef.current;
    if (!el) return;
    const { next } = wrapSelection(el, before, after);
    setExtraInfo(next);
  };

  const resolveMember = () => findMemberForLibreDeuda(members, memberQuery)
    || (members || []).find((m) => String(m.name || '').toLowerCase().includes(memberQuery.trim().toLowerCase()));

  const handleContinue = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      let fileName = '';
      let summary = '';
      const filters = { memberQuery, asOf, from, to, extraInfo, familyQuery };

      if (reportType === 'libre_deuda') {
        const member = resolveMember();
        if (!member) throw new Error('Socio. Es obligatorio');
        const cert = buildLibreDeudaCertificate(member, { asOf, extraInfo, allMembers: members });
        await exportLibreDeudaPdf(cert);
        fileName = `jockey_club_libre_deuda_${cert.memberNumber}_${cert.asOf}.pdf`;
        summary = `${cert.memberNumber} · ${cert.statusLabel}`;
      } else if (reportType === 'recargos') {
        const member = memberQuery.trim() ? resolveMember() : null;
        if (memberQuery.trim() && !member) throw new Error('Socio. Es obligatorio');
        const nro = member ? memberNumberOf(member) : '';
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

      onRecordReport?.(createAccountingReportRecord({
        reportType,
        filters,
        summary,
        fileName,
      }));
    } catch (err) {
      setError(err.message || 'No se pudo generar el reporte.');
    } finally {
      setBusy(false);
    }
  };

  const rerun = async (record) => {
    setReportType(record.reportType);
    const f = record.filters || {};
    setMemberQuery(f.memberQuery || '');
    setAsOf(f.asOf || todayIso());
    setFrom(f.from || '');
    setTo(f.to || '');
    setExtraInfo(f.extraInfo || '');
    setFamilyQuery(f.familyQuery || '');
  };

  return (
    <div className="fade-in cuotas-panel">
      <h2 className="cuotas-title" style={{ marginBottom: '1rem' }}>
        <FileText size={18} /> Reportes
      </h2>

      <section className="supplier-pay-import-block">
        <div className="supplier-pay-import-form">
          <div className="supplier-pay-import-field">
            <label className="form-label" htmlFor="arep-mod">Módulos</label>
            <select id="arep-mod" className="form-input" value="contabilidad" disabled>
              <option value="contabilidad">Contabilidad</option>
            </select>
          </div>
          <div className="supplier-pay-import-field">
            <label className="form-label" htmlFor="arep-type">Tipos de reporte</label>
            <select
              id="arep-type"
              className="form-input"
              value={reportType}
              onChange={(e) => { setReportType(e.target.value); setError(''); }}
            >
              {ACCOUNTING_REPORT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {error ? (
        <div className="ig-error" role="alert" style={{ margin: '0.75rem 0' }}>{error}</div>
      ) : null}

      <form className="supplier-pay-import-block" onSubmit={handleContinue}>
        <h4 className="supplier-pay-import-title">
          {reportType === 'recargos' ? 'Buscar recargos' : typeLabel}
        </h4>

        {reportType === 'recargos' ? (
          <div className="cuotas-event-filters">
            <label>
              <span className="form-label">Socio</span>
              <input className="form-input" list="arep-members" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Nro. o nombre (opcional)" />
            </label>
            <label>
              <span className="form-label">Desde</span>
              <input type="date" className="form-input" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="disc-field-hint">Recargos a partir de la fecha seleccionada</span>
            </label>
            <label>
              <span className="form-label">Hasta</span>
              <input type="date" className="form-input" value={to} onChange={(e) => setTo(e.target.value)} />
              <span className="disc-field-hint">Recargos hasta la fecha seleccionada</span>
            </label>
          </div>
        ) : null}

        {reportType === 'libre_deuda' ? (
          <>
            <div className="cuotas-event-filters">
              <label>
                <span className="form-label">Fecha</span>
                <input type="date" className="form-input" value={asOf} onChange={(e) => setAsOf(e.target.value)} required />
              </label>
              <label>
                <span className="form-label">Socio</span>
                <input className="form-input" list="arep-members" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Nro. o nombre" required />
              </label>
            </div>
            <div className="disc-field" style={{ marginTop: '1rem' }}>
              <label className="disc-field-label">Información extra (opcional)</label>
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
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
            </div>
          </>
        ) : null}

        {reportType === 'detailed_cc' ? (
          <div className="cuotas-event-filters">
            <label>
              <span className="form-label">Socio</span>
              <input className="form-input" list="arep-members" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Nro. o nombre" required />
            </label>
          </div>
        ) : null}

        {reportType === 'family_balances' ? (
          <div className="cuotas-event-filters">
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

        <div className="supplier-pay-import-actions">
          <button type="submit" className="btn cash-lila-purple-btn" disabled={busy}>
            {busy ? 'Generando…' : 'Continuar'}
          </button>
        </div>
      </form>

      <section className="supplier-pay-import-block">
        <h4 className="supplier-pay-import-title">Reportes generados anteriormente</h4>
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Generado el</th>
                <th>Estado</th>
                <th>Descargar</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    No se encontraron reportes antiguos de “{typeLabel}”
                  </td>
                </tr>
              ) : history.map((row, idx) => (
                <tr key={row.id}>
                  <td>{history.length - idx}</td>
                  <td>
                    {formatReportGeneratedAt(row.generatedAt)}
                    {row.summary ? <div className="disc-field-hint">{row.summary}</div> : null}
                  </td>
                  <td>Finalizado</td>
                  <td>
                    <button type="button" className="cash-lila-icon-btn is-edit" title="Volver a generar" onClick={() => rerun(row)}>
                      <Download size={13} />
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

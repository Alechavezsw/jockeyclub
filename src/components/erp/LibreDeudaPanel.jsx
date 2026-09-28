import { useMemo, useRef, useState } from 'react';
import { BadgeCheck, Download, Search } from 'lucide-react';
import { memberNumberOf } from '../../domain/members/households';
import {
  createAccountingReportRecord,
  formatReportGeneratedAt,
  reportsForType,
} from '../../domain/accounting/accountingReports';
import {
  buildLibreDeudaCertificate,
  findMemberForLibreDeuda,
  formatLibreDeudaMemberNumber,
  LIBRE_DEUDA_SNAPSHOTS,
} from '../../domain/accounting/libreDeuda';
import { exportLibreDeudaPdf } from '../../domain/accounting/exportLibreDeudaPdf';
import { filterMembersForBalances } from '../../domain/accounting/memberBalances';
import { requireSnapshots } from '../../data/snapshots';
import { todayISODateAR } from '../../lib/arDate';
import SnapshotGate from '../SnapshotGate';

function wrapSelection(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || 'texto';
  return `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
}

export default function LibreDeudaPanel(props) {
  return (
    <SnapshotGate names={LIBRE_DEUDA_SNAPSHOTS}>
      <LibreDeudaContent {...props} />
    </SnapshotGate>
  );
}

function LibreDeudaContent({
  members = [],
  reports = [],
  onRecordReport,
}) {
  const [memberQuery, setMemberQuery] = useState('');
  const [asOf, setAsOf] = useState(() => todayISODateAR());
  const [extraInfo, setExtraInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const extraRef = useRef(null);

  const history = useMemo(
    () => reportsForType(reports, 'libre_deuda').slice(0, 20),
    [reports],
  );

  const member = useMemo(
    () => findMemberForLibreDeuda(members, memberQuery),
    [members, memberQuery],
  );

  const pickedLabel = member
    ? `${formatLibreDeudaMemberNumber(memberNumberOf(member) || member.memberId)} - ${member.name}`
    : '';

  const suggestions = useMemo(() => {
    const q = memberQuery.trim();
    if (q.length < 2 || q === pickedLabel) return [];
    return filterMembersForBalances(members, { query: q, status: 'all' }).slice(0, 10);
  }, [members, memberQuery, pickedLabel]);

  const certificate = useMemo(() => {
    if (!member) return null;
    try {
      return buildLibreDeudaCertificate(member, { asOf, extraInfo, allMembers: members });
    } catch {
      return null;
    }
  }, [member, asOf, extraInfo, members]);

  const pickMember = (row) => {
    const nro = formatLibreDeudaMemberNumber(memberNumberOf(row) || row.memberId);
    setMemberQuery(`${nro} - ${row.name}`);
    setError('');
  };

  const applyExtraMark = (before, after) => {
    const el = extraRef.current;
    if (!el) return;
    setExtraInfo(wrapSelection(el, before, after));
  };

  const download = async (sourceCert = certificate) => {
    setError('');
    if (!sourceCert) {
      setError('Socio. Es obligatorio');
      return;
    }
    setBusy(true);
    try {
      await requireSnapshots(LIBRE_DEUDA_SNAPSHOTS);
      const fileName = await exportLibreDeudaPdf(sourceCert);
      onRecordReport?.(createAccountingReportRecord({
        reportType: 'libre_deuda',
        filters: { memberQuery, asOf, extraInfo },
        summary: `${sourceCert.memberNumberPadded} · ${sourceCert.statusLabel}`,
        fileName,
      }));
    } catch (err) {
      setError(err.message || 'No se pudo generar el certificado.');
    } finally {
      setBusy(false);
    }
  };

  const rerun = (row) => {
    const filters = row.filters || {};
    setMemberQuery(filters.memberQuery || '');
    setAsOf(filters.asOf || todayISODateAR());
    setExtraInfo(filters.extraInfo || '');
    setError('');
  };

  return (
    <div className="fade-in mb-folio ld-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Contabilidad</p>
          <h3 className="mb-folio-title">Libre deuda</h3>
          <p className="mb-folio-meta">
            Certificado de un socio a una fecha de corte. El PDF sale con el texto institucional:
            Administración, CUIT, última liquidación paga y la nota del sistema.
          </p>
        </div>
        <span className={['mb-folio-seal', certificate && !certificate.isClear ? 'is-warn' : ''].filter(Boolean).join(' ')}>
          {certificate ? certificate.statusLabel : 'Jockey Club'}
        </span>
      </header>

      {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}

      <form
        className="er-block"
        onSubmit={(e) => {
          e.preventDefault();
          void download();
        }}
      >
        <div className="er-block-head">
          <h4>Emitir certificado</h4>
          <span>PDF</span>
        </div>

        <div className="ar-filters">
          <label>
            <span className="form-label">Fecha</span>
            <input
              type="date"
              className="form-input"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              required
            />
          </label>
          <label className="ld-search">
            <span className="form-label">Socio</span>
            <span className="ld-search-field">
              <Search size={14} aria-hidden="true" />
              <input
                className="form-input"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="Nro. o nombre"
                required
                autoComplete="off"
              />
            </span>
            {suggestions.length > 0 ? (
              <ul className="ld-suggest">
                {suggestions.map((row) => {
                  const nro = formatLibreDeudaMemberNumber(memberNumberOf(row) || row.memberId);
                  return (
                    <li key={row.memberId || nro}>
                      <button type="button" onClick={() => pickMember(row)}>
                        <strong>{nro}</strong>
                        <span>{row.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
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
            rows={3}
            value={extraInfo}
            onChange={(e) => setExtraInfo(e.target.value)}
            placeholder="Párrafo extra, debajo de la última liquidación paga."
          />
        </label>

        <div className="ar-card-actions" style={{ padding: '0.75rem 0 0' }}>
          <button type="submit" className="btn btn-tan" disabled={busy || !certificate}>
            <Download size={14} aria-hidden="true" />
            {busy ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>
      </form>

      {certificate ? (
        <article className="ld-letter" aria-label="Vista previa del certificado">
          <header className="ld-letter-head">
            <p>{certificate.letter.headingMember}</p>
            <strong>{certificate.letter.headingClub}</strong>
            <em>{certificate.letter.headingTitle}</em>
          </header>
          {certificate.letter.paragraphs.map((para, index) => (
            <p key={`${index}-${para.slice(0, 24)}`} className={para === 'CERTIFICO:' || para === 'Firma y sello' ? 'ld-letter-mark' : undefined}>
              {para}
            </p>
          ))}
          <p className="ld-letter-note">{certificate.letter.note}</p>
          <p className="ld-letter-stamp">{certificate.letter.stamp}</p>
        </article>
      ) : (
        <p className="mb-folio-empty">
          Elegí un socio para ver el certificado antes de bajarlo.
        </p>
      )}

      <section className="er-block">
        <div className="er-block-head">
          <h4>Emitidos</h4>
          <span>{history.length} recientes</span>
        </div>
        <div className="table-responsive">
          <table className="balance-table">
            <thead>
              <tr>
                <th>Socio</th>
                <th>Generado</th>
                <th>Archivo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4} className="mb-folio-empty">Todavía no se emitió ningún certificado en esta sesión.</td>
                </tr>
              ) : history.map((row) => (
                <tr key={row.id} className="balance-row-account">
                  <td>
                    <BadgeCheck size={13} aria-hidden="true" />
                    {' '}
                    {row.summary || 'Libre deuda'}
                  </td>
                  <td>{formatReportGeneratedAt(row.generatedAt)}</td>
                  <td>{row.fileName || '—'}</td>
                  <td>
                    <button type="button" className="mb-folio-link" onClick={() => rerun(row)}>
                      Cargar de nuevo
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

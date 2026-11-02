import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Sparkles, X } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import { membershipMovesSeed } from '../../domain/members/membershipMoves';
import { REVIEW_TIERS, buildCuotasReview } from '../../domain/review/cuotasReview';
import { exportCuotasReviewPdf } from '../../domain/review/exportCuotasReviewPdf';

const TIER_LABEL = Object.fromEntries(REVIEW_TIERS.map((tier) => [tier.id, tier.label]));

function formatCount(value) {
  return Number(value || 0).toLocaleString('es-AR');
}

function sampleLabel(sample) {
  return sample?.label || sample || 'Sin nombre';
}

function sampleHref(sample) {
  return sample?.href || '/panel/members';
}

function CuotasSampleList({ item, onClose }) {
  const [query, setQuery] = useState('');
  const samples = item?.samples || [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return samples;
    return samples.filter((sample) => sampleLabel(sample).toLowerCase().includes(needle));
  }, [samples, query]);

  if (!item) return null;

  return (
    <div className="cuotas-ia-samples">
      <div className="cuotas-ia-samples-head">
        <div>
          <p className="jev-list-kicker">{TIER_LABEL[item.tier] || item.tier}</p>
          <h4>{item.title}</h4>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Cerrar lista">
          ×
        </button>
      </div>
      {samples.length > 12 ? (
        <label className="jev-list-search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar nombre, número o nota…"
            aria-label="Buscar en la lista"
          />
        </label>
      ) : null}
      <p className="jev-list-count">
        {query.trim()
          ? `${formatCount(filtered.length)} de ${formatCount(samples.length)}`
          : `${formatCount(samples.length)} en la lista`}
      </p>
      {filtered.length === 0 ? (
        <p className="jev-empty">Nada coincide con esa búsqueda.</p>
      ) : (
        <ol className="jev-list">
          {filtered.map((sample, index) => {
            const label = sampleLabel(sample);
            const href = sampleHref(sample);
            return (
              <li key={`${item.id}-${href}-${label}-${index}`} className="jev-list-item">
                <Link to={href} className="jev-list-link" onClick={onClose}>
                  {label}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function CuotasIaReviewModal({
  open = false,
  onClose,
  members = [],
  membersLoading = false,
  feePeriods = [],
  period = null,
}) {
  const [listItem, setListItem] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');

  const movesSeed = useSnapshotSeed(
    open ? ['societasMembershipMoves'] : [],
    membershipMovesSeed,
  );

  const review = useMemo(() => {
    if (!open) return null;
    return buildCuotasReview({
      members,
      feePeriods,
      period,
      loading: membersLoading && !(members || []).length,
      altas: movesSeed?.SOCIETAS_MEMBERSHIP_ALTAS || [],
      bajas: movesSeed?.SOCIETAS_MEMBERSHIP_BAJAS || [],
      membershipMovesAsOf: movesSeed?.SOCIETAS_MEMBERSHIP_MOVES_AS_OF
        || movesSeed?.SOCIETAS_MEMBERSHIP_MOVES_SNAPSHOT?.asOf
        || '',
    });
  }, [open, members, membersLoading, feePeriods, period, movesSeed]);

  if (!open) return null;

  const counts = review?.counts || {};
  const ready = counts.ready !== false;
  const items = review?.items || [];

  const downloadPdf = async () => {
    if (!review || pdfBusy) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      await exportCuotasReviewPdf(review);
    } catch (err) {
      setPdfError(err?.message || 'No se pudo generar el PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const handleClose = () => {
    setListItem(null);
    setPdfError('');
    onClose?.();
  };

  return (
    <ModalDialog
      open={open}
      onClose={handleClose}
      labelledBy="cuotas-ia-title"
      overlayClassName="modal-overlay"
      contentClassName="modal-content glass-panel cuotas-ia-modal"
    >
      <header className="cuotas-ia-head">
        <div>
          <p className="jev-kicker">
            <Sparkles size={14} aria-hidden="true" /> IA Jockey · Cuotas
          </p>
          <h3 id="cuotas-ia-title">
            {period ? `Revisión · ${review?.periodLabel || 'período'}` : 'Revisión de altas, bajas y fichas'}
          </h3>
        </div>
        <div className="cuotas-ia-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => { void downloadPdf(); }}
            disabled={pdfBusy || !review}
            title="Descargar PDF de esta revisión"
          >
            <FileDown size={14} aria-hidden="true" />
            {pdfBusy ? 'Generando…' : 'PDF'}
          </button>
          <button type="button" className="cuotas-liq-ahora-close" onClick={handleClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="cuotas-ia-body">
        {pdfError ? <p className="ig-error" role="alert">{pdfError}</p> : null}

        {listItem ? (
          <CuotasSampleList item={listItem} onClose={() => setListItem(null)} />
        ) : (
          <>
            <header className="jev-hero cuotas-ia-hero">
              <div>
                <p className="jev-hero-label">Socios con la ficha bien</p>
                <p className="jev-hero-num tabular-nums">{ready ? formatCount(counts.bien) : '…'}</p>
                <p className="jev-hero-sub">
                  {ready
                    ? `de ${formatCount(counts.activos)} activos`
                    : 'El padrón todavía se está cargando'}
                </p>
              </div>
              <ul className="jev-kpis" aria-label="Padrón">
                <li>
                  <b className="tabular-nums">{ready ? formatCount(counts.titulares) : '…'}</b>
                  <span>Titulares</span>
                </li>
                <li>
                  <b className="tabular-nums">{ready ? formatCount(counts.grupos) : '…'}</b>
                  <span>Grupos</span>
                </li>
                <li>
                  <b className="tabular-nums">{ready ? formatCount(counts.integrantes) : '…'}</b>
                  <span>Integrantes</span>
                </li>
                <li>
                  <b className="tabular-nums">{ready ? formatCount(counts.fichas) : '…'}</b>
                  <span>Fichas a corregir</span>
                </li>
              </ul>
            </header>

            <p className="jev-note">
              Cola de cuotas: liquidación del mes, altas y bajas del padrón, y fichas que distorsionan el número.
              Abrí un hallazgo para ver la lista; el PDF guarda el mismo corte.
            </p>

            {items.length === 0 ? (
              <p className="jev-empty">
                {ready
                  ? 'Nada para revisar en altas, bajas, fichas ni liquidación de este período.'
                  : 'Cuando termine de cargar el padrón, aparece lo que haya que mirar.'}
              </p>
            ) : (
              <ol className="jev-rail">
                {items.map((item, index) => (
                  <li key={item.id} className={`jev-row tone-${item.tone || 'watch'}`}>
                    <span className="jev-rank" aria-hidden="true">{index + 1}</span>
                    <div className="jev-row-copy">
                      <span className="jev-tier">{TIER_LABEL[item.tier] || item.tier}</span>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <p className="jev-why">{item.why}</p>
                    </div>
                    <button
                      type="button"
                      className="jev-open"
                      onClick={() => {
                        if (item.samples?.length) setListItem(item);
                      }}
                      disabled={!item.samples?.length}
                    >
                      {item.samples?.length ? 'Abrir' : '—'}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </ModalDialog>
  );
}

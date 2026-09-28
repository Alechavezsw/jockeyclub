import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { REVIEW_TIERS, reviewItemsForAccess } from '../../domain/review/buildClubReview';
import ModalDialog from '../ModalDialog';
import DuesDueBanner from './DuesDueBanner';

const TIER_LABEL = Object.fromEntries(REVIEW_TIERS.map((tier) => [tier.id, tier.label]));

function formatCount(value) {
  return Number(value || 0).toLocaleString('es-AR');
}

function fallbackHref(item) {
  if (item?.tab === 'concessions') return '/concesiones';
  if (item?.tab === 'accounting') {
    return item.focus
      ? `/panel/accounting?sub=${encodeURIComponent(item.focus)}`
      : '/panel/accounting';
  }
  if (item?.tab) return `/panel/${item.tab}`;
  return '/panel/jev';
}

function sampleHref(sample, item) {
  return sample?.href || fallbackHref(item);
}

function sampleLabel(sample) {
  return sample?.label || sample || 'Sin nombre';
}

function JevSampleLink({ sample, item, onNavigate, className }) {
  const href = sampleHref(sample, item);
  return (
    <Link to={href} className={className} onClick={onNavigate}>
      {sampleLabel(sample)}
    </Link>
  );
}

function JevRow({ item, index, onOpen }) {
  return (
    <li className={`jev-row tone-${item.tone || 'watch'}`}>
      <span className="jev-rank" aria-hidden="true">{index + 1}</span>
      <div className="jev-row-copy">
        <span className="jev-tier">{TIER_LABEL[item.tier] || item.tier}</span>
        <strong>{item.title}</strong>
        <p>{item.detail}</p>
        <p className="jev-why">{item.why}</p>
      </div>
      <button type="button" className="jev-open" onClick={() => onOpen(item)}>
        Abrir
      </button>
    </li>
  );
}

function JevSamplesModal({ item, onClose }) {
  const [query, setQuery] = useState('');
  const samples = item?.samples || [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return samples;
    return samples.filter((sample) => sampleLabel(sample).toLowerCase().includes(needle));
  }, [samples, query]);

  if (!item) return null;

  return (
    <ModalDialog
      open
      onClose={onClose}
      labelledBy="jev-list-title"
      overlayClassName="modal-overlay"
      contentClassName="modal-content glass-panel jev-list-modal"
    >
      <div className="modal-header">
        <div>
          <p className="jev-list-kicker">{TIER_LABEL[item.tier] || item.tier}</p>
          <h3 id="jev-list-title">{item.title}</h3>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </div>
      <div className="modal-body jev-list-body">
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
              const href = sampleHref(sample, item);
              return (
                <li key={`${item.id}-${href}-${label}-${index}`} className="jev-list-item">
                  <JevSampleLink
                    sample={sample}
                    item={item}
                    className="jev-list-link"
                    onNavigate={onClose}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </ModalDialog>
  );
}

export default function JevReviewTab({
  review,
  permittedTabs = [],
  showConcessions = false,
  goToTab,
  members = [],
}) {
  const [listItem, setListItem] = useState(null);
  const items = useMemo(
    () => reviewItemsForAccess(review?.items || [], {
      tabs: permittedTabs,
      concessions: showConcessions,
    }),
    [review, permittedTabs, showConcessions],
  );
  const counts = review?.counts || {};
  const ready = counts.ready !== false;

  const openItem = (item) => {
    if (item.samples?.length) {
      setListItem(item);
      return;
    }
    if (typeof goToTab === 'function') goToTab(item.tab, item.focus || null);
  };

  const showCollection = permittedTabs.includes('dues') || permittedTabs.includes('accounting');

  return (
    <section className="jev" aria-label="Jev, revisión del club">
      {showCollection ? <DuesDueBanner members={members} /> : null}
      <header className="jev-hero">
        <div>
          <p className="jev-kicker">Jev</p>
          <h1 className="jev-hero-label">Socios con la ficha bien</h1>
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
        El orden es plata, número de socios, ficha, puerta de hoy, cierre del mes y notas.
        Jev queda activo siempre que el panel está abierto: relee los datos y no escribe nada.
        Abrir muestra la lista. Cada nombre abre la ficha para editarla.
      </p>

      {items.length === 0 ? (
        <p className="jev-empty">
          {ready
            ? 'Nada para revisar en lo que podés ver.'
            : 'Cuando termine de cargar el padrón, aparece lo que haya que mirar.'}
        </p>
      ) : (
        <ol className="jev-rail">
          {items.map((item, index) => (
            <JevRow
              key={item.id}
              item={item}
              index={index}
              onOpen={openItem}
            />
          ))}
        </ol>
      )}

      <JevSamplesModal item={listItem} onClose={() => setListItem(null)} />
    </section>
  );
}

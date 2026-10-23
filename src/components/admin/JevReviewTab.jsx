import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';
import { REVIEW_TIERS, reviewItemsForAccess } from '../../domain/review/buildClubReview';
import { exportTableExcel } from '../../domain/reports/exportTableExcel';
import { resolveFeePeriods } from '../../domain/accounting/feeBilling';
import { liquidatedTotalForMonth } from '../../domain/accounting/feePeriodLiquidation';
import { splitMonthDuesCollection } from '../../domain/accounting/cashPaymentDetail';
import { cashMovementsSeed, cashSeed } from '../../domain/accounting/cashLedger';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import { buildJevBrief } from '../../domain/assistant/clubGuide';
import { todayISODateAR } from '../../lib/arDate';
import ModalDialog from '../ModalDialog';
import DuesDueBanner from './DuesDueBanner';
import JevChatDesk from './JevChatDesk';
import JevForecastRoom from './JevForecastRoom';
import JevManual from './JevManual';

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

function JevRooms({ room, onChange }) {
  return (
    <div className="jev-rooms" role="tablist" aria-label="Salas de Jev">
      <button
        type="button"
        role="tab"
        aria-selected={room === 'consulta'}
        className={room === 'consulta' ? 'is-on' : undefined}
        onClick={() => onChange('consulta')}
      >
        Consulta
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={room === 'revision'}
        className={room === 'revision' ? 'is-on' : undefined}
        onClick={() => onChange('revision')}
      >
        Revisión
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={room === 'predicciones'}
        className={room === 'predicciones' ? 'is-on' : undefined}
        onClick={() => onChange('predicciones')}
      >
        Predicciones
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={room === 'manual'}
        className={room === 'manual' ? 'is-on' : undefined}
        onClick={() => onChange('manual')}
      >
        Manual
      </button>
    </div>
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
  const [exporting, setExporting] = useState(false);
  const samples = item?.samples || [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return samples;
    return samples.filter((sample) => sampleLabel(sample).toLowerCase().includes(needle));
  }, [samples, query]);

  const downloadExcel = async () => {
    if (!filtered.length || exporting) return;
    setExporting(true);
    try {
      await exportTableExcel({
        title: item.title,
        sheetName: TIER_LABEL[item.tier] || 'Jev',
        headers: ['#', 'Detalle', 'Destino'],
        rows: filtered.map((sample, index) => [
          index + 1,
          sampleLabel(sample),
          sampleHref(sample, item),
        ]),
      });
    } finally {
      setExporting(false);
    }
  };

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
        <div className="jev-list-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { void downloadExcel(); }}
            disabled={!filtered.length || exporting}
            title="Descargar esta lista en Excel"
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            {exporting ? 'Generando…' : 'Excel'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
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
  feePeriods = [],
  journalEntries = [],
  chartOfAccounts = [],
  tierCatalog = [],
  reservations = [],
  entryLogs = [],
  poolAccesses = [],
  poolSettings = {},
  claims = [],
  messages = [],
  surveys = [],
  staffMembers = [],
  events = [],
  alerts = [],
  applications = [],
  portalRequests = [],
  concessions = [],
}) {
  const [listItem, setListItem] = useState(null);
  const [params, setParams] = useSearchParams();
  const vista = params.get('vista');
  const room = vista === 'revision' || vista === 'predicciones' || vista === 'manual' ? vista : 'consulta';
  const setRoom = (next) => {
    const nextParams = new URLSearchParams(params);
    if (next === 'revision' || next === 'predicciones' || next === 'manual') nextParams.set('vista', next);
    else nextParams.delete('vista');
    setParams(nextParams, { replace: true });
  };
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
  const cashCut = useSnapshotSeed(['accessinCashSnapshot', 'accessinCashMovements'], () => ({
    recent: cashSeed().ACCESSIN_CASH_SNAPSHOT?.recentMovements || [],
    all: cashMovementsSeed().ACCESSIN_CASH_MOVEMENTS || [],
  }));
  const brief = useMemo(() => {
    const today = todayISODateAR();
    const monthKey = today.slice(0, 7);
    const periods = resolveFeePeriods(feePeriods);
    const liquidated = liquidatedTotalForMonth(periods, monthKey, { members, tierCatalog });
    const cashMoves = [...(cashCut.recent || []), ...(cashCut.all || [])];
    const split = splitMonthDuesCollection({
      monthKey,
      members,
      movements: cashMoves,
    });
    const [year, month] = monthKey.split('-').map(Number);
    const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    return buildJevBrief({
      today,
      monthLabel,
      collected: split.recaudado,
      liquidated,
      counts,
      members,
      reservations,
      entryLogs,
      poolAccesses,
      claims,
      messages,
      surveys,
      staffMembers,
      events,
      alerts,
      applications,
      portalRequests,
      concessions,
    });
  }, [
    feePeriods, members, tierCatalog, cashCut, counts,
    reservations, entryLogs, poolAccesses, claims, messages, surveys, staffMembers,
    events, alerts, applications, portalRequests, concessions,
  ]);

  return (
    <section className="jev" aria-label="Jev, consulta y revisión del club">
      <JevRooms room={room} onChange={setRoom} />
      <div hidden={room !== 'consulta'}>
        <JevChatDesk
          brief={brief}
          goToTab={goToTab}
          onOpenManual={() => setRoom('manual')}
          members={members}
          poolSettings={poolSettings}
        />
      </div>
      {room === 'manual' ? <JevManual goToTab={goToTab} /> : null}
      {room === 'revision' && showCollection ? (
        <DuesDueBanner
          members={members}
          feePeriods={feePeriods}
          journalEntries={journalEntries}
          chartOfAccounts={chartOfAccounts}
          tierCatalog={tierCatalog}
        />
      ) : null}
      {room === 'predicciones' ? (
        <JevForecastRoom
          brief={brief}
          cashMovements={[...(cashCut.recent || []), ...(cashCut.all || [])]}
          feePeriods={feePeriods}
          reservations={reservations}
          entryLogs={entryLogs}
          poolAccesses={poolAccesses}
          poolSettings={poolSettings}
          goToTab={goToTab}
        />
      ) : null}
      {room === 'revision' ? (
        <>
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
            Gemini también lee esta cola: pedile priorizar arriba. Abrir muestra la lista; cada nombre abre la ficha.
          </p>

          <JevChatDesk
            variant="revision"
            brief={{ ...brief, reviewItems: items }}
            reviewItems={items}
            goToTab={goToTab}
            onOpenManual={() => setRoom('manual')}
            members={members}
            poolSettings={poolSettings}
          />

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
        </>
      ) : null}

      <JevSamplesModal item={listItem} onClose={() => setListItem(null)} />
    </section>
  );
}

import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, CalendarRange, Download, Eye, FileSpreadsheet, Plus, Printer, RotateCcw, Search, Trash2, Upload,
} from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  feePeriodsForYear,
  formatPeriodGeneratedAt,
  liquidateFeePeriod,
  periodLabel,
  periodStatusLabel,
} from '../../domain/accounting/feeBilling';
import {
  ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT,
  feeAccountDetailsForPeriod,
  feeAccountDetailsSummary,
  filterFeeAccountLines,
} from '../../domain/accounting/feeAccountDetails';
import {
  LISTA_BASE_COBRANZAS_FILENAME,
  LISTA_BASE_COBRANZAS_URL,
  MEMBER_COLLECTION_ENTITIES,
  MEMBER_COLLECTION_IMPUTATION_ORDERS,
  MEMBER_COLLECTION_IMPORT_STATUS,
  applyMemberCollectionPayments,
  buildMemberCollectionImport,
  parseCobranzasSociosSheetRows,
} from '../../domain/accounting/memberCollectionImport';
import DuesControlTab from '../admin/DuesControlTab';

const PAGE_SIZE = 25;

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function formatLilaDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const day = d.getDate();
    const month = MONTHS_ES[d.getMonth()];
    const year = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} de ${month} del ${year} a las ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function statusTone(status) {
  if (status === 'completed' || status === 'processed') return 'confirmed';
  if (status === 'deleted' || status === 'failed') return 'cancelled';
  if (status === 'partial') return 'pending';
  return 'pending';
}

export default function CuotasPanel({
  members = [],
  setMembers,
  feePeriods = [],
  onUpsertFeePeriods,
  collectionImports = [],
  onImportCollections,
  onDeleteCollectionImport,
  reservations = [],
  onImputeReservation,
  addJournalEntry,
  formatCurrency: formatCurrencyProp,
  tierCatalog = [],
}) {
  const fmt = formatCurrencyProp || formatCurrency;
  const [view, setView] = useState('hub'); // hub | import_collections | import_debts | impute_events | mora | period_detail
  const [year, setYear] = useState(2026);
  const [yearDraft, setYearDraft] = useState('2026');
  const [ccEnabled, setCcEnabled] = useState(true);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [accountTab, setAccountTab] = useState(0);
  const [detailQuery, setDetailQuery] = useState('');
  const [detailPage, setDetailPage] = useState(0);

  const [entity, setEntity] = useState('excel_manual');
  const [forceDate, setForceDate] = useState('');
  const [imputationOrder, setImputationOrder] = useState('chronological');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);

  const [evSocio, setEvSocio] = useState('');
  const [evSpace, setEvSpace] = useState('all');
  const [evStatus, setEvStatus] = useState('all');
  const [evPay, setEvPay] = useState('all');
  const [detailEvent, setDetailEvent] = useState(null);

  const periods = useMemo(() => feePeriodsForYear(feePeriods, year), [feePeriods, year]);

  const periodAccounts = useMemo(
    () => (selectedPeriod ? feeAccountDetailsForPeriod(selectedPeriod) : []),
    [selectedPeriod]
  );
  const periodAccountsSummary = useMemo(
    () => feeAccountDetailsSummary(periodAccounts),
    [periodAccounts]
  );
  const activeAccount = periodAccounts[accountTab] || periodAccounts[0] || null;
  const filteredLines = useMemo(
    () => filterFeeAccountLines(activeAccount?.lines || [], detailQuery),
    [activeAccount, detailQuery]
  );
  const detailPages = Math.max(1, Math.ceil(filteredLines.length / PAGE_SIZE));
  const safeDetailPage = Math.min(detailPage, detailPages - 1);
  const pageLines = filteredLines.slice(safeDetailPage * PAGE_SIZE, (safeDetailPage + 1) * PAGE_SIZE);

  const openPeriodDetail = (period) => {
    const accounts = feeAccountDetailsForPeriod(period);
    if (!accounts.length) {
      setFlash(`Sin detalle de cuentas contables para ${periodLabel(period)}.`);
      return;
    }
    setSelectedPeriod(period);
    setAccountTab(0);
    setDetailQuery('');
    setDetailPage(0);
    setFlash('');
    setView('period_detail');
  };

  const pendingEvents = useMemo(() => {
    const list = (reservations || []).filter((r) => {
      if (r.imputed === true || r.feeImputed === true) return false;
      const facility = String(r.facilityName || r.facilityId || r.space || '').toLowerCase();
      const looksEvent = /salon|espacio|evento|verde|anhelo|bustos|maurin|refugio/i.test(facility)
        || r.type === 'event'
        || r.sourceModule === 'events';
      return looksEvent || Boolean(r.needsImputation);
    });
    return list;
  }, [reservations]);

  const filteredEvents = useMemo(() => {
    let rows = pendingEvents;
    if (evSocio.trim()) {
      const q = evSocio.trim().toLowerCase();
      rows = rows.filter((r) => (
        String(r.memberName || '').toLowerCase().includes(q)
        || String(r.memberId || '').toLowerCase().includes(q)
      ));
    }
    if (evSpace !== 'all') {
      rows = rows.filter((r) => String(r.facilityName || r.facilityId || r.space || '') === evSpace);
    }
    if (evStatus !== 'all') {
      rows = rows.filter((r) => String(r.status || '').toLowerCase() === evStatus);
    }
    if (evPay !== 'all') {
      rows = rows.filter((r) => String(r.paymentMethod || r.payMethod || 'all') === evPay);
    }
    return rows;
  }, [pendingEvents, evSocio, evSpace, evStatus, evPay]);

  const spaces = useMemo(() => {
    const set = new Set();
    pendingEvents.forEach((r) => {
      const s = r.facilityName || r.facilityId || r.space;
      if (s) set.add(String(s));
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [pendingEvents]);

  const applyYear = () => {
    const y = Number(yearDraft);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      setError('Año inválido.');
      return;
    }
    setYear(y);
    setError('');
  };

  const liquidate = (periodId) => {
    try {
      const result = liquidateFeePeriod(feePeriods, periodId, members);
      onUpsertFeePeriods?.(result.periods);
      setFlash(`Liquidado ${periodLabel(result.period)}.`);
    } catch (err) {
      setError(err.message || 'No se pudo liquidar.');
    }
  };

  const processCollections = async () => {
    setError('');
    setOk('');
    if (!file) {
      setError('Seleccioná un archivo Excel para procesar.');
      return;
    }
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets.Socios || wb.Sheets.SOCIOS || wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('No se encontró la hoja Socios.');
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const rows = parseCobranzasSociosSheetRows(aoa);
      const built = buildMemberCollectionImport({
        rows,
        members,
        entity,
        forceDate,
        imputationOrder,
        fileName: file.name,
      });
      if (!built.payments.length) {
        throw new Error('No hay filas con MONTO > 0 para importar. Completá la lista base y volvé a subirla.');
      }
      if (typeof onImportCollections === 'function') {
        await onImportCollections(built);
      }
      if (typeof setMembers === 'function') {
        setMembers((prev) => applyMemberCollectionPayments(prev, built.payments));
      }
      if (typeof addJournalEntry === 'function' && built.batch.totalAmount > 0) {
        addJournalEntry({
          date: forceDate || new Date().toISOString().slice(0, 10),
          description: `Importación cobranzas socios (${built.batch.fileName || 'Excel Manual'})`,
          sourceModule: 'cuotas',
          lines: [
            { account: 'Caja General', type: 'debit', amount: built.batch.totalAmount },
            { account: 'Cuotas Sociales', type: 'credit', amount: built.batch.totalAmount },
          ],
        });
      }
      setOk(
        `Importados ${built.batch.importedCount} de ${built.batch.totalRows} pagos · ${fmt(built.batch.totalAmount)}`
        + (built.errors.length ? ` · ${built.errors.length} aviso(s)` : '')
      );
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.message || 'No se pudo procesar el archivo.');
    } finally {
      setBusy(false);
    }
  };

  if (view === 'period_detail' && selectedPeriod) {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { setView('hub'); setSelectedPeriod(null); }}
          >
            <ArrowLeft size={14} /> Volver
          </button>
          <h3 className="cuotas-title" style={{ margin: 0 }}>
            Detalle cuentas contables · {periodLabel(selectedPeriod)}
          </h3>
        </div>

        <div className="cuotas-cc-banner">
          <span>
            {periodAccountsSummary.accountCount} cuentas · {periodAccountsSummary.lineCount} movimientos · total{' '}
            {fmt(periodAccountsSummary.totalAmount)}
            {ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT?.asOf
              ? ` · export ${ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT.asOf}`
              : ''}
          </span>
        </div>

        {activeAccount?.collectionPeriodLabel ? (
          <p className="disc-field-hint" style={{ margin: 0 }}>
            Período de cobro: {activeAccount.collectionPeriodLabel}
          </p>
        ) : null}

        <div className="disc-hub-tabs">
          {periodAccounts.map((acc, idx) => (
            <button
              key={acc.id}
              type="button"
              className={`disc-hub-tab${accountTab === idx ? ' is-active' : ''}`}
              onClick={() => { setAccountTab(idx); setDetailPage(0); }}
            >
              {acc.accountLabel}
              <span className="disc-badge" style={{ marginLeft: 8 }}>{acc.lineCount}</span>
            </button>
          ))}
        </div>

        {activeAccount ? (
          <section className="supplier-pay-import-block">
            <div className="cuotas-toolbar" style={{ marginBottom: '0.75rem' }}>
              <div>
                <strong>CUENTA CONTABLE: {activeAccount.accountLabel}</strong>
                <div className="disc-field-hint" style={{ margin: 0 }}>
                  Total {fmt(activeAccount.total)} · {activeAccount.lineCount} líneas
                </div>
              </div>
              <label className="disc-search-input" style={{ minWidth: 220 }}>
                <Search size={14} />
                <input
                  className="form-input"
                  value={detailQuery}
                  onChange={(e) => { setDetailQuery(e.target.value); setDetailPage(0); }}
                  placeholder="Socio, DNI, descripción…"
                />
              </label>
            </div>

            <div className="disc-pager">
              <span>
                {filteredLines.length === 0
                  ? 'No se encontraron resultados'
                  : `Mostrando ${safeDetailPage * PAGE_SIZE + 1} - ${Math.min(filteredLines.length, (safeDetailPage + 1) * PAGE_SIZE)} de ${filteredLines.length}`}
              </span>
              {filteredLines.length > PAGE_SIZE ? (
                <div className="cash-efectivo-pager">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={safeDetailPage <= 0} onClick={() => setDetailPage((p) => Math.max(0, p - 1))}>Anterior</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={safeDetailPage >= detailPages - 1} onClick={() => setDetailPage((p) => Math.min(detailPages - 1, p + 1))}>Siguiente</button>
                </div>
              ) : null}
            </div>

            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>DNI</th>
                    <th>N° socio</th>
                    <th>Nombre</th>
                    <th>Fecha de cobro</th>
                    <th>Fecha cuota</th>
                    <th>Tipo</th>
                    <th>Descripción</th>
                    <th>Cobrado</th>
                  </tr>
                </thead>
                <tbody>
                  {pageLines.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ color: 'var(--text-muted)' }}>Sin líneas.</td>
                    </tr>
                  ) : (
                    pageLines.map((line, i) => (
                      <tr key={`${line.memberNumber}-${line.feeDate}-${line.amount}-${i}`}>
                        <td>{line.dni || '—'}</td>
                        <td>{line.memberNumber}</td>
                        <td style={{ fontWeight: 600 }}>{line.memberName}</td>
                        <td>{line.collectedAtLabel || line.collectedAt || '—'}</td>
                        <td>{line.feeDateLabel || line.feeDate || '—'}</td>
                        <td>{line.type}</td>
                        <td>{line.description}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(line.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  if (view === 'mora') {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView('hub')}>
            <ArrowLeft size={14} /> Volver a cuotas
          </button>
        </div>
        <DuesControlTab
          members={members}
          setMembers={setMembers}
          addJournalEntry={addJournalEntry}
          formatCurrency={fmt}
          tierCatalog={tierCatalog}
        />
      </div>
    );
  }

  if (view === 'import_collections') {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <h3 className="cuotas-title">Importar cobranzas socios</h3>
        </div>

        <section className="supplier-pay-import-block">
          <div className="supplier-pay-import-form">
            <div className="supplier-pay-import-field">
              <label className="form-label" htmlFor="mci-entity">Entidad</label>
              <select id="mci-entity" className="form-input" value={entity} onChange={(e) => setEntity(e.target.value)}>
                {Object.entries(MEMBER_COLLECTION_ENTITIES).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
            <div className="supplier-pay-import-field">
              <label className="form-label" htmlFor="mci-force">Forzar fecha</label>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  id="mci-force"
                  type="date"
                  className="form-input"
                  value={forceDate}
                  onChange={(e) => setForceDate(e.target.value)}
                />
                {forceDate ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForceDate('')} title="Limpiar">×</button>
                ) : null}
              </div>
              <p className="disc-field-hint">
                Los pagos se imputarán en la fecha seleccionada, ignorando la fecha real del pago.
                Si se deja en blanco, se usa la fecha real de cada pago.
              </p>
            </div>
            <div className="supplier-pay-import-field">
              <label className="form-label" htmlFor="mci-order">Orden de imputación</label>
              <select
                id="mci-order"
                className="form-input"
                value={imputationOrder}
                onChange={(e) => setImputationOrder(e.target.value)}
              >
                {Object.entries(MEMBER_COLLECTION_IMPUTATION_ORDERS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <p className="disc-field-hint">Prioridad entre tipos de cuota según el orden elegido.</p>
            </div>
            <div className="supplier-pay-import-field">
              <label className="form-label" htmlFor="mci-file">Archivo</label>
              <input
                id="mci-file"
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div>
              <a className="btn cash-lila-purple-btn" href={LISTA_BASE_COBRANZAS_URL} download={LISTA_BASE_COBRANZAS_FILENAME}>
                <Download size={14} /> Descargar lista base
              </a>
            </div>
          </div>

          {error ? <p className="ig-error">{error}</p> : null}
          {ok ? <p className="ig-ok">{ok}</p> : null}

          <div className="supplier-pay-import-actions">
            <button type="button" className="btn btn-secondary" onClick={() => { setView('hub'); setError(''); setOk(''); }}>
              Volver
            </button>
            <button type="button" className="btn cash-lila-purple-btn" disabled={busy} onClick={processCollections}>
              <Upload size={14} /> {busy ? 'Procesando…' : 'Procesar archivo'}
            </button>
          </div>
        </section>

        <section className="supplier-pay-import-block">
          <h4 className="supplier-pay-import-title">Historial de importaciones</h4>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Creado el</th>
                  <th>Entidad</th>
                  <th>Estado</th>
                  <th>Pagos importados</th>
                  <th>Total</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(collectionImports || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ color: 'var(--text-muted)' }}>Sin importaciones todavía.</td>
                  </tr>
                ) : (
                  collectionImports.map((batch, i) => (
                    <tr key={batch.id}>
                      <td>{batch.accessinId || collectionImports.length - i}</td>
                      <td>{formatLilaDateTime(batch.importedAt)}</td>
                      <td>{batch.entityLabel || MEMBER_COLLECTION_ENTITIES[batch.entity] || batch.entity}</td>
                      <td>
                        <span className={`status-badge ${statusTone(batch.status)}`}>
                          {MEMBER_COLLECTION_IMPORT_STATUS[batch.status] || batch.status}
                        </span>
                      </td>
                      <td>{batch.importedCount} de {batch.totalRows || batch.importedCount}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(batch.totalAmount)}</td>
                      <td>
                        <div className="cash-lila-row-actions">
                          {batch.fileName ? (
                            <a className="cash-lila-icon-btn is-edit" href={LISTA_BASE_COBRANZAS_URL} download title="Plantilla">
                              <Download size={13} />
                            </a>
                          ) : null}
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-del"
                            title="Eliminar"
                            onClick={() => {
                              if (window.confirm('¿Marcar esta importación como eliminada?')) {
                                onDeleteCollectionImport?.(batch.id);
                              }
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  if (view === 'import_debts') {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <h3 className="cuotas-title">Importar deudas socios</h3>
        </div>
        <section className="supplier-pay-import-block">
          <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
            Cargá saldos iniciales o deudas pendientes por socio (misma plantilla de lista base: UNIDAD + MONTO).
          </p>
          <p className="disc-field-hint">
            Por ahora usá <strong>Importar cobranzas</strong> con montos positivos como cobros.
            La importación de deudas (incremento de saldo) se habilita en la siguiente iteración con la plantilla Accessin de deudas.
          </p>
          <div className="supplier-pay-import-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setView('hub')}>Volver</button>
            <a className="btn cash-lila-purple-btn" href={LISTA_BASE_COBRANZAS_URL} download={LISTA_BASE_COBRANZAS_FILENAME}>
              <Download size={14} /> Descargar lista base
            </a>
          </div>
        </section>
      </div>
    );
  }

  if (view === 'impute_events') {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView('hub')}>
            <ArrowLeft size={14} /> Volver
          </button>
          <h3 className="cuotas-title" style={{ margin: 0 }}>Reservas sin imputar</h3>
        </div>

        <section className="supplier-pay-import-block">
          <div className="cuotas-event-filters">
            <label>
              <span className="form-label">Socio</span>
              <input className="form-input" value={evSocio} onChange={(e) => setEvSocio(e.target.value)} placeholder="Nombre o nro." />
            </label>
            <label>
              <span className="form-label">Espacio</span>
              <select className="form-input" value={evSpace} onChange={(e) => setEvSpace(e.target.value)}>
                <option value="all">Todos</option>
                {spaces.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              <span className="form-label">Estado</span>
              <select className="form-input" value={evStatus} onChange={(e) => setEvStatus(e.target.value)}>
                <option value="all">Todos</option>
                <option value="aprobado">Aprobado</option>
                <option value="approved">Approved</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </label>
            <label>
              <span className="form-label">Forma de pago</span>
              <select className="form-input" value={evPay} onChange={(e) => setEvPay(e.target.value)}>
                <option value="all">Todas</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </label>
          </div>

          <p className="disc-field-hint">
            Mostrando {Math.min(10, filteredEvents.length)} de {filteredEvents.length}
            {pendingEvents.length ? ` · ${pendingEvents.length} sin imputar` : ''}
          </p>

          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Socio</th>
                  <th>Creado el</th>
                  <th>Fecha</th>
                  <th>Espacio / Estado</th>
                  <th>Importe</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                      No hay reservas de salón/espacio pendientes de imputar.
                    </td>
                  </tr>
                ) : (
                  filteredEvents.slice(0, 50).map((r) => (
                    <tr key={r.id}>
                      <td>{r.accessinId || r.id}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.memberName || '—'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.memberId}</div>
                      </td>
                      <td>{formatLilaDateTime(r.createdAt || r.created_at)}</td>
                      <td>{r.date || r.start || '—'}{r.startTime ? ` ${r.startTime}` : ''}{r.endTime ? ` - ${r.endTime}` : ''}</td>
                      <td>
                        <div>{r.facilityName || r.facilityId || r.space || '—'}</div>
                        <span className="status-badge confirmed">{r.status || 'Aprobado'}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn cash-lila-purple-btn btn-sm"
                          onClick={() => {
                            onImputeReservation?.(r);
                            setFlash(`Evento ${r.id} marcado para imputación.`);
                          }}
                        >
                          Imputar
                        </button>
                      </td>
                      <td>
                        <button type="button" className="cash-lila-icon-btn is-edit" title="Ver" onClick={() => setDetailEvent(r)}>
                          <Eye size={13} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {detailEvent ? (
          <div className="modal-overlay" onClick={() => setDetailEvent(null)} role="presentation">
            <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <div className="modal-header">
                <h3>Evento #{detailEvent.accessinId || detailEvent.id}</h3>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetailEvent(null)}>×</button>
              </div>
              <div className="modal-body" style={{ display: 'grid', gap: '0.65rem' }}>
                <div><strong>Socio:</strong> {detailEvent.memberName}</div>
                <div><strong>Socio (ID):</strong> {detailEvent.memberId}</div>
                <div><strong>Espacio:</strong> {detailEvent.facilityName || detailEvent.facilityId || detailEvent.space}</div>
                <div><strong>Estado:</strong> {detailEvent.status || 'Aprobado'}</div>
                <div><strong>Fecha:</strong> {detailEvent.date || detailEvent.start}</div>
                <div><strong>Invitados:</strong> {detailEvent.guests ?? 0}</div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDetailEvent(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // HUB
  return (
    <div className="fade-in cuotas-panel">
      <div className="cuotas-toolbar">
        <h2 className="cuotas-title">
          <CalendarRange size={18} /> Cuotas
        </h2>
        <div className="cuotas-actions">
          <button type="button" className="btn cash-lila-purple-btn" onClick={() => setView('import_debts')}>
            <FileSpreadsheet size={14} /> Importar deudas socios
          </button>
          <button type="button" className="btn cash-lila-purple-btn" onClick={() => { setView('import_collections'); setError(''); setOk(''); }}>
            <Upload size={14} /> Importar cobranzas socios
          </button>
          <button type="button" className="btn cash-lila-purple-btn" onClick={() => setView('impute_events')}>
            <Plus size={14} /> Imputar eventos
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setView('mora')}>
            <Search size={14} /> Control de mora
          </button>
        </div>
      </div>

      <div className={`cuotas-cc-banner${ccEnabled ? '' : ' is-off'}`}>
        <span>
          {ccEnabled
            ? 'Todos los socios pueden ver sus cuentas corrientes'
            : 'Las cuentas corrientes están desactivadas para los socios'}
        </span>
        <button
          type="button"
          className="btn btn-sm cuotas-cc-toggle"
          onClick={() => setCcEnabled((v) => !v)}
        >
          {ccEnabled ? 'Desactivar cuentas corrientes' : 'Activar cuentas corrientes'}
        </button>
      </div>

      {flash ? <p className="ig-ok">{flash}</p> : null}
      {error ? <p className="ig-error">{error}</p> : null}

      <div className="cuotas-year-row">
        <label className="form-label" htmlFor="cuotas-year">Año</label>
        <input
          id="cuotas-year"
          className="form-input"
          value={yearDraft}
          onChange={(e) => setYearDraft(e.target.value)}
          style={{ maxWidth: 120 }}
        />
        <button type="button" className="btn cash-lila-purple-btn" onClick={applyYear}>
          Ver año seleccionado
        </button>
      </div>

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Período</th>
              <th>Monto</th>
              <th>Fecha de generación</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: 'var(--text-muted)' }}>No hay períodos para {year}.</td>
              </tr>
            ) : (
              periods.map((p) => (
                <tr key={p.id}>
                  <td>{p.accessinId || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{periodLabel(p)}</td>
                  <td>{p.status === 'processed' ? fmt(p.amount) : '—'}</td>
                  <td>{formatPeriodGeneratedAt(p.generatedAt)}</td>
                  <td>
                    <span className={`status-badge ${statusTone(p.status)}`}>
                      {periodStatusLabel(p.status)}
                    </span>
                  </td>
                  <td>
                    <div className="cash-lila-row-actions">
                      {p.status === 'processed' ? (
                        <>
                          <button type="button" className="cash-lila-icon-btn is-edit" title="Imprimir" onClick={() => window.print()}>
                            <Printer size={13} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Ver detalle de cuentas"
                            onClick={() => openPeriodDetail(p)}
                          >
                            <Eye size={13} />
                          </button>
                          {p.month === 9 && p.year === 2026 ? (
                            <>
                              <button type="button" className="cash-lila-icon-btn is-del" title="Anular" disabled>
                                <Trash2 size={13} />
                              </button>
                              <button type="button" className="cash-lila-icon-btn is-edit" title="Revertir" disabled>
                                <RotateCcw size={13} />
                              </button>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <button
                          type="button"
                          className="cash-lila-icon-btn is-edit"
                          title="Liquidar período"
                          onClick={() => liquidate(p.id)}
                        >
                          <Plus size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  Store, AlertTriangle, CheckCircle2, Clock, Plus, RefreshCw, Ban, Search,
  CalendarDays, FileText, Download, Receipt, ClipboardList, KeyRound, Link2, Upload,
} from 'lucide-react';
import {
  CONCESSION_TYPES,
  CONCESSION_SPACES,
  CHECKLIST_ITEMS,
  DOC_TYPES,
  REQUIRED_DOC_TYPES,
  summarizeConcessions,
  findSpaceOverlap,
  getCanonDebt,
  buildExpiryCalendar,
  exportConcessionsCsv,
  downloadTextFile,
  checklistProgress,
  missingRequiredDocuments,
} from '../../domain/concessions/concessions';
import { downloadCanonReceiptPdf } from '../../domain/concessions/exportCanonReceiptPdf';
import { isSupabaseConfigured } from '../../lib/supabase';
import { uploadConcessionDocument, validateConcessionDocFile } from '../../data/storage';
import ConcessionWizard from './ConcessionWizard';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function spaceLabel(spaceId) {
  return CONCESSION_SPACES.find((s) => s.id === spaceId)?.name || 'Sin espacio';
}

const STATUS_CLASS = {
  active: 'is-ok',
  expiring: 'is-warn',
  expired: 'is-bad',
  suspended: 'is-off',
  draft: 'is-off',
};

export default function ConcessionsTab({
  concessions = [],
  canonPayments = [],
  upsertConcession: saveConcession,
  renewConcessionContract,
  setConcessionStatus,
  toggleConcessionChecklist,
  addDocToConcession,
  removeDocFromConcession,
  recordCanonPayment,
  renewedBy = 'admin',
}) {
  const [section, setSection] = useState('contratos');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('resumen');
  const [payForm, setPayForm] = useState({ period: '', amount: '', method: 'transfer', note: '' });
  const [uploadingDocType, setUploadingDocType] = useState(null);
  const [calCursor, setCalCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const { rows, totals } = useMemo(() => summarizeConcessions(concessions), [concessions]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.expiry.status !== filter) return false;
      if (!q) return true;
      const hay = `${r.name} ${r.concessionaire} ${r.concessionaireNumber || ''} ${r.location} ${r.cuit} ${r.portalCode}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, filter, query]);

  const selected = rows.find((r) => r.id === selectedId) || visible[0] || null;

  const debt = useMemo(
    () => (selected ? getCanonDebt(selected, canonPayments) : null),
    [selected, canonPayments]
  );

  const selectedPayments = useMemo(
    () => (selected ? canonPayments.filter((p) => p.concessionId === selected.id) : []),
    [selected, canonPayments]
  );

  const calendar = useMemo(
    () => buildExpiryCalendar(concessions, calCursor),
    [concessions, calCursor]
  );

  const progress = selected ? checklistProgress(selected) : null;
  const missingDocs = selected ? missingRequiredDocuments(selected) : [];

  // Si faltan docs obligatorios, abrir esa pestaña al elegir la concesión
  useEffect(() => {
    if (!selected?.id) return;
    if (missingRequiredDocuments(selected).length > 0) {
      setDetailTab('docs');
    }
  }, [selected?.id]);

  const registerPayment = (e) => {
    e.preventDefault();
    if (!selected || !recordCanonPayment) return;
    try {
      const payment = recordCanonPayment({
        concessionId: selected.id,
        period: payForm.period || new Date().toISOString().slice(0, 7),
        amount: Number(payForm.amount) || selected.monthlyFee,
        method: payForm.method,
        note: payForm.note,
      });
      setPayForm({ period: '', amount: '', method: 'transfer', note: '' });
      void downloadCanonReceiptPdf({ concession: selected, payment });
    } catch (err) {
      setError(err.message || 'No se pudo registrar el cobro.');
    }
  };

  const uploadDetailDoc = async (type, file) => {
    if (!selected || !addDocToConcession) return;
    setError('');
    setUploadingDocType(type);
    try {
      validateConcessionDocFile(file);
      if (!isSupabaseConfigured) {
        throw new Error('Para subir archivos necesitás Supabase configurado.');
      }
      const uploaded = await uploadConcessionDocument(file, {
        concessionId: selected.id,
        type,
      });
      await addDocToConcession(selected.id, {
        type,
        name: uploaded.name,
        url: uploaded.url,
        path: uploaded.path,
        mimeType: uploaded.mimeType,
        size: uploaded.size,
      });
      if (CHECKLIST_ITEMS.some((i) => i.id === type) && toggleConcessionChecklist) {
        toggleConcessionChecklist(selected.id, type, true);
      }
    } catch (err) {
      setError(err?.message || 'No se pudo adjuntar el documento.');
    } finally {
      setUploadingDocType(null);
    }
  };

  const exportCsv = () => {
    downloadTextFile(
      `concesiones-${new Date().toISOString().slice(0, 10)}.csv`,
      exportConcessionsCsv(concessions),
      'text/csv;charset=utf-8'
    );
  };

  const monthLabel = new Date(calCursor.year, calCursor.month, 1).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="fade-in conc-tab">
      <header className="conc-head">
        <div>
          <h2 className="serif-font conc-title">
            <Store size={20} /> Concesiones
          </h2>
          <p>Canon, vencimientos, documentos, checklist y portal del concesionario.</p>
        </div>
        <div className="conc-head-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}>
            <Download size={14} /> Exportar CSV
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setShowForm(true);
              setSection('contratos');
              setError('');
            }}
          >
            <Plus size={14} /> Nueva concesión
          </button>
        </div>
      </header>

      {error && !showForm && (
        <p className="conc-error" role="alert">{error}</p>
      )}

      <div className="conc-section-tabs">
        {[
          ['contratos', 'Contratos'],
          ['calendario', 'Calendario'],
          ['canon', 'Canon / Deuda'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`filter-btn${section === id ? ' active' : ''}`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="conc-kpis">
        <article className="conc-kpi">
          <span>Vigentes</span>
          <strong className="ok">{totals.active}</strong>
        </article>
        <article className="conc-kpi">
          <span>Por vencer</span>
          <strong className="warn">{totals.expiring}</strong>
        </article>
        <article className="conc-kpi">
          <span>Vencidas</span>
          <strong className="bad">{totals.expired}</strong>
        </article>
        <article className="conc-kpi">
          <span>Canon mensual</span>
          <strong>{formatCurrency(totals.monthlyCanon)}</strong>
        </article>
      </section>

      {(totals.expiring > 0 || totals.expired > 0) && (
        <div className="conc-alert-strip">
          <AlertTriangle size={16} />
          Hay {totals.expiring} por vencer y {totals.expired} vencida(s). Revisá renovaciones.
        </div>
      )}

      {showForm && (
        <ConcessionWizard
          concessions={concessions}
          saveConcession={saveConcession}
          addDocToConcession={addDocToConcession}
          toggleConcessionChecklist={toggleConcessionChecklist}
          findSpaceOverlap={findSpaceOverlap}
          onCancel={() => setShowForm(false)}
          onDone={(saved) => {
            setShowForm(false);
            setSelectedId(saved?.id || null);
            setSection('contratos');
            setDetailTab(missingRequiredDocuments(saved || {}).length ? 'docs' : 'resumen');
          }}
        />
      )}

      {section === 'calendario' && (
        <section className="glass-card conc-calendar">
          <div className="conc-calendar-head">
            <h3><CalendarDays size={16} /> Vencimientos · {monthLabel}</h3>
            <div className="conc-calendar-nav">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCalCursor((c) => {
                  const d = new Date(c.year, c.month - 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })}
              >
                ←
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCalCursor((c) => {
                  const d = new Date(c.year, c.month + 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })}
              >
                →
              </button>
            </div>
          </div>
          {calendar.length === 0 ? (
            <p className="conc-empty">Sin vencimientos este mes.</p>
          ) : (
            <ul className="conc-calendar-list">
              {calendar.map((ev) => (
                <li key={`${ev.concessionId}-${ev.date}`}>
                  <strong>{formatDate(ev.date)}</strong>
                  <span>{ev.name}</span>
                  <em>{ev.concessionaire}</em>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSelectedId(ev.concessionId); setSection('contratos'); }}>
                    Ver
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === 'canon' && (
        <section className="glass-card conc-debt-board">
          <h3><Receipt size={16} /> Deuda de canon por concesión</h3>
          <div className="conc-debt-grid">
            {rows.map((c) => {
              const d = getCanonDebt(c, canonPayments);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="conc-debt-card"
                  onClick={() => { setSelectedId(c.id); setSection('contratos'); setDetailTab('canon'); }}
                >
                  <strong>{c.name}</strong>
                  <span>{d.unpaidMonths.length} mes(es) impagos</span>
                  <em className={d.totalDebt > 0 ? 'bad' : 'ok'}>{formatCurrency(d.totalDebt)}</em>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {section === 'contratos' && (
        <>
          <div className="conc-toolbar">
            <div className="conc-filters">
              {[
                ['all', 'Todas'],
                ['active', 'Vigentes'],
                ['expiring', 'Por vencer'],
                ['expired', 'Vencidas'],
                ['suspended', 'Suspendidas'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`filter-btn${filter === id ? ' active' : ''}`}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="conc-search">
              <Search size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar concesión…" />
            </label>
          </div>

          <div className="conc-layout">
            <div className="conc-list glass-card">
              {visible.length === 0 && <p className="conc-empty">Sin concesiones con ese filtro.</p>}
              {visible.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`conc-row${selected?.id === c.id ? ' is-selected' : ''} ${STATUS_CLASS[c.expiry.status] || ''}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="conc-row-top">
                    <strong>{c.name}</strong>
                    <span className={`conc-badge ${STATUS_CLASS[c.expiry.status]}`}>{c.expiry.label}</span>
                  </div>
                  <div className="conc-row-meta">
                    {c.concessionaire} · vence {formatDate(c.endDate)}
                  </div>
                  <div className="conc-row-fee">{formatCurrency(c.monthlyFee)} / mes</div>
                </button>
              ))}
            </div>

            {selected && (
              <section className="conc-detail glass-card">
                <div className="conc-detail-head">
                  <div>
                    <h3>{selected.name}</h3>
                    <p>{CONCESSION_TYPES[selected.type] || selected.type} · {spaceLabel(selected.spaceId)}</p>
                  </div>
                  <span className={`conc-badge ${STATUS_CLASS[selected.expiry.status]}`}>
                    {selected.expiry.status === 'expired' && <AlertTriangle size={12} />}
                    {selected.expiry.status === 'expiring' && <Clock size={12} />}
                    {selected.expiry.status === 'active' && <CheckCircle2 size={12} />}
                    {selected.expiry.label}
                  </span>
                </div>

                <div className="conc-detail-tabs">
                  {[
                    ['resumen', 'Resumen'],
                    ['canon', 'Canon'],
                    ['docs', missingDocs.length ? `Documentos (${missingDocs.length})` : 'Documentos'],
                    ['checklist', 'Checklist'],
                    ['historial', 'Renovaciones'],
                    ['portal', 'Portal'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`filter-btn${detailTab === id ? ' active' : ''}${id === 'docs' && missingDocs.length ? ' is-warn-tab' : ''}`}
                      onClick={() => setDetailTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {detailTab === 'resumen' && (
                  <>
                    <div className="conc-fields">
                      <div><span>Concesionario</span><strong>{selected.concessionaire}</strong></div>
                      <div><span>Nº concesionario</span><strong>{selected.concessionaireNumber || '—'}</strong></div>
                      <div><span>Teléfono</span><strong>{selected.contactPhone || '—'}</strong></div>
                      <div><span>CUIT</span><strong>{selected.cuit || '—'}</strong></div>
                      <div><span>Contacto</span><strong>{selected.contactName || '—'}</strong></div>
                      <div><span>Email</span><strong>{selected.contactEmail || '—'}</strong></div>
                      <div><span>Espacio</span><strong>{spaceLabel(selected.spaceId)}</strong></div>
                      <div><span>Vigencia</span><strong>{formatDate(selected.startDate)} → {formatDate(selected.endDate)}</strong></div>
                      <div><span>Canon</span><strong>{formatCurrency(selected.monthlyFee)}</strong></div>
                      <div><span>Depósito</span><strong>{formatCurrency(selected.deposit)}</strong></div>
                      <div><span>Checklist</span><strong>{progress ? `${progress.done}/${progress.total}` : '—'}</strong></div>
                      <div><span>Docs faltantes</span><strong className={missingDocs.length ? 'bad' : 'ok'}>{missingDocs.length || 'Ninguno'}</strong></div>
                    </div>
                    {selected.notes && <p className="conc-notes">{selected.notes}</p>}
                    <div className="conc-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => renewConcessionContract?.(selected.id, { months: 12, renewedBy })}
                      >
                        <RefreshCw size={14} /> Renovar 12 meses
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setConcessionStatus?.(
                          selected.id,
                          selected.statusManual === 'suspended' ? 'active' : 'suspended'
                        )}
                      >
                        <Ban size={14} />
                        {selected.statusManual === 'suspended' ? 'Reactivar' : 'Suspender'}
                      </button>
                    </div>
                    {(selected.expiry.status === 'expiring' || selected.expiry.status === 'expired') && (
                      <div className={`conc-deadline ${selected.expiry.status === 'expired' ? 'is-bad' : 'is-warn'}`}>
                        <AlertTriangle size={15} />
                        {selected.expiry.status === 'expired'
                          ? `Contrato vencido el ${formatDate(selected.endDate)}.`
                          : `Vence el ${formatDate(selected.endDate)} (en ${selected.expiry.daysLeft} día/s).`}
                      </div>
                    )}
                  </>
                )}

                {detailTab === 'canon' && (
                  <div className="conc-panel">
                    <div className="conc-fields">
                      <div><span>Deuda</span><strong className={debt?.totalDebt > 0 ? 'bad' : 'ok'}>{formatCurrency(debt?.totalDebt || 0)}</strong></div>
                      <div><span>Meses impagos</span><strong>{debt?.unpaidMonths?.join(', ') || '—'}</strong></div>
                    </div>
                    <form className="conc-inline-form" onSubmit={registerPayment}>
                      <div>
                        <label className="form-label">Período</label>
                        <input
                          type="month"
                          className="form-input"
                          value={payForm.period}
                          onChange={(e) => setPayForm({ ...payForm, period: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <label className="form-label">Importe</label>
                        <input
                          type="number"
                          className="form-input"
                          placeholder={String(selected.monthlyFee || '')}
                          value={payForm.amount}
                          onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="form-label">Medio</label>
                        <select className="form-input" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                          <option value="transfer">Transferencia</option>
                          <option value="cash">Efectivo</option>
                          <option value="cheque">Cheque</option>
                          <option value="mercadopago">Mercado Pago</option>
                        </select>
                      </div>
                      <button type="submit" className="btn btn-primary btn-sm">
                        <Receipt size={14} /> Cobrar + PDF
                      </button>
                    </form>
                    <ul className="conc-pay-list">
                      {selectedPayments.length === 0 && <li className="conc-empty">Sin cobros registrados.</li>}
                      {selectedPayments.map((p) => (
                        <li key={p.id}>
                          <span>{p.period}</span>
                          <strong>{formatCurrency(p.amount)}</strong>
                          <em>{p.date}</em>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => { void downloadCanonReceiptPdf({ concession: selected, payment: p }); }}
                          >
                            PDF
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {detailTab === 'docs' && (
                  <div className="conc-panel">
                    {error && <p className="conc-error" role="alert">{error}</p>}
                    {missingDocs.length > 0 && (
                      <div className="conc-alert-strip">
                        <FileText size={14} />
                        Completá por pasos. Faltan: {missingDocs.map((d) => DOC_TYPES[d] || d).join(', ')}
                      </div>
                    )}
                    <div className="conc-doc-steps">
                      {REQUIRED_DOC_TYPES.map((type, idx) => {
                        const files = (selected.documents || []).filter((d) => d.type === type);
                        const done = files.length > 0;
                        return (
                          <article key={type} className={`conc-doc-card${done ? ' is-done' : ''}`}>
                            <header>
                              <span className="conc-doc-card-step">Paso {idx + 1}</span>
                              <h4>{DOC_TYPES[type]}</h4>
                              <span className={`conc-badge ${done ? 'is-ok' : 'is-warn'}`}>
                                {done ? 'Cargado' : 'Pendiente'}
                              </span>
                            </header>
                            <p>PDF o foto · máx. 10 MB</p>
                            <label className="conc-doc-upload">
                              <Upload size={14} />
                              {uploadingDocType === type ? 'Subiendo…' : done ? 'Agregar otro archivo' : 'Elegir archivo y subir'}
                              <input
                                type="file"
                                accept="application/pdf,image/*"
                                disabled={Boolean(uploadingDocType)}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = '';
                                  if (file) void uploadDetailDoc(type, file);
                                }}
                              />
                            </label>
                            {files.length > 0 ? (
                              <ul className="conc-doc-file-list">
                                {files.map((d) => (
                                  <li key={d.id}>
                                    <FileText size={14} />
                                    <div className="conc-doc-file-meta">
                                      <strong>{d.name || DOC_TYPES[type]}</strong>
                                      <em>{formatDate((d.uploadedAt || '').slice(0, 10))}</em>
                                    </div>
                                    {d.url ? (
                                      <a className="btn btn-secondary btn-sm" href={d.url} target="_blank" rel="noreferrer">
                                        Ver
                                      </a>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => removeDocFromConcession?.(selected.id, d.id)}
                                    >
                                      Quitar
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="conc-empty">Todavía no hay archivo para este paso.</p>
                            )}
                          </article>
                        );
                      })}
                    </div>

                    <details className="conc-doc-extra">
                      <summary>Otros documentos (anexo / otro)</summary>
                      <div className="conc-doc-steps" style={{ marginTop: '0.75rem' }}>
                        {['anexo', 'otro'].map((type) => {
                          const files = (selected.documents || []).filter((d) => d.type === type);
                          return (
                            <article key={type} className="conc-doc-card">
                              <header>
                                <h4>{DOC_TYPES[type]}</h4>
                              </header>
                              <label className="conc-doc-upload">
                                <Upload size={14} />
                                {uploadingDocType === type ? 'Subiendo…' : 'Subir'}
                                <input
                                  type="file"
                                  accept="application/pdf,image/*"
                                  disabled={Boolean(uploadingDocType)}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    if (file) void uploadDetailDoc(type, file);
                                  }}
                                />
                              </label>
                              {files.length > 0 && (
                                <ul className="conc-doc-file-list">
                                  {files.map((d) => (
                                    <li key={d.id}>
                                      <FileText size={14} />
                                      <strong>{d.name}</strong>
                                      {d.url ? <a href={d.url} target="_blank" rel="noreferrer">Ver</a> : null}
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => removeDocFromConcession?.(selected.id, d.id)}
                                      >
                                        Quitar
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                )}

                {detailTab === 'checklist' && (
                  <div className="conc-panel">
                    <p className="conc-notes">
                      <ClipboardList size={14} /> Progreso: {progress?.done || 0}/{progress?.total || 0}
                      {progress ? ` (${progress.pct}%)` : ''}
                    </p>
                    <ul className="conc-check-list">
                      {CHECKLIST_ITEMS.map((item) => (
                        <li key={item.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={Boolean(selected.checklist?.[item.id])}
                              onChange={(e) => toggleConcessionChecklist?.(selected.id, item.id, e.target.checked)}
                            />
                            <span>
                              {item.label}
                              {item.phase === 'exit' && <em> · baja</em>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {detailTab === 'historial' && (
                  <div className="conc-panel">
                    <ul className="conc-pay-list">
                      {(selected.renewalHistory || []).length === 0 && (
                        <li className="conc-empty">Sin renovaciones registradas.</li>
                      )}
                      {[...(selected.renewalHistory || [])].reverse().map((h) => (
                        <li key={h.id}>
                          <span>{formatDate((h.at || '').slice(0, 10))}</span>
                          <strong>
                            {formatDate(h.previousEndDate)} → {formatDate(h.newEndDate)}
                          </strong>
                          <em>
                            {formatCurrency(h.previousFee)} → {formatCurrency(h.newFee)}
                            {h.renewedBy ? ` · ${h.renewedBy}` : ''}
                          </em>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {detailTab === 'portal' && (
                  <div className="conc-panel conc-portal-box">
                    <p>
                      <KeyRound size={16} /> Código portal concesionario
                    </p>
                    <code className="conc-portal-code">{selected.portalCode || '—'}</code>
                    <p className="conc-notes">
                      El concesionario puede consultar contrato, vencimiento y documentos en{' '}
                      <Link2 size={12} style={{ display: 'inline' }} />{' '}
                      <a href={`/concesionario/${selected.portalCode}`} target="_blank" rel="noreferrer">
                        /concesionario/{selected.portalCode}
                      </a>
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

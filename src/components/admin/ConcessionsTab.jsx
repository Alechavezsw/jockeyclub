import { useMemo, useState } from 'react';
import {
  Store, AlertTriangle, CheckCircle2, Clock, Plus, RefreshCw, Ban, Search,
  CalendarDays, FileText, Download, Receipt, ClipboardList, KeyRound, Link2,
} from 'lucide-react';
import {
  CONCESSION_TYPES,
  CONCESSION_SPACES,
  CHECKLIST_ITEMS,
  DOC_TYPES,
  createConcession,
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

const EMPTY_FORM = {
  name: '',
  type: 'gastronomia',
  concessionaire: '',
  cuit: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  location: '',
  spaceId: 'space-pavilion',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  noticeDays: '30',
  monthlyFee: '',
  revenueSharePct: '0',
  deposit: '',
  autoRenew: false,
  notes: '',
  statusManual: 'active',
};

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
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('resumen');
  const [payForm, setPayForm] = useState({ period: '', amount: '', method: 'transfer', note: '' });
  const [docForm, setDocForm] = useState({ type: 'contrato', name: '', note: '' });
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
      const hay = `${r.name} ${r.concessionaire} ${r.location} ${r.cuit} ${r.portalCode}`.toLowerCase();
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

  const submit = (e) => {
    e.preventDefault();
    setError('');
    try {
      const overlap = findSpaceOverlap(concessions, {
        spaceId: form.spaceId,
        startDate: form.startDate,
        endDate: form.endDate,
      });
      if (overlap) {
        throw new Error(`El espacio ya está ocupado por «${overlap.name}» en ese período.`);
      }
      const created = createConcession({
        ...form,
        noticeDays: Number(form.noticeDays) || 30,
        monthlyFee: Number(form.monthlyFee) || 0,
        revenueSharePct: Number(form.revenueSharePct) || 0,
        deposit: Number(form.deposit) || 0,
      });
      if (!saveConcession) throw new Error('Guardado no disponible.');
      saveConcession(created);
      setForm(EMPTY_FORM);
      setShowForm(false);
      setSelectedId(created.id);
    } catch (err) {
      setError(err.message || 'No se pudo guardar la concesión.');
    }
  };

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
      downloadCanonReceiptPdf({ concession: selected, payment });
    } catch (err) {
      setError(err.message || 'No se pudo registrar el cobro.');
    }
  };

  const addDoc = (e) => {
    e.preventDefault();
    if (!selected || !addDocToConcession) return;
    addDocToConcession(selected.id, {
      type: docForm.type,
      name: docForm.name || DOC_TYPES[docForm.type] || 'Documento',
      note: docForm.note,
    });
    setDocForm({ type: 'contrato', name: '', note: '' });
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
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} /> Nueva concesión
          </button>
        </div>
      </header>

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
        <form className="glass-card conc-form" onSubmit={submit}>
          <h3>Alta de concesión</h3>
          <div className="conc-form-grid">
            <div>
              <label className="form-label">Nombre *</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="form-label">Tipo</label>
              <select className="form-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(CONCESSION_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Espacio del club *</label>
              <select className="form-input" value={form.spaceId} onChange={(e) => setForm({ ...form, spaceId: e.target.value })}>
                {CONCESSION_SPACES.map((s) => (
                  <option key={s.id} value={s.id}>{s.area} · {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Concesionario *</label>
              <input className="form-input" value={form.concessionaire} onChange={(e) => setForm({ ...form, concessionaire: e.target.value })} required />
            </div>
            <div>
              <label className="form-label">CUIT</label>
              <input className="form-input" value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Inicio</label>
              <input type="date" className="form-input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Vencimiento *</label>
              <input type="date" className="form-input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </div>
            <div>
              <label className="form-label">Aviso (días)</label>
              <input type="number" min="1" className="form-input" value={form.noticeDays} onChange={(e) => setForm({ ...form, noticeDays: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Canon mensual</label>
              <input type="number" min="0" className="form-input" value={form.monthlyFee} onChange={(e) => setForm({ ...form, monthlyFee: e.target.value })} />
            </div>
            <div>
              <label className="form-label">% participación</label>
              <input type="number" min="0" max="100" className="form-input" value={form.revenueSharePct} onChange={(e) => setForm({ ...form, revenueSharePct: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Ubicación / nota física</label>
              <input className="form-input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
          </div>
          {error && <p className="conc-error">{error}</p>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary btn-sm">Guardar</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </form>
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
                    ['docs', 'Documentos'],
                    ['checklist', 'Checklist'],
                    ['historial', 'Renovaciones'],
                    ['portal', 'Portal'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`filter-btn${detailTab === id ? ' active' : ''}`}
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
                      <div><span>CUIT</span><strong>{selected.cuit || '—'}</strong></div>
                      <div><span>Contacto</span><strong>{selected.contactName || '—'} · {selected.contactPhone || '—'}</strong></div>
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
                            onClick={() => downloadCanonReceiptPdf({ concession: selected, payment: p })}
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
                    {missingDocs.length > 0 && (
                      <div className="conc-alert-strip">
                        <FileText size={14} />
                        Faltan: {missingDocs.map((d) => DOC_TYPES[d] || d).join(', ')}
                      </div>
                    )}
                    <form className="conc-inline-form" onSubmit={addDoc}>
                      <div>
                        <label className="form-label">Tipo</label>
                        <select className="form-input" value={docForm.type} onChange={(e) => setDocForm({ ...docForm, type: e.target.value })}>
                          {Object.entries(DOC_TYPES).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="form-label">Nombre archivo</label>
                        <input className="form-input" value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })} placeholder="contrato.pdf" />
                      </div>
                      <button type="submit" className="btn btn-primary btn-sm">Adjuntar</button>
                    </form>
                    <ul className="conc-pay-list">
                      {(selected.documents || []).length === 0 && <li className="conc-empty">Sin documentos.</li>}
                      {(selected.documents || []).map((d) => (
                        <li key={d.id}>
                          <span>{DOC_TYPES[d.type] || d.type}</span>
                          <strong>{d.name}</strong>
                          <em>{formatDate((d.uploadedAt || '').slice(0, 10))}</em>
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

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Eye, FileDown, FileText, LifeBuoy, Lock, Plus, Search, Share2, Trash2,
} from 'lucide-react';
import CuotasDeskToolbar, { CuotasTool } from './CuotasDeskToolbar';
import { exportAccountPaymentPdf } from '../../domain/accounting/exportAccountPaymentPdf';
import { exportPaymentBoletoPdf } from '../../domain/accounting/exportPaymentBoleto';
import { getActiveTiers } from '../../domain/members/tiers';
import { memberNumberOf, resolveFamilyForDisplay } from '../../domain/members/households';
import {
  ACCOUNT_ENTRY_TYPES,
  accountSummaryMeta,
  buildAccessinAccountEntries,
  buildPaymentBoleto,
  applyAccountEntryToMember,
  createAccountEntry,
  entriesFromGroupLines,
  entriesFromSupportLines,
  familyBalanceForMember,
  filterMembersForBalances,
  formatSpanishLongDate,
  groupEntriesByMonth,
  MEMBER_BALANCES_SNAPSHOTS,
  memberStatusLabel,
  mergeAccountEntries,
} from '../../domain/accounting/memberBalances';
import {
  currentAccountBalanceOf,
  currentAccountBalancesSeed,
} from '../../domain/accounting/currentAccountBalances';
import { lookupMonthlyDebt } from '../../domain/accounting/monthlyDebts';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import { listGroupAccountLedger, listMemberAccountSupport } from '../../data/repos';
import { isSupabaseConfigured } from '../../lib/supabase';
import SnapshotGate from '../SnapshotGate';

const SNAPSHOTS = [...MEMBER_BALANCES_SNAPSHOTS, 'accessinMonthlyDebts'];

const PAGE_SIZE = 50;

function formatLilaMoney(n, { signed = false } = {}) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (signed && v < 0) return `$ -${abs}`;
  if (signed && v > 0) return `$ ${abs}`;
  return `$ ${abs}`;
}

const EMPTY_FILTERS = {
  query: '',
  status: 'habilitado',
  tier: 'all',
};

export default function MemberBalancesPanel(props) {
  return (
    <SnapshotGate names={SNAPSHOTS}>
      <MemberBalancesContent {...props} />
    </SnapshotGate>
  );
}

function MemberBalancesContent({
  members = [],
  accountEntries = [],
  onUpsertEntry,
  onDeleteEntry,
  onBack,
  onGoView,
  onGoImportCollections,
  onGoImportDebts,
  onGoImputeEvents,
  tierCatalog = [],
}) {
  const {
    ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF,
    ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT,
  } = useSnapshotSeed(SNAPSHOTS, currentAccountBalancesSeed);
  const tiers = useMemo(() => getActiveTiers(tierCatalog), [tierCatalog]);

  const [view, setView] = useState('list'); // list | summary | payment | boleto | entry
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [monthsBack, setMonthsBack] = useState(4);
  const [summaryMode, setSummaryMode] = useState('member'); // member | family | support
  const [ledger, setLedger] = useState({ status: 'idle', titular: '', account: null });
  const [support, setSupport] = useState({ status: 'idle', titular: '', account: null });
  const [boleto, setBoleto] = useState(null);
  const [entryForm, setEntryForm] = useState({
    type: 'pago',
    target: 'socio',
    memberNumber: '',
    memberName: '',
    value: '',
    date: new Date().toISOString().slice(0, 10),
    description: '',
  });
  const [entryQuery, setEntryQuery] = useState('');
  const [error, setError] = useState('');
  const [exportBusy, setExportBusy] = useState('');

  const goDesk = (next) => {
    if (next === 'balances') return;
    if (typeof onGoView === 'function') onGoView(next);
    else if (next === 'monthly_debts') onGoImportDebts?.();
    else if (next === 'import_collections') onGoImportCollections?.();
    else if (next === 'impute_events') onGoImputeEvents?.();
  };

  const entrySuggestions = useMemo(() => {
    const q = entryQuery.trim();
    if (q.length < 2) return [];
    const selected = entryForm.memberNumber
      ? `${entryForm.memberNumber} — ${entryForm.memberName}`.trim()
      : '';
    if (selected && q === selected) return [];
    return filterMembersForBalances(members, { query: q, status: 'all' }).slice(0, 12);
  }, [members, entryQuery, entryForm.memberNumber, entryForm.memberName]);

  const applyFilters = (next) => {
    setFilters(next);
    setApplied(next);
    setPage(0);
  };

  const filtered = useMemo(
    () => filterMembersForBalances(members, applied),
    [members, applied]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const ledgerTitular = useMemo(
    () => (selectedMember ? memberNumberOf(selectedMember) : ''),
    [selectedMember]
  );

  useEffect(() => {
    if (view !== 'summary' || !ledgerTitular || !isSupabaseConfigured) return undefined;
    let cancel = false;
    setLedger({ status: 'loading', titular: ledgerTitular, account: null });
    listGroupAccountLedger(ledgerTitular)
      .then((account) => {
        if (!cancel) setLedger({ status: 'ready', titular: ledgerTitular, account });
      })
      .catch(() => {
        if (!cancel) setLedger({ status: 'missing', titular: ledgerTitular, account: null });
      });
    return () => { cancel = true; };
  }, [view, ledgerTitular]);

  useEffect(() => {
    if (view !== 'summary' || summaryMode !== 'support' || !ledgerTitular || !isSupabaseConfigured) return undefined;
    let cancel = false;
    setSupport({ status: 'loading', titular: ledgerTitular, account: null });
    listMemberAccountSupport(ledgerTitular)
      .then((account) => {
        if (!cancel) setSupport({ status: 'ready', titular: ledgerTitular, account });
      })
      .catch(() => {
        if (!cancel) setSupport({ status: 'missing', titular: ledgerTitular, account: null });
      });
    return () => { cancel = true; };
  }, [view, summaryMode, ledgerTitular]);

  const ledgerReady = ledger.status === 'ready' && ledger.titular === ledgerTitular && ledger.account;
  const ledgerLoading = ledger.status === 'loading' && ledger.titular === ledgerTitular;
  const supportReady = support.status === 'ready' && support.titular === ledgerTitular && support.account;
  const supportLoading = support.status === 'loading' && support.titular === ledgerTitular;

  const entriesForSelected = useMemo(() => {
    if (!selectedMember) return [];
    if (summaryMode === 'support') {
      if (!supportReady) return [];
      return entriesFromSupportLines(support.account.lines);
    }
    const family = resolveFamilyForDisplay(selectedMember, members);
    const nros = new Set([
      memberNumberOf(selectedMember),
      ...(family?.members || []).map((m) => memberNumberOf(m) || String(m.memberId || '').replace(/\D/g, '')),
    ].filter(Boolean));

    if (ledgerReady) {
      const fromLila = entriesFromGroupLines(ledger.account.lines, {
        memberNumber: summaryMode === 'member' ? memberNumberOf(selectedMember) : undefined,
      });
      const local = [];
      const targets = summaryMode === 'family' ? nros : new Set([memberNumberOf(selectedMember)]);
      targets.forEach((nro) => {
        local.push(...mergeAccountEntries([], accountEntries, nro));
      });
      return [...fromLila, ...local].toSorted(
        (a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id)
      );
    }

    if (summaryMode === 'family') {
      const all = [];
      nros.forEach((nro) => {
        const accessin = buildAccessinAccountEntries(nro);
        all.push(...mergeAccountEntries(accessin, accountEntries, nro));
      });
      return all.toSorted((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
    }
    const nro = memberNumberOf(selectedMember);
    const accessin = buildAccessinAccountEntries(nro);
    return mergeAccountEntries(accessin, accountEntries, nro);
  }, [selectedMember, accountEntries, summaryMode, members, ledgerReady, ledgerLoading, ledger.account, supportReady, support.account]);

  const carriedBalance = summaryMode === 'support' && supportReady
    ? Number(support.account.opening_balance) || 0
    : ledgerReady && summaryMode === 'family'
      ? Number(ledger.account.opening_balance) || 0
      : 0;

  const monthGroups = useMemo(
    () => groupEntriesByMonth(entriesForSelected, { monthsBack, carriedBalance }),
    [entriesForSelected, monthsBack, carriedBalance]
  );

  const meta = useMemo(
    () => (selectedMember ? accountSummaryMeta(selectedMember, members) : null),
    [selectedMember, members]
  );

  const openSummary = (member, mode = 'member') => {
    setSelectedMember(member);
    setSummaryMode(mode);
    setMonthsBack(4);
    setView('summary');
  };

  const openPayment = (entry) => {
    setSelectedEntry(entry);
    setView('payment');
  };

  const openBoleto = () => {
    if (!selectedMember) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const periodLabel = `${['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][m]} del ${y}`;
    const amount = Number(currentAccountBalanceOf(selectedMember)) || 0;
    const due1 = `${y}-${String(m + 1).padStart(2, '0')}-10`;
    const due2 = `${y}-${String(m + 1).padStart(2, '0')}-30`;
    setBoleto(buildPaymentBoleto(selectedMember, {
      periodLabel,
      amount,
      dueDate1: due1,
      dueDate2: due2,
      surcharge: Math.round(amount * 0.1),
    }));
    setView('boleto');
  };

  const pickEntryMember = (member) => {
    const nro = memberNumberOf(member);
    setEntryForm((f) => ({ ...f, memberNumber: nro, memberName: member?.name || '' }));
    setEntryQuery(nro ? `${nro} — ${member?.name || ''}`.trim() : '');
  };

  const openEntry = (member = null) => {
    setError('');
    const nro = member ? memberNumberOf(member) : '';
    setEntryForm({
      type: 'pago',
      target: 'socio',
      memberNumber: nro,
      memberName: member?.name || '',
      value: '',
      date: new Date().toISOString().slice(0, 10),
      description: '',
    });
    setEntryQuery(member ? `${nro} — ${member.name || ''}`.trim() : '');
    setView('entry');
  };

  const submitEntry = (e) => {
    e.preventDefault();
    setError('');
    try {
      if (entryForm.target === 'socio' && !entryForm.memberNumber) {
        throw new Error('Seleccioná un socio.');
      }
      const hit = (members || []).find((m) => memberNumberOf(m) === String(entryForm.memberNumber).replace(/\D/g, ''));
      const payload = createAccountEntry({
        ...entryForm,
        memberName: entryForm.memberName || hit?.name || '',
        memberNumber: entryForm.memberNumber,
      });
      onUpsertEntry?.(payload);
      if (hit) {
        setSelectedMember(applyAccountEntryToMember(hit, payload));
        setView('summary');
      } else {
        setView('list');
      }
    } catch (err) {
      setError(err.message || 'No se pudo crear la entrada.');
    }
  };

  if (view === 'entry') {
    return (
      <div className="fade-in cuotas-panel">
        <div className="modal-overlay" style={{ position: 'relative', background: 'transparent', inset: 'auto' }}>
          <div className="modal-card" style={{ maxWidth: 560, margin: '0 auto' }}>
            <div className="modal-header">
              <h3>Crear nueva entrada</h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView(selectedMember ? 'summary' : 'list')}>×</button>
            </div>
            <form className="modal-body disc-form" onSubmit={submitEntry}>
              <div className="disc-field">
                <label className="disc-field-label">Tipo</label>
                <select className="form-input" value={entryForm.type} onChange={(e) => setEntryForm((f) => ({ ...f, type: e.target.value }))}>
                  {ACCOUNT_ENTRY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div className="disc-field">
                <label className="disc-field-label">Crear pago para</label>
                <select className="form-input" value={entryForm.target} onChange={(e) => setEntryForm((f) => ({ ...f, target: e.target.value }))}>
                  <option value="socio">Socio</option>
                  <option value="grupo">Grupo familiar</option>
                </select>
              </div>
              <div className="disc-field">
                <label className="disc-field-label" htmlFor="member-entry-search">Socio</label>
                <div className="member-entry-pick">
                  <div className="member-entry-pick-field">
                    <Search size={16} aria-hidden className="member-entry-pick-icon" />
                    <input
                      id="member-entry-search"
                      className="form-input"
                      type="search"
                      value={entryQuery}
                      onChange={(e) => {
                        const q = e.target.value;
                        setEntryQuery(q);
                        setEntryForm((f) => ({ ...f, memberNumber: '', memberName: '' }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && entrySuggestions[0]) {
                          e.preventDefault();
                          pickEntryMember(entrySuggestions[0]);
                        }
                      }}
                      placeholder="Nombre, DNI o Nº de socio"
                      autoComplete="off"
                      required={!entryForm.memberNumber}
                    />
                  </div>
                  {entrySuggestions.length > 0 ? (
                    <ul className="member-entry-suggest" role="listbox">
                      {entrySuggestions.map((m) => (
                        <li key={m.memberId || memberNumberOf(m)}>
                          <button
                            type="button"
                            role="option"
                            onClick={() => pickEntryMember(m)}
                          >
                            <strong>{m.name}</strong>
                            <span>Nº {memberNumberOf(m) || m.memberId}{m.documentNumber ? ` · DNI ${m.documentNumber}` : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : entryQuery.trim().length >= 2 && !entryForm.memberNumber ? (
                    <p className="member-entry-empty">No se encontraron socios</p>
                  ) : null}
                </div>
              </div>
              <div className="disc-field">
                <label className="disc-field-label">Fecha</label>
                <input type="date" className="form-input" value={entryForm.date} onChange={(e) => setEntryForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="disc-field">
                <label className="disc-field-label">Valor</label>
                <input type="number" min="0" step="0.01" className="form-input" value={entryForm.value} onChange={(e) => setEntryForm((f) => ({ ...f, value: e.target.value }))} required />
              </div>
              <div className="disc-field">
                <label className="disc-field-label">Descripción</label>
                <input className="form-input" value={entryForm.description} onChange={(e) => setEntryForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              {error ? <p className="ig-error">{error}</p> : null}
              <div className="ig-form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setView(selectedMember ? 'summary' : 'list')}>Cancelar</button>
                <button type="submit" className="btn btn-tan">Continuar</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'boleto' && boleto) {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView('summary')}>
            <ArrowLeft size={14} /> Volver
          </button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn disc-bulk-btn"
              disabled={Boolean(exportBusy)}
              onClick={async () => {
                setExportBusy('pdf');
                setError('');
                try {
                  await exportPaymentBoletoPdf(boleto);
                } catch (err) {
                  setError(err?.message || 'No se pudo generar el PDF.');
                } finally {
                  setExportBusy('');
                }
              }}
            >
              <FileDown size={14} /> {exportBusy === 'pdf' ? 'Generando…' : 'PDF'}
            </button>
          </div>
        </div>
        {error ? <p className="ig-error">{error}</p> : null}
        <section className="supplier-pay-import-block boleto-sheet">
          <h3 style={{ marginTop: 0 }}>
            Boleto de pago #{boleto.number} · {boleto.periodLabel} · {boleto.memberNumber}
          </h3>
          <p style={{ fontWeight: 700, letterSpacing: '0.04em' }}>{boleto.clubName}</p>
          <p><strong>{boleto.memberName}</strong></p>
          <h4>Liquidación {boleto.periodLabel}</h4>
          <table className="admin-table">
            <thead>
              <tr><th>#</th><th>Socio</th><th>Identificador</th><th>Monto</th></tr>
            </thead>
            <tbody>
              {boleto.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.id}</td>
                  <td>{l.memberName}</td>
                  <td>{l.identifier}</td>
                  <td style={{ fontWeight: 700 }}>{formatLilaMoney(l.amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total {boleto.periodLabel}</td>
                <td style={{ fontWeight: 700 }}>{formatLilaMoney(boleto.total)}</td>
              </tr>
            </tbody>
          </table>
          <h4>Conceptos a pagar</h4>
          <table className="admin-table">
            <thead>
              <tr><th>Fecha</th><th>Entrada</th><th>Monto</th><th>Cancelado</th></tr>
            </thead>
            <tbody>
              {boleto.lines.map((l) => (
                <tr key={`c-${l.id}`}>
                  <td>{String(l.date).slice(5).replace('-', '/')}</td>
                  <td>{l.description}</td>
                  <td>{formatLilaMoney(l.amount)}</td>
                  <td>{formatLilaMoney(l.cancelled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><strong>Total a pagar:</strong> {formatLilaMoney(boleto.totalToPay)}</p>
          <p>1° vencimiento: {formatLilaMoney(boleto.dueAmount1)} hasta {boleto.dueDate1}</p>
          <p>2° vencimiento: {formatLilaMoney(boleto.dueAmount2)} hasta {boleto.dueDate2}</p>
          {boleto.surchargeNote ? <p className="disc-field-hint">{boleto.surchargeNote}</p> : null}
        </section>
      </div>
    );
  }

  if (view === 'payment' && selectedEntry) {
    const alloc = selectedEntry.allocations || [];
    const methods = selectedEntry.paymentMethods || [];
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView('summary')}>
            <ArrowLeft size={14} /> Volver
          </button>
        </div>
        <h3 className="cuotas-title">
          Pago #{selectedEntry.accessinId || selectedEntry.id} — Socio — {selectedEntry.memberNumber} — {formatSpanishLongDate(selectedEntry.date)}
        </h3>
        <section className="supplier-pay-import-block">
          <h4>Información del pago</h4>
          <p><strong>Fecha:</strong> {formatSpanishLongDate(selectedEntry.date)}</p>
          <p><strong>Descripción:</strong> {selectedEntry.description || '—'}</p>
          <h4>Entradas imputadas</h4>
          <table className="admin-table">
            <thead>
              <tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Monto</th><th>Cancelado</th></tr>
            </thead>
            <tbody>
              {alloc.length === 0 ? (
                <tr><td colSpan={5} style={{ color: 'var(--text-muted)' }}>Sin detalle de imputación.</td></tr>
              ) : alloc.map((a, i) => (
                <tr key={i}>
                  <td>{String(a.date || '').slice(5).replace('-', '/')}</td>
                  <td>{a.type}</td>
                  <td>{a.description}</td>
                  <td>{formatLilaMoney(a.amount)}</td>
                  <td>{formatLilaMoney(a.cancelled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><strong>Total pago:</strong> {formatLilaMoney(Math.abs(selectedEntry.value))}</p>
          <h4>Formas de pago</h4>
          {methods.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>—</p> : methods.map((m, i) => (
            <p key={i}>{m.method} {m.reference ? `# ${m.reference}` : ''} — {formatLilaMoney(m.amount)}</p>
          ))}
          <div className="ig-form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setView('summary')}>Volver</button>
            <button
              type="button"
              className="btn disc-bulk-btn"
              disabled={Boolean(exportBusy)}
              onClick={async () => {
                setExportBusy('payment-pdf');
                setError('');
                try {
                  await exportAccountPaymentPdf(selectedEntry, {
                    memberName: selectedMember?.name || '',
                  });
                } catch (err) {
                  setError(err?.message || 'No se pudo generar el PDF.');
                } finally {
                  setExportBusy('');
                }
              }}
            >
              <FileDown size={14} /> {exportBusy === 'payment-pdf' ? 'Generando…' : 'Descargar PDF'}
            </button>
            <button type="button" className="btn btn-tan"><Share2 size={14} /> Compartir</button>
          </div>
        </section>
      </div>
    );
  }

  if (view === 'summary' && selectedMember && meta) {
    const title = summaryMode === 'family' && meta.familyGroupName
      ? `Resumen de cuenta: ${meta.familyGroupName}`
      : summaryMode === 'support'
        ? `Resumen de soporte — ${meta.memberNumber}`
        : `Resumen de cuenta socio — ${meta.memberNumber}`;
    const cols = summaryMode === 'family' ? 7 : 6;
    const debt = lookupMonthlyDebt(meta.memberNumber);
    const familyOfficial = familyBalanceForMember(selectedMember, members);

    return (
      <div className="fade-in cuotas-panel">
        <nav className="cuotas-toolbar cuotas-toolbar--local" aria-label="Resumen de cuenta">
          <button type="button" className="cuotas-back" onClick={() => setView('list')}>
            <ArrowLeft size={15} aria-hidden="true" />
            Volver
          </button>
          <div className="cuotas-actions">
            <CuotasTool
              icon={Plus}
              label="Entradas"
              hint="Cargar un movimiento"
              tone="emerald"
              onClick={() => openEntry(selectedMember)}
            />
            <CuotasTool
              icon={Lock}
              label="Boleto de pago"
              hint="Imprimir liquidación"
              tone="emerald"
              onClick={openBoleto}
            />
          </div>
        </nav>

        <h3 className="cuotas-title">{title}</h3>
        {summaryMode === 'family' ? (
          <>
            <p><strong>Socio responsable:</strong> {meta.responsibleName}</p>
            <p><strong>Socios adherentes:</strong> {meta.adherentNames.join(', ') || '—'}</p>
            {familyOfficial.source === 'accessin' ? (
              <section className="supplier-pay-import-block" style={{ marginBottom: '1rem' }}>
                <h4 style={{ marginTop: 0 }}>Saldo de grupo familiar (LILA)</h4>
                <p style={{ marginTop: 0 }}>
                  Total {formatLilaMoney(familyOfficial.amount, { signed: true })}
                  {familyOfficial.label ? ` · ${familyOfficial.label}` : ''}
                </p>
                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr><th>Período</th><th>Capital</th></tr>
                    </thead>
                    <tbody>
                      {(familyOfficial.months || []).map((row) => (
                        <tr key={row.periodKey || row.periodLabel}>
                          <td>{row.periodLabel}</td>
                          <td style={{ fontWeight: 700, color: row.capital < 0 ? 'var(--danger-accent)' : 'var(--emerald-accent)' }}>
                            {formatLilaMoney(row.capital, { signed: true })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <>
            <p><strong>Apellido y nombre:</strong> {meta.memberName}</p>
            <p><strong>Cuotas:</strong> {meta.tierLabel}</p>
            <p><strong>Grupo familiar:</strong> {meta.familyGroupName || '—'}</p>
          </>
        )}

        {debt && Number(debt.totalDebt) > 0 ? (
          <section className="supplier-pay-import-block" style={{ marginBottom: '1rem' }}>
            <h4 style={{ marginTop: 0 }}>Deuda mes a mes (morosos LILA)</h4>
            <p style={{ marginTop: 0 }}>
              Total {formatLilaMoney(debt.totalDebt)} · {(debt.months || []).length} períodos
            </p>
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr><th>Período</th><th>Capital</th><th>Acumulada</th></tr>
                </thead>
                <tbody>
                  {(debt.months || []).slice(-6).map((row) => (
                    <tr key={row.periodKey}>
                      <td>{row.periodLabel}</td>
                      <td style={{ color: 'var(--emerald-accent)', fontWeight: 700 }}>{formatLilaMoney(row.capital)}</td>
                      <td>{formatLilaMoney(row.accumulated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                {summaryMode === 'family' ? <th>Socio</th> : null}
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Descripción</th>
                {summaryMode === 'support' ? <th>Pendiente</th> : null}
                <th>Valor</th>
                {summaryMode === 'support' ? null : <th>Funciones</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={cols}>
                  <button
                    type="button"
                    className="cuotas-tool tone-gold cuotas-tool--wide"
                    onClick={() => setMonthsBack((n) => n + 3)}
                  >
                    <i className="cuotas-tool-icon" aria-hidden="true">
                      <Plus size={17} strokeWidth={2.15} />
                    </i>
                    <span className="cuotas-tool-copy">
                      <strong>Cargar 3 meses anteriores</strong>
                      <small>Ya hay {monthsBack} meses</small>
                    </span>
                  </button>
                </td>
              </tr>
              {(ledgerLoading || (summaryMode === 'support' && supportLoading)) ? (
                <tr>
                  <td colSpan={cols} style={{ color: 'var(--text-muted)' }}>
                    El resumen de la app está abajo. El extracto completo sigue cargando.
                  </td>
                </tr>
              ) : null}
              {!(summaryMode === 'support' && supportLoading) && monthGroups.length === 0 ? (
                <tr>
                  <td colSpan={cols} style={{ color: 'var(--text-muted)' }}>
                    {summaryMode === 'support' && support.status === 'ready' && !support.account
                      ? 'El soporte de esta cuenta todavía no está cargado.'
                      : 'Sin movimientos en el período.'}
                  </td>
                </tr>
              ) : null}
              {!(summaryMode === 'support' && supportLoading) && monthGroups.map((g) => (
                <Fragment key={g.key}>
                  <tr>
                    <td colSpan={cols} className="member-balances-month-head">
                      {g.openingLabel}: {formatLilaMoney(
                        summaryMode === 'support'
                          ? (support.account?.month_balances || []).find((saldo) => String(saldo.on || '').startsWith(g.key))?.amount ?? g.openingBalance
                          : g.openingBalance
                      )}
                    </td>
                  </tr>
                  {g.entries.length === 0 ? (
                    <tr>
                      <td colSpan={cols} style={{ color: 'var(--text-muted)' }}>
                        Sin movimientos en {g.title}.
                      </td>
                    </tr>
                  ) : null}
                  {g.entries.map((row) => (
                    <Fragment key={row.id}>
                      <tr>
                        <td>{row.accessinId || row.id.slice(-6)}</td>
                        {summaryMode === 'family' ? (
                          <td>{row.memberNumber} — {row.memberName || selectedMember.name}</td>
                        ) : null}
                        <td>{row.date}</td>
                        <td>{row.typeLabel || row.type}</td>
                        <td>{row.description || '—'}</td>
                        {summaryMode === 'support' ? (
                          <td>{formatLilaMoney(row.pending)}</td>
                        ) : null}
                        <td style={{
                          fontWeight: 700,
                          color: row.value < 0 ? 'var(--danger-accent)' : 'var(--emerald-accent)',
                        }}
                        >
                          {formatLilaMoney(row.value, { signed: true })}
                        </td>
                        {summaryMode === 'support' ? null : (
                          <td>
                            <div className="cash-lila-row-actions">
                              {row.type === 'pago' ? (
                                <button type="button" className="cash-lila-icon-btn is-edit" title="Ver pago" onClick={() => openPayment(row)}>
                                  <Eye size={13} />
                                </button>
                              ) : null}
                              {row.source === 'manual' ? (
                                <button
                                  type="button"
                                  className="cash-lila-icon-btn is-del"
                                  title="Eliminar"
                                  onClick={() => {
                                    if (window.confirm('¿Eliminar esta entrada?')) onDeleteEntry?.(row.id);
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        )}
                      </tr>
                      {summaryMode === 'support' ? (row.links || []).map((link) => (
                        <tr key={`${row.id}-${link.kind}-${link.lineId}`}>
                          <td />
                          <td>{link.date}</td>
                          <td colSpan={2} style={{ color: 'var(--text-muted)' }}>
                            {link.kind === 'entrada' ? 'Entrada pagada' : 'Pago vinculado'}
                            {link.lineId ? ` · ${link.lineId}` : ''}
                            {link.label ? ` · ${link.label}` : ''}
                          </td>
                          <td />
                          <td>{formatLilaMoney(link.amount, { signed: true })}</td>
                        </tr>
                      )) : null}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
              {summaryMode === 'member' ? (
                <tr>
                  <td colSpan={cols} className="member-balances-month-head">
                    Saldo: {formatLilaMoney(currentAccountBalanceOf(selectedMember))}
                  </td>
                </tr>
              ) : null}
              {((ledgerReady && summaryMode === 'family') || (supportReady && summaryMode === 'support')) && monthGroups.length > 0 ? (
                <tr>
                  <td colSpan={cols} className="member-balances-month-head">
                    Saldo al {formatSpanishLongDate((summaryMode === 'support' ? support.account : ledger.account).closing_on)}: {formatLilaMoney(
                      summaryMode === 'support'
                        ? support.account.closing_balance
                        : monthGroups[monthGroups.length - 1].closingBalance
                    )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // LIST
  return (
    <div className="fade-in cuotas-panel member-balances-panel">
      <CuotasDeskToolbar
        current="balances"
        onBack={onBack}
        onGo={goDesk}
        extraOperate={[{
          id: 'entries',
          icon: Plus,
          label: 'Entradas',
          hint: 'Cargar un movimiento',
          onClick: () => openEntry(),
        }]}
      />

      <section className="supplier-pay-import-block">
        <h4 className="supplier-pay-import-title">Buscar socio</h4>
        <p className="disc-field-hint" style={{ marginTop: 0 }}>
          Nombre, DNI, Nº de socio o grupo familiar
          {' · '}
          Saldos CC LILA al {ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT.asOfLabel || ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF}
          {' · '}
          {ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT.withBalance?.toLocaleString('es-AR')} con saldo
        </p>
        <div className="member-balances-search">
          <div className="members-search-field">
            <Search size={20} aria-hidden className="members-search-icon" />
            <input
              id="member-balances-search"
              type="search"
              className="members-search-input"
              placeholder="Nombre, DNI, Nº de socio o grupo familiar…"
              value={filters.query}
              onChange={(e) => applyFilters({ ...filters, query: e.target.value })}
              autoComplete="off"
            />
          </div>
          <label>
            <span className="form-label">Estado</span>
            <select className="form-input" value={filters.status} onChange={(e) => applyFilters({ ...filters, status: e.target.value })}>
              <option value="all">Todos</option>
              <option value="habilitado">Habilitado</option>
              <option value="inhabilitado">Inhabilitado</option>
            </select>
          </label>
          <label>
            <span className="form-label">Categoría</span>
            <select className="form-input" value={filters.tier} onChange={(e) => applyFilters({ ...filters, tier: e.target.value })}>
              <option value="all">Todas</option>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <div className="disc-pager">
        <span>
          {filtered.length === 0
            ? 'No se encontraron resultados'
            : `Mostrando ${safePage * PAGE_SIZE + 1} - ${Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} de ${filtered.length}`}
        </span>
        {filtered.length > PAGE_SIZE ? (
          <div className="cash-efectivo-pager">
            <button type="button" className="btn btn-secondary btn-sm" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</button>
            <button type="button" className={`cash-efectivo-page-btn${safePage === 0 ? ' is-active' : ''}`} onClick={() => setPage(0)}>1</button>
            {totalPages > 1 ? (
              <button type="button" className={`cash-efectivo-page-btn${safePage === totalPages - 1 ? ' is-active' : ''}`} onClick={() => setPage(totalPages - 1)}>{totalPages}</button>
            ) : null}
            <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Siguiente</button>
          </div>
        ) : null}
      </div>

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Número de socio</th>
              <th>Socio titular</th>
              <th>Balance</th>
              <th>Balance familiar</th>
              <th>Estado</th>
              <th>Funciones</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--text-muted)' }}>Sin socios para este filtro.</td>
              </tr>
            ) : pageRows.map((m) => {
              const fam = familyBalanceForMember(m, members);
              const balance = currentAccountBalanceOf(m);
              return (
                <tr key={m.memberId || m.id}>
                  <td>{m.accessinId || String(m.memberId).slice(-5)}</td>
                  <td>{memberNumberOf(m)}</td>
                  <td style={{ fontWeight: 600 }}>
                    <button type="button" className="member-balances-open" onClick={() => openSummary(m, 'member')}>
                      {m.name}
                    </button>
                  </td>
                  <td style={{ fontWeight: 700, color: balance > 0 ? 'var(--emerald-accent)' : undefined }}>
                    {formatLilaMoney(balance)}
                  </td>
                  <td>
                    {fam.isTitular
                      ? <span style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>{formatLilaMoney(fam.amount)}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>{fam.label}</span>}
                  </td>
                  <td>{memberStatusLabel(m)}</td>
                  <td>
                    <div className="cash-lila-row-actions">
                      <button type="button" className="cash-lila-icon-btn is-edit" title="Resumen de cuenta" aria-label="Resumen de cuenta" onClick={() => openSummary(m, 'member')}>
                        <Eye size={13} />
                      </button>
                      <button type="button" className="cash-lila-icon-btn is-edit" title="Resumen de soporte" aria-label="Resumen de soporte" onClick={() => openSummary(m, 'support')}>
                        <LifeBuoy size={13} />
                      </button>
                      {fam.isTitular ? (
                        <button type="button" className="cash-lila-icon-btn is-edit" title="Resumen grupo familiar" onClick={() => openSummary(m, 'family')}>
                          <FileText size={13} />
                        </button>
                      ) : null}
                      <button type="button" className="cash-lila-icon-btn is-edit" title="Nueva entrada" onClick={() => openEntry(m)}>
                        <Plus size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

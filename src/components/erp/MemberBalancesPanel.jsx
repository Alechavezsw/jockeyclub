import { Fragment, useMemo, useState } from 'react';
import {
  ArrowLeft, Eye, FileText, Lock, Plus, Printer, Search, Share2, Trash2, Wallet,
} from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { getActiveTiers } from '../../domain/members/tiers';
import { memberNumberOf, resolveFamilyForDisplay } from '../../domain/members/households';
import {
  ACCOUNT_ENTRY_TYPES,
  accountSummaryMeta,
  buildAccessinAccountEntries,
  buildPaymentBoleto,
  applyAccountEntryToMember,
  createAccountEntry,
  familyBalanceForMember,
  filterMembersForBalances,
  formatSpanishLongDate,
  groupEntriesByMonth,
  memberStatusLabel,
  mergeAccountEntries,
} from '../../domain/accounting/memberBalances';
import {
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF,
  ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT,
  currentAccountBalanceOf,
} from '../../domain/accounting/currentAccountBalances';
import { lookupMonthlyDebt } from '../../domain/accounting/monthlyDebts';
import { ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT } from '../../domain/accounting/familyGroupBalances';

const PAGE_SIZE = 50;

function formatLilaMoney(n, { signed = false } = {}) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (signed && v < 0) return `$ -${abs}`;
  if (signed && v > 0) return `$ ${abs}`;
  return `$ ${abs}`;
}

const EMPTY_FILTERS = {
  firstName: '',
  lastName: '',
  dni: '',
  memberNumber: '',
  familyId: '',
  status: 'habilitado',
  tier: 'all',
};

export default function MemberBalancesPanel({
  members = [],
  accountEntries = [],
  onUpsertEntry,
  onDeleteEntry,
  onBack,
  onGoImportCollections,
  onGoImportDebts,
  onGoImputeEvents,
  formatCurrency: formatCurrencyProp,
  tierCatalog = [],
}) {
  const fmt = formatCurrencyProp || formatCurrency;
  const tiers = useMemo(() => getActiveTiers(tierCatalog), [tierCatalog]);

  const [view, setView] = useState('list'); // list | summary | payment | boleto | entry
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [monthsBack, setMonthsBack] = useState(3);
  const [summaryMode, setSummaryMode] = useState('member'); // member | family
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
  const [error, setError] = useState('');

  const filtered = useMemo(
    () => filterMembersForBalances(members, applied),
    [members, applied]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const entriesForSelected = useMemo(() => {
    if (!selectedMember) return [];
    if (summaryMode === 'family') {
      const family = resolveFamilyForDisplay(selectedMember, members);
      const nros = new Set([
        memberNumberOf(selectedMember),
        ...(family?.members || []).map((m) => memberNumberOf(m) || String(m.memberId || '').replace(/\D/g, '')),
      ].filter(Boolean));
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
  }, [selectedMember, accountEntries, summaryMode, members]);

  const monthGroups = useMemo(
    () => groupEntriesByMonth(entriesForSelected, { monthsBack }),
    [entriesForSelected, monthsBack]
  );

  const meta = useMemo(
    () => (selectedMember ? accountSummaryMeta(selectedMember, members) : null),
    [selectedMember, members]
  );

  const openSummary = (member, mode = 'member') => {
    setSelectedMember(member);
    setSummaryMode(mode);
    setMonthsBack(3);
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

  const openEntry = (member = null) => {
    setError('');
    setEntryForm({
      type: 'pago',
      target: 'socio',
      memberNumber: member ? memberNumberOf(member) : '',
      memberName: member?.name || '',
      value: '',
      date: new Date().toISOString().slice(0, 10),
      description: '',
    });
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
                <label className="disc-field-label">Socio</label>
                <input
                  className="form-input"
                  list="sal-members"
                  value={entryForm.memberNumber ? `${entryForm.memberNumber}${entryForm.memberName ? ` - ${entryForm.memberName}` : ''}` : ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const nro = raw.split('-')[0].trim().replace(/\D/g, '');
                    const hit = (members || []).find((m) => memberNumberOf(m) === nro);
                    setEntryForm((f) => ({
                      ...f,
                      memberNumber: nro,
                      memberName: hit?.name || raw.split('-').slice(1).join('-').trim(),
                    }));
                  }}
                  placeholder="Nro. o nombre"
                  required
                />
                <datalist id="sal-members">
                  {(members || []).slice(0, 800).map((m) => (
                    <option key={m.memberId} value={`${memberNumberOf(m)} - ${m.name}`} />
                  ))}
                </datalist>
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
                <button type="submit" className="btn cash-lila-purple-btn">Continuar</button>
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
            <button type="button" className="btn disc-bulk-btn" onClick={() => window.print()}>
              <Printer size={14} /> Imprimir
            </button>
          </div>
        </div>
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
            <button type="button" className="btn disc-bulk-btn" onClick={() => window.print()}><Printer size={14} /> Imprimir</button>
            <button type="button" className="btn cash-lila-purple-btn"><Share2 size={14} /> Compartir</button>
          </div>
        </section>
      </div>
    );
  }

  if (view === 'summary' && selectedMember && meta) {
    const title = summaryMode === 'family' && meta.familyGroupName
      ? `Resumen de cuenta: ${meta.familyGroupName}`
      : `Resumen de cuenta socio — ${meta.memberNumber}`;
    const debt = lookupMonthlyDebt(meta.memberNumber);
    const familyOfficial = familyBalanceForMember(selectedMember, members);

    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView('list')}>
            <ArrowLeft size={14} /> Volver
          </button>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn cash-lila-purple-btn" onClick={() => openEntry(selectedMember)}>
              <Plus size={14} /> Entradas
            </button>
            <button type="button" className="btn cash-lila-purple-btn" onClick={openBoleto}>
              <Lock size={14} /> Boleto de pago
            </button>
          </div>
        </div>

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
                <th>Valor</th>
                <th>Funciones</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={summaryMode === 'family' ? 7 : 6}>
                  <button
                    type="button"
                    className="btn cash-lila-purple-btn"
                    style={{ width: '100%' }}
                    onClick={() => setMonthsBack((n) => n + 3)}
                  >
                    Cargar 3 meses anteriores
                  </button>
                </td>
              </tr>
              {monthGroups.length === 0 ? (
                <tr>
                  <td colSpan={summaryMode === 'family' ? 7 : 6} style={{ color: 'var(--text-muted)' }}>
                    Sin movimientos en el período.
                  </td>
                </tr>
              ) : monthGroups.map((g) => (
                <Fragment key={g.key}>
                  <tr>
                    <td colSpan={summaryMode === 'family' ? 7 : 6} style={{ background: 'color-mix(in srgb, var(--lilac-accent, #7c3aed) 12%, transparent)', fontWeight: 700 }}>
                      {g.openingLabel}: {formatLilaMoney(g.openingBalance)}
                    </td>
                  </tr>
                  {g.entries.map((row) => (
                    <tr key={row.id}>
                      <td>{row.accessinId || row.id.slice(-6)}</td>
                      {summaryMode === 'family' ? (
                        <td>{row.memberNumber} — {row.memberName || selectedMember.name}</td>
                      ) : null}
                      <td>{row.date}</td>
                      <td>{row.typeLabel || row.type}</td>
                      <td>{row.description || '—'}</td>
                      <td style={{
                        fontWeight: 700,
                        color: row.value < 0 ? 'var(--danger-accent)' : 'var(--emerald-accent)',
                      }}
                      >
                        {formatLilaMoney(row.value, { signed: true })}
                      </td>
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
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // LIST
  return (
    <div className="fade-in cuotas-panel member-balances-panel">
      <div className="cuotas-toolbar">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {onBack ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
              <ArrowLeft size={14} /> Volver
            </button>
          ) : null}
          <h3 className="cuotas-title" style={{ margin: 0 }}>
            <Wallet size={18} /> Saldos / Socios
          </h3>
        </div>
        <div className="cuotas-actions">
          <button type="button" className="btn cash-lila-mint-btn" onClick={() => onGoImportDebts?.()}>
            Deudas mes a mes
          </button>
          <button type="button" className="btn cash-lila-mint-btn" onClick={() => onGoImportCollections?.()}>
            Importar cobranzas socios
          </button>
          <button type="button" className="btn cash-lila-mint-btn" onClick={() => onGoImputeEvents?.()}>
            Imputar eventos
          </button>
          <button type="button" className="btn cash-lila-mint-btn" onClick={() => openEntry()}>
            <Plus size={14} /> Entradas
          </button>
        </div>
      </div>

      <section className="supplier-pay-import-block">
        <h4 className="supplier-pay-import-title">Buscar por</h4>
        <p className="disc-field-hint" style={{ marginTop: 0 }}>
          Saldos CC LILA al {ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT.asOfLabel || ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF}
          {' · '}
          {ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT.withBalance?.toLocaleString('es-AR')} con saldo
          {' · '}
          total {formatLilaMoney(ACCESSIN_CURRENT_ACCOUNT_BALANCES_SNAPSHOT.totalBalance)}
          {' · '}
          GF {ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT.groupCount?.toLocaleString('es-AR')}
          {' · '}
          {ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT.withBalance?.toLocaleString('es-AR')} con saldo familiar
        </p>
        <div className="cuotas-event-filters">
          <label>
            <span className="form-label">Nombre del socio</span>
            <input className="form-input" value={filters.firstName} onChange={(e) => setFilters((f) => ({ ...f, firstName: e.target.value }))} />
          </label>
          <label>
            <span className="form-label">Apellido del socio</span>
            <input className="form-input" value={filters.lastName} onChange={(e) => setFilters((f) => ({ ...f, lastName: e.target.value }))} />
          </label>
          <label>
            <span className="form-label">DNI del socio</span>
            <input className="form-input" value={filters.dni} onChange={(e) => setFilters((f) => ({ ...f, dni: e.target.value }))} />
          </label>
          <label>
            <span className="form-label">Número de socio</span>
            <input className="form-input" value={filters.memberNumber} onChange={(e) => setFilters((f) => ({ ...f, memberNumber: e.target.value }))} />
          </label>
          <label>
            <span className="form-label">Identificador grupo familiar</span>
            <input className="form-input" value={filters.familyId} onChange={(e) => setFilters((f) => ({ ...f, familyId: e.target.value }))} />
          </label>
          <label>
            <span className="form-label">Estado</span>
            <select className="form-input" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="all">Todos</option>
              <option value="habilitado">Habilitado</option>
              <option value="inhabilitado">Inhabilitado</option>
            </select>
          </label>
          <label>
            <span className="form-label">Categoría de cuota</span>
            <select className="form-input" value={filters.tier} onChange={(e) => setFilters((f) => ({ ...f, tier: e.target.value }))}>
              <option value="all">Todas</option>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              type="button"
              className="btn cash-lila-mint-btn"
              onClick={() => { setApplied(filters); setPage(0); }}
            >
              <Search size={14} /> Buscar
            </button>
          </div>
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
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
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
                      <button type="button" className="cash-lila-icon-btn is-edit" title="Resumen socio" onClick={() => openSummary(m, 'member')}>
                        <Eye size={13} />
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

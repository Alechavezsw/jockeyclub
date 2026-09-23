import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, CalendarRange, Download, Eye, FileDown, FileSpreadsheet, ListTree, Plus, RotateCcw, Search, Ticket, Trash2, Upload, Wallet,
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
  feeAccountDetailsForPeriod,
  feeAccountDetailsSeed,
  feeAccountDetailsSummary,
  filterFeeAccountLines,
} from '../../domain/accounting/feeAccountDetails';
import { requireSnapshots } from '../../data/snapshots';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';
import { exportFeePeriodExcel, exportFeePeriodPdf } from '../../domain/accounting/exportFeePeriodDetails';
import {
  LISTA_BASE_COBRANZAS_FILENAME,
  LISTA_BASE_COBRANZAS_URL,
  MEMBER_COLLECTION_ENTITIES,
  MEMBER_COLLECTION_IMPUTATION_ORDERS,
  MEMBER_COLLECTION_IMPORT_STATUS,
  applyMemberCollectionPayments,
  buildMemberCollectionImport,
  collectionPaymentsToEntries,
  parseCobranzasSociosSheetRows,
} from '../../domain/accounting/memberCollectionImport';
import {
  applyAccountEntryToMember,
  applyEntryToMembers,
  createAccountEntry,
} from '../../domain/accounting/memberBalances';
import { buildEventImputationEntry, reservationChargeAmount } from '../../domain/accounting/eventImputation';
import { getOverdueMembers } from '../../domain/members/dues';
import DuesControlTab from '../admin/DuesControlTab';
import OverdueDuesStrip from '../admin/OverdueDuesStrip';
import FeeChartAccountsPanel from './FeeChartAccountsPanel';
import MemberBalancesPanel from './MemberBalancesPanel';
import MonthlyDebtsPanel from './MonthlyDebtsPanel';
import DetailedCurrentAccountsPanel from './DetailedCurrentAccountsPanel';
import MemberCreditPurchasesPanel from './MemberCreditPurchasesPanel';

const PAGE_SIZE = 25;

const FEE_DETAILS_SNAPSHOTS = ['accessinFeeAccountDetails'];
const NO_SNAPSHOTS = [];

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
  feeChartAccounts = [],
  onUpsertFeeChartAccount,
  onDeleteFeeChartAccount,
  memberAccountEntries = [],
  onUpsertMemberAccountEntry,
  onDeleteMemberAccountEntry,
  reservations = [],
  onImputeReservation,
  addJournalEntry,
  formatCurrency: formatCurrencyProp,
  tierCatalog = [],
}) {
  const fmt = formatCurrencyProp || formatCurrency;
  const [view, setView] = useState('hub'); // hub | import_collections | import_debts | impute_events | mora | period_detail | accounts | balances | monthly_debts | detailed_cc | credit_purchases
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
  const [exportBusy, setExportBusy] = useState(null);

  const periods = useMemo(() => feePeriodsForYear(feePeriods, year), [feePeriods, year]);
  const overdueMembers = useMemo(() => getOverdueMembers(members), [members]);

  // El detalle de cuotas (665 kB con DNI) se baja recién al abrir un período.
  const {
    ACCESSIN_FEE_ACCOUNT_DETAILS,
    ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT,
  } = useSnapshotSeed(
    view === 'period_detail' ? FEE_DETAILS_SNAPSHOTS : NO_SNAPSHOTS,
    feeAccountDetailsSeed,
  );
  const periodAccounts = useMemo(
    () => (selectedPeriod ? feeAccountDetailsForPeriod(selectedPeriod, ACCESSIN_FEE_ACCOUNT_DETAILS) : []),
    [selectedPeriod, ACCESSIN_FEE_ACCOUNT_DETAILS]
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
    setSelectedPeriod(period);
    setAccountTab(0);
    setDetailQuery('');
    setDetailPage(0);
    setFlash('');
    setView('period_detail');
  };

  const downloadPeriod = async (period, kind) => {
    if (!period || exportBusy) return;
    setExportBusy({ id: period.id, kind });
    setError('');
    try {
      await requireSnapshots(FEE_DETAILS_SNAPSHOTS);
      const accounts = feeAccountDetailsForPeriod(period);
      if (kind === 'xlsx') await exportFeePeriodExcel(period, accounts);
      else await exportFeePeriodPdf(period, accounts, { formatCurrency: fmt });
    } catch (err) {
      setError(err?.message || 'No se pudo generar el archivo.');
    } finally {
      setExportBusy(null);
    }
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

  const reservationStatusLabel = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'confirmed' || s === 'confirmada') return 'Confirmada';
    if (s === 'approved' || s === 'aprobado' || s === 'aprobada') return 'Aprobada';
    if (s === 'pending' || s === 'pendiente') return 'Pendiente';
    if (s === 'cancelled' || s === 'canceled' || s === 'cancelada') return 'Cancelada';
    return status || 'Aprobada';
  };

  const imputeEvent = (reservation) => {
    setError('');
    setOk('');
    try {
      const entry = buildEventImputationEntry(reservation);
      onUpsertMemberAccountEntry?.(entry);
      if (typeof setMembers === 'function') {
        setMembers((prev) => applyEntryToMembers(prev, entry));
      }
      onImputeReservation?.(reservation);
      setDetailEvent(null);
      setOk(`Imputado ${reservation.memberName || reservation.memberId}: ${fmt(entry.value)}.`);
    } catch (err) {
      setError(err?.message || 'No se pudo imputar el evento.');
    }
  };

  const liquidate = (periodId) => {
    try {
      const result = liquidateFeePeriod(feePeriods, periodId, members);
      onUpsertFeePeriods?.(result.periods);
      const charges = (result.memberUpdates || []).filter((u) => (Number(u.addAmount) || 0) > 0);
      if (charges.length && typeof setMembers === 'function') {
        const chargeDate = result.period.generatedAt || new Date().toISOString().slice(0, 10);
        const byId = new Map(charges.map((u) => [String(u.memberId), u]));
        setMembers((prev) => prev.map((m) => {
          const u = byId.get(String(m.memberId));
          if (!u) return m;
          const entry = createAccountEntry({
            type: 'cuota',
            memberNumber: m.memberId,
            memberName: m.name,
            value: u.addAmount,
            date: chargeDate,
            source: 'fee_liquidation',
            description: periodLabel(result.period),
          });
          onUpsertMemberAccountEntry?.(entry);
          return applyAccountEntryToMember(m, entry);
        }));
      }
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
      collectionPaymentsToEntries(built.payments).forEach((entry) => {
        onUpsertMemberAccountEntry?.(entry);
      });
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

  if (view === 'accounts') {
    return (
      <FeeChartAccountsPanel
        accounts={feeChartAccounts}
        onUpsert={onUpsertFeeChartAccount}
        onDelete={onDeleteFeeChartAccount}
        onBack={() => setView('hub')}
        formatCurrency={fmt}
      />
    );
  }

  if (view === 'balances') {
    return (
      <MemberBalancesPanel
        members={members}
        accountEntries={memberAccountEntries}
        onUpsertEntry={(entry) => {
          onUpsertMemberAccountEntry?.(entry);
          if (typeof setMembers === 'function') {
            setMembers((prev) => applyEntryToMembers(prev, entry));
          }
        }}
        onDeleteEntry={onDeleteMemberAccountEntry}
        onBack={() => setView('hub')}
        onGoImportCollections={() => { setView('import_collections'); setError(''); setOk(''); }}
        onGoImportDebts={() => setView('monthly_debts')}
        onGoImputeEvents={() => setView('impute_events')}
        formatCurrency={fmt}
        tierCatalog={tierCatalog}
      />
    );
  }

  if (view === 'monthly_debts' || view === 'import_debts') {
    return (
      <MonthlyDebtsPanel
        onBack={() => setView('hub')}
        onOpenMemberBalance={() => setView('balances')}
      />
    );
  }

  if (view === 'detailed_cc') {
    return (
      <DetailedCurrentAccountsPanel
        onBack={() => setView('hub')}
        onOpenMemberBalance={() => setView('balances')}
      />
    );
  }

  if (view === 'credit_purchases') {
    return (
      <MemberCreditPurchasesPanel
        members={members}
        onBack={() => setView('hub')}
        onOpenMember={() => setView('balances')}
      />
    );
  }

  if (view === 'period_detail' && selectedPeriod) {
    return (
      <SnapshotGate names={FEE_DETAILS_SNAPSHOTS}>
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
            <div className="cuotas-actions">
              <button
                type="button"
                className="btn btn-tan btn-sm"
                disabled={Boolean(exportBusy)}
                onClick={() => downloadPeriod(selectedPeriod, 'xlsx')}
              >
                <FileSpreadsheet size={14} /> {exportBusy?.kind === 'xlsx' ? 'Generando…' : 'Excel'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={Boolean(exportBusy)}
                onClick={() => downloadPeriod(selectedPeriod, 'pdf')}
              >
                <FileDown size={14} /> {exportBusy?.kind === 'pdf' ? 'Generando…' : 'PDF'}
              </button>
            </div>
          </div>

          <div className="cuotas-cc-banner">
            <span>
              {periodAccountsSummary.accountCount} cuentas · {periodAccountsSummary.lineCount} movimientos · total{' '}
              {fmt(periodAccountsSummary.totalAmount || selectedPeriod.amount)}
              {periodAccounts[0]?.slicedFromExport
                ? ` · cuotas de ${periodLabel(selectedPeriod)} en el export LILA`
                : ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT?.asOf
                  ? ` · export ${ACCESSIN_FEE_ACCOUNT_DETAILS_SNAPSHOT.asOf}`
                  : ''}
            </span>
          </div>

          {periodAccounts.length === 0 ? (
            <p className="disc-field-hint" style={{ margin: 0 }}>
              Este período está liquidado por {fmt(selectedPeriod.amount || 0)}, pero no hay líneas de cuenta para mostrar.
            </p>
          ) : null}

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
      </SnapshotGate>
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
          onAccountEntry={onUpsertMemberAccountEntry}
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
              <a className="btn btn-tan" href={LISTA_BASE_COBRANZAS_URL} download={LISTA_BASE_COBRANZAS_FILENAME}>
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
            <button type="button" className="btn btn-tan" disabled={busy} onClick={processCollections}>
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
            {filteredEvents.length} reservas
            {pendingEvents.length ? ` · ${pendingEvents.length} sin imputar` : ''}
            {' · '}
            Imputar carga el alquiler en la cuenta corriente del socio
          </p>
          {ok ? <p className="ig-ok">{ok}</p> : null}
          {error ? <p className="ig-error">{error}</p> : null}

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
                  filteredEvents.map((r) => {
                    const amount = reservationChargeAmount(r);
                    return (
                      <tr key={r.id || r.accessinId}>
                        <td>{r.accessinId || String(r.id || '—').slice(0, 8)}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.memberName || '—'}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.memberId}</div>
                        </td>
                        <td>{formatLilaDateTime(r.createdAt || r.created_at)}</td>
                        <td>{r.date || r.start || '—'}{r.startTime ? ` ${r.startTime}` : ''}{r.endTime ? ` - ${r.endTime}` : ''}</td>
                        <td>
                          <div>{r.facilityName || r.facilityId || r.space || '—'}</div>
                          <span className="status-badge confirmed">{reservationStatusLabel(r.status)}</span>
                        </td>
                        <td style={{ fontWeight: 700 }}>{amount > 0 ? fmt(amount) : '—'}</td>
                        <td>
                          <div className="cash-lila-row-actions">
                            <button
                              type="button"
                              className="btn btn-tan btn-sm"
                              onClick={() => imputeEvent(r)}
                            >
                              Imputar
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setDetailEvent(r)}
                            >
                              Ver
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {detailEvent ? (
          <div className="modal-overlay" onClick={() => setDetailEvent(null)} role="presentation">
            <div className="modal-card glass-panel cuotas-event-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="cuotas-event-modal-title">
              <div className="modal-header">
                <h3 id="cuotas-event-modal-title">
                  {detailEvent.facilityName || detailEvent.facilityId || detailEvent.space || 'Evento'}
                </h3>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetailEvent(null)} aria-label="Cerrar">×</button>
              </div>
              <div className="modal-body">
                <dl className="cuotas-event-facts">
                  <div>
                    <dt>Socio</dt>
                    <dd>{detailEvent.memberName || '—'}</dd>
                  </div>
                  <div>
                    <dt>Nº socio</dt>
                    <dd>{detailEvent.memberId || '—'}</dd>
                  </div>
                  <div>
                    <dt>Estado</dt>
                    <dd>{reservationStatusLabel(detailEvent.status)}</dd>
                  </div>
                  <div>
                    <dt>Fecha</dt>
                    <dd>{detailEvent.date || detailEvent.start || '—'}</dd>
                  </div>
                  <div>
                    <dt>Invitados</dt>
                    <dd>{detailEvent.guests ?? 0}</dd>
                  </div>
                </dl>
                <div className="cuotas-event-amount">
                  <span>A imputar en cuenta</span>
                  <strong>{fmt(reservationChargeAmount(detailEvent))}</strong>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDetailEvent(null)}>Cerrar</button>
                <button type="button" className="btn btn-emerald" onClick={() => imputeEvent(detailEvent)}>
                  <Wallet size={16} /> Imputar a la cuenta
                </button>
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
      <OverdueDuesStrip
        members={overdueMembers}
        formatCurrency={fmt}
        onOpenAll={() => setView('mora')}
      />
      <div className="cuotas-toolbar">
        <h2 className="cuotas-title">
          <CalendarRange size={18} /> Cuotas
        </h2>
        <div className="cuotas-actions">
          <button type="button" className="btn btn-tan" onClick={() => setView('balances')}>
            <Wallet size={14} /> Saldos / Socios
          </button>
          <button type="button" className="btn btn-tan" onClick={() => setView('detailed_cc')}>
            <ListTree size={14} /> CC detalladas
          </button>
          <button type="button" className="btn btn-tan" onClick={() => setView('credit_purchases')}>
            <Ticket size={14} /> Créditos comprados
          </button>
          <button type="button" className="btn btn-tan" onClick={() => setView('monthly_debts')}>
            <FileSpreadsheet size={14} /> Deudas mes a mes
          </button>
          <button type="button" className="btn btn-tan" onClick={() => setView('accounts')}>
            <BookOpen size={14} /> Cuentas contables
          </button>
          <button type="button" className="btn btn-tan" onClick={() => { setView('import_collections'); setError(''); setOk(''); }}>
            <Upload size={14} /> Importar cobranzas socios
          </button>
          <button type="button" className="btn btn-tan" onClick={() => setView('impute_events')}>
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
          className={`btn btn-sm cuotas-cc-toggle${ccEnabled ? ' btn-secondary' : ' btn-emerald'}`}
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
        <button type="button" className="btn btn-emerald" onClick={applyYear}>
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
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Ver detalle de cuentas"
                            aria-label="Ver detalle de cuentas"
                            onClick={() => openPeriodDetail(p)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Descargar Excel"
                            aria-label="Descargar Excel"
                            disabled={exportBusy?.id === p.id}
                            onClick={() => downloadPeriod(p, 'xlsx')}
                          >
                            <FileSpreadsheet size={14} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Descargar PDF"
                            aria-label="Descargar PDF"
                            disabled={exportBusy?.id === p.id}
                            onClick={() => downloadPeriod(p, 'pdf')}
                          >
                            <FileDown size={14} />
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

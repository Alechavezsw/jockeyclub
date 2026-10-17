import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronDown, Download, Eye, FileDown, FileSpreadsheet, Pencil, Plus, RotateCcw, Trash2, Upload, Wallet,
} from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  applyFeePackEdit,
  feePeriodIsClosed,
  feePeriodsForYear,
  formatPeriodGeneratedAt,
  feePeriodLiquidateBlock,
  liquidateFeePeriod,
  packEditorFromPeriod,
  periodLabel,
  periodStatusLabel,
  resolveFeePeriods,
} from '../../domain/accounting/feeBilling';
import FeePackEditor from './FeePackEditor';
import { feePackForPeriod } from '../../domain/accounting/feePackConcepts';
import DuesDueBanner from '../admin/DuesDueBanner';
import { exportFeePeriodExcel, exportFeePeriodPdf } from '../../domain/accounting/exportFeePeriodDetails';
import { liquidationFromPeriod } from '../../domain/accounting/feePeriodLiquidation';
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
  revertMemberCollectionPayments,
} from '../../domain/accounting/memberCollectionImport';
import {
  applyAccountEntryToMember,
  applyEntryToMembers,
  createAccountEntry,
} from '../../domain/accounting/memberBalances';
import {
  applyEventImputation,
  imputedEventReservations,
  pendingEventReservations,
  reservationChargeAmount,
  reservationStatusBucket,
  revertEventImputation,
} from '../../domain/accounting/eventImputation';
import { getOverdueMembers } from '../../domain/members/dues';
import DuesControlTab from '../admin/DuesControlTab';
import OverdueDuesStrip from '../admin/OverdueDuesStrip';
import FeeChartAccountsPanel from './FeeChartAccountsPanel';
import MemberBalancesPanel from './MemberBalancesPanel';
import MonthlyDebtsPanel from './MonthlyDebtsPanel';
import DetailedCurrentAccountsPanel from './DetailedCurrentAccountsPanel';
import MemberCreditPurchasesPanel from './MemberCreditPurchasesPanel';
import CuotasDeskToolbar from './CuotasDeskToolbar';
import { mergeDuesSettings } from '../../domain/system/clubSettings';

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
  onPersistFeePeriod,
  onApplyBalanceDeltas,
  collectionImports = [],
  onImportCollections,
  onDeleteCollectionImport,
  feeChartAccounts = [],
  onUpsertFeeChartAccount,
  onDeleteFeeChartAccount,
  onPostFeeLedger,
  memberAccountEntries = [],
  onUpsertMemberAccountEntry,
  onDeleteMemberAccountEntry,
  reservations = [],
  onImputeReservation,
  addJournalEntry,
  journalEntries = [],
  chartOfAccounts = [],
  formatCurrency: formatCurrencyProp,
  tierCatalog = [],
  onSendMessage,
  initialView = 'hub',
  balancesOnly = false,
  duesSettings,
  setDuesSettings,
}) {
  const fmt = formatCurrencyProp || formatCurrency;
  const [view, setView] = useState(() => (balancesOnly ? 'balances' : initialView)); // hub | import_collections | import_debts | impute_events | mora | period_detail | accounts | balances | monthly_debts | detailed_cc | credit_purchases
  const [year, setYear] = useState(2026);
  const ccEnabled = duesSettings?.showCurrentAccountsToMembers !== false;
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [editingPeriod, setEditingPeriod] = useState(false);

  const [entity, setEntity] = useState('excel_manual');
  const [forceDate, setForceDate] = useState('');
  const [imputationOrder, setImputationOrder] = useState('chronological');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);

  const [evSocio, setEvSocio] = useState('');
  const [evSpace, setEvSpace] = useState('all');
  const [evStatus, setEvStatus] = useState('all');
  const [evPay, setEvPay] = useState('all');
  const [evList, setEvList] = useState('pending');
  const [detailEvent, setDetailEvent] = useState(null);
  const [exportBusy, setExportBusy] = useState(null);

  const periods = useMemo(
    () => feePeriodsForYear(resolveFeePeriods(feePeriods), year),
    [feePeriods, year],
  );
  const yearOptions = useMemo(() => {
    const set = new Set((feePeriods || []).map((p) => Number(p.year)).filter(Boolean));
    set.add(year);
    set.add(new Date().getFullYear());
    return [...set].toSorted((a, b) => b - a);
  }, [feePeriods, year]);
  const overdueMembers = useMemo(() => getOverdueMembers(members), [members]);
  const goHome = () => {
    setSelectedPeriod(null);
    setEditingPeriod(false);
    setView(balancesOnly ? 'balances' : 'hub');
  };
  const goDesk = (next) => {
    if (balancesOnly && ['import_collections', 'impute_events', 'mora'].includes(next)) return;
    if (next === 'import_collections') {
      setError('');
      setOk('');
    }
    setView(next);
  };

  const periodLiquidation = useMemo(
    () => (selectedPeriod ? liquidationFromPeriod(selectedPeriod, { members, tierCatalog }) : null),
    [selectedPeriod, members, tierCatalog],
  );

  const openPeriodDetail = (period, edit = false) => {
    setSelectedPeriod(period);
    setEditingPeriod(edit && !feePeriodIsClosed(period));
    setFlash('');
    setView('period_detail');
  };

  const savePackEdit = async (draft) => {
    if (!selectedPeriod || feePeriodIsClosed(selectedPeriod)) return;
    setError('');
    setOk('');
    setBusy(true);
    try {
      const next = applyFeePackEdit(selectedPeriod, draft);
      const source = feePeriods?.length ? feePeriods : [selectedPeriod];
      const nextList = source.some((p) => p.id === next.id)
        ? source.map((p) => (p.id === next.id ? next : p))
        : [...source, next];
      onUpsertFeePeriods?.(nextList);
      if (onPersistFeePeriod) await onPersistFeePeriod(next);
      setSelectedPeriod(next);
      setEditingPeriod(false);
      setOk('Cambios guardados. No se imputó una cuota a los socios.');
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la liquidación.');
    } finally {
      setBusy(false);
    }
  };

  const downloadPeriod = async (period, kind, visibleModel) => {
    if (!period || exportBusy) return;
    setExportBusy({ id: period.id, kind });
    setError('');
    try {
      const model = visibleModel || liquidationFromPeriod(period, { members, tierCatalog });
      if (kind === 'xlsx') await exportFeePeriodExcel(model, null, { formatCurrency: fmt });
      else await exportFeePeriodPdf(model, null, { formatCurrency: fmt });
    } catch (err) {
      setError(err?.message || 'No se pudo generar el archivo.');
    } finally {
      setExportBusy(null);
    }
  };

  const pendingEvents = useMemo(() => pendingEventReservations(reservations), [reservations]);
  const imputedEvents = useMemo(() => imputedEventReservations(reservations), [reservations]);

  const filteredEvents = useMemo(() => {
    let rows = evList === 'imputed' ? imputedEvents : pendingEvents;
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
      rows = rows.filter((r) => reservationStatusBucket(r.status) === evStatus);
    }
    if (evPay !== 'all') {
      rows = rows.filter((r) => {
        const method = String(r.paymentMethod || r.payMethod || '').toLowerCase();
        if (evPay === 'none') return !method;
        return method === evPay;
      });
    }
    return rows;
  }, [pendingEvents, imputedEvents, evList, evSocio, evSpace, evStatus, evPay]);

  const spaces = useMemo(() => {
    const set = new Set();
    [...pendingEvents, ...imputedEvents].forEach((r) => {
      const s = r.facilityName || r.facilityId || r.space;
      if (s) set.add(String(s));
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [pendingEvents, imputedEvents]);

  const reservationStatusLabel = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'confirmed' || s === 'confirmada') return 'Confirmada';
    if (s === 'approved' || s === 'aprobado' || s === 'aprobada') return 'Aprobada';
    if (s === 'pending' || s === 'pendiente') return 'Pendiente';
    if (s === 'cancelled' || s === 'canceled' || s === 'cancelada') return 'Cancelada';
    return status || 'Aprobada';
  };

  const imputeEvent = async (reservation) => {
    setError('');
    setOk('');
    setBusy(true);
    try {
      const result = applyEventImputation(reservation, members);
      if (typeof setMembers === 'function') {
        setMembers((prev) => prev.map((row) => (
          row.memberId === result.member.memberId ? result.member : row
        )));
      }
      onUpsertMemberAccountEntry?.(result.entry);
      if (typeof addJournalEntry === 'function') {
        await addJournalEntry(result.journal);
      }
      await onImputeReservation?.(result.reservation);
      setDetailEvent(null);
      setOk(`Imputado ${result.member.name || reservation.memberName}: ${fmt(result.amount)}. Queda en la cuenta y no se vuelve a cargar al recargar.`);
    } catch (err) {
      setError(err?.message || 'No se pudo imputar el evento.');
    } finally {
      setBusy(false);
    }
  };

  const revertEvent = async (reservation) => {
    setError('');
    setOk('');
    if (!window.confirm('¿Revertir esta imputación? Se baja el alquiler del saldo del socio.')) return;
    setBusy(true);
    try {
      const result = revertEventImputation(reservation, members);
      if (result.member && typeof setMembers === 'function') {
        setMembers((prev) => prev.map((row) => (
          row.memberId === result.member.memberId ? result.member : row
        )));
      }
      if (result.entryId) onDeleteMemberAccountEntry?.(result.entryId);
      await onImputeReservation?.(result.reservation);
      setDetailEvent(null);
      setOk(`Revertido ${fmt(result.amount)}.`);
    } catch (err) {
      setError(err?.message || 'No se pudo revertir la imputación.');
    } finally {
      setBusy(false);
    }
  };

  const liquidate = async (periodId) => {
    try {
      const result = liquidateFeePeriod(feePeriods, periodId, members);
      const open = (feePeriods || []).find((p) => p.id === periodId);
      const model = liquidationFromPeriod(open, { members, tierCatalog });
      const closed = {
        ...result.period,
        amount: model.total,
        lines: model.rows,
      };
      result.period = closed;
      result.periods = result.periods.map((p) => (p.id === periodId ? closed : p));
      if (onPersistFeePeriod) await onPersistFeePeriod(result.period);
      onUpsertFeePeriods?.(result.periods);
      const charges = (result.memberUpdates || []).filter((u) => (Number(u.addAmount) || 0) > 0);
      if (charges.length && onApplyBalanceDeltas) {
        await onApplyBalanceDeltas(charges.map((u) => ({
          memberId: u.memberId,
          amount: u.addAmount,
        })));
      }
      if (charges.length && onPostFeeLedger) {
        await onPostFeeLedger({ charges, period: result.period, members });
      }
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
      setSelectedPeriod(null);
      goHome();
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
      let appliedResult = { members, applied: [], ledgerEntries: [], fullyPaidCount: 0, creditCount: 0 };
      if (typeof setMembers === 'function') {
        setMembers((prev) => {
          appliedResult = applyMemberCollectionPayments(prev, built.payments);
          return appliedResult.members;
        });
      } else {
        appliedResult = applyMemberCollectionPayments(members, built.payments);
      }
      const batch = {
        ...built.batch,
        applied: appliedResult.applied,
        fullyPaidCount: appliedResult.fullyPaidCount,
        creditCount: appliedResult.creditCount,
      };
      if (typeof onImportCollections === 'function') {
        await onImportCollections({ ...built, batch });
      }
      collectionPaymentsToEntries(built.payments, appliedResult.ledgerEntries).forEach((entry) => {
        onUpsertMemberAccountEntry?.(entry);
      });
      if (typeof addJournalEntry === 'function' && built.batch.totalAmount > 0) {
        await addJournalEntry({
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
        + (appliedResult.fullyPaidCount ? ` · ${appliedResult.fullyPaidCount} socio(s) al día` : '')
        + (appliedResult.creditCount ? ` · ${appliedResult.creditCount} con crédito a favor` : '')
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
        members={members}
        onUpsert={onUpsertFeeChartAccount}
        onDelete={onDeleteFeeChartAccount}
        onBack={() => goHome()}
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
        onBack={balancesOnly ? undefined : goHome}
        consultOnly={balancesOnly}
        onGoView={goDesk}
        formatCurrency={fmt}
        tierCatalog={tierCatalog}
      />
    );
  }

  if (view === 'monthly_debts' || view === 'import_debts') {
    return (
      <MonthlyDebtsPanel
        members={members}
        accountEntries={memberAccountEntries}
        onBack={() => goHome()}
        onOpenMemberBalance={() => setView('balances')}
      />
    );
  }

  if (view === 'detailed_cc') {
    return (
      <DetailedCurrentAccountsPanel
        onBack={() => goHome()}
        onOpenMemberBalance={() => setView('balances')}
      />
    );
  }

  if (view === 'credit_purchases') {
    return (
      <MemberCreditPurchasesPanel
        members={members}
        onBack={() => goHome()}
        onOpenMember={() => setView('balances')}
      />
    );
  }

  if (view === 'period_detail' && selectedPeriod) {
    const liquidation = periodLiquidation || liquidationFromPeriod(selectedPeriod, { members, tierCatalog });
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar cuotas-toolbar--local">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { goHome(); setSelectedPeriod(null); setEditingPeriod(false); }}
          >
            <ArrowLeft size={14} /> Volver
          </button>
          <h3 className="cuotas-title" style={{ margin: 0 }}>
            {liquidation.title}
          </h3>
          <div className="cuotas-liq-actions">
            {!feePeriodIsClosed(selectedPeriod) && !editingPeriod ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditingPeriod(true)}
                >
                  <Pencil size={14} /> Editar
                </button>
                <button
                  type="button"
                  className="btn btn-emerald btn-sm"
                  onClick={() => liquidate(selectedPeriod.id)}
                >
                  <Plus size={14} /> Liquidar
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="btn btn-tan btn-sm"
              disabled={Boolean(exportBusy)}
              onClick={() => downloadPeriod(selectedPeriod, 'xlsx', liquidation)}
            >
              <FileSpreadsheet size={14} /> {exportBusy?.kind === 'xlsx' ? 'Generando…' : 'Excel'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={Boolean(exportBusy)}
              onClick={() => downloadPeriod(selectedPeriod, 'pdf', liquidation)}
            >
              <FileDown size={14} /> {exportBusy?.kind === 'pdf' ? 'Generando…' : 'PDF'}
            </button>
          </div>
        </div>

        {error ? <p className="ig-error">{error}</p> : null}
        {ok ? <p className="ig-ok">{ok}</p> : null}

        {editingPeriod && !feePeriodIsClosed(selectedPeriod) ? (
          <FeePackEditor
            key={selectedPeriod.id}
            period={selectedPeriod}
            draft={packEditorFromPeriod(
              selectedPeriod,
              feePackForPeriod(selectedPeriod) ? liquidation : null,
            )}
            formatCurrency={fmt}
            busy={busy}
            onSave={savePackEdit}
            onCancel={() => setEditingPeriod(false)}
          />
        ) : (
        <>
        <div className="cuotas-cc-banner">
          <span>Detalle de gastos · total {fmt(liquidation.total)}</span>
        </div>

        <div className="table-responsive">
          <table className="admin-table cuotas-liq-table">
            <thead>
              <tr>
                <th>#</th>
                <th>IDENTIFICADOR</th>
                <th>SOCIOS TITULARES ACTIVOS</th>
                <th>VALOR</th>
                <th>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {liquidation.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                    Este período no tiene el detalle de liquidación de Lila.
                  </td>
                </tr>
              ) : (
                liquidation.rows.map((row) => (
                  <tr key={`${row.identifier}-${row.name}`}>
                    <td>{row.identifier || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td className="num">{row.holders}</td>
                    <td className="num">{fmt(row.unit)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmt(row.total)}</td>
                  </tr>
                ))
              )}
              {liquidation.rows.length > 0 ? (
                <tr>
                  <td colSpan={4} style={{ fontWeight: 700 }}>TOTAL</td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmt(liquidation.total)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {liquidation.surcharges?.length ? (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Categorías de cuotas</th>
                  <th>Recargo</th>
                </tr>
              </thead>
              <tbody>
                {liquidation.surcharges.map((row) => (
                  <tr key={`${row.date}-${row.category}-${row.rate}`}>
                    <td>{row.date}</td>
                    <td>{row.category}</td>
                    <td>{row.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        </>
        )}
      </div>
    );
  }

  if (view === 'mora') {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => goHome()}>
            <ArrowLeft size={14} /> Volver a cuotas
          </button>
        </div>
        <DuesControlTab
          members={members}
          setMembers={setMembers}
          addJournalEntry={addJournalEntry}
          onAccountEntry={onUpsertMemberAccountEntry}
          onSendMessage={onSendMessage}
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
              <p className="disc-field-hint">
                Excel de transferencias, débitos o cobros. Cada fila es un pago de cuota viva (día 10 / mora).
              </p>
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
                Si está vacía, se usa la fecha de cada fila. Si la completás, todos los pagos se imputan ese día
                (vence el 10; recargo desde el 11).
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
              <p className="disc-field-hint">
                Si un socio trae varios renglones, se aplican en ese orden. Cada pago baja el saldo y, si cancela,
                pasa el vencimiento al próximo día 10. El excedente queda como crédito o anticipo.
              </p>
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
            <button type="button" className="btn btn-secondary" onClick={() => { goHome(); setError(''); setOk(''); }}>
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
                          {batch.status === 'deleted' ? null : (
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-del"
                            title="Revertir e eliminar"
                            onClick={() => {
                              const canRevert = Array.isArray(batch.applied) && batch.applied.length > 0;
                              const okDelete = window.confirm(
                                canRevert
                                  ? '¿Revertir esta importación? Se restauran saldo, vencimiento y mora de esos socios.'
                                  : '¿Marcar esta importación como eliminada? Los saldos no se revierten (lote anterior).',
                              );
                              if (!okDelete) return;
                              if (canRevert && typeof setMembers === 'function') {
                                setMembers((prev) => revertMemberCollectionPayments(prev, batch.applied));
                              }
                              (batch.applied || []).forEach((row) => {
                                if (row.paymentId) onDeleteMemberAccountEntry?.(row.paymentId);
                              });
                              onDeleteCollectionImport?.(batch.id);
                            }}
                          >
                            <Trash2 size={13} />
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
        </section>
      </div>
    );
  }

  if (view === 'impute_events') {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => goHome()}>
            <ArrowLeft size={14} /> Volver
          </button>
          <h3 className="cuotas-title" style={{ margin: 0 }}>Imputar eventos</h3>
        </div>

        <section className="supplier-pay-import-block">
          <div className="cuotas-event-filters">
            <label>
              <span className="form-label">Lista</span>
              <select className="form-input" value={evList} onChange={(e) => setEvList(e.target.value)}>
                <option value="pending">Pendientes</option>
                <option value="imputed">Ya imputadas</option>
              </select>
            </label>
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
                <option value="confirmed">Confirmada</option>
                <option value="pending">Pendiente</option>
              </select>
            </label>
            <label>
              <span className="form-label">Forma de pago</span>
              <select className="form-input" value={evPay} onChange={(e) => setEvPay(e.target.value)}>
                <option value="all">Todas</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="none">Sin dato</option>
              </select>
            </label>
          </div>

          <p className="disc-field-hint">
            {filteredEvents.length} reservas
            {` · ${pendingEvents.length} sin imputar`}
            {imputedEvents.length ? ` · ${imputedEvents.length} imputadas` : ''}
            {' · '}
            Imputar carga el alquiler (precio de la reserva) en la cuenta del socio y lo deja guardado.
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
                      {evList === 'imputed'
                        ? 'No hay alquileres imputados en esta lista.'
                        : 'No hay reservas de salón/espacio pendientes de imputar.'}
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((r) => {
                    const amount = reservationChargeAmount(r, undefined, { includeCharged: evList === 'imputed' });
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
                            {evList === 'imputed' ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busy}
                              onClick={() => revertEvent(r)}
                            >
                              Revertir
                            </button>
                            ) : (
                            <button
                              type="button"
                              className="btn btn-tan btn-sm"
                              disabled={busy}
                              onClick={() => imputeEvent(r)}
                            >
                              {busy ? 'Imputando…' : 'Imputar'}
                            </button>
                            )}
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
                {evList === 'imputed' ? (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => revertEvent(detailEvent)}>
                  Revertir imputación
                </button>
                ) : (
                <button type="button" className="btn btn-emerald" disabled={busy} onClick={() => imputeEvent(detailEvent)}>
                  <Wallet size={16} /> Imputar a la cuenta
                </button>
                )}
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
      <DuesDueBanner
        members={members}
        journalEntries={journalEntries}
        chartOfAccounts={chartOfAccounts}
        feePeriods={feePeriods}
        tierCatalog={tierCatalog}
        afterCollect={<CuotasDeskToolbar onGo={goDesk} />}
      />
      <OverdueDuesStrip
        members={overdueMembers}
        formatCurrency={fmt}
        onOpenAll={() => setView('mora')}
      />

      {flash ? <p className="ig-ok">{flash}</p> : null}
      {error ? <p className="ig-error">{error}</p> : null}

      <details className="cuotas-year">
        <summary className="cuotas-year-summary">
          <i className="due-fold-arrow" aria-hidden="true">
            <ChevronDown size={18} strokeWidth={2.5} />
          </i>
          <span>Cuotas de {year}</span>
          <b className="tabular-nums">{periods.length}</b>
        </summary>
        <div className="cuotas-year-body">
          <label className="cuotas-year-pick" htmlFor="cuotas-year">
            <span>Año</span>
            <select
              id="cuotas-year"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
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
              periods.map((p) => {
                const liquidateBlock = feePeriodLiquidateBlock(p);
                return (
                <tr key={p.id}>
                  <td>{p.accessinId || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{periodLabel(p)}</td>
                  <td className="tabular-nums">
                    {p.status === 'processed' || p.status === 'draft'
                      ? fmt(liquidationFromPeriod(p, { members, tierCatalog }).total)
                      : 'Cuotas no liquidados'}
                  </td>
                  <td>{p.status === 'draft' ? 'No liquidado' : formatPeriodGeneratedAt(p.generatedAt)}</td>
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
                            title="Ver liquidación"
                            aria-label="Ver liquidación"
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
                      ) : p.status === 'draft' ? (
                        <>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Ver liquidación"
                            aria-label="Ver liquidación"
                            onClick={() => openPeriodDetail(p)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Editar"
                            aria-label="Editar liquidación"
                            onClick={() => openPeriodDetail(p, true)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title={liquidateBlock || 'Liquidar período'}
                            aria-label="Liquidar período"
                            disabled={Boolean(liquidateBlock)}
                            onClick={() => liquidate(p.id)}
                          >
                            <Plus size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Ver liquidación"
                            aria-label="Ver liquidación"
                            onClick={() => openPeriodDetail(p)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Editar"
                            aria-label="Editar liquidación"
                            onClick={() => openPeriodDetail(p, true)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title={liquidateBlock || 'Liquidar período'}
                            aria-label="Liquidar período"
                            disabled={Boolean(liquidateBlock)}
                            onClick={() => liquidate(p.id)}
                          >
                            <Plus size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
          </div>
        </div>
      </details>

      <div className={`cuotas-cc-banner${ccEnabled ? '' : ' is-off'}`}>
        <span>
          {ccEnabled
            ? 'Todos los socios pueden ver sus cuentas corrientes'
            : 'Las cuentas corrientes están desactivadas para los socios'}
        </span>
        <button
          type="button"
          className={`btn btn-sm cuotas-cc-toggle${ccEnabled ? ' btn-secondary' : ' btn-emerald'}`}
          disabled={typeof setDuesSettings !== 'function'}
          onClick={() => setDuesSettings?.((prev) => ({
            ...mergeDuesSettings(prev),
            showCurrentAccountsToMembers: !ccEnabled,
          }))}
        >
          {ccEnabled ? 'Desactivar cuentas corrientes' : 'Activar cuentas corrientes'}
        </button>
      </div>
    </div>
  );
}

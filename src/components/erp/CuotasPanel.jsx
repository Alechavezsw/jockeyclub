import { loadXlsx } from '../../lib/office.js';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronDown, Download, Eye, FileDown, FileSpreadsheet, History, Loader2, Pencil, Play, RotateCcw, Sparkles, Trash2, Upload, Wallet, X,
} from 'lucide-react';
import ModalDialog from '../ModalDialog';
import { useAuth } from '../../context/AuthContext';
import { canEditFeePackAmounts, canReopenFeePeriod } from '../../domain/auth/roles';
import { notaAjusteCuota, revertDuesPayment, sendImportReceiptsBatch } from '../../data/repos';
import { isSupabaseConfigured } from '../../lib/supabase';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  applyFeePackEdit,
  appOwnsFeePeriod,
  feePeriodActionHistory,
  feePeriodIsClosed,
  feePeriodsForYear,
  formatPeriodGeneratedAt,
  feePeriodLiquidateBlock,
  feePeriodPrepareBlock,
  liquidateFeePeriod,
  packEditorFromPeriod,
  periodLabel,
  periodStatusLabel,
  prepareFeePeriodDraft,
  resolveFeePeriods,
} from '../../domain/accounting/feeBilling';
import { todayISODateAR, todayAR } from '../../lib/arDate';
import { persistImportedCollectionPayments } from '../../domain/members/memberPayments';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';
import { money } from '../../domain/money';
import FeePackEditor from './FeePackEditor';
import DuesDueBanner from '../admin/DuesDueBanner';
import CollectDuesDeskFlow from '../admin/CollectDuesDeskFlow';
import { exportFeePeriodExcel, exportFeePeriodPdf } from '../../domain/accounting/exportFeePeriodDetails';
import { liquidationFromPeriod, periodDisplayTotal } from '../../domain/accounting/feePeriodLiquidation';
import {
  LISTA_BASE_COBRANZAS_FILENAME,
  LISTA_BASE_COBRANZAS_URL,
  LILA_COBRANZAS_DEFAULT_KINDS,
  MEMBER_COLLECTION_ENTITIES,
  MEMBER_COLLECTION_IMPUTATION_ORDERS,
  MEMBER_COLLECTION_IMPORT_STATUS,
  applyMemberCollectionPayments,
  buildMemberCollectionImport,
  collectionPaymentsToEntries,
  detectCobranzasSheetFormat,
  parseCobranzasSociosSheetRows,
  parseLilaCobranzasSheetRows,
  revertMemberCollectionPayments,
} from '../../domain/accounting/memberCollectionImport';
import {
  applyEntryToMembers,
} from '../../domain/accounting/memberBalances';
import {
  applyEventImputation,
  imputedEventReservations,
  pendingEventReservations,
  reservationChargeAmount,
  reservationStatusBucket,
  revertEventImputation,
} from '../../domain/accounting/eventImputation';
import { countOverdueMembers, getOverdueMembers } from '../../domain/members/dues';
import DuesControlTab from '../admin/DuesControlTab';
import OverdueDuesStrip from '../admin/OverdueDuesStrip';
import FeeChartAccountsPanel from './FeeChartAccountsPanel';
import MemberBalancesPanel from './MemberBalancesPanel';
import MonthlyDebtsPanel from './MonthlyDebtsPanel';
import DetailedCurrentAccountsPanel from './DetailedCurrentAccountsPanel';
import MemberCreditPurchasesPanel from './MemberCreditPurchasesPanel';
import CuotasDeskToolbar from './CuotasDeskToolbar';
import CuotasIaReviewModal from './CuotasIaReviewModal';
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
  if (status === 'deleted' || status === 'failed' || status === 'cancelled') return 'cancelled';
  if (status === 'pending' || status === 'partial') return 'pending';
  return 'pending';
}

export default function CuotasPanel({
  members = [],
  setMembers,
  feePeriods = [],
  onUpsertFeePeriods,
  onPersistFeePeriod,
  onReopenFeePeriod,
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
  discounts = [],
  onSendMessage,
  initialView = 'hub',
  balancesOnly = false,
  duesSettings,
  paymentPlans = [],
  setDuesSettings,
  membersLoading = false,
}) {
  const { user } = useAuth();
  const roleSource = user?.roles?.length ? user.roles : user?.role;
  const actorName = String(user?.fullName || user?.name || user?.email || '').trim() || 'Usuario';
  const actorMeta = { by: actorName, byId: user?.id || null };
  const editFeeAmounts = canEditFeePackAmounts(roleSource);
  const reopenPeriods = canReopenFeePeriod(roleSource);
  const [notePeriod, setNotePeriod] = useState(null);
  const fmt = formatCurrencyProp || formatCurrency;
  const [view, setView] = useState(() => (balancesOnly ? 'balances' : initialView)); // hub | import_collections | import_debts | impute_events | mora | period_detail | accounts | balances | monthly_debts | detailed_cc | credit_purchases
  const [year, setYear] = useState(2026);
  const ccEnabled = duesSettings?.showCurrentAccountsToMembers !== false;
  const [flash, setFlash] = useState('');
  const [successBanner, setSuccessBanner] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  /** null | 'procesando' | 'revirtiendo' | 'generando' | 'actualizando' */
  const [busyPhase, setBusyPhase] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [iaReviewOpen, setIaReviewOpen] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState(null);

  useEffect(() => {
    if (!successBanner) return undefined;
    const t = window.setTimeout(() => setSuccessBanner(''), 7000);
    return () => window.clearTimeout(t);
  }, [successBanner]);

  const [entity, setEntity] = useState('excel_manual');
  const [forceDate, setForceDate] = useState('');
  const [imputationOrder, setImputationOrder] = useState('chronological');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const [lilaMonth, setLilaMonth] = useState(() => {
    const m = Number(todayAR().slice(5, 7));
    return m >= 1 && m <= 12 ? m : 1;
  });
  const [lilaYear, setLilaYear] = useState(() => {
    const y = Number(todayAR().slice(0, 4));
    return y >= 2020 ? y : new Date().getFullYear();
  });
  const [lilaIncludeVarios, setLilaIncludeVarios] = useState(false);
  const [paidAtReason, setPaidAtReason] = useState('Importación Excel cobranzas (débito/transferencia)');
  const [sendReceipts, setSendReceipts] = useState(true);
  const [detectedFormat, setDetectedFormat] = useState('');
  const [collectOpen, setCollectOpen] = useState(false);

  const [evSocio, setEvSocio] = useState('');
  const [evSpace, setEvSpace] = useState('all');
  const [evStatus, setEvStatus] = useState('all');
  const [evPay, setEvPay] = useState('all');
  const [evList, setEvList] = useState('pending');
  const [detailEvent, setDetailEvent] = useState(null);
  const [exportBusy, setExportBusy] = useState(null);
  const [liquidateConfirmId, setLiquidateConfirmId] = useState(null);
  const [liquidateDraft, setLiquidateDraft] = useState(null);

  const deferredMembers = useDeferredValue(members);
  const membersReady = !membersLoading && (deferredMembers?.length || 0) > 0;
  const discountRules = Array.isArray(discounts) ? discounts : [];
  const liquidationOpts = { members: deferredMembers, tierCatalog, discountRules };
  const actorWithDiscounts = { ...actorMeta, discountRules };

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
  // Lista completa solo en Mora o al abrir el strip; el hub cerrado solo necesita el conteo.
  const [overdueOpen, setOverdueOpen] = useState(false);
  const needOverdueList = membersReady && (view === 'mora' || overdueOpen);
  const overdueMembers = useMemo(
    () => (needOverdueList ? getOverdueMembers(deferredMembers) : []),
    [needOverdueList, deferredMembers],
  );
  const overdueCount = useMemo(() => {
    if (!membersReady) return 0;
    if (needOverdueList) return overdueMembers.length;
    return countOverdueMembers(deferredMembers);
  }, [membersReady, needOverdueList, overdueMembers, deferredMembers]);
  const periodAmounts = useMemo(() => {
    const ctx = membersReady ? { members: deferredMembers, tierCatalog } : {};
    return new Map(
      periods.map((period) => [
        period.id,
        periodDisplayTotal(period, ctx),
      ]),
    );
  }, [periods, membersReady, deferredMembers, tierCatalog]);
  const goHome = () => {
    setSelectedPeriod(null);
    setEditingPeriod(false);
    setView(balancesOnly ? 'balances' : 'hub');
  };
  const goDesk = (next) => {
    if (balancesOnly && ['import_collections', 'impute_events', 'mora', 'collect_dues'].includes(next)) return;
    if (next === 'collect_dues') {
      setCollectOpen(true);
      return;
    }
    if (next === 'import_collections') {
      const day = todayAR();
      const m = Number(day.slice(5, 7));
      const y = Number(day.slice(0, 4));
      if (m >= 1 && m <= 12) setLilaMonth(m);
      if (y >= 2020) setLilaYear(y);
      setError('');
      setOk('');
    }
    setView(next);
  };

  useEffect(() => {
    if (view !== 'import_collections') return;
    const day = todayAR();
    const m = Number(day.slice(5, 7));
    const y = Number(day.slice(0, 4));
    if (m >= 1 && m <= 12) setLilaMonth(m);
    if (y >= 2020) setLilaYear(y);
  }, [view]);

  const periodLiquidation = useMemo(
    () => (selectedPeriod && membersReady
      ? liquidationFromPeriod(selectedPeriod, liquidationOpts)
      : null),
    [selectedPeriod, membersReady, deferredMembers, tierCatalog],
  );
  const openPeriodDetail = (period, edit = false) => {
    setSelectedPeriod(period);
    setEditingPeriod(edit && !feePeriodIsClosed(period));
    setFlash('');
    setView('period_detail');
  };

  /**
   * Ver/editar borrador.
   * Si ya hay pack preparado (p. ej. LILA), no recuenta el padrón: eso pisa montos.
   * Recuento solo con «Cargar borrador» / «Actualizar padrón».
   */
  const openDraftDetail = async (period, edit = false) => {
    if (!period) return;
    const hasPreparedPack = Boolean(
      period.pack?.concepts?.length
      || period.lines?.length
      || (Number(period.amount) > 0 && Number(period.pack?.total) > 0),
    );
    if (
      period.status === 'draft'
      && !balancesOnly
      && !feePeriodPrepareBlock(period)
      && !hasPreparedPack
    ) {
      setBusy(true);
      setBusyPhase('procesando');
      setError('');
      try {
        const prepared = await refreshDraftFromPadron(period.id);
        openPeriodDetail(prepared, edit);
        return;
      } catch (err) {
        setError(err?.message || 'No se pudo actualizar el padrón (altas/bajas).');
      } finally {
        setBusy(false);
        setBusyPhase(null);
      }
    }
    openPeriodDetail(period, edit);
  };

  /** Recarga titulares desde el padrón vivo: entran altas, salen bajas. */
  const refreshDraftFromPadron = async (periodId) => {
    const block = feePeriodPrepareBlock(
      (feePeriods || []).find((p) => p.id === periodId)
        || selectedPeriod
        || { id: periodId },
    );
    if (block) throw new Error(block);
    const result = prepareFeePeriodDraft(feePeriods, periodId, members, new Date(), actorWithDiscounts);
    const model = liquidationFromPeriod(result.period, { members, tierCatalog, discountRules });
    const prepared = {
      ...result.period,
      amount: model.total,
      lines: model.rows,
      pack: {
        ...(result.period.pack || {}),
        total: model.total,
        concepts: result.period.pack?.concepts || model.rows,
      },
    };
    // Fuente de verdad: Supabase (fee_period_closures).
    const saved = onPersistFeePeriod ? await onPersistFeePeriod(prepared) : prepared;
    const next = saved || prepared;
    onUpsertFeePeriods?.(result.periods.map((p) => (p.id === periodId ? next : p)));
    return next;
  };

  const persistPackEdit = async (draft) => {
    if (!selectedPeriod || feePeriodIsClosed(selectedPeriod)) {
      throw new Error('Período no editable.');
    }
    let safeDraft = draft;
    if (!editFeeAmounts) {
      const locked = packEditorFromPeriod(selectedPeriod);
      const byId = new Map((locked.concepts || []).map((row) => [String(row.id), row.amount]));
      safeDraft = {
        ...draft,
        concepts: (draft.concepts || []).map((row) => ({
          ...row,
          amount: byId.has(String(row.id)) ? byId.get(String(row.id)) : row.amount,
        })),
      };
    }
    const edited = applyFeePackEdit(selectedPeriod, safeDraft);
    const saved = onPersistFeePeriod ? await onPersistFeePeriod(edited) : edited;
    const next = saved || edited;
    const source = feePeriods?.length ? feePeriods : [selectedPeriod];
    const nextList = source.some((p) => p.id === next.id)
      ? source.map((p) => (p.id === next.id ? next : p))
      : [...source, next];
    onUpsertFeePeriods?.(nextList);
    setSelectedPeriod(next);
    return { next, nextList };
  };

  const savePackEdit = async (draft) => {
    if (!selectedPeriod || feePeriodIsClosed(selectedPeriod)) return;
    setError('');
    setOk('');
    setBusy(true);
    try {
      await persistPackEdit(draft);
      setEditingPeriod(false);
      setOk('Cambios guardados. No se imputó una cuota a los socios.');
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la liquidación.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Botón verde Generar (tabla año): abre la pantalla de liquidación (editar / liquidar).
   * Conserva el borrador preparado; no recuenta padrón (montos LILA).
   */
  const openGenerateScreen = async (periodId) => {
    setError('');
    setOk('');
    const period = (feePeriods || []).find((p) => p.id === periodId) || selectedPeriod;
    if (!period) {
      setError('Período no encontrado.');
      return;
    }
    if (feePeriodIsClosed(period) || period.status === 'pending') {
      openPeriodDetail(period, false);
      return;
    }
    openPeriodDetail(period, true);
  };

  /**
   * Confirmar generación: modal → Pendiente hasta las 00 h; después Procesada e imputa.
   * No recuenta padrón si ya hay borrador preparado (conserva montos LILA).
   */
  const openGenerate = async (periodId) => {
    setError('');
    setOk('');
    let period = (feePeriods || []).find((p) => p.id === periodId) || selectedPeriod;
    if (!period) {
      setError('Período no encontrado.');
      return;
    }
    if (feePeriodIsClosed(period) || period.status === 'pending') {
      openPeriodDetail(period, false);
      return;
    }
    const block = feePeriodLiquidateBlock(period);
    if (block) {
      setError(block);
      return;
    }
    const hasPreparedPack = Boolean(
      period.pack?.concepts?.length
      || period.lines?.length
      || (Number(period.amount) > 0 && Number(period.pack?.total) > 0),
    );
    if (!balancesOnly && !feePeriodPrepareBlock(period) && !hasPreparedPack) {
      setBusy(true);
      setBusyPhase('procesando');
      try {
        period = await refreshDraftFromPadron(periodId);
      } catch (err) {
        setError(err.message || 'No se pudo actualizar el padrón (altas/bajas).');
        return;
      } finally {
        setBusy(false);
        setBusyPhase(null);
      }
    }
    requestLiquidate(period.id || periodId);
  };

  const downloadPeriod = async (period, kind, visibleModel) => {
    if (!period || exportBusy) return;
    setExportBusy({ id: period.id, kind });
    setError('');
    try {
      const model = visibleModel || liquidationFromPeriod(period, { members, tierCatalog, discountRules });
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
      setOk(`Registrado ${result.member.name || reservation.memberName}: ${fmt(result.amount)}. El alquiler no queda en la deuda de cuota.`);
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

  const prepareDraft = async (periodId) => {
    try {
      setBusy(true);
      setBusyPhase('procesando');
      const prepared = await refreshDraftFromPadron(periodId);
      if (selectedPeriod?.id === periodId) setSelectedPeriod(prepared);
      setFlash(`Padrón de ${periodLabel(prepared)} actualizado (${fmt(prepared.amount)}). Altas incluidas, bajas fuera.`);
      setError('');
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el padrón.');
    } finally {
      setBusy(false);
      setBusyPhase(null);
    }
  };

  const requestLiquidate = (periodId, draft = null) => {
    const period = (feePeriods || []).find((p) => p.id === periodId) || selectedPeriod;
    if (!period) {
      setError('Período no encontrado.');
      return;
    }
    const block = feePeriodLiquidateBlock(period);
    if (block) {
      setError(block);
      setOk('');
      return;
    }
    setError('');
    setOk('');
    setLiquidateDraft(draft || null);
    setLiquidateConfirmId(period.id || periodId);
  };

  const liquidate = async (periodId) => {
    const draftToApply = liquidateDraft;
    // Cerrar el modal al tocar Continuar; el proceso sigue en background.
    setLiquidateConfirmId(null);
    setLiquidateDraft(null);
    setBusy(true);
    setBusyPhase('procesando');
    setError('');
    try {
      let list = feePeriods;
      let open = (list || []).find((p) => p.id === periodId) || selectedPeriod;
      if (draftToApply && open) {
        const saved = applyFeePackEdit(open, draftToApply);
        list = (list?.length ? list : [open]).map((p) => (p.id === periodId ? saved : p));
        open = saved;
        onUpsertFeePeriods?.(list);
        if (onPersistFeePeriod) await onPersistFeePeriod(saved);
        setSelectedPeriod(saved);
      }
      const result = liquidateFeePeriod(list, periodId, members, new Date(), actorWithDiscounts);
      const model = liquidationFromPeriod(result.period, { members, tierCatalog, discountRules });
      const generated = {
        ...result.period,
        amount: model.total,
        lines: model.rows,
        pack: {
          ...(result.period.pack || {}),
          total: model.total,
          concepts: model.rows.map((row) => ({
            id: row.identifier,
            label: row.name,
            holders: row.holders,
            amount: row.unit,
            total: row.total,
          })),
          charges: result.period.pack?.charges || result.pendingCharges || [],
          availableAt: result.period.availableAt,
        },
      };
      result.period = generated;
      result.periods = result.periods.map((p) => (p.id === periodId ? generated : p));
      const saved = onPersistFeePeriod ? await onPersistFeePeriod(result.period) : result.period;
      const persisted = saved || result.period;
      result.period = persisted;
      result.periods = result.periods.map((p) => (p.id === periodId ? persisted : p));
      onUpsertFeePeriods?.(result.periods);
      // Pendiente: no imputa deudas ni ledger hasta las 00 h (promotePendingFeePeriods).
      setSelectedPeriod(null);
      goHome();
      const available = persisted.availableAt
        ? formatPeriodGeneratedAt(persisted.availableAt)
        : 'las 00 h de mañana';
      const label = periodLabel(persisted);
      setFlash(
        `Generado ${label} en Pendiente. Disponible desde ${available} (Procesada).`,
      );
      setSuccessBanner(`Liquidación de ${label} generada exitosamente.`);
    } catch (err) {
      setError(err.message || 'No se pudo liquidar.');
    } finally {
      setBusy(false);
      setBusyPhase(null);
    }
  };

  // Auto día 1 / promover Pendiente corre en AdminView al abrir el panel
  // (solo superadmin/contador con dues.liquidate). Acá queda el flujo manual.

  const reopen = async (period, reasonOverride = null) => {
    const reason = reasonOverride || window.prompt(
      `Error grave en ${periodLabel(period)}. Describí qué salió mal. Se anulan las deudas de esa liquidación y el mes vuelve a borrador.`,
    );
    if (reason == null) return;
    setBusy(true);
    setBusyPhase('revirtiendo');
    setError('');
    try {
      const result = onReopenFeePeriod
        ? await onReopenFeePeriod(period, reason, members, actorMeta)
        : null;
      if (!result) throw new Error('No se puede corregir esta liquidación.');
      const reversals = result.reversals || [];
      if (reversals.length && typeof setMembers === 'function') {
        const byId = new Map();
        for (const row of reversals) {
          const key = String(row.memberId);
          const prev = byId.get(key) || { amount: 0, outstandingBalance: null };
          prev.amount += Number(row.addAmount) || 0;
          if (row.outstandingBalance != null && Number.isFinite(Number(row.outstandingBalance))) {
            prev.outstandingBalance = Number(row.outstandingBalance);
          }
          byId.set(key, prev);
        }
        setMembers((prev) => prev.map((member) => {
          const hit = byId.get(String(member.memberId));
          if (!hit) return member;
          const outstandingBalance = hit.outstandingBalance != null
            ? hit.outstandingBalance
            : money(Number(member.outstandingBalance) - hit.amount);
          return { ...member, outstandingBalance };
        }));
      }
      const label = periodLabel(period);
      for (const entry of memberAccountEntries) {
        if (entry.source === 'fee_liquidation'
          && entry.isActive !== false
          && String(entry.description || '').startsWith(label)) {
          onDeleteMemberAccountEntry?.(entry.id);
        }
      }
      setFlash(`${label} volvió a borrador. Revisá y liquidá de nuevo.`);
      setSuccessBanner(`Liquidación de ${label} revertida exitosamente.`);
    } catch (err) {
      setError(err.message || 'No se pudo reabrir el mes.');
    } finally {
      setBusy(false);
      setBusyPhase(null);
    }
  };

  /** Pendiente aún no imputó: vuelve a Borrador como en LILA (No liquidado + Generar). */
  const cancelPendingGeneration = async (period) => {
    if (!period || period.status !== 'pending') return;
    await reopen(period, 'Cancelar generación pendiente: vuelve a borrador sin imputar.');
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
      const XLSX = await loadXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets.Socios || wb.Sheets.SOCIOS || wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('No se encontró una hoja con datos.');
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const detected = detectCobranzasSheetFormat(aoa);
      setDetectedFormat(detected.format);
      let rows = [];
      let importEntity = entity;
      let formatNote = '';
      if (detected.format === 'lila') {
        const kinds = lilaIncludeVarios
          ? [...LILA_COBRANZAS_DEFAULT_KINDS, 'Varios']
          : [...LILA_COBRANZAS_DEFAULT_KINDS];
        const parsed = parseLilaCobranzasSheetRows(aoa, {
          kinds,
          month: lilaMonth,
          year: lilaYear,
        });
        rows = parsed.rows;
        importEntity = 'lila_cobranzas';
        formatNote = `${MONTHS_ES[lilaMonth - 1] || lilaMonth}/${lilaYear}`;
        if (!rows.length) {
          throw new Error(
            `No hay filas Cuotas/Recargos para ${MONTHS_ES[lilaMonth - 1] || lilaMonth} ${lilaYear}. `
            + 'Revisá mes/año o el archivo.',
          );
        }
      } else {
        rows = parseCobranzasSociosSheetRows(aoa);
        formatNote = 'lista base';
      }
      const today = todayAR();
      const hasBackdated = rows.some((r) => {
        const day = String(forceDate || r.fecha || '').slice(0, 10);
        return day && day < today;
      });
      if (hasBackdated && String(paidAtReason || '').trim().length < 8) {
        throw new Error('Hay fechas anteriores a hoy: completá el motivo del cobro antedatado (mín. 8 caracteres).');
      }
      const built = buildMemberCollectionImport({
        rows,
        members,
        entity: importEntity,
        forceDate,
        imputationOrder,
        fileName: file.name,
        paidAtReason: hasBackdated ? paidAtReason : '',
        sendReceipts,
      });
      if (!built.payments.length) {
        throw new Error('No hay filas con importe > 0 para importar.');
      }
      let appliedResult = { members, applied: [], ledgerEntries: [], fullyPaidCount: 0, creditCount: 0, skipped: 0 };
      if (isSupabaseConfigured) {
        appliedResult = await persistImportedCollectionPayments(members, built.payments);
        if (typeof setMembers === 'function') setMembers(appliedResult.members);
      } else if (typeof setMembers === 'function') {
        setMembers((prev) => {
          appliedResult = applyMemberCollectionPayments(prev, built.payments);
          return appliedResult.members;
        });
      } else {
        appliedResult = applyMemberCollectionPayments(members, built.payments);
      }
      const postedAmount = (appliedResult.applied || []).reduce(
        (sum, row) => sum + (Number(row.amount) || 0),
        0,
      );
      let receiptNote = '';
      if (sendReceipts && appliedResult.applied?.length) {
        if (isSupabaseConfigured) {
          setOk(`Pagos cargados (${formatNote}). Enviando boletos…`);
          const receipts = await sendImportReceiptsBatch({
            importSource: built.batch.importSource,
            onProgress: ({ sent, skipped, pending }) => {
              setOk(
                `Pagos cargados (${formatNote}). Boletos: ${sent} enviados`
                + (skipped ? ` · ${skipped} sin mail` : '')
                + (pending != null ? ` · ${Math.max(0, pending - sent - skipped)} pendientes` : ''),
              );
            },
          });
          receiptNote = ` · boletos ${receipts.sent} enviados`
            + (receipts.skipped ? ` · ${receipts.skipped} sin mail` : '')
            + (receipts.failed ? ` · ${receipts.failed} fallidos` : '');
        } else {
          const byId = new Map((appliedResult.members || members).map((m) => [String(m.memberId), m]));
          const payByKey = new Map(built.payments.map((p) => [p.id, p]));
          let mailed = 0;
          for (const row of appliedResult.applied) {
            const member = byId.get(String(row.memberId));
            const src = payByKey.get(row.paymentId);
            if (!member || !src) continue;
            await deliverPaymentReceipt({
              member,
              payment: {
                ...src,
                amount: row.amount,
                date: row.date,
                receiptNumber: src.voucher || src.receiptNumber,
                method: src.methodLabel || src.method,
                concept: src.concept,
              },
              onSendMessage,
              kind: 'cuota',
            });
            mailed += 1;
          }
          receiptNote = ` · ${mailed} boleto(s) disparados`;
        }
      }
      const batch = {
        ...built.batch,
        applied: appliedResult.applied,
        fullyPaidCount: appliedResult.fullyPaidCount,
        creditCount: appliedResult.creditCount,
        receiptsSent: sendReceipts,
      };
      if (typeof onImportCollections === 'function') {
        await onImportCollections({ ...built, batch });
      }
      collectionPaymentsToEntries(built.payments, appliedResult.ledgerEntries).forEach((entry) => {
        onUpsertMemberAccountEntry?.(entry);
      });
      if (typeof addJournalEntry === 'function' && postedAmount > 0) {
        await addJournalEntry({
          date: forceDate || todayAR(),
          description: `Importación cobranzas socios (${built.batch.fileName || formatNote || 'Excel'})`,
          sourceModule: 'cuotas',
          lines: [
            { account: 'Caja General', type: 'debit', amount: postedAmount },
            { account: 'Cuotas Sociales', type: 'credit', amount: postedAmount },
          ],
        });
      }
      setOk(
        `Importados ${appliedResult.applied.length} de ${built.batch.totalRows} pagos · ${fmt(postedAmount)}`
        + (formatNote ? ` · ${formatNote}` : '')
        + (appliedResult.skipped ? ` · ${appliedResult.skipped} ya estaban cargados` : '')
        + (appliedResult.fullyPaidCount ? ` · ${appliedResult.fullyPaidCount} socio(s) al día` : '')
        + (appliedResult.creditCount ? ` · ${appliedResult.creditCount} con crédito a favor` : '')
        + (built.errors.length ? ` · ${built.errors.length} aviso(s)` : '')
        + receiptNote,
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
        members={members}
        journalEntries={journalEntries}
        chartOfAccounts={chartOfAccounts}
        feePeriods={feePeriods}
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
    const liquidation = periodLiquidation || liquidationFromPeriod(selectedPeriod, { members, tierCatalog, discountRules });
    return (
      <div className="fade-in cuotas-panel">
        <CuotasBusyOverlay phase={busyPhase} />
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
                  disabled={busy}
                  onClick={() => openDraftDetail(selectedPeriod, true)}
                >
                  <Pencil size={14} /> Editar
                </button>
                {!balancesOnly && !feePeriodPrepareBlock(selectedPeriod) ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        setBusy(true);
                        const prepared = await refreshDraftFromPadron(selectedPeriod.id);
                        setSelectedPeriod(prepared);
                        setOk('Padrón actualizado: altas incluidas, bajas fuera.');
                      } catch (err) {
                        setError(err.message || 'No se pudo actualizar el padrón.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Upload size={14} /> Actualizar padrón
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-emerald btn-sm"
                  title="Revisar altas, bajas y fichas en IA Jockey"
                  onClick={() => setIaReviewOpen(true)}
                >
                  <Sparkles size={14} /> Revisar IA
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  title="Generar liquidación"
                  disabled={busy}
                  onClick={() => openGenerate(selectedPeriod.id)}
                >
                  <History size={14} /> Generar
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

        {error ? <p className="ig-error" role="alert">{error}</p> : null}
        {ok ? <p className="ig-ok">{ok}</p> : null}
        {flash && editingPeriod ? <p className="ig-ok">{flash}</p> : null}

        {editingPeriod && !feePeriodIsClosed(selectedPeriod) ? (
          <FeePackEditor
            key={`${selectedPeriod.id}-${selectedPeriod.updatedAt || selectedPeriod.pack?.preparedAt || 'edit'}`}
            period={selectedPeriod}
            draft={packEditorFromPeriod(
              selectedPeriod,
              // Borrador con pack: no pasar liquidación viva (recuenta y cambia montos LILA).
              (selectedPeriod.status === 'draft' && selectedPeriod.pack?.concepts?.length)
                ? null
                : (liquidation?.rows?.length ? liquidation : null),
            )}
            formatCurrency={fmt}
            busy={busy}
            liquidateBlocked={feePeriodLiquidateBlock(selectedPeriod)}
            canEditAmounts={editFeeAmounts}
            onSave={savePackEdit}
            onLiquidate={(draft) => {
              requestLiquidate(selectedPeriod.id, draft);
            }}
            onCancel={() => setEditingPeriod(false)}
          />
        ) : (
        <>
        <div className="cuotas-cc-banner">
          <span>Detalle de cuotas · total {fmt(liquidation.total)}</span>
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

        <LiquidateNowDialog
          open={Boolean(liquidateConfirmId)}
          period={(feePeriods || []).find((p) => p.id === liquidateConfirmId) || selectedPeriod}
          busy={busy}
          onClose={() => {
            setLiquidateConfirmId(null);
            setLiquidateDraft(null);
          }}
          onConfirm={() => liquidate(liquidateConfirmId)}
        />

        <CuotasIaReviewModal
          open={iaReviewOpen}
          onClose={() => setIaReviewOpen(false)}
          members={deferredMembers}
          membersLoading={membersLoading}
          feePeriods={feePeriods}
          period={selectedPeriod}
        />
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
          paymentPlans={paymentPlans}
          paymentTolerance={duesSettings?.paymentTolerance}
        />
      </div>
    );
  }

  if (view === 'import_collections') {
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <h3 className="cuotas-title">Importar cobranzas / débitos</h3>
        </div>

        <section className="supplier-pay-import-block">
          <p className="disc-field-hint" style={{ marginBottom: '1rem' }}>
            Subí el Excel de cobranzas (columnas Tipo, ID Recibo, Fecha, Mes, Año, NRO DE SOCIO, Concepto, Banco, Importe total)
            o la lista base del club. Se imputan los pagos al padrón y, si está marcado, se envía el boleto automáticamente.
          </p>
          <div className="supplier-pay-import-form">
            <div className="supplier-pay-import-field">
              <label className="form-label" htmlFor="mci-entity">Entidad (lista base)</label>
              <select id="mci-entity" className="form-input" value={entity} onChange={(e) => setEntity(e.target.value)}>
                {Object.entries(MEMBER_COLLECTION_ENTITIES).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <p className="disc-field-hint">
                Si el archivo viene del sistema de cobranzas, se detecta solo.
              </p>
            </div>
            <div className="supplier-pay-import-field">
              <label className="form-label" htmlFor="mci-lila-month">Mes</label>
              <select
                id="mci-lila-month"
                className="form-input"
                value={lilaMonth}
                onChange={(e) => setLilaMonth(Number(e.target.value))}
              >
                {MONTHS_ES.map((label, i) => (
                  <option key={label} value={i + 1}>{label}</option>
                ))}
              </select>
              <p className="disc-field-hint">Solo filas de ese mes (Cuotas + Recargos).</p>
            </div>
            <div className="supplier-pay-import-field">
              <label className="form-label" htmlFor="mci-lila-year">Año</label>
              <input
                id="mci-lila-year"
                type="number"
                className="form-input"
                min={2020}
                max={2100}
                value={lilaYear}
                onChange={(e) => setLilaYear(Number(e.target.value) || year)}
              />
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
                Vacío = fecha de cada fila. Completá para imputar todos ese día (vence el 10; mora desde el 11).
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
            </div>
            <div className="supplier-pay-import-field" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" htmlFor="mci-reason">Motivo si hay fechas anteriores a hoy</label>
              <input
                id="mci-reason"
                className="form-input"
                value={paidAtReason}
                onChange={(e) => setPaidAtReason(e.target.value)}
                placeholder="Ej. Importación Excel débitos noviembre"
              />
            </div>
            <div className="supplier-pay-import-field">
              <label className="form-label" htmlFor="mci-file">Archivo Excel</label>
              <input
                id="mci-file"
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  setDetectedFormat('');
                  setFile(e.target.files?.[0] || null);
                }}
              />
              {detectedFormat ? (
                <p className="disc-field-hint">Formato detectado: {detectedFormat === 'lila' ? 'cobranzas' : 'lista base'}.</p>
              ) : null}
            </div>
            <div className="supplier-pay-import-field">
              <label className="form-label" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={sendReceipts}
                  onChange={(e) => setSendReceipts(e.target.checked)}
                />
                Enviar boleto automático al subir
              </label>
              <label className="form-label" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={lilaIncludeVarios}
                  onChange={(e) => setLilaIncludeVarios(e.target.checked)}
                />
                Incluir filas «Varios»
              </label>
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
              <Upload size={14} /> {busy ? 'Procesando…' : 'Procesar y cargar pagos'}
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
                            onClick={async () => {
                              const canRevert = Array.isArray(batch.applied) && batch.applied.length > 0;
                              const okDelete = window.confirm(
                                canRevert
                                  ? '¿Revertir esta importación? Se restauran saldo, vencimiento y mora de esos socios.'
                                  : '¿Marcar esta importación como eliminada? Los saldos no se revierten (lote anterior).',
                              );
                              if (!okDelete) return;
                              const voided = new Map();
                              let voidReason = '';
                              if (canRevert && isSupabaseConfigured) {
                                voidReason = window.prompt('Motivo para anular estos cobros (mínimo 8 caracteres)') || '';
                                if (voidReason.trim().length < 8) {
                                  setError('Falta el motivo de la anulación (mínimo 8 caracteres).');
                                  return;
                                }
                                for (const row of [...batch.applied].reverse()) {
                                  if (!row.paymentDbId) continue;
                                  const balance = await revertDuesPayment(row.paymentDbId, voidReason.trim());
                                  voided.set(String(row.memberId), balance);
                                }
                              }
                              if (canRevert && typeof setMembers === 'function') {
                                setMembers((prev) => {
                                  const restored = revertMemberCollectionPayments(prev, batch.applied);
                                  if (!voided.size) return restored;
                                  return restored.map((member) => (
                                    voided.has(String(member.memberId))
                                      ? { ...member, outstandingBalance: voided.get(String(member.memberId)) }
                                      : member
                                  ));
                                });
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
      <CuotasBusyOverlay phase={busyPhase} />
      <DuesDueBanner
        members={deferredMembers}
        membersLoading={membersLoading || !membersReady}
        journalEntries={journalEntries}
        chartOfAccounts={chartOfAccounts}
        feePeriods={feePeriods}
        tierCatalog={tierCatalog}
        afterCollect={<CuotasDeskToolbar onGo={goDesk} />}
      />
      <OverdueDuesStrip
        members={overdueMembers}
        count={overdueCount}
        formatCurrency={fmt}
        loading={membersLoading || !membersReady}
        onOpenChange={setOverdueOpen}
        onOpenAll={() => setView('mora')}
      />

      <CollectDuesDeskFlow
        open={collectOpen}
        onClose={() => setCollectOpen(false)}
        members={members}
        setMembers={setMembers}
        addJournalEntry={addJournalEntry}
        onAccountEntry={onUpsertMemberAccountEntry}
        onSendMessage={onSendMessage}
        formatCurrency={fmt}
        paymentPlans={paymentPlans}
        paymentTolerance={duesSettings?.paymentTolerance}
        onCollected={({ message }) => {
          setSuccessBanner(message || 'Cobro registrado.');
          setFlash(message || 'Cobro registrado.');
        }}
      />

      {successBanner ? (
        <div className="cuotas-success-banner" role="status" aria-live="polite">
          <span>{successBanner}</span>
          <button
            type="button"
            className="cuotas-success-banner-close"
            aria-label="Cerrar aviso"
            onClick={() => setSuccessBanner('')}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
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
          <p className="cuotas-year-auto-hint">
            El día 1 de cada mes se genera sola desde el padrón (altas incluidas, bajas fuera).
            Cargar borrador y Generar siguen disponibles a mano.
          </p>
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
              periods.map((p, idx) => {
                const liquidateBlock = feePeriodLiquidateBlock(p);
                const prepareBlock = feePeriodPrepareBlock(p);
                const nextPeriod = periods[idx + 1];
                const canSeedNext = p.status === 'processed'
                  && nextPeriod
                  && nextPeriod.status === 'draft'
                  && appOwnsFeePeriod(nextPeriod)
                  && !feePeriodPrepareBlock(nextPeriod);
                const historyBtn = appOwnsFeePeriod(p) ? (
                  <button
                    type="button"
                    className="cash-lila-icon-btn is-hist"
                    title="Historial de generación / reversión"
                    aria-label="Historial"
                    onClick={() => setHistoryPeriod(p)}
                  >
                    <History size={14} />
                  </button>
                ) : null;
                return (
                <tr key={p.id}>
                  <td>{p.accessinId || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{periodLabel(p)}</td>
                  <td className="tabular-nums">
                    {p.status === 'processed' || p.status === 'pending' || p.status === 'draft'
                      ? (periodAmounts.get(p.id) != null
                        ? fmt(periodAmounts.get(p.id))
                        : (membersReady ? '—' : '…'))
                      : 'Cuotas no liquidados'}
                  </td>
                  <td>
                    {p.status === 'draft'
                      ? 'No liquidado'
                      : (
                        <>
                          {formatPeriodGeneratedAt(p.generatedAt)}
                          {p.status === 'pending' && p.availableAt
                            ? ` · disponible ${formatPeriodGeneratedAt(p.availableAt)}`
                            : null}
                        </>
                      )}
                  </td>
                  <td>
                    <span className={`status-badge ${statusTone(p.status)}`}>
                      {periodStatusLabel(p.status)}
                    </span>
                    {p.status === 'draft' && appOwnsFeePeriod(p) ? (
                      <div className="cuotas-year-auto-tag">Automática el día 1</div>
                    ) : null}
                    {p.pack?.autoFromPadronAt ? (
                      <div className="cuotas-year-auto-tag is-done">Generada el día 1</div>
                    ) : null}
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
                          {historyBtn}
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
                          {canSeedNext && !balancesOnly ? (
                            <button
                              type="button"
                              className="cash-lila-icon-btn is-edit"
                              title={`Cargar borrador de ${periodLabel(nextPeriod)} desde el padrón`}
                              aria-label={`Cargar borrador de ${periodLabel(nextPeriod)}`}
                              onClick={() => prepareDraft(nextPeriod.id)}
                            >
                              <Upload size={14} />
                            </button>
                          ) : null}
                          {!balancesOnly && appOwnsFeePeriod(p) && reopenPeriods ? (
                            <button
                              type="button"
                              className="cash-lila-icon-btn is-del"
                              title="Reabrir (solo superadmin)"
                              aria-label="Reabrir liquidación"
                              onClick={() => reopen(p)}
                            >
                              <RotateCcw size={14} />
                            </button>
                          ) : null}
                          {!balancesOnly && appOwnsFeePeriod(p) && reopenPeriods ? (
                            <button
                              type="button"
                              className="cash-lila-icon-btn is-edit"
                              title="Nota de crédito o débito"
                              aria-label="Nota de crédito o débito"
                              onClick={() => setNotePeriod(p)}
                            >
                              <Wallet size={14} />
                            </button>
                          ) : null}
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
                      ) : p.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Ver liquidación"
                            aria-label="Ver liquidación"
                            onClick={() => openDraftDetail(p)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Editar (hasta Procesada)"
                            aria-label="Editar liquidación"
                            onClick={() => openDraftDetail(p, true)}
                          >
                            <Pencil size={14} />
                          </button>
                          {historyBtn}
                          {!balancesOnly && appOwnsFeePeriod(p) && reopenPeriods ? (
                            <button
                              type="button"
                              className="cash-lila-icon-btn is-del"
                              title="Volver a borrador (aún no imputó)"
                              aria-label="Volver a borrador"
                              onClick={() => cancelPendingGeneration(p)}
                            >
                              <RotateCcw size={14} />
                            </button>
                          ) : null}
                        </>
                      ) : p.status === 'draft' ? (
                        <>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Ver liquidación"
                            aria-label="Ver liquidación"
                            onClick={() => openDraftDetail(p)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Editar"
                            aria-label="Editar liquidación"
                            onClick={() => openDraftDetail(p, true)}
                          >
                            <Pencil size={14} />
                          </button>
                          {historyBtn}
                          {!balancesOnly ? (
                            <button
                              type="button"
                              className="cash-lila-icon-btn is-edit"
                              title={prepareBlock || 'Cargar / actualizar borrador desde el padrón (también automático el día 1)'}
                              aria-label="Cargar borrador"
                              disabled={Boolean(prepareBlock)}
                              onClick={() => prepareDraft(p.id)}
                            >
                              <Upload size={14} />
                            </button>
                          ) : null}
                          {!balancesOnly ? (
                            <button
                              type="button"
                              className="cash-lila-icon-btn is-gen"
                              title={prepareBlock || 'Generar liquidación (también automática el día 1)'}
                              aria-label="Generar"
                              disabled={Boolean(prepareBlock) && Boolean(liquidateBlock)
                                && !(p.pack?.concepts?.length || p.lines?.length)}
                              onClick={() => openGenerateScreen(p.id)}
                            >
                              <Play size={14} />
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Ver liquidación"
                            aria-label="Ver liquidación"
                            onClick={() => openDraftDetail(p)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="cash-lila-icon-btn is-edit"
                            title="Editar"
                            aria-label="Editar liquidación"
                            onClick={() => openDraftDetail(p, true)}
                          >
                            <Pencil size={14} />
                          </button>
                          {historyBtn}
                          {!balancesOnly ? (
                            <button
                              type="button"
                              className="cash-lila-icon-btn is-edit"
                              title={prepareBlock || 'Cargar / actualizar borrador desde el padrón (también automático el día 1)'}
                              aria-label="Cargar borrador"
                              disabled={Boolean(prepareBlock)}
                              onClick={() => prepareDraft(p.id)}
                            >
                              <Upload size={14} />
                            </button>
                          ) : null}
                          {!balancesOnly ? (
                            <button
                              type="button"
                              className="cash-lila-icon-btn is-gen"
                              title={prepareBlock || 'Generar liquidación (también automática el día 1)'}
                              aria-label="Generar"
                              disabled={Boolean(prepareBlock) && Boolean(liquidateBlock)
                                && !(p.pack?.concepts?.length || p.lines?.length)}
                              onClick={() => openGenerateScreen(p.id)}
                            >
                              <Play size={14} />
                            </button>
                          ) : null}
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

      <LiquidateNowDialog
        open={Boolean(liquidateConfirmId)}
        period={(feePeriods || []).find((p) => p.id === liquidateConfirmId) || selectedPeriod}
        busy={busy}
        onClose={() => {
          setLiquidateConfirmId(null);
          setLiquidateDraft(null);
        }}
        onConfirm={() => liquidate(liquidateConfirmId)}
      />

      <FeeAdjustmentNoteDialog
        open={Boolean(notePeriod)}
        period={notePeriod}
        busy={busy}
        onClose={() => setNotePeriod(null)}
        onSubmit={async (input) => {
          setBusy(true);
          setError('');
          try {
            const balance = await notaAjusteCuota(input);
            if (typeof setMembers === 'function') {
              setMembers((prev) => (prev || []).map((member) => (
                String(member.memberId) === String(input.memberNumber)
                  ? { ...member, outstandingBalance: balance }
                  : member
              )));
            }
            setFlash(`Nota de ${input.kind === 'credito' ? 'crédito' : 'débito'} registrada. La liquidación no se modificó.`);
            setNotePeriod(null);
          } catch (err) {
            setError(err.message || 'No se pudo registrar la nota.');
          } finally {
            setBusy(false);
          }
        }}
      />

      <FeePeriodHistoryDialog
        open={Boolean(historyPeriod)}
        period={
          historyPeriod
            ? ((feePeriods || []).find((p) => p.id === historyPeriod.id) || historyPeriod)
            : null
        }
        formatCurrency={fmt}
        onClose={() => setHistoryPeriod(null)}
      />

      <CuotasIaReviewModal
        open={iaReviewOpen}
        onClose={() => setIaReviewOpen(false)}
        members={deferredMembers}
        membersLoading={membersLoading}
        feePeriods={feePeriods}
        period={selectedPeriod}
      />
    </div>
  );
}

function busyPhaseLabel(phase) {
  if (phase === 'revirtiendo') return 'Revirtiendo…';
  if (phase === 'generando') return 'Generando…';
  if (phase === 'actualizando') return 'Actualizando padrón…';
  if (phase === 'procesando') return 'Procesando…';
  return null;
}

function CuotasBusyOverlay({ phase = null }) {
  const label = busyPhaseLabel(phase);
  if (!label) return null;
  return (
    <div className="cuotas-busy-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="cuotas-busy-card">
        <Loader2 size={28} className="spin" aria-hidden="true" />
        <p>{label}</p>
      </div>
    </div>
  );
}

function LiquidateNowDialog({ open = false, period, busy, onClose, onConfirm }) {
  if (!open || !period) return null;
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      labelledBy="cuotas-gen-title"
      describedBy="cuotas-gen-body"
      contentClassName="modal-content cuotas-liq-ahora"
    >
      <header className="cuotas-liq-ahora-head">
        <h4 id="cuotas-gen-title">Generar cuotas</h4>
        <button type="button" className="cuotas-liq-ahora-close" onClick={onClose} aria-label="Cerrar">
          <X size={16} />
        </button>
      </header>
      <p id="cuotas-gen-body" className="cuotas-liq-ahora-copy">
        Las cuotas no estarán disponibles hasta las 00&nbsp;h de mañana. La cuota quedará en estado{' '}
        <strong>Pendiente</strong>. Una vez que la misma pase a estado <strong>Procesada</strong> no podrá
        ser editada ni eliminada. ¿Está seguro que desea continuar?
      </p>
      <footer className="cuotas-liq-ahora-foot">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onConfirm?.();
          }}
        >
          {busy ? 'Procesando…' : 'Generar'}
        </button>
      </footer>
    </ModalDialog>
  );
}

function formatHistoryAt(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return formatPeriodGeneratedAt(iso);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return formatPeriodGeneratedAt(iso);
  }
}

function FeePeriodHistoryDialog({ open = false, period, formatCurrency: fmt = formatCurrency, onClose }) {
  if (!open || !period) return null;
  const rows = feePeriodActionHistory(period);
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      labelledBy="cuotas-hist-title"
      describedBy="cuotas-hist-body"
      contentClassName="modal-content cuotas-hist-dialog"
    >
      <header className="cuotas-hist-head">
        <h4 id="cuotas-hist-title">
          Historial · {periodLabel(period)}
        </h4>
        <button type="button" className="cuotas-liq-ahora-close" onClick={onClose} aria-label="Cerrar">
          <X size={16} />
        </button>
      </header>
      <div id="cuotas-hist-body" className="cuotas-hist-body">
        {rows.length === 0 ? (
          <p className="cuotas-hist-empty">Sin generación ni reversión registrada aún.</p>
        ) : (
          <ul className="cuotas-hist-list">
            {rows.map((row) => {
              const generated = row.type === 'generated';
              return (
                <li
                  key={`${row.type}-${row.at}`}
                  className={`cuotas-hist-item ${generated ? 'is-gen' : 'is-rev'}`}
                >
                  <div className="cuotas-hist-item-top">
                    <span className={`cuotas-hist-badge ${generated ? 'is-gen' : 'is-rev'}`}>
                      {generated ? 'Generada' : 'Revertida'}
                    </span>
                    <time dateTime={row.at}>{formatHistoryAt(row.at)}</time>
                  </div>
                  <p className="cuotas-hist-user">
                    Usuario: {row.by || '—'}
                  </p>
                  <p className="cuotas-hist-meta">
                    {generated
                      ? `Monto ${fmt(row.amount || 0)}${row.availableAt ? ` · disponible ${formatPeriodGeneratedAt(row.availableAt)}` : ''}`
                      : `Monto ${fmt(row.amount || 0)}${row.statusWas ? ` · era ${periodStatusLabel(row.statusWas)}` : ''}`}
                  </p>
                  {!generated && row.reason ? (
                    <p className="cuotas-hist-reason">{row.reason}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="cuotas-hist-foot">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          Cerrar
        </button>
      </footer>
    </ModalDialog>
  );
}

function FeeAdjustmentNoteDialog({ open, period, busy, onClose, onSubmit }) {
  const [memberNumber, setMemberNumber] = useState('');
  const [kind, setKind] = useState('credito');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMemberNumber('');
    setKind('credito');
    setAmount('');
    setReason('');
    setLocalError('');
  }, [open, period?.id]);

  if (!open || !period) return null;

  const submit = (event) => {
    event.preventDefault();
    const why = reason.trim();
    const value = Number(amount);
    if (!String(memberNumber).trim()) {
      setLocalError('Indicá el número de socio.');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setLocalError('El importe tiene que ser mayor a cero.');
      return;
    }
    if (why.length < 8) {
      setLocalError('Falta el motivo de la nota (mínimo 8 caracteres).');
      return;
    }
    setLocalError('');
    onSubmit?.({
      memberNumber: String(memberNumber).trim(),
      kind,
      amount: value,
      reason: why,
    });
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      labelledBy="cuotas-nota-title"
      describedBy="cuotas-nota-body"
      contentClassName="modal-content cuotas-liq-ahora"
    >
      <header className="cuotas-liq-ahora-head">
        <h4 id="cuotas-nota-title">Nota de crédito o débito</h4>
        <button type="button" className="cuotas-liq-ahora-close" onClick={onClose} aria-label="Cerrar">
          <X size={16} />
        </button>
      </header>
      <form id="cuotas-nota-body" onSubmit={submit} style={{ display: 'grid', gap: '0.75rem' }}>
        <p className="cuotas-liq-ahora-copy" style={{ margin: 0 }}>
          {periodLabel(period)} queda como se liquidó. La nota mueve solo el saldo de ese socio.
        </p>
        <label className="form-label">
          Número de socio
          <input className="form-input" value={memberNumber} onChange={(e) => setMemberNumber(e.target.value)} required />
        </label>
        <label className="form-label">
          Tipo
          <select className="form-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="credito">Crédito (baja el saldo)</option>
            <option value="debito">Débito (sube el saldo)</option>
          </select>
        </label>
        <label className="form-label">
          Importe
          <input className="form-input" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label className="form-label">
          Motivo
          <input className="form-input" minLength={8} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        {localError ? <p role="alert" style={{ color: '#ef4444', margin: 0 }}>{localError}</p> : null}
        <footer className="cuotas-liq-ahora-foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Guardando…' : 'Registrar nota'}</button>
        </footer>
      </form>
    </ModalDialog>
  );
}

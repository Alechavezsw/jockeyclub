import { useMemo, useState } from 'react';
import {
  Banknote,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Download,
  Eye,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Smartphone,
  X,
} from 'lucide-react';
import AdminNewReservationDialog from './AdminNewReservationDialog';
import {
  buildBookingReceiptFromReservation,
  reservationPaidInFull,
} from '../../domain/reservations/bookingReceipt';
import {
  reservationOpenBalance,
  reservationTotalPrice,
} from '../../domain/reservations/bookingRules';
import { downloadPaymentReceiptPdf } from '../../domain/members/exportPaymentReceiptPdf';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';
import { completeReservationPayment } from '../../data/repos/reservations';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  paymentReceiptShareTargets,
  sendDuesReceiptMessage,
} from '../../domain/members/duesReceiptDelivery';
import { exportWeekReservationsPdf } from '../../domain/reservations/exportWeekReservationsPdf';
import { todayAR } from '../../lib/arDate';

function openExternal(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function memberForReservation(res, members = []) {
  return (members || []).find((row) => String(row.memberId) === String(res?.memberId)) || {
    memberId: res?.memberId,
    name: res?.memberName,
  };
}

function bookingPaymentForShare(res, members = []) {
  const member = memberForReservation(res, members);
  const payFull = reservationPaidInFull(res);
  return {
    member,
    payment: buildBookingReceiptFromReservation(res, { member, payFull }),
  };
}

function reservationTakenByLabel(res) {
  const name = String(res?.recordedByName || '').trim();
  if (name) return name;
  const source = String(res?.source || '').toLowerCase();
  if (source === 'app') return 'Portal del socio';
  if (source === 'admin') return 'Administración';
  return null;
}

function isAppReservation(res) {
  const source = String(res?.source || '').toLowerCase();
  return source === 'app' || source === 'portal' || source === 'member';
}

/** Nº visible de la reserva (app u otras): estable y corto. */
export function reservationAppNumber(res) {
  const external = String(res?.externalId || '').replace(/\D/g, '');
  if (external.length >= 3) return external.slice(-6);
  const raw = String(res?.id || '').replace(/[^a-zA-Z0-9]/g, '');
  if (!raw) return '—';
  return raw.slice(-6).toUpperCase();
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthLabel(year, month) {
  const raw = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function statusLabel(status) {
  if (status === 'confirmed') return 'Confirmada';
  if (status === 'pending') return 'Pendiente';
  if (status === 'rejected') return 'Rechazada';
  return 'Cancelada';
}

/** Texto del hover del día en el calendario. */
function calendarDayTooltip(dayRes = []) {
  const active = (dayRes || []).filter((r) => !r?.occupancyOnly);
  if (!active.length) return 'Sin reservas';
  const lines = active.map((r) => {
    const time = r.endTime ? `${r.time || '—'}–${r.endTime}` : (r.time || '—');
    const place = r.facilityName || r.facilityId || 'Espacio';
    const who = r.memberName || (r.memberId ? `Nº ${r.memberId}` : 'Socio');
    return `${time} · ${place} · ${who} · ${statusLabel(r.status)}`;
  });
  const head = active.length === 1 ? '1 reserva' : `${active.length} reservas`;
  return [head, ...lines].join('\n');
}

function formatBookingDate(iso, { today = new Date() } = {}) {
  if (!iso) return '—';
  const day = String(iso).slice(0, 10);
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = date.getFullYear() === today.getFullYear();
  const raw = date.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return raw.replace(/\./g, '');
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v);
}

function reservationCreatedAt(res) {
  return String(res?.createdAt || '').trim();
}

/** Más reciente primero; pendientes arriba cuando no hay día filtrado. */
function compareReservationsLatest(a, b, { pendingFirst = false } = {}) {
  if (pendingFirst) {
    const ap = a.status === 'pending' ? 0 : 1;
    const bp = b.status === 'pending' ? 0 : 1;
    if (ap !== bp) return ap - bp;
  }
  const byCreated = reservationCreatedAt(b).localeCompare(reservationCreatedAt(a));
  if (byCreated !== 0) return byCreated;
  const byDate = String(b.date || '').localeCompare(String(a.date || ''));
  if (byDate !== 0) return byDate;
  return String(b.time || '').localeCompare(String(a.time || ''));
}

function formatRelativeCreated(iso) {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const diffMs = Date.now() - at.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return at.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function normalizeBookingSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function reservationSearchHaystack(res) {
  return normalizeBookingSearch([
    res?.memberName,
    res?.memberId,
    res?.facilityName,
    res?.facilityId,
    res?.notes,
    res?.guestNames,
    res?.date,
    res?.time,
    res?.endTime,
    res?.recordedByName,
    reservationAppNumber(res),
    isAppReservation(res) ? 'app portal' : '',
    statusLabel(res?.status),
    reservationTakenByLabel(res),
  ].filter(Boolean).join(' '));
}

function reservationMatchesQuery(res, query) {
  const q = normalizeBookingSearch(query);
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = reservationSearchHaystack(res);
  return tokens.every((token) => hay.includes(token));
}

/** Libro de reservas con calendario mensual y tabla de gestión. */
export default function BookingsTab({
  reservations = [],
  setReservations,
  updateReservationStatus,
  addReservation = null,
  members = [],
  facilityCatalog = null,
  onSendMessage,
}) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);
  const todayKey = toISODate(today);

  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const [selectedDate, setSelectedDate] = useState(null);
  const [receiptTarget, setReceiptTarget] = useState(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState('');
  const [weekPdfBusy, setWeekPdfBusy] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [newReservationOpen, setNewReservationOpen] = useState(false);
  const [openActionsId, setOpenActionsId] = useState(null);
  const [actionsBusyKey, setActionsBusyKey] = useState('');
  const [actionsNotice, setActionsNotice] = useState('');
  const [actionsError, setActionsError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [listScope, setListScope] = useState('all'); // all | app
  const [detailReservationId, setDetailReservationId] = useState(null);

  const selectCalendarDay = (iso) => {
    setSelectedDate((prev) => {
      const next = prev === iso ? null : iso;
      if (next) setListOpen(true);
      return next;
    });
  };

  const setBookingSearch = (value) => {
    setSearchQuery(value);
    if (String(value || '').trim()) setListOpen(true);
  };

  const openReservationDetail = (res, { jumpCalendar = true } = {}) => {
    if (!res?.id) return;
    setDetailReservationId(res.id);
    setListOpen(true);
    if (!jumpCalendar || listScope === 'app') return;
    const day = String(res.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setSelectedDate(day);
      const d = new Date(`${day}T12:00:00`);
      if (!Number.isNaN(d.getTime())) {
        setCursor({ year: d.getFullYear(), month: d.getMonth() });
      }
    }
  };

  const enterAppReservationsScope = () => {
    setListScope('app');
    setListOpen(true);
    setSelectedDate(null);
    setSearchQuery('');
    setOpenActionsId(null);
    requestAnimationFrame(() => {
      document.getElementById('bookings-app-inbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const exitAppReservationsScope = () => {
    setListScope('all');
    setDetailReservationId(null);
  };

  const byDate = useMemo(() => {
    const map = new Map();
    for (const res of reservations) {
      if (!res?.date) continue;
      const list = map.get(res.date) || [];
      list.push(res);
      map.set(res.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    }
    return map;
  }, [reservations]);

  const calendarCells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startOffset = (first.getDay() + 6) % 7; // lunes = 0
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const cells = [];

    for (let i = 0; i < startOffset; i += 1) {
      cells.push({ key: `pad-${i}`, empty: true });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(cursor.year, cursor.month, day, 12);
      const iso = toISODate(date);
      const dayRes = (byDate.get(iso) || []).filter((r) => !r?.occupancyOnly);
      cells.push({
        key: iso,
        empty: false,
        day,
        iso,
        isToday: iso === todayKey,
        isSelected: selectedDate === iso,
        total: dayRes.length,
        confirmed: dayRes.filter((r) => r.status === 'confirmed').length,
        pending: dayRes.filter((r) => r.status === 'pending').length,
        cancelled: dayRes.filter((r) => r.status === 'cancelled').length,
        tooltip: calendarDayTooltip(dayRes),
      });
    }
    return cells;
  }, [cursor, byDate, todayKey, selectedDate]);

  const currentMonthKey = todayKey.slice(0, 7);
  const currentMonthLabel = useMemo(() => {
    const raw = new Date(today.getFullYear(), today.getMonth(), 1)
      .toLocaleDateString('es-AR', { month: 'long' });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [today]);

  const monthReservations = useMemo(
    () => (reservations || []).filter((r) => (
      !r.occupancyOnly && String(r.date || '').slice(0, 7) === currentMonthKey
    )),
    [reservations, currentMonthKey],
  );

  const pendingReservations = useMemo(
    () => monthReservations.filter((r) => r.status === 'pending'),
    [monthReservations],
  );
  const pendingCount = pendingReservations.length;

  const latestReservations = useMemo(
    () => monthReservations
      .toSorted((a, b) => compareReservationsLatest(a, b, { pendingFirst: true }))
      .slice(0, 10),
    [monthReservations],
  );

  const searchActive = Boolean(normalizeBookingSearch(searchQuery));

  const appReservations = useMemo(
    () => (reservations || []).filter((r) => !r.occupancyOnly && isAppReservation(r)),
    [reservations],
  );
  const appPendingCount = useMemo(
    () => appReservations.filter((r) => r.status === 'pending').length,
    [appReservations],
  );

  const detailReservation = useMemo(
    () => (reservations || []).find((r) => String(r.id) === String(detailReservationId)) || null,
    [reservations, detailReservationId],
  );

  const filteredReservations = useMemo(() => {
    const onlyApp = listScope === 'app';
    if (searchActive) {
      return (reservations || [])
        .filter((r) => !r.occupancyOnly && reservationMatchesQuery(r, searchQuery))
        .filter((r) => !onlyApp || isAppReservation(r))
        .toSorted((a, b) => compareReservationsLatest(a, b));
    }
    if (onlyApp) {
      const pool = selectedDate
        ? appReservations.filter((r) => r.date === selectedDate)
        : appReservations;
      return [...pool].toSorted((a, b) => (
        selectedDate
          ? String(a.time || '').localeCompare(String(b.time || ''))
          : compareReservationsLatest(a, b, { pendingFirst: true })
      ));
    }
    if (selectedDate) {
      return reservations
        .filter((r) => r.date === selectedDate)
        .toSorted((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    }
    return [...monthReservations]
      .toSorted((a, b) => compareReservationsLatest(a, b, { pendingFirst: true }));
  }, [
    reservations,
    selectedDate,
    monthReservations,
    searchQuery,
    searchActive,
    listScope,
    appReservations,
  ]);

  const selectedDayList = selectedDate ? (byDate.get(selectedDate) || []) : [];

  const shiftMonth = (delta) => {
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const handleUpdateReservationStatus = async (resId, newStatus) => {
    if (typeof updateReservationStatus === 'function') {
      const result = await updateReservationStatus(resId, newStatus);
      if (result?.ok === false && result?.error) {
        window.alert(result.error);
      }
      return;
    }
    setReservations((prev) => prev.map((res) => (
      res.id === resId ? { ...res, status: newStatus } : res
    )));
  };

  const openReceiptMenu = (res) => {
    if (!res || res.status === 'cancelled') return;
    if (!(reservationTotalPrice(null, res) > 0)) return;
    setReceiptError('');
    setReceiptTarget(res);
  };

  const runBookingShareAction = async (res, action) => {
    if (!res || res.status === 'cancelled') return;
    if (!(reservationTotalPrice(null, res) > 0)) {
      setActionsError('Esta reserva no tiene importe para comprobante.');
      return;
    }
    const key = `${action}:${res.id}`;
    setActionsBusyKey(key);
    setActionsError('');
    setActionsNotice('');
    try {
      if (action === 'download') {
        openReceiptMenu(res);
        return;
      }
      const { member, payment } = bookingPaymentForShare(res, members);
      const share = paymentReceiptShareTargets(member, payment);
      if (action === 'whatsapp') {
        if (!share.whatsappUrl) {
          setActionsError('Este socio no tiene celular en la ficha.');
          return;
        }
        openExternal(share.whatsappUrl);
        setActionsNotice('WhatsApp abierto con el texto del comprobante.');
        return;
      }
      if (action === 'mail') {
        if (!share.email) {
          setActionsError('Este socio no tiene un mail real en la ficha.');
          return;
        }
        await sendDuesReceiptMessage({
          member,
          payment,
          channels: { md: false, email: true },
        });
        setActionsNotice('Comprobante enviado por mail.');
        return;
      }
      if (action === 'md') {
        if (typeof onSendMessage !== 'function') {
          setActionsError('La mensajería interna no está disponible.');
          return;
        }
        await sendDuesReceiptMessage({
          member,
          payment,
          onSendMessage,
          channels: { md: true, email: false },
        });
        setActionsNotice('Comprobante enviado por MD.');
      }
    } catch (err) {
      setActionsError(err?.message || 'No se pudo completar la acción.');
    } finally {
      setActionsBusyKey('');
    }
  };

  const completeBookingPayment = async (res) => {
    const balance = reservationOpenBalance(res);
    if (!(balance > 0) || res?.status === 'cancelled') return;
    const total = reservationTotalPrice(null, res);
    setActionsBusyKey(`settle:${res.id}`);
    setActionsError('');
    setActionsNotice('');
    try {
      let next = {
        ...res,
        chargedPrice: total,
        paidInFull: true,
        balanceAmount: balance,
        balancePaidAt: todayAR(),
        balancePaymentMethod: 'efectivo',
        notes: /Pago:\s*total alquiler/i.test(String(res.notes || ''))
          ? res.notes
          : [res.notes, 'Pago: total alquiler'].filter(Boolean).join('\n'),
      };
      const cloudId = /^[0-9a-f-]{36}$/i.test(String(res.id || ''));
      if (isSupabaseConfigured && cloudId) {
        const saved = await completeReservationPayment(res.id, 'efectivo');
        next = {
          ...next,
          chargedPrice: Number(saved?.chargedPrice) || total,
          paidInFull: true,
          balanceAmount: Number(saved?.balance) || balance,
        };
      }
      if (typeof setReservations === 'function') {
        setReservations((prev) => (prev || []).map((row) => (
          row.id === res.id ? { ...row, ...next } : row
        )));
      }
      const member = memberForReservation(next, members);
      const payment = buildBookingReceiptFromReservation(next, { member, payFull: true });
      void deliverPaymentReceipt({
        member,
        payment,
        onSendMessage,
        kind: 'reserva',
      });
      setActionsNotice('Alquiler saldado. El comprobante del total sale solo.');
      setOpenActionsId(res.id);
    } catch (err) {
      setActionsError(err?.message || 'No se pudo completar el pago.');
      setOpenActionsId(res.id);
    } finally {
      setActionsBusyKey('');
    }
  };

  const downloadBookingReceipt = async (payFull) => {
    if (!receiptTarget || receiptBusy) return;
    const total = reservationTotalPrice(null, receiptTarget);
    if (!(total > 0)) {
      setReceiptError('Esta reserva no tiene importe para comprobante.');
      return;
    }
    setReceiptBusy(true);
    setReceiptError('');
    try {
      const member = (members || []).find(
        (row) => String(row.memberId) === String(receiptTarget.memberId),
      ) || {
        memberId: receiptTarget.memberId,
        name: receiptTarget.memberName,
      };
      const payment = buildBookingReceiptFromReservation(receiptTarget, { member, payFull });
      await downloadPaymentReceiptPdf({ member, payment });
    } catch (err) {
      setReceiptError(err?.message || 'No se pudo generar el PDF.');
    } finally {
      setReceiptBusy(false);
    }
  };

  const downloadWeekPdf = async () => {
    if (weekPdfBusy) return;
    setWeekPdfBusy(true);
    try {
      const weekOf = selectedDate || todayAR();
      await exportWeekReservationsPdf(reservations, { weekOf });
    } catch (err) {
      window.alert(err?.message || 'No se pudo generar el PDF de la semana.');
    } finally {
      setWeekPdfBusy(false);
    }
  };

  const showCreatedColumn = searchActive || !selectedDate;
  const tableColSpan = (showCreatedColumn ? 8 : 7) + 1;

  const renderReservationsTable = (rows, { emptyLabel }) => (
    <div className="bookings-list-body table-responsive">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Nº</th>
            <th>Socio</th>
            <th>Instalación</th>
            <th>Fecha</th>
            <th>Horario</th>
            {showCreatedColumn ? <th>Alta</th> : null}
            <th>Importe</th>
            <th>Estado</th>
            <th style={{ textAlign: 'right' }}>Gestión</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={tableColSpan}
                style={{ color: 'var(--text-muted)', padding: '1.5rem 1rem' }}
              >
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((res) => (
              <tr
                key={res.id}
                className={detailReservationId === res.id ? 'is-selected-booking' : undefined}
              >
                <td>
                  <button
                    type="button"
                    className={`bookings-res-num${isAppReservation(res) ? ' is-app' : ''}`}
                    onClick={() => openReservationDetail(res)}
                    title="Abrir ficha de la reserva"
                  >
                    #{reservationAppNumber(res)}
                  </button>
                </td>
                <td>
                  <strong>{res.memberName}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Nº {res.memberId}
                    {isAppReservation(res) ? ' · App' : ''}
                  </div>
                </td>
                <td>
                  <span style={{ color: 'var(--text-gold)', fontWeight: 600 }}>{res.facilityName}</span>
                </td>
                <td className="bookings-when">{formatBookingDate(res.date)}</td>
                <td className="bookings-when">
                  {res.time || '—'}
                  {res.endTime ? <small>a {res.endTime}</small> : null}
                </td>
                {showCreatedColumn ? (
                  <td className="bookings-when">
                    {formatRelativeCreated(reservationCreatedAt(res)) || '—'}
                  </td>
                ) : null}
                <td className="bookings-money">
                  {formatMoney(res.chargedPrice || res.estimatedPrice) || (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td>
                  <div className="bookings-settle">
                    <span className={`bookings-status ${res.status}`}>
                      {statusLabel(res.status)}
                    </span>
                    {res.status !== 'cancelled' && reservationOpenBalance(res) > 0 ? (
                      <button
                        type="button"
                        className="bookings-settle-btn"
                        disabled={actionsBusyKey === `settle:${res.id}`}
                        onClick={() => completeBookingPayment(res)}
                      >
                        <span className="bookings-settle-btn-icon" aria-hidden="true">
                          {actionsBusyKey === `settle:${res.id}`
                            ? <Loader2 size={12} className="bookings-settle-spin" />
                            : <Banknote size={12} strokeWidth={2.25} />}
                        </span>
                        <span className="bookings-settle-btn-copy">
                          <strong>{actionsBusyKey === `settle:${res.id}` ? 'Guardando…' : 'Completar pago'}</strong>
                          <b>{formatMoney(reservationOpenBalance(res))}</b>
                        </span>
                      </button>
                    ) : null}
                    {res.status !== 'cancelled' && reservationTotalPrice(null, res) > 0 && reservationOpenBalance(res) <= 0 ? (
                      <span className="bookings-settle-note" style={{ color: 'var(--emerald-accent)' }}>Alquiler saldado</span>
                    ) : null}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {(() => {
                    const actionsOpen = openActionsId === res.id;
                    const canReceipt = res.status !== 'cancelled'
                      && reservationTotalPrice(null, res) > 0;
                    const { member, payment } = canReceipt
                      ? bookingPaymentForShare(res, members)
                      : { member: null, payment: null };
                    const share = canReceipt
                      ? paymentReceiptShareTargets(member, payment)
                      : { whatsappUrl: null, email: '' };
                    const rowBusy = actionsBusyKey.endsWith(`:${res.id}`);
                    return (
                      <div className="bookings-list-actions">
                        <div className={`bookings-actions-wrap${actionsOpen ? ' is-open' : ''}`}>
                          <button
                            type="button"
                            className="bookings-actions-toggle"
                            aria-expanded={actionsOpen}
                            aria-controls={`booking-actions-${res.id}`}
                            onClick={() => {
                              setActionsNotice('');
                              setActionsError('');
                              setOpenActionsId(actionsOpen ? null : res.id);
                            }}
                          >
                            <span>Gestión</span>
                            <ChevronDown size={14} aria-hidden="true" />
                          </button>
                          {actionsOpen ? (
                            <div
                              id={`booking-actions-${res.id}`}
                              className="bookings-actions-panel"
                            >
                              <dl className="bookings-taken-by">
                                <div>
                                  <dt>Tomó</dt>
                                  <dd>{reservationTakenByLabel(res) || '—'}</dd>
                                </div>
                              </dl>
                              {canReceipt ? (
                                <div
                                  className="bookings-actions-chips payment-receipts-actions"
                                  role="group"
                                  aria-label="Enviar o descargar comprobante"
                                >
                                  <button
                                    type="button"
                                    className="payment-receipts-chip tone-pdf"
                                    disabled={rowBusy}
                                    title="Descargar PDF"
                                    aria-label="Descargar PDF"
                                    onClick={() => runBookingShareAction(res, 'download')}
                                  >
                                    <Download size={13} aria-hidden="true" />
                                    <span>PDF</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="payment-receipts-chip tone-wa"
                                    disabled={rowBusy || !share.whatsappUrl}
                                    title={share.whatsappUrl ? 'Abrir WhatsApp' : 'Sin celular en ficha'}
                                    aria-label="Enviar por WhatsApp"
                                    onClick={() => runBookingShareAction(res, 'whatsapp')}
                                  >
                                    <Phone size={13} aria-hidden="true" />
                                    <span>WA</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="payment-receipts-chip tone-mail"
                                    disabled={rowBusy || !share.email}
                                    title={share.email ? 'Enviar por mail' : 'Sin mail real en ficha'}
                                    aria-label="Enviar por mail"
                                    onClick={() => runBookingShareAction(res, 'mail')}
                                  >
                                    {actionsBusyKey === `mail:${res.id}`
                                      ? <Loader2 size={13} className="spin" aria-hidden="true" />
                                      : <Mail size={13} aria-hidden="true" />}
                                    <span>Mail</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="payment-receipts-chip tone-md"
                                    disabled={rowBusy || typeof onSendMessage !== 'function'}
                                    title="Enviar por mensajería interna (MD)"
                                    aria-label="Enviar por MD"
                                    onClick={() => runBookingShareAction(res, 'md')}
                                  >
                                    {actionsBusyKey === `md:${res.id}`
                                      ? <Loader2 size={13} className="spin" aria-hidden="true" />
                                      : <MessageSquare size={13} aria-hidden="true" />}
                                    <span>MD</span>
                                  </button>
                                </div>
                              ) : (
                                <p className="bookings-actions-feedback">Sin comprobante para esta reserva.</p>
                              )}
                              <div className="bookings-actions-status">
                                {res.status === 'pending' ? (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{
                                      borderColor: 'var(--emerald-accent)',
                                      color: 'var(--emerald-accent)',
                                      background: 'rgba(16, 185, 129, 0.05)',
                                    }}
                                    onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                                  >
                                    Aprobar
                                  </button>
                                ) : null}
                                {res.status !== 'cancelled' ? (
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    onClick={() => handleUpdateReservationStatus(res.id, 'cancelled')}
                                  >
                                    Anular
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                                  >
                                    Reactivar
                                  </button>
                                )}
                              </div>
                              {actionsOpen && actionsNotice ? (
                                <p className="bookings-actions-feedback is-ok" role="status">{actionsNotice}</p>
                              ) : null}
                              {actionsOpen && actionsError ? (
                                <p className="bookings-actions-feedback is-err" role="alert">{actionsError}</p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="glass-card fade-in bookings-tab" style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      <style>{`
        .bookings-scope-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          min-height: 2rem;
          padding: 0.28rem 0.75rem;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--border-glass) 80%, transparent);
          background: color-mix(in srgb, var(--border-glass) 35%, transparent);
          color: var(--text-primary);
          font: inherit;
          font-size: 0.78rem;
          font-weight: 650;
          cursor: pointer;
          white-space: nowrap;
        }
        .bookings-scope-chip strong {
          font-variant-numeric: tabular-nums;
          color: var(--primary-gold);
        }
        .bookings-scope-chip em {
          font-style: normal;
          font-size: 0.7rem;
          color: #f59e0b;
          font-weight: 700;
        }
        .bookings-scope-chip.is-active {
          border-color: color-mix(in srgb, var(--primary-gold) 65%, transparent);
          background: color-mix(in srgb, var(--primary-gold) 18%, transparent);
        }
        .bookings-res-num {
          display: inline-flex;
          align-items: center;
          min-height: 1.7rem;
          padding: 0.15rem 0.55rem;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--border-glass) 80%, transparent);
          background: color-mix(in srgb, var(--border-glass) 30%, transparent);
          color: var(--text-primary);
          font: inherit;
          font-size: 0.72rem;
          font-weight: 750;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.03em;
          cursor: pointer;
        }
        .bookings-res-num.is-app {
          border-color: color-mix(in srgb, var(--primary-gold) 55%, transparent);
          color: var(--text-gold, var(--primary-gold));
        }
        .bookings-res-num:hover {
          border-color: var(--primary-gold);
          background: color-mix(in srgb, var(--primary-gold) 16%, transparent);
        }
        tr.is-selected-booking td {
          background: color-mix(in srgb, var(--primary-gold) 10%, transparent);
        }
        .bookings-detail-overlay {
          position: fixed;
          inset: 0;
          z-index: 80;
          display: flex;
          justify-content: flex-end;
          background: color-mix(in srgb, #000 42%, transparent);
        }
        .bookings-detail-panel {
          width: min(420px, 100vw);
          height: 100%;
          overflow: auto;
          padding: 1.1rem 1.15rem 1.5rem;
          background: var(--bg-card, #122018);
          border-left: 1px solid var(--border-glass);
          box-shadow: -12px 0 40px rgba(0, 0, 0, 0.28);
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }
        .bookings-detail-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
        }
        .bookings-detail-head h4 {
          margin: 0;
          font-size: 1.05rem;
        }
        .bookings-detail-head p {
          margin: 0.25rem 0 0;
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .bookings-detail-grid {
          display: grid;
          gap: 0.55rem;
        }
        .bookings-detail-grid div {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.45rem 0;
          border-bottom: 1px solid color-mix(in srgb, var(--border-glass) 70%, transparent);
          font-size: 0.84rem;
        }
        .bookings-detail-grid span {
          color: var(--text-muted);
        }
        .bookings-detail-grid strong {
          text-align: right;
          font-weight: 650;
        }
        .bookings-detail-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
          margin-top: auto;
        }
        .bookings-app-inbox {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          scroll-margin-top: 1rem;
        }
        .bookings-app-inbox-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .bookings-app-inbox-head h4 {
          margin: 0;
          font-size: 1.05rem;
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
        }
        .bookings-app-inbox-head p {
          margin: 0.3rem 0 0;
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .bookings-app-list {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
        }
        .bookings-app-card {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.65rem 0.85rem;
          align-items: center;
          width: 100%;
          padding: 0.85rem 0.95rem;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--border-glass) 85%, transparent);
          background: color-mix(in srgb, var(--border-glass) 22%, transparent);
          text-align: left;
        }
        .bookings-app-card.is-pending {
          border-color: color-mix(in srgb, #f59e0b 55%, transparent);
          background: color-mix(in srgb, #f59e0b 10%, transparent);
        }
        .bookings-app-card-main {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          min-width: 0;
        }
        .bookings-app-card-main strong {
          font-size: 0.95rem;
        }
        .bookings-app-card-main span {
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .bookings-app-card-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          justify-content: flex-end;
        }
        @media (max-width: 720px) {
          .bookings-app-card {
            grid-template-columns: 1fr;
          }
          .bookings-app-card-actions {
            justify-content: flex-start;
          }
        }
        .bookings-tab-toolbar {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          flex-wrap: wrap;
          padding-bottom: 0.35rem;
          border-bottom: 1px solid var(--border-glass);
        }
        .bookings-search {
          position: relative;
          display: flex;
          align-items: center;
          flex: 1 1 14rem;
          min-width: 12rem;
          max-width: 22rem;
        }
        .bookings-search > svg:first-child {
          position: absolute;
          left: 0.7rem;
          color: var(--text-muted);
          pointer-events: none;
        }
        .bookings-search-input {
          width: 100%;
          min-height: 2.35rem;
          padding: 0.4rem 2.2rem 0.4rem 2.25rem;
          border: 1px solid var(--border-glass);
          border-radius: 10px;
          background: color-mix(in srgb, var(--border-glass) 28%, transparent);
          color: var(--text-primary);
          font: inherit;
          font-size: 0.88rem;
        }
        .bookings-search-input::placeholder {
          color: var(--text-muted);
        }
        .bookings-search-input:focus {
          outline: 2px solid color-mix(in srgb, var(--primary-gold) 55%, transparent);
          outline-offset: 1px;
          border-color: color-mix(in srgb, var(--primary-gold) 45%, var(--border-glass));
        }
        .bookings-search-clear {
          position: absolute;
          right: 0.35rem;
          display: grid;
          place-items: center;
          width: 1.7rem;
          height: 1.7rem;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
        }
        .bookings-search-clear:hover {
          color: var(--text-primary);
          background: color-mix(in srgb, var(--text-muted) 14%, transparent);
        }
        .bookings-search-results {
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
          padding: 0.85rem 1rem 1rem;
          border: 1px solid var(--border-glass);
          border-radius: 14px;
          background: color-mix(in srgb, var(--border-glass) 22%, transparent);
        }
        .bookings-search-results-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .bookings-search-results-head h4 {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--text-primary);
        }
        .bookings-search-results-head p {
          margin: 0;
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .bookings-search-results .bookings-list-body {
          margin: 0;
        }
        .bookings-search-empty {
          margin: 0;
          padding: 1rem 0.25rem;
          font-size: 0.88rem;
          color: var(--text-muted);
        }
        .bookings-layout {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          width: 100%;
        }
        .bookings-cal {
          width: 100%;
          padding: 1.25rem 1.35rem 1.4rem;
          border: 1px solid var(--border-glass);
          border-radius: 16px;
          background: rgba(255,255,255,0.02);
        }
        .bookings-cal-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.85rem;
          margin-bottom: 1.05rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid color-mix(in srgb, var(--border-glass) 80%, transparent);
        }
        .bookings-cal-head h4 {
          margin: 0;
          font-size: 1.2rem;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.01em;
        }
        .bookings-cal-nav {
          display: inline-flex;
          gap: 0.4rem;
        }
        .bookings-cal-nav button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 10px;
          border: 1px solid var(--border-glass);
          background: rgba(255,255,255,0.03);
          color: var(--text-primary);
          cursor: pointer;
        }
        .bookings-cal-nav button:hover {
          border-color: var(--primary-gold);
          color: var(--primary-gold);
        }
        .bookings-cal-week {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 0.45rem;
          margin-bottom: 0.5rem;
        }
        .bookings-cal-week span {
          text-align: center;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          padding: 0.35rem 0;
          font-weight: 700;
        }
        .bookings-cal-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 0.5rem;
        }
        .bookings-cal-cell {
          min-height: 6.25rem;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--border-glass) 85%, transparent);
          background: rgba(255,255,255,0.025);
          padding: 0.55rem 0.45rem 0.5rem;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.35rem;
          cursor: pointer;
          color: var(--text-primary);
          font-family: inherit;
          transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
        }
        .bookings-cal-cell:hover:not(:disabled) {
          border-color: rgba(var(--primary-gold-rgb),0.5);
          background: rgba(var(--primary-gold-rgb),0.08);
          transform: translateY(-1px);
        }
        .bookings-cal-cell:disabled {
          cursor: default;
          opacity: 0.22;
          border-color: transparent;
          background: transparent;
        }
        .bookings-cal-cell.is-today {
          border-color: rgba(16,185,129,0.55);
          box-shadow: inset 0 0 0 1px rgba(16,185,129,0.18);
        }
        .bookings-cal-cell.is-selected {
          border-color: var(--primary-gold);
          background: rgba(var(--primary-gold-rgb),0.14);
          box-shadow: inset 0 0 0 1px rgba(var(--primary-gold-rgb),0.28);
        }
        .bookings-cal-cell.has-bookings {
          background: color-mix(in srgb, var(--primary-gold) 7%, rgba(255,255,255,0.04));
        }
        .bookings-cal-daynum {
          font-size: 1.05rem;
          font-weight: 750;
          line-height: 1;
          letter-spacing: -0.02em;
        }
        .bookings-cal-dots {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: auto;
        }
        .bookings-cal-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .bookings-cal-dot.confirmed { background: var(--emerald-accent); }
        .bookings-cal-dot.pending { background: #f59e0b; }
        .bookings-cal-dot.cancelled { background: #ef4444; }
        .bookings-cal-count {
          font-size: 0.72rem;
          font-weight: 650;
          color: var(--text-secondary);
        }
        .bookings-day-panel {
          margin-top: 1.15rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border-glass);
        }
        .bookings-day-panel h5 {
          margin: 0 0 0.7rem;
          font-size: 0.92rem;
          color: var(--text-gold);
        }
        .bookings-day-item {
          display: grid;
          grid-template-columns: 5rem minmax(0, 1fr) auto;
          gap: 0.75rem;
          align-items: center;
          font-size: 0.88rem;
          padding: 0.85rem 0.15rem;
          border-bottom: 1px solid var(--border-glass);
        }
        .bookings-day-item:last-child { border-bottom: none; }
        .bookings-day-time {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--text-gold);
          line-height: 1.15;
        }
        .bookings-day-time small {
          display: block;
          margin-top: 0.15rem;
          font-weight: 500;
          font-size: 0.68rem;
          letter-spacing: 0;
          color: var(--text-muted);
        }
        .bookings-day-copy {
          min-width: 0;
        }
        .bookings-day-copy strong,
        .bookings-day-place {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bookings-day-place {
          color: var(--text-muted);
          margin-top: 0.12rem;
        }
        .bookings-day-side {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.28rem;
        }
        .bookings-money {
          font-variant-numeric: tabular-nums;
          font-weight: 650;
          letter-spacing: -0.02em;
        }
        .bookings-status {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          padding: 0.18rem 0.5rem;
          border-radius: 999px;
          font-size: 0.68rem;
          font-weight: 650;
          letter-spacing: 0.01em;
          line-height: 1.2;
          border: 1px solid transparent;
        }
        .bookings-status.confirmed {
          color: var(--emerald-accent);
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.28);
        }
        .bookings-settle {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.35rem;
        }
        .bookings-settle-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.28rem;
          width: fit-content;
          padding: 0.18rem 0.5rem;
          border: 1px solid color-mix(in srgb, var(--primary-gold) 55%, var(--border-glass));
          border-radius: 999px;
          background: color-mix(in srgb, var(--primary-gold) 18%, var(--surface-card, transparent));
          color: var(--text-primary);
          font: inherit;
          font-size: 0.68rem;
          font-weight: 650;
          letter-spacing: 0.01em;
          line-height: 1.2;
          cursor: pointer;
          text-align: left;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .bookings-settle-btn:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary-gold) 28%, var(--surface-card, transparent));
          border-color: color-mix(in srgb, var(--primary-gold) 70%, var(--border-glass));
        }
        .bookings-settle-btn:focus-visible {
          outline: 2px solid var(--primary-gold);
          outline-offset: 2px;
        }
        .bookings-settle-btn:disabled {
          opacity: 0.72;
          cursor: wait;
        }
        .bookings-settle-btn-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: var(--primary-gold);
        }
        .bookings-settle-btn-copy {
          display: inline-flex;
          align-items: baseline;
          gap: 0.28rem;
          min-width: 0;
          line-height: 1.2;
          white-space: nowrap;
        }
        .bookings-settle-btn-copy strong {
          font-size: inherit;
          font-weight: inherit;
          letter-spacing: inherit;
          text-transform: none;
          color: inherit;
        }
        .bookings-settle-btn-copy b {
          font-size: inherit;
          font-weight: inherit;
          font-variant-numeric: tabular-nums;
          color: var(--text-gold, var(--primary-gold));
        }
        .bookings-settle-spin {
          animation: bookings-settle-spin 0.8s linear infinite;
        }
        @keyframes bookings-settle-spin {
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .bookings-settle-btn,
          .bookings-settle-spin {
            transition: none;
            animation: none;
          }
        }
        .bookings-settle-note {
          margin: 0;
          font-size: 0.68rem;
          line-height: 1.3;
          max-width: 11rem;
        }
        .bookings-status.pending {
          color: var(--warning-accent);
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.28);
        }
        .bookings-status.cancelled {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.25);
        }
        .bookings-when {
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .bookings-when small {
          display: block;
          margin-top: 0.12rem;
          color: var(--text-muted);
          font-weight: 500;
        }
        .bookings-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          margin-top: 1rem;
          padding-top: 0.85rem;
          border-top: 1px solid color-mix(in srgb, var(--border-glass) 75%, transparent);
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .bookings-legend span {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }
        .bookings-table-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
          margin-bottom: 0;
          width: 100%;
        }
        .bookings-list-panel {
          width: 100%;
          border: 1px solid var(--border-glass);
          border-radius: 14px;
          overflow: hidden;
          background: color-mix(in srgb, var(--bg-card, transparent) 88%, transparent);
        }
        .bookings-list-toggle {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
          padding: 0.85rem 1rem;
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
          text-align: left;
        }
        .bookings-list-toggle:hover {
          background: color-mix(in srgb, var(--primary-gold) 6%, transparent);
        }
        .bookings-list-toggle-main {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          min-width: 0;
          flex: 1;
        }
        .bookings-list-title-row {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          flex-wrap: wrap;
        }
        .bookings-notif-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          min-height: 1.4rem;
          padding: 0.12rem 0.55rem;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.01em;
          background: color-mix(in srgb, #f59e0b 22%, transparent);
          color: #fbbf24;
          border: 1px solid color-mix(in srgb, #f59e0b 45%, transparent);
        }
        .bookings-notif-badge.is-clear {
          background: color-mix(in srgb, var(--emerald-accent) 14%, transparent);
          color: var(--emerald-accent);
          border-color: color-mix(in srgb, var(--emerald-accent) 35%, transparent);
        }
        .bookings-list-chevron {
          flex-shrink: 0;
          transition: transform 0.18s ease;
          color: var(--text-muted);
        }
        .bookings-list-chevron.is-open {
          transform: rotate(180deg);
        }
        .bookings-inbox {
          border-top: 1px solid var(--border-glass);
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          padding: 0.65rem 0.85rem 0.85rem;
        }
        .bookings-inbox-label {
          margin: 0 0 0.15rem;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .bookings-inbox-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.55rem 0.75rem;
          align-items: center;
          padding: 0.55rem 0.65rem;
          border-radius: 10px;
          border: 1px solid var(--border-glass);
          background: color-mix(in srgb, var(--bg-card, transparent) 70%, transparent);
          text-align: left;
          color: inherit;
          cursor: pointer;
          width: 100%;
        }
        .bookings-inbox-item:hover {
          border-color: color-mix(in srgb, var(--primary-gold) 40%, var(--border-glass));
          background: color-mix(in srgb, var(--primary-gold) 7%, transparent);
        }
        .bookings-inbox-item.is-pending {
          border-color: color-mix(in srgb, #f59e0b 40%, var(--border-glass));
          background: color-mix(in srgb, #f59e0b 8%, transparent);
        }
        .bookings-inbox-copy strong {
          display: block;
          font-size: 0.86rem;
          font-weight: 650;
          color: var(--text-primary);
        }
        .bookings-inbox-copy span {
          display: block;
          margin-top: 0.12rem;
          font-size: 0.74rem;
          color: var(--text-muted);
        }
        .bookings-inbox-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.25rem;
          flex-shrink: 0;
        }
        .bookings-inbox-meta small {
          font-size: 0.68rem;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .bookings-receipt-overlay {
          position: fixed;
          inset: 0;
          z-index: 80;
          display: grid;
          place-items: center;
          padding: 1rem;
          background: color-mix(in srgb, #0b1220 55%, transparent);
        }
        .bookings-receipt-dialog {
          width: min(26rem, 100%);
          display: grid;
          gap: 0.75rem;
          padding: 1rem 1.1rem;
          border-radius: 14px;
          border: 1px solid var(--border-glass);
          background: var(--bg-primary);
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
        }
        .bookings-receipt-dialog h4 {
          margin: 0;
          font-size: 1.05rem;
        }
        .bookings-receipt-dialog p {
          margin: 0;
          font-size: 0.82rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        .bookings-receipt-actions {
          display: grid;
          gap: 0.45rem;
        }
        .bookings-receipt-actions .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.4rem;
        }
        .bookings-receipt-error {
          margin: 0;
          font-size: 0.8rem;
          color: var(--danger-accent);
        }
        .bookings-receipt-foot {
          display: flex;
          justify-content: flex-end;
        }
        .bookings-list-body {
          border-top: 1px solid var(--border-glass);
          max-height: min(70vh, 640px);
          overflow: auto;
        }
        .bookings-list-actions {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.45rem;
          min-width: 11rem;
        }
        .bookings-actions-wrap {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.45rem;
          width: 100%;
        }
        .bookings-actions-toggle {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          min-height: 1.85rem;
          padding: 0.25rem 0.7rem;
          border: 1px solid color-mix(in srgb, var(--border-glass) 80%, transparent);
          border-radius: 999px;
          background: color-mix(in srgb, var(--border-glass) 40%, var(--surface-card, transparent));
          color: var(--text-primary);
          font: inherit;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .bookings-actions-toggle svg {
          transition: transform 0.16s ease;
        }
        .bookings-actions-wrap.is-open .bookings-actions-toggle svg {
          transform: rotate(180deg);
        }
        .bookings-actions-panel {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          width: 100%;
          max-width: 16rem;
          padding: 0.55rem 0.6rem;
          border-radius: 0.75rem;
          background: color-mix(in srgb, var(--border-glass) 35%, var(--surface-card, transparent));
          border: 1px solid color-mix(in srgb, var(--border-glass) 75%, transparent);
          text-align: left;
        }
        .bookings-taken-by {
          display: grid;
          gap: 0.35rem;
          margin: 0;
        }
        .bookings-taken-by > div {
          display: grid;
          grid-template-columns: 4.2rem 1fr;
          gap: 0.35rem;
          align-items: baseline;
        }
        .bookings-taken-by dt {
          margin: 0;
          color: var(--text-muted);
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .bookings-taken-by dd {
          margin: 0;
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.25;
          word-break: break-word;
        }
        .bookings-actions-chips {
          display: inline-flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.28rem;
        }
        .bookings-actions-chips .payment-receipts-chip {
          min-height: 1.7rem;
        }
        .bookings-actions-status {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .bookings-actions-status .btn {
          min-width: 0;
          min-height: 1.85rem;
          padding: 0.28rem 0.65rem;
          font-size: 0.72rem;
        }
        .bookings-actions-feedback {
          margin: 0;
          font-size: 0.72rem;
          line-height: 1.3;
        }
        .bookings-actions-feedback.is-ok { color: var(--emerald-accent); }
        .bookings-actions-feedback.is-err { color: var(--danger-accent, #ef4444); }
        @media (max-width: 720px) {
          .bookings-cal-cell {
            min-height: 4.6rem;
          }
          .bookings-cal-daynum {
            font-size: 0.92rem;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .bookings-cal-cell:hover:not(:disabled) {
            transform: none;
          }
        }
      `}</style>

      <div className="bookings-tab-toolbar">
        <CalendarDays size={22} color="var(--primary-gold)" />
        <h3 className="serif-font" style={{ fontSize: '1.5rem', margin: 0, flex: '0 1 auto', minWidth: 0 }}>
          Libro de Reservas
        </h3>
        <button
          type="button"
          className={`bookings-scope-chip${listScope === 'app' ? ' is-active' : ''}`}
          aria-pressed={listScope === 'app'}
          onClick={enterAppReservationsScope}
          title="Ver y gestionar reservas hechas desde la app del socio"
        >
          Reservas de la app
          <strong>{appReservations.length}</strong>
          {appPendingCount > 0 ? <em>{appPendingCount} pend.</em> : null}
        </button>
        <div className="bookings-search">
          <Search size={15} aria-hidden="true" />
          <label className="sr-only" htmlFor="bookings-search-input">Buscar reservas</label>
          <input
            id="bookings-search-input"
            type="search"
            className="bookings-search-input"
            value={searchQuery}
            onChange={(e) => setBookingSearch(e.target.value)}
            placeholder="Socio, Nº reserva, espacio, fecha…"
            autoComplete="off"
            aria-controls="bookings-search-results"
            aria-expanded={searchActive}
          />
          {searchQuery ? (
            <button
              type="button"
              className="bookings-search-clear"
              aria-label="Limpiar búsqueda"
              onClick={() => setBookingSearch('')}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => { void downloadWeekPdf(); }}
          disabled={weekPdfBusy}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title="Descargar PDF con todas las reservas de la semana (lun–dom)"
        >
          <Download size={15} aria-hidden />
          {weekPdfBusy ? 'Generando…' : 'PDF semana'}
        </button>
        {typeof addReservation === 'function' ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setNewReservationOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={15} />
            Nueva reserva
          </button>
        ) : null}
      </div>

      {searchActive ? (
        <section
          className="bookings-search-results"
          id="bookings-search-results"
          aria-live="polite"
        >
          <div className="bookings-search-results-head">
            <h4>
              {filteredReservations.length === 1
                ? '1 reserva encontrada'
                : `${filteredReservations.length} reservas encontradas`}
            </h4>
            <p>
              Búsqueda: “{searchQuery.trim()}”
            </p>
          </div>
          {renderReservationsTable(filteredReservations, {
            emptyLabel: 'Ninguna reserva coincide con la búsqueda.',
          })}
        </section>
      ) : null}

      <AdminNewReservationDialog
        open={newReservationOpen}
        onClose={() => setNewReservationOpen(false)}
        members={members}
        reservations={reservations}
        facilityCatalog={facilityCatalog}
        addReservation={addReservation}
        onSendMessage={onSendMessage}
        onCreated={(saved) => {
          const day = String(saved?.date || '').slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            const d = new Date(`${day}T12:00:00`);
            if (!Number.isNaN(d.getTime())) {
              setCursor({ year: d.getFullYear(), month: d.getMonth() });
              setSelectedDate(day);
              setListOpen(true);
            }
          }
        }}
      />

      {receiptTarget ? (
        <div
          className="bookings-receipt-overlay"
          role="presentation"
          onClick={() => {
            if (!receiptBusy) {
              setReceiptTarget(null);
              setReceiptError('');
            }
          }}
        >
          <div
            className="bookings-receipt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bookings-receipt-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id="bookings-receipt-title">Comprobante de pago</h4>
            <p>
              <strong>{receiptTarget.memberName || 'Socio'}</strong>
              {' · '}
              {receiptTarget.facilityName || receiptTarget.facilityId || 'Instalación'}
              {' · '}
              {formatBookingDate(receiptTarget.date)}
              {receiptTarget.time ? ` · ${receiptTarget.time}` : ''}
            </p>
            <div className="bookings-receipt-actions">
              {reservationPaidInFull(receiptTarget) ? null : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={receiptBusy}
                  onClick={() => { void downloadBookingReceipt(false); }}
                >
                  <Download size={15} aria-hidden />
                  {receiptBusy ? 'Generando…' : 'Descargar seña (50 %)'}
                </button>
              )}
              <button
                type="button"
                className={reservationPaidInFull(receiptTarget) ? 'btn btn-primary' : 'btn btn-secondary'}
                disabled={receiptBusy}
                onClick={() => { void downloadBookingReceipt(true); }}
              >
                <Download size={15} aria-hidden />
                {receiptBusy ? 'Generando…' : 'Descargar pago total'}
              </button>
            </div>
            {receiptError ? <p className="bookings-receipt-error">{receiptError}</p> : null}
            <div className="bookings-receipt-foot">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={receiptBusy}
                onClick={() => {
                  setReceiptTarget(null);
                  setReceiptError('');
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {listScope === 'app' && !searchActive ? (
        <section className="bookings-app-inbox" id="bookings-app-inbox" aria-label="Reservas de la app">
          <div className="bookings-app-inbox-head">
            <div>
              <h4>
                <Smartphone size={18} aria-hidden />
                Reservas de la app
              </h4>
              <p>
                {appReservations.length === 0
                  ? 'Todavía no hay pedidos desde el portal del socio.'
                  : `${appReservations.length} reserva${appReservations.length === 1 ? '' : 's'}${
                    appPendingCount > 0
                      ? ` · ${appPendingCount} pendiente${appPendingCount === 1 ? '' : 's'} de aprobación`
                      : ''
                  }`}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={exitAppReservationsScope}
            >
              Volver al libro
            </button>
          </div>

          {appReservations.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Cuando un socio reserve desde Mi cuenta / Reservar, aparece acá para confirmar, anular o ver el detalle.
            </p>
          ) : (
            <div className="bookings-app-list">
              {[...appReservations]
                .toSorted((a, b) => compareReservationsLatest(a, b, { pendingFirst: true }))
                .map((res) => {
                  const busy = actionsBusyKey.endsWith(`:${res.id}`);
                  const money = formatMoney(res.chargedPrice || res.estimatedPrice);
                  return (
                    <article
                      key={res.id}
                      className={`bookings-app-card${res.status === 'pending' ? ' is-pending' : ''}`}
                    >
                      <div className="bookings-app-card-main">
                        <strong>
                          #{reservationAppNumber(res)}
                          {' · '}
                          {res.memberName || 'Socio'}
                        </strong>
                        <span>
                          {res.facilityName || res.facilityId || 'Espacio'}
                          {' · '}
                          {formatBookingDate(res.date)}
                          {res.time ? ` · ${res.time}` : ''}
                          {res.endTime ? `–${res.endTime}` : ''}
                        </span>
                        <span>
                          <span className={`bookings-status ${res.status}`}>{statusLabel(res.status)}</span>
                          {money ? ` · ${money}` : ''}
                          {reservationCreatedAt(res)
                            ? ` · alta ${formatRelativeCreated(reservationCreatedAt(res))}`
                            : ''}
                        </span>
                      </div>
                      <div className="bookings-app-card-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openReservationDetail(res, { jumpCalendar: false })}
                        >
                          <Eye size={14} aria-hidden />
                          Detalle
                        </button>
                        {res.status === 'pending' ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                          >
                            <Check size={14} aria-hidden />
                            Aprobar
                          </button>
                        ) : null}
                        {res.status !== 'cancelled' ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            onClick={() => handleUpdateReservationStatus(res.id, 'cancelled')}
                          >
                            Anular
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                          >
                            Reactivar
                          </button>
                        )}
                        {res.status !== 'cancelled' && reservationOpenBalance(res) > 0 ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={actionsBusyKey === `settle:${res.id}`}
                            onClick={() => completeBookingPayment(res)}
                          >
                            Completar pago
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
            </div>
          )}
        </section>
      ) : null}

      <div className="bookings-layout" hidden={searchActive || listScope === 'app'}>
        <aside className="bookings-cal">
          <div className="bookings-cal-head">
            <h4>{monthLabel(cursor.year, cursor.month)}</h4>
            <div className="bookings-cal-nav">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCursor({ year: today.getFullYear(), month: today.getMonth() });
                  setSelectedDate(todayKey);
                }}
                aria-label="Ir a hoy"
                style={{ width: 'auto', padding: '0 0.65rem', fontSize: '0.75rem', fontWeight: 600 }}
              >
                Hoy
              </button>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="bookings-cal-week">
            {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="bookings-cal-grid">
            {calendarCells.map((cell) => (
              cell.empty ? (
                <button key={cell.key} type="button" className="bookings-cal-cell" disabled aria-hidden="true" />
              ) : (
                <button
                  key={cell.key}
                  type="button"
                  className={[
                    'bookings-cal-cell',
                    cell.isToday ? 'is-today' : '',
                    cell.isSelected ? 'is-selected' : '',
                    cell.total > 0 ? 'has-bookings' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => selectCalendarDay(cell.iso)}
                  title={cell.tooltip || 'Sin reservas'}
                >
                  <span className="bookings-cal-daynum">{cell.day}</span>
                  {cell.total > 0 && (
                    <>
                      <span className="bookings-cal-count">{cell.total}</span>
                      <span className="bookings-cal-dots">
                        {Array.from({ length: Math.min(cell.confirmed, 3) }).map((_, i) => (
                          <span key={`c-${i}`} className="bookings-cal-dot confirmed" />
                        ))}
                        {Array.from({ length: Math.min(cell.pending, 2) }).map((_, i) => (
                          <span key={`p-${i}`} className="bookings-cal-dot pending" />
                        ))}
                        {cell.cancelled > 0 && <span className="bookings-cal-dot cancelled" />}
                      </span>
                    </>
                  )}
                </button>
              )
            ))}
          </div>

          <div className="bookings-legend">
            <span><i className="bookings-cal-dot confirmed" /> Confirmada</span>
            <span><i className="bookings-cal-dot pending" /> Pendiente</span>
            <span><i className="bookings-cal-dot cancelled" /> Cancelada</span>
          </div>

          {selectedDate && (
            <div className="bookings-day-panel">
              <h5>
                {new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-AR', {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}
              </h5>
              {selectedDayList.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Sin turnos este día.
                </p>
              ) : (
                selectedDayList.map((res) => {
                  const money = formatMoney(res.chargedPrice || res.estimatedPrice);
                  return (
                    <div key={res.id} className="bookings-day-item">
                      <div className="bookings-day-time">
                        {res.time || '—'}
                        {res.endTime ? <small>a {res.endTime}</small> : null}
                      </div>
                      <div className="bookings-day-copy">
                        <strong>{res.memberName}</strong>
                        <span className="bookings-day-place">{res.facilityName}</span>
                      </div>
                      <div className="bookings-day-side">
                        {money ? <span className="bookings-money">{money}</span> : null}
                        <span className={`bookings-status ${res.status}`}>{statusLabel(res.status)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </aside>

        <div className="bookings-list-panel">
          <div className="bookings-table-head">
            <button
              type="button"
              className="bookings-list-toggle"
              aria-expanded={listOpen}
              onClick={() => setListOpen((v) => !v)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <div className="bookings-list-toggle-main">
                <div style={{ minWidth: 0 }}>
                  <div className="bookings-list-title-row">
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>
                      {listScope === 'app'
                        ? (selectedDate
                          ? `App · ${new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-AR')}`
                          : 'Reservas de la app')
                        : selectedDate
                          ? `Turnos del ${new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-AR')}`
                          : `Reservas · ${currentMonthLabel}`}
                    </h4>
                    {!selectedDate ? (
                      <span
                        className={`bookings-notif-badge${pendingCount ? '' : ' is-clear'}`}
                        aria-label={pendingCount
                          ? `${pendingCount} pendientes de aprobación`
                          : 'Sin pendientes'}
                      >
                        {pendingCount
                          ? `${pendingCount} pendiente${pendingCount === 1 ? '' : 's'}`
                          : 'Al día'}
                      </span>
                    ) : null}
                  </div>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {selectedDate
                      ? `${filteredReservations.length} turno${filteredReservations.length === 1 ? '' : 's'} del día`
                      : `${monthReservations.length} en ${currentMonthLabel.toLowerCase()}`}
                    {listOpen ? ' · clic para plegar' : ' · clic para expandir la tabla'}
                  </p>
                </div>
              </div>
              <ChevronDown size={18} className={`bookings-list-chevron${listOpen ? ' is-open' : ''}`} aria-hidden />
            </button>
            {selectedDate ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSelectedDate(null);
                  setListOpen(true);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: '0.5rem' }}
              >
                <X size={14} /> Ver mes
              </button>
            ) : null}
          </div>

          {!listOpen && !selectedDate && latestReservations.length > 0 ? (
            <div className="bookings-inbox" aria-label="Notificaciones de reservas">
              <p className="bookings-inbox-label">
                {pendingCount
                  ? `${currentMonthLabel} · pendientes y últimas 10`
                  : `${currentMonthLabel} · últimas 10`}
              </p>
              {latestReservations.map((res) => (
                <button
                  key={res.id}
                  type="button"
                  className={`bookings-inbox-item${res.status === 'pending' ? ' is-pending' : ''}`}
                  onClick={() => {
                    if (res.status === 'cancelled' || !(reservationTotalPrice(null, res) > 0)) {
                      setSelectedDate(res.date || null);
                      setListOpen(true);
                      if (res.date) {
                        const d = new Date(`${String(res.date).slice(0, 10)}T12:00:00`);
                        if (!Number.isNaN(d.getTime())) {
                          setCursor({ year: d.getFullYear(), month: d.getMonth() });
                        }
                      }
                      return;
                    }
                    openReceiptMenu(res);
                  }}
                >
                  <div className="bookings-inbox-copy">
                    <strong>{res.memberName || 'Socio'}</strong>
                    <span>
                      {res.facilityName || res.facilityId || 'Instalación'}
                      {' · '}
                      {formatBookingDate(res.date)}
                      {res.time ? ` · ${res.time}` : ''}
                    </span>
                  </div>
                  <div className="bookings-inbox-meta">
                    <span className={`bookings-status ${res.status}`}>{statusLabel(res.status)}</span>
                    <small>{formatRelativeCreated(reservationCreatedAt(res)) || '—'}</small>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {listOpen
            ? renderReservationsTable(filteredReservations, {
              emptyLabel: listScope === 'app'
                ? 'No hay reservas de la app para mostrar.'
                : 'No hay reservas para mostrar.',
            })
            : null}
        </div>
      </div>

      {detailReservation ? (
        <div
          className="bookings-detail-overlay"
          role="presentation"
          onClick={() => setDetailReservationId(null)}
        >
          <aside
            className="bookings-detail-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bookings-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bookings-detail-head">
              <div>
                <h4 id="bookings-detail-title">
                  Reserva #{reservationAppNumber(detailReservation)}
                </h4>
                <p>
                  {isAppReservation(detailReservation) ? 'Origen: app del socio' : 'Origen: administración / otro'}
                  {reservationTakenByLabel(detailReservation)
                    ? ` · ${reservationTakenByLabel(detailReservation)}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label="Cerrar ficha"
                onClick={() => setDetailReservationId(null)}
              >
                <X size={14} />
              </button>
            </div>

            <div className="bookings-detail-grid">
              <div>
                <span>Estado</span>
                <strong>{statusLabel(detailReservation.status)}</strong>
              </div>
              <div>
                <span>Socio</span>
                <strong>{detailReservation.memberName || '—'} · Nº {detailReservation.memberId || '—'}</strong>
              </div>
              <div>
                <span>Espacio</span>
                <strong>{detailReservation.facilityName || detailReservation.facilityId || '—'}</strong>
              </div>
              <div>
                <span>Fecha</span>
                <strong>{formatBookingDate(detailReservation.date)}</strong>
              </div>
              <div>
                <span>Horario</span>
                <strong>
                  {detailReservation.time || '—'}
                  {detailReservation.endTime ? ` → ${detailReservation.endTime}` : ''}
                </strong>
              </div>
              <div>
                <span>Invitados</span>
                <strong>
                  {Number(detailReservation.guests) || 0}
                  {detailReservation.guestNames ? ` · ${detailReservation.guestNames}` : ''}
                </strong>
              </div>
              <div>
                <span>Total / cobrado</span>
                <strong>
                  {formatMoney(reservationTotalPrice(null, detailReservation)) || '—'}
                  {' / '}
                  {formatMoney(detailReservation.chargedPrice) || '—'}
                </strong>
              </div>
              <div>
                <span>Saldo</span>
                <strong>{formatMoney(reservationOpenBalance(detailReservation)) || '$ 0'}</strong>
              </div>
              <div>
                <span>Alta</span>
                <strong>
                  {detailReservation.createdAt
                    ? new Date(detailReservation.createdAt).toLocaleString('es-AR')
                    : '—'}
                </strong>
              </div>
              {detailReservation.notes ? (
                <div>
                  <span>Notas</span>
                  <strong style={{ whiteSpace: 'pre-wrap' }}>{detailReservation.notes}</strong>
                </div>
              ) : null}
            </div>

            <div className="bookings-detail-actions">
              {detailReservation.status === 'pending' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={Boolean(actionsBusyKey)}
                    onClick={() => {
                      void handleUpdateReservationStatus(detailReservation.id, 'confirmed');
                      setDetailReservationId(null);
                    }}
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={Boolean(actionsBusyKey)}
                    onClick={() => {
                      void handleUpdateReservationStatus(detailReservation.id, 'cancelled');
                      setDetailReservationId(null);
                    }}
                  >
                    Rechazar
                  </button>
                </>
              ) : null}
              {detailReservation.status === 'confirmed' ? (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={Boolean(actionsBusyKey)}
                  onClick={() => {
                    void handleUpdateReservationStatus(detailReservation.id, 'cancelled');
                    setDetailReservationId(null);
                  }}
                >
                  Anular
                </button>
              ) : null}
              {detailReservation.status === 'cancelled' ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={Boolean(actionsBusyKey)}
                  onClick={() => {
                    void handleUpdateReservationStatus(detailReservation.id, 'confirmed');
                    setDetailReservationId(null);
                  }}
                >
                  Reactivar
                </button>
              ) : null}
              {detailReservation.status !== 'cancelled'
                && reservationOpenBalance(detailReservation) > 0 ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={actionsBusyKey === `settle:${detailReservation.id}`}
                  onClick={() => {
                    void completeBookingPayment(detailReservation);
                  }}
                >
                  Completar pago
                </button>
              ) : null}
              {detailReservation.status !== 'cancelled'
                && reservationTotalPrice(null, detailReservation) > 0 ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openReceiptMenu(detailReservation)}
                >
                  Comprobante
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

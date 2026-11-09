import { useEffect, useMemo, useState } from 'react';
import { X, Search, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { FACILITIES, isDemoFacilityId, isPoolFacility } from '../../domain/reservations/facilities';
import { buildFacilityCatalog } from '../../domain/reservations/facilityConfig';
import {
  facilityTurns,
  reservationTotalPrice,
  reservationDepositAmount,
  reservationBalanceAfterDeposit,
  RESERVATION_DEPOSIT_RATE,
  validateMemberBooking,
} from '../../domain/reservations/bookingRules';
import { facilityDayTaken, hasReservationConflict } from '../../domain/reservations/conflicts';
import { CLUB_BANK_ACCOUNTS } from '../../domain/members/clubBanks';
import { uploadDuesReceipt } from '../../data/storage';
import { todayAR, todayISODateAR } from '../../lib/arDate';
import { isSupabaseConfigured } from '../../lib/supabase';
import * as repos from '../../data/repos';
import MercadoPagoCheckout from '../MercadoPagoCheckout';
import { useAuth } from '../../context/AuthContext';
import { buildBookingPaymentReceipt } from '../../domain/reservations/bookingReceipt';
import { downloadPaymentReceiptPdf } from '../../domain/members/exportPaymentReceiptPdf';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';

const PAY_METHODS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'mercadopago', label: 'Mercado Pago' },
  { id: 'cuenta_corriente', label: 'Seña a cuenta' },
];

function money(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v);
}

function memberMatches(member, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  const digits = q.replace(/\D/g, '');
  const number = String(member?.memberId || '').replace(/\D/g, '');
  const name = String(member?.name || '').toLowerCase();
  const doc = String(member?.documentNumber || '').replace(/\D/g, '');
  if (digits.length >= 2 && (number.includes(digits) || doc.includes(digits))) return true;
  return name.includes(q);
}

/**
 * Alta de reserva desde administración: socio, espacio, fecha/turno, seña 50 % y medio de pago.
 */
export default function AdminNewReservationDialog({
  open,
  onClose,
  members = [],
  reservations = [],
  facilityCatalog = null,
  addReservation,
  onCreated,
  onSendMessage,
}) {
  const catalog = useMemo(
    () => buildFacilityCatalog(FACILITIES, Array.isArray(facilityCatalog) ? facilityCatalog : [])
      .filter((f) => !isDemoFacilityId(f.id) && !isPoolFacility(f)),
    [facilityCatalog],
  );

  const [memberQuery, setMemberQuery] = useState('');
  const [remoteHits, setRemoteHits] = useState([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [member, setMember] = useState(null);
  const [facilityId, setFacilityId] = useState(catalog[0]?.id || '');
  const [date, setDate] = useState(todayISODateAR());
  const [time, setTime] = useState('');
  const { user } = useAuth();
  const [payMethod, setPayMethod] = useState('efectivo');
  const [payScope, setPayScope] = useState('deposit'); // deposit | total
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState('');
  /** Carga manual: papel en mano, sin subir archivo. */
  const [hasPhysicalReceipt, setHasPhysicalReceipt] = useState(false);
  const [mpPaidIntent, setMpPaidIntent] = useState(null);

  const facility = catalog.find((f) => f.id === facilityId) || null;
  const turns = facilityTurns(facility);
  const total = reservationTotalPrice(facility);
  const deposit = reservationDepositAmount(total);
  const payFull = payScope === 'total';
  const chargeAmount = payFull ? total : deposit;
  const remainingAfterPay = payFull ? 0 : reservationBalanceAfterDeposit(total);
  const bank = CLUB_BANK_ACCOUNTS[0];
  const transferReceiptOk = Boolean(receiptFile) || hasPhysicalReceipt;
  const selectedTurn = turns.find((turn) => turn.time === time) || null;
  const slotTaken = Boolean(
    facility && date && time
    && (selectedTurn?.openDay
      ? facilityDayTaken(reservations, { facilityId: facility.id, date })
      : hasReservationConflict(reservations, { facilityId: facility.id, date, time })),
  );
  const slotCheck = useMemo(() => {
    if (!facility || !date || !time) {
      return { ok: false, label: 'Elegí fecha y turno.', tone: 'muted' };
    }
    if (slotTaken) {
      return { ok: false, label: 'Ese día y horario ya están reservados.', tone: 'bad' };
    }
    const check = validateMemberBooking({
      facility,
      member: member || { memberId: '0', name: '—' },
      reservations,
      date,
      time,
      guests: 0,
      asAdmin: true,
    });
    if (!check.ok) {
      return { ok: false, label: check.error || 'Turno no disponible.', tone: 'bad' };
    }
    return { ok: true, label: 'Disponible para ese día y horario.', tone: 'ok' };
  }, [facility, date, time, slotTaken, member, reservations]);

  const turnsWithAvailability = useMemo(
    () => turns.map((turn) => ({
      ...turn,
      taken: Boolean(
        facility
        && date
        && (turn.openDay
          ? facilityDayTaken(reservations, { facilityId: facility.id, date })
          : hasReservationConflict(reservations, { facilityId: facility.id, date, time: turn.time })),
      ),
    })),
    [turns, facility, date, reservations],
  );

  useEffect(() => {
    if (!open) return;
    setMemberQuery('');
    setRemoteHits([]);
    setMember(null);
    setFacilityId(catalog[0]?.id || '');
    setDate(todayISODateAR());
    setTime('');
    setPayMethod('efectivo');
    setPayScope('deposit');
    setNotes('');
    setBusy(false);
    setError('');
    setReceiptFile(null);
    setHasPhysicalReceipt(false);
    setReceiptPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setMpPaidIntent(null);
  }, [open, catalog]);

  useEffect(() => {
    if (!facility) return;
    const first = facilityTurns(facility)[0]?.time || '';
    setTime((prev) => (turns.some((t) => t.time === prev) ? prev : first));
  }, [facilityId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset turn when space changes

  useEffect(() => {
    const needle = memberQuery.trim();
    const digits = needle.replace(/\D/g, '');
    const enough = needle.length >= 2 || digits.length >= 3;
    if (!open || !enough || !isSupabaseConfigured) {
      setRemoteHits([]);
      setRemoteBusy(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRemoteBusy(true);
      repos.searchMembersDirectory(needle, { limit: 30 })
        .then((rows) => {
          if (!cancelled) setRemoteHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setRemoteHits([]);
        })
        .finally(() => {
          if (!cancelled) setRemoteBusy(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [memberQuery, open]);

  const memberHits = useMemo(() => {
    if (member) return [];
    const local = (members || []).filter((m) => memberMatches(m, memberQuery)).slice(0, 12);
    const byId = new Map(local.map((m) => [String(m.memberId), m]));
    for (const row of remoteHits) {
      const id = String(row.memberId || '');
      if (id && !byId.has(id)) byId.set(id, row);
    }
    return [...byId.values()].slice(0, 12);
  }, [members, memberQuery, remoteHits, member]);

  if (!open) return null;

  const persistReservation = async ({
    method,
    mpIntent = null,
    receiptAttachment = null,
    physicalReceipt = false,
  } = {}) => {
    const check = validateMemberBooking({
      facility,
      member,
      reservations,
      date,
      time,
      guests: 0,
      asAdmin: true,
    });
    if (!check.ok) {
      return { ok: false, error: check.error || 'No se puede reservar ese turno.' };
    }
    const payBits = [];
    if (payFull) payBits.push('Pago: total alquiler');
    else if (total > 0) payBits.push('Pago: seña 50 %');
    if (mpIntent?.id) payBits.push(`MP intent ${mpIntent.id}`);
    if (receiptAttachment?.url) payBits.push(`Comprobante: ${receiptAttachment.url}`);
    else if (physicalReceipt) payBits.push('Comprobante físico (carga manual)');
    const noteParts = [notes.trim(), payBits.join(' · ')].filter(Boolean);
    const payload = {
      facilityId: facility.id,
      facilityName: facility.name,
      memberId: member.memberId,
      memberName: member.name,
      date,
      time,
      guests: 0,
      guestNames: '',
      status: 'confirmed',
      endTime: check.turn.endTime,
      estimatedPrice: total || null,
      depositAmount: deposit || null,
      depositRate: total > 0 ? RESERVATION_DEPOSIT_RATE : null,
      paymentMethod: total > 0 ? method : null,
      chargedPrice: total > 0 && method !== 'cuenta_corriente' ? chargeAmount : null,
      notes: noteParts.join('\n'),
      source: 'admin',
      forceConfirmed: true,
      mpIntentId: mpIntent?.id || null,
      receiptUrl: receiptAttachment?.url || null,
      recordedBy: user?.id || null,
      recordedByName: String(user?.fullName || user?.email || '').trim() || null,
    };
    const result = await addReservation?.(payload);
    if (result?.ok === false) {
      return { ok: false, error: result.error || 'No se pudo guardar la reserva.' };
    }
    const reservation = result?.reservation || payload;
    if (total > 0 && method !== 'cuenta_corriente' && chargeAmount > 0) {
      const payment = buildBookingPaymentReceipt({
        member,
        facility,
        date,
        time,
        method,
        payFull,
        total,
        charged: chargeAmount,
        deposit,
        balanceAfter: remainingAfterPay,
        today: todayAR(),
      });
      try {
        await downloadPaymentReceiptPdf({ member, payment });
      } catch {
        /* descarga best-effort */
      }
      // Mercado Pago: el webhook ya manda deliverMpReceipt. No duplicar mail/MD.
      if (method !== 'mercadopago' && !mpIntent?.id) {
        void deliverPaymentReceipt({
          member,
          payment,
          onSendMessage,
          kind: 'reserva',
        });
      }
    }
    return { ok: true, reservation };
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!member) {
      setError('Elegí un socio.');
      return;
    }
    if (!facility) {
      setError('Elegí un espacio.');
      return;
    }
    if (!slotCheck.ok) {
      setError(slotCheck.label);
      return;
    }
    if (total > 0 && payMethod === 'mercadopago') {
      setError('Generá el QR de Mercado Pago. La reserva se confirma cuando acredita.');
      return;
    }
    if (total > 0 && payMethod === 'transferencia' && !transferReceiptOk) {
      setError('Subí el comprobante o marcá “Tengo comprobante físico”.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let receiptAttachment = null;
      if (total > 0 && payMethod === 'transferencia' && receiptFile && !hasPhysicalReceipt) {
        receiptAttachment = await uploadDuesReceipt(receiptFile, user?.id || member.memberId);
      }
      const saved = await persistReservation({
        method: payMethod,
        mpIntent: mpPaidIntent,
        receiptAttachment,
        physicalReceipt: hasPhysicalReceipt,
      });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      onCreated?.(saved.reservation);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la reserva.');
    } finally {
      setBusy(false);
    }
  };

  const handleMercadoPagoApproved = async (intent) => {
    if (busy || !member || !facility) return;
    setBusy(true);
    setError('');
    setMpPaidIntent(intent || null);
    try {
      const saved = await persistReservation({
        method: 'mercadopago',
        mpIntent: intent || null,
      });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      onCreated?.(saved.reservation);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'El pago acreditó pero no se pudo guardar la reserva.');
    } finally {
      setBusy(false);
    }
  };

  const handleReceiptChange = (event) => {
    const file = event.target.files?.[0] || null;
    setReceiptFile(file);
    if (file) setHasPhysicalReceipt(false);
    setError('');
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    setReceiptPreview(file && file.type?.startsWith('image/') ? URL.createObjectURL(file) : '');
  };

  const handlePhysicalReceiptToggle = (checked) => {
    setHasPhysicalReceipt(checked);
    setError('');
    if (checked) {
      setReceiptFile(null);
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
      setReceiptPreview('');
    }
  };

  const bookingReadyForMp = Boolean(member && facility && date && time && slotCheck.ok && chargeAmount > 0);
  const mpConcept = `${payFull ? 'Reserva total' : 'Seña reserva'} · ${facility?.name || 'instalación'} · ${date} ${time}`;
  const hideSubmitForMp = total > 0 && payMethod === 'mercadopago';

  return (
    <div className="admin-new-res-overlay" role="presentation" onClick={onClose}>
      <style>{`
        .admin-new-res-overlay {
          position: fixed;
          inset: 0;
          z-index: 80;
          display: grid;
          place-items: center;
          padding: 1rem;
          background: color-mix(in srgb, var(--bg-primary) 35%, rgba(0, 0, 0, 0.72));
        }
        .admin-new-res-dialog {
          width: min(560px, 100%);
          max-height: min(92vh, 820px);
          overflow: auto;
          border-radius: 14px;
          border: 1px solid var(--border-glass-hover);
          background: var(--surface-card, var(--bg-secondary));
          color: var(--text-primary);
          box-shadow: var(--shadow-premium);
          color-scheme: inherit;
        }
        .admin-new-res-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 1rem 1.1rem 0.75rem;
          border-bottom: 1px solid var(--border-glass);
          background: var(--surface-soft);
        }
        .admin-new-res-head h3 {
          margin: 0;
          font-size: 1.15rem;
          color: var(--text-primary);
        }
        .admin-new-res-close {
          border: 0;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 0.25rem;
        }
        .admin-new-res-close:hover {
          color: var(--text-primary);
        }
        .admin-new-res-form {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          padding: 1rem 1.1rem 1.15rem;
          color: var(--text-primary);
        }
        .admin-new-res-form label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.78rem;
          font-weight: 650;
          color: var(--text-secondary);
        }
        .admin-new-res-form input,
        .admin-new-res-form select,
        .admin-new-res-form textarea {
          width: 100%;
          border-radius: 10px;
          border: 1px solid var(--border-glass);
          background: var(--bg-primary);
          color: var(--text-primary);
          padding: 0.55rem 0.7rem;
          font: inherit;
          font-size: 0.92rem;
          font-weight: 500;
          color-scheme: inherit;
        }
        .admin-new-res-form input::placeholder,
        .admin-new-res-form textarea::placeholder {
          color: var(--text-muted);
          opacity: 1;
        }
        .admin-new-res-form option {
          background: var(--bg-secondary);
          color: var(--text-primary);
        }
        .admin-new-res-form input:focus,
        .admin-new-res-form select:focus,
        .admin-new-res-form textarea:focus {
          outline: none;
          border-color: color-mix(in srgb, var(--primary-gold) 55%, var(--border-glass));
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-gold) 18%, transparent);
        }
        .admin-new-res-search {
          position: relative;
        }
        .admin-new-res-search svg {
          position: absolute;
          left: 0.7rem;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
          pointer-events: none;
        }
        .admin-new-res-search input {
          padding-left: 2.1rem;
        }
        .admin-new-res-hits {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          max-height: 180px;
          overflow: auto;
        }
        .admin-new-res-hit {
          text-align: left;
          border-radius: 10px;
          border: 1px solid var(--border-glass);
          background: var(--bg-primary);
          color: var(--text-primary);
          padding: 0.5rem 0.65rem;
          cursor: pointer;
        }
        .admin-new-res-hit:hover {
          border-color: color-mix(in srgb, var(--primary-gold) 45%, var(--border-glass));
          background: color-mix(in srgb, var(--primary-gold) 10%, var(--bg-primary));
        }
        .admin-new-res-hit strong {
          display: block;
          font-size: 0.88rem;
          color: var(--text-primary);
        }
        .admin-new-res-hit span {
          font-size: 0.74rem;
          color: var(--text-secondary);
        }
        .admin-new-res-picked {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.65rem 0.75rem;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--emerald-accent) 40%, var(--border-glass));
          background: color-mix(in srgb, var(--emerald-accent) 12%, var(--bg-primary));
          color: var(--text-primary);
        }
        .admin-new-res-picked strong {
          display: block;
          color: var(--text-primary);
        }
        .admin-new-res-picked span {
          font-size: 0.75rem;
          color: var(--text-secondary);
        }
        .admin-new-res-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }
        .admin-new-res-pay {
          display: grid;
          gap: 0.45rem;
          padding: 0.75rem 0.85rem;
          border-radius: 12px;
          border: 1px solid var(--border-glass);
          background: var(--surface-soft);
          color: var(--text-primary);
        }
        .admin-new-res-pay-row {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          font-size: 0.86rem;
          color: var(--text-primary);
        }
        .admin-new-res-pay-row.is-accent {
          color: var(--primary-gold);
          font-weight: 700;
        }
        .admin-new-res-scope {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.4rem;
          margin-top: 0.35rem;
        }
        .admin-new-res-scope label {
          flex-direction: column;
          align-items: flex-start;
          gap: 0.15rem;
          font-weight: 550;
          color: var(--text-primary);
          border: 1px solid var(--border-glass);
          border-radius: 12px;
          padding: 0.55rem 0.7rem;
          cursor: pointer;
          background: var(--bg-primary);
        }
        .admin-new-res-scope label:has(input:checked) {
          border-color: color-mix(in srgb, var(--primary-gold) 50%, var(--border-glass));
          background: color-mix(in srgb, var(--primary-gold) 12%, var(--bg-primary));
        }
        .admin-new-res-scope input { width: auto; accent-color: var(--primary-gold); }
        .admin-new-res-scope strong {
          font-size: 0.92rem;
          color: var(--text-primary);
        }
        .admin-new-res-scope span {
          font-size: 0.72rem;
          color: var(--text-secondary);
          font-weight: 500;
        }
        .admin-new-res-methods {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.4rem;
        }
        .admin-new-res-methods label {
          flex-direction: row;
          align-items: center;
          gap: 0.4rem;
          font-weight: 550;
          color: var(--text-primary);
          border: 1px solid var(--border-glass);
          border-radius: 999px;
          padding: 0.4rem 0.65rem;
          cursor: pointer;
          background: var(--bg-primary);
        }
        .admin-new-res-methods label:has(input:checked) {
          border-color: color-mix(in srgb, var(--primary-gold) 50%, var(--border-glass));
          background: color-mix(in srgb, var(--primary-gold) 12%, var(--bg-primary));
        }
        .admin-new-res-methods input { width: auto; accent-color: var(--primary-gold); }
        .admin-new-res-slot {
          display: flex;
          align-items: flex-start;
          gap: 0.45rem;
          margin: -0.15rem 0 0;
          padding: 0.55rem 0.7rem;
          border-radius: 10px;
          font-size: 0.82rem;
          font-weight: 600;
          line-height: 1.35;
        }
        .admin-new-res-slot.is-ok {
          color: color-mix(in srgb, var(--emerald-accent) 88%, var(--text-primary));
          background: color-mix(in srgb, var(--emerald-accent) 14%, var(--bg-primary));
          border: 1px solid color-mix(in srgb, var(--emerald-accent) 35%, var(--border-glass));
        }
        .admin-new-res-slot.is-bad {
          color: color-mix(in srgb, var(--danger-accent) 90%, var(--text-primary));
          background: color-mix(in srgb, var(--danger-accent) 12%, var(--bg-primary));
          border: 1px solid color-mix(in srgb, var(--danger-accent) 35%, var(--border-glass));
        }
        .admin-new-res-slot.is-muted {
          color: var(--text-secondary);
          background: var(--surface-soft);
          border: 1px solid var(--border-glass);
        }
        .admin-new-res-transfer {
          margin-top: 0.55rem;
          display: grid;
          gap: 0.35rem;
          padding: 0.65rem 0.75rem;
          border-radius: 10px;
          border: 1px solid var(--border-glass);
          background: var(--bg-primary);
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .admin-new-res-transfer strong { color: var(--text-primary); }
        .admin-new-res-file {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          margin-top: 0.35rem;
          padding: 0.55rem 0.65rem;
          border-radius: 10px;
          border: 1px dashed color-mix(in srgb, var(--primary-gold) 45%, var(--border-glass));
          background: color-mix(in srgb, var(--primary-gold) 8%, var(--bg-primary));
          color: var(--text-primary);
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
        }
        .admin-new-res-file input[type="file"] { display: none; }
        .admin-new-res-physical {
          display: flex;
          align-items: flex-start;
          gap: 0.55rem;
          margin-top: 0.35rem;
          padding: 0.55rem 0.65rem;
          border-radius: 10px;
          border: 1px solid var(--border-glass);
          background: var(--surface-soft);
          color: var(--text-primary);
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
        }
        .admin-new-res-physical:has(input:checked) {
          border-color: color-mix(in srgb, var(--emerald-accent) 45%, var(--border-glass));
          background: color-mix(in srgb, var(--emerald-accent) 12%, var(--bg-primary));
        }
        .admin-new-res-physical input {
          margin-top: 0.15rem;
          width: 1rem;
          height: 1rem;
          accent-color: var(--emerald-accent, #10b981);
          flex-shrink: 0;
        }
        .admin-new-res-physical span {
          display: grid;
          gap: 0.15rem;
          font-weight: 600;
        }
        .admin-new-res-physical small {
          font-weight: 500;
          color: var(--text-secondary);
          line-height: 1.35;
        }
        .admin-new-res-physical-ok {
          margin: 0;
          font-size: 0.78rem;
          font-weight: 600;
          color: color-mix(in srgb, var(--emerald-accent) 88%, var(--text-primary));
        }
        .admin-new-res-transfer img {
          margin-top: 0.35rem;
          max-width: 100%;
          max-height: 140px;
          border-radius: 8px;
          border: 1px solid var(--border-glass);
        }
        .admin-new-res-mp { margin-top: 0.55rem; }
        .admin-new-res-error {
          margin: 0;
          color: var(--danger-accent);
          font-size: 0.84rem;
        }
        .admin-new-res-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.55rem;
          margin-top: 0.25rem;
        }
        @media (max-width: 560px) {
          .admin-new-res-grid,
          .admin-new-res-scope,
          .admin-new-res-methods { grid-template-columns: 1fr; }
        }
      `}</style>
      <div
        className="admin-new-res-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-new-res-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-new-res-head">
          <h3 id="admin-new-res-title">Nueva reserva</h3>
          <button type="button" className="admin-new-res-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <form className="admin-new-res-form" onSubmit={handleSave}>
          <div>
            <label htmlFor="admin-new-res-member">Socio</label>
            {member ? (
              <div className="admin-new-res-picked">
                <div>
                  <strong>{member.name}</strong>
                  <span>Nº {member.memberId}</span>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMember(null)}>
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <div className="admin-new-res-search">
                  <Search size={15} aria-hidden />
                  <input
                    id="admin-new-res-member"
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="Nombre o Nº de socio"
                    autoComplete="off"
                  />
                </div>
                {remoteBusy ? (
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Buscando…</p>
                ) : null}
                {memberHits.length > 0 ? (
                  <div className="admin-new-res-hits" style={{ marginTop: '0.45rem' }}>
                    {memberHits.map((row) => (
                      <button
                        key={row.memberId || row.id}
                        type="button"
                        className="admin-new-res-hit"
                        onClick={() => {
                          setMember(row);
                          setMemberQuery('');
                          setRemoteHits([]);
                        }}
                      >
                        <strong>{row.name}</strong>
                        <span>Nº {row.memberId}{row.tier ? ` · ${row.tier}` : ''}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <label>
            Espacio
            <select
              value={facilityId}
              onChange={(e) => {
                setFacilityId(e.target.value);
                setError('');
                setMpPaidIntent(null);
              }}
            >
              {catalog.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>

          <div className="admin-new-res-grid">
            <label>
              Fecha
              <input
                type="date"
                value={date}
                min={todayISODateAR()}
                onChange={(e) => {
                  setDate(e.target.value);
                  setError('');
                  setMpPaidIntent(null);
                }}
                required
              />
            </label>
            <label>
              Turno
              <select
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setError('');
                  setMpPaidIntent(null);
                }}
                required
              >
                {turnsWithAvailability.map((turn) => (
                  <option key={turn.time} value={turn.time} disabled={turn.taken}>
                    {turn.openDay
                      ? (turn.taken ? 'Ocupado' : 'Libre')
                      : `${turn.label || turn.time}${turn.endTime ? ` · ${turn.time}–${turn.endTime}` : ` · ${turn.time}`}${turn.taken ? ' · ocupado' : ' · libre'}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className={`admin-new-res-slot is-${slotCheck.tone}`}
            role="status"
            aria-live="polite"
          >
            {slotCheck.tone === 'ok' ? <CheckCircle2 size={15} aria-hidden /> : <AlertCircle size={15} aria-hidden />}
            <span>{slotCheck.label}</span>
          </div>

          {total > 0 ? (
            <div className="admin-new-res-pay" aria-label="Pago de la reserva">
              <div className="admin-new-res-pay-row">
                <span>Total alquiler</span>
                <strong>{money(total)}</strong>
              </div>
              <div style={{ marginTop: '0.15rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 650 }}>
                  ¿Cuánto cobra ahora?
                </span>
                <div className="admin-new-res-scope" role="radiogroup" aria-label="Monto a cobrar">
                  <label>
                    <input
                      type="radio"
                      name="admin-res-scope"
                      checked={!payFull}
                      onChange={() => {
                        setPayScope('deposit');
                        setError('');
                        setMpPaidIntent(null);
                      }}
                    />
                    <strong>Seña 50 %</strong>
                    <span>{money(deposit)} · resta {money(reservationBalanceAfterDeposit(total))} en cuenta</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="admin-res-scope"
                      checked={payFull}
                      onChange={() => {
                        setPayScope('total');
                        setError('');
                        setMpPaidIntent(null);
                      }}
                    />
                    <strong>Total</strong>
                    <span>{money(total)} · queda saldado</span>
                  </label>
                </div>
              </div>
              <div className="admin-new-res-pay-row is-accent">
                <span>A cobrar ahora · {date}</span>
                <strong>{money(chargeAmount)}</strong>
              </div>
              <div className="admin-new-res-pay-row">
                <span>Saldo restante</span>
                <strong>{money(remainingAfterPay)}</strong>
              </div>
              <div style={{ marginTop: '0.35rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 650 }}>
                  Medio de cobro
                </span>
                <div className="admin-new-res-methods" style={{ marginTop: '0.4rem' }}>
                  {PAY_METHODS.map((method) => (
                    <label key={method.id}>
                      <input
                        type="radio"
                        name="admin-res-pay"
                        checked={payMethod === method.id}
                        onChange={() => {
                          setPayMethod(method.id);
                          setError('');
                          setMpPaidIntent(null);
                        }}
                      />
                      {method.label}
                    </label>
                  ))}
                </div>
              </div>

              {payMethod === 'mercadopago' ? (
                <div className="admin-new-res-mp">
                  <MercadoPagoCheckout
                    kind="booking"
                    mode="qr"
                    amount={chargeAmount}
                    memberNumber={member?.memberId}
                    concept={mpConcept}
                    label={`Generar QR · ${payFull ? 'total' : 'seña'} ${money(chargeAmount)}`}
                    disabled={!bookingReadyForMp || busy}
                    onApproved={handleMercadoPagoApproved}
                  />
                </div>
              ) : null}

              {payMethod === 'transferencia' ? (
                <div className="admin-new-res-transfer">
                  {bank ? (
                    <div className="pay-alias">
                      <span className="pay-alias-label">Alias</span>
                      <strong className="pay-alias-value">{bank.alias}</strong>
                    </div>
                  ) : null}
                  <p style={{ margin: 0 }}>
                    Monto {payFull ? 'total' : 'seña'}: <strong>{money(chargeAmount)}</strong>
                  </p>
                  <label className="admin-new-res-physical">
                    <input
                      type="checkbox"
                      checked={hasPhysicalReceipt}
                      onChange={(e) => handlePhysicalReceiptToggle(e.target.checked)}
                    />
                    <span>
                      Tengo comprobante físico
                      <small>Con esto solo ya podés guardar la reserva (carga manual).</small>
                    </span>
                  </label>
                  {hasPhysicalReceipt ? (
                    <p className="admin-new-res-physical-ok" role="status">
                      Listo: no hace falta subir archivo.
                    </p>
                  ) : (
                    <>
                      <label className="admin-new-res-file">
                        <Upload size={15} aria-hidden />
                        {receiptFile?.name || 'Subir comprobante (JPG, PNG o PDF)'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
                          onChange={handleReceiptChange}
                        />
                      </label>
                      {receiptPreview ? (
                        <img src={receiptPreview} alt="Vista previa del comprobante" />
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <label>
            Notas
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional"
            />
          </label>

          {error ? <p className="admin-new-res-error">{error}</p> : null}

          <div className="admin-new-res-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            {hideSubmitForMp ? null : (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  busy
                  || !member
                  || !slotCheck.ok
                  || (total > 0 && payMethod === 'transferencia' && !transferReceiptOk)
                }
              >
                {busy
                  ? 'Guardando…'
                  : payMethod === 'transferencia' && total > 0 && hasPhysicalReceipt
                    ? 'Guardar reserva'
                    : payMethod === 'transferencia' && total > 0
                      ? 'Guardar con comprobante'
                      : 'Guardar reserva'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

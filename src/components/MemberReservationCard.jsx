import { useState } from 'react';
import { Calendar, MapPin, Upload } from 'lucide-react';
import MercadoPagoCheckout from './MercadoPagoCheckout';
import {
  reservationCollectedAmount,
  reservationOpenBalance,
  reservationTotalPrice,
} from '../domain/reservations/bookingRules';
import { CLUB_BANK_ACCOUNTS } from '../domain/members/clubBanks';
import { bookingPaymentNotice } from '../domain/members/duesPaymentNotice';
import { uploadDuesReceipt } from '../data/storage';

function money(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function eventLabel(res) {
  const day = String(res?.date || '').slice(0, 10);
  const date = day
    ? new Date(`${day}T12:00:00`).toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    : '';
  const hours = [res?.time, res?.endTime ? `a ${res.endTime}` : ''].filter(Boolean).join(' ');
  return [date, hours ? `${hours} hs` : ''].filter(Boolean).join(' · ');
}

/** Reserva del socio: lugar, turno, seña y saldo para terminar el alquiler. */
export default function MemberReservationCard({
  reservation,
  member,
  canPay = false,
  cancelling = false,
  onCancel,
  onSettled,
  sendMessage,
  user = null,
}) {
  const [settled, setSettled] = useState(false);
  const [payMethod, setPayMethod] = useState('mercadopago');
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState('');
  const [payingTransfer, setPayingTransfer] = useState(false);
  const [payNotice, setPayNotice] = useState('');
  const [payError, setPayError] = useState('');

  const total = reservationTotalPrice(null, reservation);
  const paid = settled ? total : reservationCollectedAmount(reservation);
  const balance = settled ? 0 : reservationOpenBalance(reservation);
  const guests = Number(reservation?.guests) || 0;
  const when = eventLabel(reservation);
  const depositOnly = total > 0 && paid > 0 && balance > 0;
  /** Seña (50 %) o sin cobro: se puede anular. Alquiler ya saldado, no. */
  const canCancel = typeof onCancel === 'function' && (depositOnly || paid <= 0 || total <= 0);
  const bank = CLUB_BANK_ACCOUNTS[0];
  const showPayRest = balance > 0 && canPay && total > 0;

  const handleReceipt = (event) => {
    const file = event.target.files?.[0] || null;
    setReceiptFile(file);
    setPayError('');
    setPayNotice('');
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    setReceiptPreview(file && file.type.startsWith('image/') ? URL.createObjectURL(file) : '');
  };

  const handleTransferBalance = async () => {
    if (!sendMessage || payingTransfer || !(balance > 0)) return;
    if (!receiptFile) {
      setPayError('Adjuntá el comprobante del resto (50 %).');
      return;
    }
    setPayingTransfer(true);
    setPayError('');
    setPayNotice('');
    try {
      const attachment = await uploadDuesReceipt(receiptFile, user?.id);
      await sendMessage(bookingPaymentNotice({
        memberName: member?.name,
        memberId: member?.memberId,
        amountLabel: `${money(balance)} (resto · seña ya abonada ${money(paid)} · total ${money(total)})`,
        facilityName: reservation.facilityName,
        dateLabel: when,
        time: reservation.time,
        method: 'transferencia',
        bankName: bank?.name,
        attachment,
      }));
      setPayNotice('Comprobante del resto enviado a administración.');
      setReceiptFile(null);
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
      setReceiptPreview('');
    } catch (err) {
      setPayError(err?.message || 'No se pudo avisar el pago del resto.');
    } finally {
      setPayingTransfer(false);
    }
  };

  return (
    <article className="db-res-item mfb-res-card" style={{ alignItems: 'stretch', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Calendar size={18} color="var(--emerald-accent)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {reservation.facilityName}
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.15rem 0 0', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <MapPin size={10} color="var(--primary-gold)" /> {when || 'Sin fecha'}
            </p>
            {guests > 0 ? (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
                {guests === 1 ? '1 invitado' : `${guests} invitados`}
                {reservation.guestNames ? ` · ${reservation.guestNames}` : ''}
              </p>
            ) : null}
          </div>
        </div>
        <span className={`status-tag ${reservation.status}`} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', alignSelf: 'flex-start' }}>
          {reservation.status === 'confirmed' ? 'Confirmada' : 'Pendiente'}
        </span>
      </div>

      {total > 0 ? (
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.45rem', margin: 0 }}>
          {[
            ['Total', money(total)],
            ['Seña', money(Math.min(paid, total))],
            ['Resto', balance > 0 ? money(balance) : 'Saldado'],
          ].map(([label, value]) => (
            <div key={label} style={{ padding: '0.45rem 0.55rem', borderRadius: 10, background: 'var(--surface-soft)' }}>
              <dt style={{ fontSize: '0.65rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</dt>
              <dd style={{ margin: '0.15rem 0 0', fontSize: '0.86rem', fontWeight: 700, color: label === 'Resto' && balance > 0 ? 'var(--text-gold)' : 'var(--text-primary)' }}>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {showPayRest ? (
        <div className="mfb-res-pay">
          <p className="mfb-res-pay-title">
            Seña abonada · pagá el resto ({money(balance)})
          </p>
          <label className="mfb-res-pay-method">
            <span>Medio</span>
            <select
              value={payMethod}
              onChange={(e) => {
                setPayMethod(e.target.value);
                setPayError('');
                setPayNotice('');
              }}
            >
              <option value="mercadopago">Mercado Pago</option>
              <option value="transferencia">Transferencia</option>
            </select>
          </label>

          {payMethod === 'mercadopago' ? (
            <MercadoPagoCheckout
              kind="booking"
              amount={balance}
              memberNumber={member?.memberId}
              concept={`Resto reserva · ${reservation.facilityName || 'Instalación'} · ${String(reservation.date || '').slice(0, 10)} ${reservation.time || ''}`.trim()}
              booking={{
                reservationId: reservation.id,
                settleBalance: true,
                facilityId: reservation.facilityId,
                facilityName: reservation.facilityName,
                date: reservation.date,
                time: reservation.time,
                endTime: reservation.endTime || null,
                estimatedPrice: total,
                depositAmount: paid,
              }}
              label={`Pagar resto ${money(balance)}`}
              onApproved={() => {
                setSettled(true);
                onSettled?.({
                  ...reservation,
                  chargedPrice: total,
                  paidInFull: true,
                  balanceAmount: balance,
                });
              }}
            />
          ) : (
            <div className="mfb-res-transfer">
              {bank ? (
                <div className="pay-alias">
                  <span className="pay-alias-label">Alias</span>
                  <strong className="pay-alias-value">{bank.alias}</strong>
                </div>
              ) : null}
              <label className="pay-hist-file">
                <Upload size={16} />
                {receiptFile?.name || 'Adjuntar comprobante del resto (JPG, PNG o PDF)'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
                  onChange={handleReceipt}
                />
              </label>
              {receiptPreview ? <img src={receiptPreview} alt="Vista previa del comprobante" /> : null}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={payingTransfer || !sendMessage}
                onClick={() => { void handleTransferBalance(); }}
              >
                {payingTransfer ? 'Enviando…' : `Enviar comprobante · ${money(balance)}`}
              </button>
            </div>
          )}
          {payError ? <p className="mfb-res-pay-err">{payError}</p> : null}
          {payNotice ? <p className="mfb-res-pay-ok">{payNotice}</p> : null}
        </div>
      ) : balance <= 0 && total > 0 ? (
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--emerald-accent)', fontWeight: 650 }}>
          Alquiler saldado
        </p>
      ) : depositOnly ? (
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          Seña abonada · queda resto por pagar
        </p>
      ) : null}

      {canCancel ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => onCancel(reservation.id)}
            disabled={cancelling}
            className="btn btn-danger btn-sm"
            style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
            aria-label={depositOnly ? 'Cancelar reserva con seña abonada' : 'Cancelar reserva'}
          >
            {cancelling ? 'Cancelando…' : 'Cancelar'}
          </button>
        </div>
      ) : null}
    </article>
  );
}

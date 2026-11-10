import { useState } from 'react';
import { Calendar, MapPin } from 'lucide-react';
import MercadoPagoCheckout from './MercadoPagoCheckout';
import {
  reservationCollectedAmount,
  reservationOpenBalance,
  reservationTotalPrice,
} from '../domain/reservations/bookingRules';

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
  onCancel,
  onSettled,
}) {
  const [settled, setSettled] = useState(false);
  const total = reservationTotalPrice(null, reservation);
  const paid = settled ? total : reservationCollectedAmount(reservation);
  const balance = settled ? 0 : reservationOpenBalance(reservation);
  const guests = Number(reservation?.guests) || 0;
  const when = eventLabel(reservation);

  return (
    <article className="db-res-item" style={{ alignItems: 'stretch', flexDirection: 'column', gap: '0.75rem' }}>
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
            ['Saldo', balance > 0 ? money(balance) : 'Saldado'],
          ].map(([label, value]) => (
            <div key={label} style={{ padding: '0.45rem 0.55rem', borderRadius: 10, background: 'var(--surface-soft)' }}>
              <dt style={{ fontSize: '0.65rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</dt>
              <dd style={{ margin: '0.15rem 0 0', fontSize: '0.86rem', fontWeight: 700, color: label === 'Saldo' && balance > 0 ? 'var(--text-gold)' : 'var(--text-primary)' }}>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {balance > 0 && canPay ? (
          <MercadoPagoCheckout
            kind="booking"
            amount={balance}
            memberNumber={member?.memberId}
            concept={`Saldo reserva · ${reservation.facilityName || 'Instalación'} · ${String(reservation.date || '').slice(0, 10)} ${reservation.time || ''}`.trim()}
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
            label={`Pagar saldo ${money(balance)}`}
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
        ) : balance <= 0 && total > 0 ? (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--emerald-accent)', fontWeight: 650 }}>
            Alquiler saldado
          </p>
        ) : <span />}
        <button
          type="button"
          onClick={() => onCancel?.(reservation.id)}
          className="btn btn-danger btn-sm"
          style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
        >
          Cancelar
        </button>
      </div>
    </article>
  );
}

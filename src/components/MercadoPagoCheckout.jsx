import { useEffect, useRef, useState } from 'react';
import { CreditCard, Loader2, QrCode, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { isSupabaseConfigured } from '../lib/supabase';
import { createMercadoPagoCheckout, getMercadoPagoIntent } from '../data/repos';
import { isMpPaidStatus, mpChannelFor } from '../domain/payments/mercadoPago';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

export default function MercadoPagoCheckout({
  kind = 'dues',
  amount,
  memberNumber,
  concept,
  guestName,
  mode = 'redirect',
  label,
  subscribe = false,
  onApproved,
  disabled = false,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState(null);
  const approvedRef = useRef(onApproved);
  approvedRef.current = onApproved;

  useEffect(() => {
    if (!checkout?.id || !isSupabaseConfigured) return undefined;
    let cancelled = false;
    let done = false;
    const tick = async () => {
      if (done) return;
      try {
        const next = await getMercadoPagoIntent(checkout.id);
        if (cancelled || !next) return;
        if (isMpPaidStatus(next.status) && next.appliedAt) {
          done = true;
          setCheckout((prev) => ({ ...prev, ...next }));
          approvedRef.current?.(next);
        }
      } catch {
        /* el webhook puede tardar */
      }
    };
    const timer = window.setInterval(() => { void tick(); }, 2800);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [checkout?.id]);

  const start = async (nextKind = kind) => {
    if (disabled || busy || amount <= 0) return;
    if (!isSupabaseConfigured) {
      setError('Mercado Pago necesita el libro conectado.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await createMercadoPagoCheckout({
        kind: nextKind,
        amount,
        memberNumber,
        concept,
        guestName,
        channel: mpChannelFor({ kind: nextKind, mode, subscribe }),
      });
      setCheckout(created);
    } catch (err) {
      setError(err.message || 'No se pudo abrir Mercado Pago.');
    } finally {
      setBusy(false);
    }
  };

  const paid = isMpPaidStatus(checkout?.status) && checkout?.appliedAt;
  const onsite = mode === 'qr' && !subscribe;
  const payload = checkout?.qrData || checkout?.initPoint || '';
  const action = subscribe
    ? (label || 'Suscribirme al débito')
    : onsite
      ? (label || `Cobrar ${formatCurrency(amount)} con QR`)
      : (label || `Pagar ${formatCurrency(amount)} con Mercado Pago`);

  return (
    <div className="mp-box">
      {!checkout ? (
        <button
          type="button"
          className="btn btn-primary mp-box-go"
          disabled={disabled || busy || amount <= 0}
          onClick={() => { void start(subscribe ? 'subscription' : kind); }}
        >
          {busy ? <Loader2 size={16} className="mp-spin" /> : <CreditCard size={16} />}
          {busy ? 'Generando código…' : action}
        </button>
      ) : null}

      {payload && !paid ? (
        <div className="mp-box-wait">
          <div className="mp-box-qr">
            <QRCodeSVG value={payload} size={168} level="M" includeMargin />
          </div>
          <div>
            <strong><QrCode size={14} /> {onsite ? 'QR de mostrador' : 'Mercado Pago'}</strong>
            <p>
              {subscribe
                ? 'Escaneá el código o abrí Mercado Pago. El débito queda cuando confirma, el día 10.'
                : onsite
                  ? `${formatCurrency(amount)}. El socio escanea con la app de Mercado Pago. El cobro se acredita solo cuando confirma.`
                  : `${formatCurrency(amount)}. Escaneá el código o abrí Mercado Pago. El cobro se acredita cuando confirma.`}
            </p>
            {checkout.initPoint && !onsite ? (
              <a className="btn btn-secondary btn-sm" href={checkout.initPoint} target="_blank" rel="noreferrer">
                {subscribe ? 'Abrir adhesión' : 'Abrir pago'}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {paid ? <p className="mp-box-ok">Pago acreditado.</p> : null}
      {error ? <p className="mp-box-err" role="alert">{error}</p> : null}
      {checkout && !paid ? (
        <p className="mp-box-hint">
          <RefreshCw size={12} /> Esperando la confirmación de Mercado Pago…
        </p>
      ) : null}
    </div>
  );
}

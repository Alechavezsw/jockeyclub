import { useState } from 'react';
import { Download, Loader2, Mail, MessageSquare, Phone, X } from 'lucide-react';
import { downloadPaymentReceiptPdf } from '../../domain/members/exportPaymentReceiptPdf';
import {
  paymentReceiptShareTargets,
  sendDuesReceiptMessage,
} from '../../domain/members/duesReceiptDelivery';
import { formatCurrency as formatCurrencyDefault } from '../../domain/accounting/journal';

function openExternal(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Aviso post-cobro con acciones visibles: PDF, WhatsApp, mail y MD.
 */
export default function CollectReceiptActionsBanner({
  member,
  payment,
  message,
  onSendMessage,
  formatCurrency = formatCurrencyDefault,
  onClose,
}) {
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const share = paymentReceiptShareTargets(member, payment);
  const title = message
    || `Cobro registrado · ${formatCurrency(payment?.amount)} · ${member?.name || 'Socio'}`;

  const run = async (action) => {
    if (!member || !payment) return;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      if (action === 'download') {
        await downloadPaymentReceiptPdf({ member, payment });
        setNotice('PDF descargado.');
        return;
      }
      if (action === 'whatsapp') {
        if (!share.whatsappUrl) {
          setError('Sin celular en la ficha.');
          return;
        }
        openExternal(share.whatsappUrl);
        setNotice('WhatsApp abierto.');
        return;
      }
      if (action === 'mail') {
        if (!share.email) {
          setError('Sin mail real en la ficha.');
          return;
        }
        await sendDuesReceiptMessage({
          member,
          payment,
          channels: { md: false, email: true },
        });
        setNotice('Comprobante enviado por mail.');
        return;
      }
      if (action === 'md') {
        if (typeof onSendMessage !== 'function') {
          setError('Mensajería no disponible.');
          return;
        }
        await sendDuesReceiptMessage({
          member,
          payment,
          onSendMessage,
          channels: { md: true, email: false },
        });
        setNotice('Comprobante enviado por MD.');
      }
    } catch (err) {
      setError(err?.message || 'No se pudo completar la acción.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="cuotas-success-banner cuotas-receipt-banner" role="status" aria-live="polite">
      <div className="cuotas-receipt-banner-main">
        <strong className="cuotas-receipt-banner-title">{title}</strong>
        <p className="cuotas-receipt-banner-hint">
          Comprobante listo: descargalo o reenvialo al socio.
        </p>
        <div className="payment-receipts-actions" role="group" aria-label="Acciones del comprobante">
          <button
            type="button"
            className="payment-receipts-chip tone-pdf"
            disabled={Boolean(busy)}
            title="Descargar PDF"
            aria-label="Descargar PDF"
            onClick={() => run('download')}
          >
            {busy === 'download'
              ? <Loader2 size={13} className="spin" aria-hidden="true" />
              : <Download size={13} aria-hidden="true" />}
            <span>PDF</span>
          </button>
          <button
            type="button"
            className="payment-receipts-chip tone-wa"
            disabled={Boolean(busy) || !share.whatsappUrl}
            title={share.whatsappUrl ? 'Abrir WhatsApp' : 'Sin celular en ficha'}
            aria-label="Enviar por WhatsApp"
            onClick={() => run('whatsapp')}
          >
            <Phone size={13} aria-hidden="true" />
            <span>WA</span>
          </button>
          <button
            type="button"
            className="payment-receipts-chip tone-mail"
            disabled={Boolean(busy) || !share.email}
            title={share.email ? 'Enviar por mail' : 'Sin mail real en ficha'}
            aria-label="Enviar por mail"
            onClick={() => run('mail')}
          >
            {busy === 'mail'
              ? <Loader2 size={13} className="spin" aria-hidden="true" />
              : <Mail size={13} aria-hidden="true" />}
            <span>Mail</span>
          </button>
          <button
            type="button"
            className="payment-receipts-chip tone-md"
            disabled={Boolean(busy) || typeof onSendMessage !== 'function'}
            title="Enviar por mensajería interna (MD)"
            aria-label="Enviar por MD"
            onClick={() => run('md')}
          >
            {busy === 'md'
              ? <Loader2 size={13} className="spin" aria-hidden="true" />
              : <MessageSquare size={13} aria-hidden="true" />}
            <span>MD</span>
          </button>
        </div>
        {notice ? <p className="cuotas-receipt-banner-ok">{notice}</p> : null}
        {error ? <p className="cuotas-receipt-banner-err">{error}</p> : null}
      </div>
      {onClose ? (
        <button
          type="button"
          className="cuotas-success-banner-close"
          aria-label="Cerrar aviso"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

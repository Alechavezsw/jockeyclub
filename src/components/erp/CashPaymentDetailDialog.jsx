import { useEffect, useState } from 'react';
import { Mail, Phone, Printer, Share2, X } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import { cashPaymentShareTargets } from '../../domain/accounting/cashPaymentDetail';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import { exportCashPaymentPdf } from '../../domain/accounting/exportCashPaymentPdf';
import { formatCurrency } from '../../domain/accounting/journal';

function shortFeeDate(iso) {
  const raw = String(iso || '').slice(0, 10);
  const match = raw.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${match[2]}` : (iso ? formatAccessinCashDate(iso) : '—');
}

function openExternal(url) {
  if (String(url).startsWith('mailto:')) {
    window.location.href = url;
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function CashPaymentDetailDialog({ detail, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const share = detail ? cashPaymentShareTargets(detail, formatCurrency) : null;

  useEffect(() => {
    setShareOpen(false);
    setError('');
  }, [detail?.movementId, detail?.paymentNumber]);

  const download = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setError('');
    try {
      await exportCashPaymentPdf(detail);
    } catch (err) {
      setError(err?.message || 'No se pudo generar el PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      open={Boolean(detail)}
      onClose={onClose}
      labelledBy="cash-payment-detail-title"
      contentClassName="modal-content glass-panel cash-payment-detail-modal"
      contentStyle={{ maxWidth: 780, width: '100%' }}
    >
      {detail ? (
        <div className="cash-payment-detail">
          <div className="cash-payment-detail-head">
            <h3 id="cash-payment-detail-title" className="cash-payment-detail-title">
              {detail.title}
            </h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Cerrar">
              <X size={14} />
            </button>
          </div>

          <section className="cash-payment-detail-section">
            <h4>Información del pago</h4>
            <div className="cash-payment-detail-grid">
              <div className="cash-payment-detail-field">
                <span className="cash-payment-detail-label">Fecha</span>
                <div className="cash-payment-detail-value">{detail.dateLabel}</div>
              </div>
              <div className="cash-payment-detail-field">
                <span className="cash-payment-detail-label">Descripción</span>
                <div className="cash-payment-detail-value">{detail.description || '—'}</div>
              </div>
              <div className="cash-payment-detail-field">
                <span className="cash-payment-detail-label">Comprobante</span>
                <div className="cash-payment-detail-value">{detail.voucher || '—'}</div>
              </div>
            </div>
          </section>

          <section className="cash-payment-detail-section">
            <h4>Entradas imputadas</h4>
            <div className="table-responsive cash-payment-detail-table-wrap">
              <table className="admin-table cash-payment-detail-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Descripción</th>
                    <th>Monto</th>
                    <th>Cancelado</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.applied.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                        Sin imputaciones vinculadas a este movimiento.
                      </td>
                    </tr>
                  ) : (
                    detail.applied.map((line) => (
                      <tr key={line.id || `${line.date}-${line.type}-${line.amount}`}>
                        <td>{shortFeeDate(line.date)}</td>
                        <td>{line.type}</td>
                        <td>{line.description}</td>
                        <td>{formatCurrency(line.amount)}</td>
                        <td>{formatCurrency(line.cancelled)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="cash-payment-detail-sum">
                    <td colSpan={4}>Saldo a favor imputado</td>
                    <td>{formatCurrency(detail.creditApplied)}</td>
                  </tr>
                  <tr className="cash-payment-detail-sum">
                    <td colSpan={4}>Excedente</td>
                    <td>{formatCurrency(detail.surplus)}</td>
                  </tr>
                  <tr className="cash-payment-detail-sum is-total">
                    <td colSpan={4}>Total pago</td>
                    <td>{formatCurrency(detail.paymentTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="cash-payment-detail-section">
            <h4>Formas de pago</h4>
            <div className="cash-payment-methods">
              {detail.paymentMethods.map((method) => (
                <div key={method.id} className="cash-payment-method-card">
                  <div className="cash-payment-method-title">
                    {method.label}
                    {method.reference ? ` #${method.reference}` : ''}
                  </div>
                  <label className="cash-payment-detail-label">Monto</label>
                  <input className="form-input" readOnly value={Number(method.amount).toFixed(2)} />
                </div>
              ))}
            </div>
          </section>

          {error ? <p style={{ color: '#ef4444', margin: 0 }}>{error}</p> : null}

          <div className="cash-payment-detail-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Volver
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={download}>
              <Printer size={14} /> {busy ? 'Generando…' : 'Imprimir'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              aria-expanded={shareOpen}
              onClick={() => {
                setError('');
                if (!share?.whatsappUrl && !share?.mailUrl) {
                  setShareOpen(false);
                  setError('Este socio no tiene celular ni mail en la ficha.');
                  return;
                }
                if (share.whatsappUrl && share.mailUrl) {
                  setShareOpen((open) => !open);
                  return;
                }
                openExternal(share.whatsappUrl || share.mailUrl);
              }}
            >
              <Share2 size={14} /> Compartir
            </button>
          </div>
          {shareOpen && share ? (
            <div className="cash-payment-share">
              {share.whatsappUrl ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openExternal(share.whatsappUrl)}>
                  <Phone size={14} /> WhatsApp {share.phone}
                </button>
              ) : null}
              {share.mailUrl ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openExternal(share.mailUrl)}>
                  <Mail size={14} /> {share.email}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </ModalDialog>
  );
}

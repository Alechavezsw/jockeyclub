import { useMemo, useState } from 'react';
import { X, Banknote, Landmark, QrCode, Upload, Copy, Check } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ModalDialog from '../ModalDialog';
import {
  CLUB_BANK_ACCOUNTS,
  MERCADO_PAGO,
  buildMercadoPagoQrPayload,
  journalAccountForPayment,
} from '../../domain/members/clubBanks';

const METHODS = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote, hint: 'Cobro en sede / caja' },
  { id: 'transferencia', label: 'Transferencia', icon: Landmark, hint: 'Bancos del club + comprobante' },
  { id: 'mercadopago', label: 'Mercado Pago', icon: QrCode, hint: 'Genera QR de cobro' },
];

function CopyBtn({ value }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.2rem 0.45rem' }}
      title="Copiar"
      aria-label="Copiar al portapapeles"
    >
      {ok ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {ok ? 'OK' : 'Copiar'}
    </button>
  );
}

/** Modal de cobro de cuota: efectivo, transferencia o Mercado Pago (QR). */
export default function CollectDuesModal({
  member,
  formatCurrency,
  onClose,
  onConfirm,
}) {
  const amount = member?.outstandingBalance || 0;
  const [method, setMethod] = useState('efectivo');
  const [bankId, setBankId] = useState(CLUB_BANK_ACCOUNTS[0]?.id || '');
  const [receiptName, setReceiptName] = useState('');
  const [receiptPreview, setReceiptPreview] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedBank = CLUB_BANK_ACCOUNTS.find((b) => b.id === bankId) || CLUB_BANK_ACCOUNTS[0];

  const mpPayload = useMemo(() => {
    if (!member) return '';
    return buildMercadoPagoQrPayload({
      amount,
      memberId: member.memberId,
      memberName: member.name,
    });
  }, [member, amount]);

  const handleReceipt = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setReceiptName('');
      setReceiptPreview('');
      return;
    }
    setReceiptName(file.name);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setReceiptPreview(String(reader.result || ''));
      reader.readAsDataURL(file);
    } else {
      setReceiptPreview('');
    }
  };

  const handleConfirm = () => {
    setError('');
    if (method === 'transferencia' && !receiptName) {
      setError('Adjunte el comprobante de la transferencia.');
      return;
    }

    setSubmitting(true);
    const journalAccount = journalAccountForPayment(method, bankId);
    onConfirm({
      method,
      bankId: method === 'transferencia' ? bankId : null,
      bankName: method === 'transferencia' ? selectedBank?.name : null,
      journalAccount,
      receiptName: method === 'transferencia' ? receiptName : null,
      amount,
    });
    setSubmitting(false);
  };

  if (!member) return null;

  return (
    <ModalDialog
      onClose={onClose}
      labelledBy="collect-dues-title"
      contentClassName="modal-content glass-panel"
      contentStyle={{
        width: '92%',
        maxWidth: 520,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-glass)',
        padding: '1.25rem',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}
    >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <h4 id="collect-dues-title" className="serif-font" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-gold)' }}>
              Cobrar cuota
            </h4>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {member.name} · {formatCurrency(amount)}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            aria-label="Cerrar"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <X size={14} aria-hidden="true" /> Cerrar
          </button>
        </div>

        <p style={{ margin: '0 0 0.65rem', fontSize: '0.78rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
          Método de pago
        </p>
        <div className="collect-methods-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', marginBottom: '1.1rem' }}>
          <style>{`
            @media (max-width: 480px) {
              .collect-methods-grid { grid-template-columns: 1fr !important; }
            }
          `}</style>
          {METHODS.map((m) => {
            const Icon = m.icon;
            const active = method === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => { setMethod(m.id); setError(''); }}
                style={{
                  padding: '0.75rem 0.5rem',
                  borderRadius: 10,
                  border: active ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                  background: active ? 'rgba(207,161,58,0.12)' : 'rgba(255,255,255,0.02)',
                  color: active ? 'var(--text-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                }}
              >
                <Icon size={18} style={{ margin: '0 auto 0.35rem', display: 'block' }} />
                <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: '0.68rem', marginTop: 2, opacity: 0.8, lineHeight: 1.25 }}>{m.hint}</div>
              </button>
            );
          })}
        </div>

        {method === 'efectivo' && (
          <div style={{ padding: '0.9rem', borderRadius: 10, border: '1px solid var(--border-glass)', marginBottom: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Confirme el cobro en efectivo. Se registrará en <strong style={{ color: 'var(--text-gold)' }}>Caja General</strong>.
            </p>
          </div>
        )}

        {method === 'transferencia' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Banco del club</label>
              <select
                className="form-input"
                value={bankId}
                onChange={(e) => setBankId(e.target.value)}
              >
                {CLUB_BANK_ACCOUNTS.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {selectedBank && (
              <div style={{ padding: '0.85rem', borderRadius: 10, border: '1px solid var(--border-glass)', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-gold)', marginBottom: '0.5rem' }}>{selectedBank.name}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>Titular: <strong style={{ color: 'var(--text-primary)' }}>{selectedBank.accountName}</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>CBU: <code style={{ color: 'var(--text-primary)' }}>{selectedBank.cbu}</code></span>
                    <CopyBtn value={selectedBank.cbu} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>Alias: <code style={{ color: 'var(--text-primary)' }}>{selectedBank.alias}</code></span>
                    <CopyBtn value={selectedBank.alias} />
                  </div>
                </div>
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Comprobante *</label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '0.85rem 1rem',
                  borderRadius: 10,
                  border: '1px dashed var(--border-glass)',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  fontSize: '0.88rem',
                }}
              >
                <Upload size={16} color="var(--text-gold)" />
                {receiptName || 'Adjuntar imagen o PDF del comprobante'}
                <input
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  onChange={handleReceipt}
                  style={{ display: 'none' }}
                />
              </label>
              {receiptPreview && (
                <img
                  src={receiptPreview}
                  alt="Vista previa del comprobante"
                  style={{ marginTop: 8, maxWidth: '100%', maxHeight: 160, borderRadius: 8, border: '1px solid var(--border-glass)' }}
                />
              )}
            </div>
          </div>
        )}

        {method === 'mercadopago' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.85rem', marginBottom: '1rem', padding: '1rem', borderRadius: 10, border: '1px solid var(--border-glass)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, color: 'var(--text-gold)', marginBottom: 4 }}>QR Mercado Pago</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Alias: <code>{MERCADO_PAGO.alias}</code> · {formatCurrency(amount)}
              </div>
            </div>
            <div style={{ background: '#fff', padding: 12, borderRadius: 12 }}>
              <QRCodeSVG value={mpPayload} size={180} level="M" includeMargin />
            </div>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', maxWidth: 320 }}>
              El socio escanea el QR o transfiere al alias. Confirme el cobro cuando vea el acreditado.
            </p>
          </div>
        )}

        {error && (
          <p style={{ color: '#ef4444', margin: '0 0 0.75rem', fontSize: '0.88rem' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={submitting}
            style={{ minWidth: 160 }}
          >
            Confirmar cobro
          </button>
        </div>
    </ModalDialog>
  );
}

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CreditCard,
  Receipt,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Wallet,
  Download,
  Banknote,
  Upload,
} from 'lucide-react';
import { downloadPaymentReceiptPdf } from '../domain/members/exportPaymentReceiptPdf';
import { useMemberDuesStanding } from '../hooks/useMemberDuesStanding';
import { CLUB_BANK_ACCOUNTS } from '../domain/members/clubBanks';
import { duesAmountForMember, isDuesExemptMember, quotaHeadline } from '../domain/members/dues';
import { duesPaymentNotice } from '../domain/members/duesPaymentNotice';
import { uploadDuesReceipt } from '../data/storage';
import MercadoPagoCheckout from '../components/MercadoPagoCheckout';
import { formatPaymentWhen } from '../domain/members/paymentHistory';
import { isMpAdhered, mpPayNowAmount, mpSubscribeAmount } from '../domain/payments/mercadoPago';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function PaymentHistoryView({ member, user, setCurrentView, sendMessage, membersCanViewCurrentAccounts = true }) {
  const [method, setMethod] = useState('transferencia');
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState('');
  const [notifiedKey, setNotifiedKey] = useState('');
  const bank = CLUB_BANK_ACCOUNTS[0];
  const {
    summary,
    history,
    loading: loadingHistory,
    pending: standingPending,
    lateLabel,
    behind,
    member: duesMember,
  } = useMemberDuesStanding(member);
  const profile = duesMember || member;
  const monthsLate = summary.monthsBehind || 0;
  const quota = quotaHeadline(profile);
  const duesExempt = isDuesExemptMember(profile) || !quota.billing;
  const alDia = !standingPending && !behind;
  const monthly = duesExempt ? 0 : duesAmountForMember(profile);
  const payable = duesExempt ? 0 : mpPayNowAmount(summary.outstanding, monthly);
  const subscribeAmount = duesExempt ? 0 : mpSubscribeAmount(monthly);

  const noticeKey = `${method}:${profile?.memberId || ''}:${payable}:${receiptFile?.name || ''}`;

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('mp');
    if (flag === 'ok' || flag === 'sub') {
      setMessage('Mercado Pago ya tiene el movimiento. En un momento se acredita en tu cuenta.');
    } else if (flag === 'fail') {
      setError('El pago no se completó. Podés intentar de nuevo.');
    }
  }, []);

  const handleReceipt = (event) => {
    const file = event.target.files?.[0];
    setReceiptFile(file || null);
    setReceiptPreview('');
    setNotifiedKey('');
    setMessage('');
    setError('');
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setReceiptPreview(String(reader.result || ''));
      reader.readAsDataURL(file);
    }
  };

  const handleNotify = async () => {
    if (standingPending) return;
    const charge = Number(payable) || 0;
    if (charge <= 0) {
      setError('No se pudo calcular el importe de la cuota.');
      return;
    }
    if (!sendMessage) {
      setError('El aviso a administración no está disponible.');
      return;
    }
    if (method === 'transferencia' && !receiptFile) {
      setError('Adjuntá el comprobante de la transferencia.');
      return;
    }
    if (notifiedKey === noticeKey) return;
    setPaying(true);
    setError('');
    setMessage('');
    try {
      const attachment = method === 'transferencia'
        ? await uploadDuesReceipt(receiptFile, user?.id)
        : null;
      const notice = duesPaymentNotice({
        memberName: profile?.name,
        memberId: profile?.memberId,
        amountLabel: formatCurrency(charge),
        dueLabel: formatDate(summary.nextDue),
        method,
        bankName: bank?.name,
        attachment,
      });
      await sendMessage(notice);
      setNotifiedKey(noticeKey);
      setMessage(method === 'transferencia'
        ? 'El comprobante llegó a administración.'
        : 'Avisamos a administración.');
    } catch (err) {
      setError(err.message || 'No se pudo avisar a administración.');
    } finally {
      setPaying(false);
    }
  };

  const actionLabel = method === 'transferencia' ? 'Enviar comprobante' : 'Avisar a administración';
  const subscribed = isMpAdhered(profile);

  if (!membersCanViewCurrentAccounts) {
    return (
      <div className="fade-in pay-hist">
        <header className="pay-hist-head">
          <button
            type="button"
            className="btn btn-secondary btn-sm pay-hist-back"
            onClick={() => setCurrentView?.('dashboard')}
          >
            <ArrowLeft size={14} /> Volver al inicio
          </button>
          <div>
            <h1 className="page-title" style={{ marginBottom: '0.35rem' }}>
              <CreditCard size={22} style={{ verticalAlign: -3, marginRight: 8 }} />
              Cuenta corriente
            </h1>
            <p className="page-subtitle" style={{ margin: 0 }}>
              No está visible en el portal. Consultá el saldo en administración.
            </p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="fade-in pay-hist">
      <header className="pay-hist-head">
        <button
          type="button"
          className="btn btn-secondary btn-sm pay-hist-back"
          onClick={() => setCurrentView?.('dashboard')}
        >
          <ArrowLeft size={14} /> Volver al inicio
        </button>
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.35rem' }}>
            <CreditCard size={22} style={{ verticalAlign: -3, marginRight: 8 }} />
            Estado Contable
          </h1>
          <p className="page-subtitle" style={{ margin: 0 }}>
            Pagos, historial y comprobantes · {profile?.name}
          </p>
        </div>
      </header>

      <section className="pay-hist-summary">
        <article className={`pay-hist-kpi${standingPending ? '' : (duesExempt || alDia) ? ' is-ok' : ' is-debt'}`}>
          <span>Situación actual</span>
          <strong>
            {standingPending ? '…' : duesExempt ? quota.title : alDia ? 'Al día' : (lateLabel || formatCurrency(summary.outstanding))}
          </strong>
          <small>
            {standingPending
              ? 'Confirmando vencimientos'
              : duesExempt
                ? (quota.hint || 'No abona cuota social')
                : alDia
                  ? `Próximo cobro ${formatDate(summary.nextDue)} · ${formatCurrency(summary.nextAmount)}`
                  : `Venció el ${formatDate(summary.nextDue)} · ${formatCurrency(summary.outstanding)}`}
          </small>
        </article>
        <article className="pay-hist-kpi">
          <span>Total abonado</span>
          <strong>{formatCurrency(summary.totalPaid)}</strong>
          <small>{summary.paymentsCount} pagos registrados</small>
        </article>
        <article className={`pay-hist-kpi${monthsLate > 0 ? ' is-debt' : ''}`}>
          <span>Último pago</span>
          <strong>{summary.lastPayment ? formatDate(summary.lastPayment.date) : '—'}</strong>
          <small>
            {summary.lastPayment
              ? `${formatCurrency(summary.lastPayment.amount)} · ${summary.lastPayment.methodLabel || summary.lastPayment.method}`
              : 'Sin movimientos'}
          </small>
          {!duesExempt && lateLabel ? (
            <small className="pay-hist-kpi-late">
              {lateLabel} · la cuota vence el 10 de cada mes
            </small>
          ) : null}
        </article>
      </section>

      <section className={`glass-card pay-hist-paybox${standingPending ? '' : (duesExempt || alDia) ? ' is-ok' : ' is-debt'}`}>
        <h2>
          <Banknote size={16} />
          {standingPending
            ? 'Estado de la cuota'
            : duesExempt
              ? quota.title
              : alDia
                ? 'Pagar cuota anticipada'
                : 'Pagar cuota pendiente'}
        </h2>
        <p>
          {standingPending
            ? 'Confirmando el estado de tu cuota…'
            : duesExempt
              ? (quota.hint || 'Esta categoría no liquida cuota social.')
              : alDia
                ? `Podés adelantar ${formatCurrency(payable)} y quedar al día hasta ${formatDate(summary.nextDue)}.`
                : `${lateLabel ? `${lateLabel}. ` : ''}Saldo a abonar: ${formatCurrency(payable)}. La cuota vence el 10 de cada mes.`}
        </p>
        {!duesExempt ? (
          <>
        <div className="pay-hist-mp-grid">
          <article className="pay-hist-mp-card">
            <h3>Pagar ahora</h3>
            <p>
              {alDia
                ? `Adelantás ${formatCurrency(payable)} de la cuota.`
                : `Regularizás ${formatCurrency(payable)} en un solo cobro.`}
            </p>
            <MercadoPagoCheckout
              kind="dues"
              amount={payable}
              memberNumber={profile?.memberId}
              concept={`Cuota social · ${profile?.name || 'socio'}`}
              disabled={standingPending || payable <= 0}
              onApproved={() => setMessage('Pago acreditado. Ya figura en tu cuenta.')}
            />
          </article>
          <article className="pay-hist-mp-card">
            <h3>Débito cada mes</h3>
            <p>
              {subscribed
                ? 'Ya estás adherido. Mercado Pago cobra la cuota el día 10.'
                : `${formatCurrency(subscribeAmount)} el día 10. La deuda anterior se paga aparte.`}
            </p>
            {subscribed ? (
              <p className="pay-hist-note">Adhesión activa.</p>
            ) : (
              <MercadoPagoCheckout
                kind="subscription"
                subscribe
                amount={subscribeAmount}
                memberNumber={profile?.memberId}
                concept={`Suscripción cuota social · ${profile?.name || 'socio'}`}
                disabled={standingPending || subscribeAmount <= 0}
                onApproved={() => setMessage('Adhesión lista. Mercado Pago debitará la cuota cada mes, el día 10.')}
              />
            )}
          </article>
        </div>
        {bank ? (
          <div className="pay-hist-transfer">
            <h3>Transferencia al club</h3>
            <p><strong>{bank.name}</strong> · {bank.accountName}</p>
            <p>CBU {bank.cbu}</p>
            <p>Alias {bank.alias}</p>
            <label className="pay-hist-file">
              <Upload size={16} />
              {receiptFile?.name || 'Adjuntar comprobante (JPG, PNG o PDF)'}
              <input type="file" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" onChange={handleReceipt} />
            </label>
            {receiptPreview ? <img src={receiptPreview} alt="Vista previa del comprobante" /> : null}
            <div className="pay-hist-payrow">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={standingPending || paying || payable <= 0 || notifiedKey === noticeKey}
                onClick={() => {
                  setMethod('transferencia');
                  void handleNotify();
                }}
              >
                {paying ? 'Enviando…' : notifiedKey === noticeKey ? 'Avisado' : actionLabel}
              </button>
            </div>
          </div>
        ) : null}
        <div className="pay-hist-feedback" aria-live="polite">
          {message ? <div className="pay-hist-ok">{message}</div> : null}
          {error ? <div className="pay-hist-alert is-error">{error}</div> : null}
          {!message && !error && !standingPending && !alDia ? (
            <div className="pay-hist-alert is-late">
              <AlertCircle size={16} />
              Tenés {lateLabel} de {formatCurrency(payable)}.
            </div>
          ) : null}
        </div>
          </>
        ) : null}
      </section>

      <section className="glass-card pay-hist-list-card">
        <div className="pay-hist-list-head">
          <h2>
            <Receipt size={16} /> Historial de pagos
          </h2>
          <span>{history.length} movimientos</span>
        </div>

        {loadingHistory && history.length === 0 ? (
          <div className="pay-hist-empty">
            <Wallet size={28} />
            <p>Cargando pagos…</p>
          </div>
        ) : history.length === 0 ? (
          <div className="pay-hist-empty">
            <Wallet size={28} />
            <p>Todavía no hay pagos registrados en tu cuenta.</p>
          </div>
        ) : (
          <ul className="pay-hist-list">
            {history.map((pay) => (
              <li key={pay.id} className="pay-hist-row">
                <div className="pay-hist-ico">
                  <CheckCircle2 size={16} />
                </div>
                <div className="pay-hist-main">
                  <strong>{pay.concept}</strong>
                  <span>
                    <Calendar size={12} /> {formatPaymentWhen(pay)}
                    {pay.receipt ? ` · Comp. ${pay.receipt}` : ''}
                  </span>
                </div>
                <div className="pay-hist-side">
                  <strong>{pay.amount > 0 ? formatCurrency(pay.amount) : '—'}</strong>
                  <span>{pay.methodLabel || pay.method}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={() => { void downloadPaymentReceiptPdf({ member, payment: pay }); }}
                  >
                    <Download size={12} /> PDF
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

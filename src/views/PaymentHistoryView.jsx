import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import {
  getMemberPaymentHistory,
  summarizePaymentHistory,
} from '../domain/members/paymentHistory';
import { payMemberDues, payUpcomingDues } from '../domain/members/memberPayments';
import { downloadPaymentReceiptPdf } from '../domain/members/exportPaymentReceiptPdf';

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

export default function PaymentHistoryView({ member, setCurrentView, updateMember }) {
  const [method, setMethod] = useState('mercadopago');
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const history = useMemo(() => getMemberPaymentHistory(member), [member]);
  const summary = useMemo(
    () => summarizePaymentHistory(history, member),
    [history, member]
  );
  const alDia = summary.outstanding <= 0;

  const handlePay = async () => {
    if (!updateMember) {
      setError('Pago no disponible en este momento.');
      return;
    }
    setPaying(true);
    setError('');
    setMessage('');
    try {
      const result = alDia
        ? payUpcomingDues(member, { method })
        : payMemberDues(member, { method });
      updateMember(result.member);
      setMessage(
        alDia
          ? `Anticipaste la cuota (${formatCurrency(result.payment.amount)}). Comprobante ${result.payment.receipt}.`
          : `Pago confirmado (${formatCurrency(result.payment.amount)}). Comprobante ${result.payment.receipt}.`
      );
      try {
        await downloadPaymentReceiptPdf({ member: result.member, payment: result.payment });
      } catch {
        /* PDF opcional */
      }
    } catch (err) {
      setError(err.message || 'No se pudo procesar el pago.');
    } finally {
      setPaying(false);
    }
  };

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
            Pagos, historial y comprobantes · {member?.name}
          </p>
        </div>
      </header>

      <section className="pay-hist-summary">
        <article className={`pay-hist-kpi${alDia ? ' is-ok' : ' is-debt'}`}>
          <span>Situación actual</span>
          <strong>{alDia ? 'Al día' : formatCurrency(summary.outstanding)}</strong>
          <small>
            {alDia
              ? `Próximo cobro ${formatDate(summary.nextDue)} · ${formatCurrency(summary.nextAmount)}`
              : 'Saldo pendiente de cuota social'}
          </small>
        </article>
        <article className="pay-hist-kpi">
          <span>Total abonado</span>
          <strong>{formatCurrency(summary.totalPaid)}</strong>
          <small>{summary.paymentsCount} pagos registrados</small>
        </article>
        <article className="pay-hist-kpi">
          <span>Último pago</span>
          <strong>{summary.lastPayment ? formatDate(summary.lastPayment.date) : '—'}</strong>
          <small>
            {summary.lastPayment
              ? `${formatCurrency(summary.lastPayment.amount)} · ${summary.lastPayment.methodLabel || summary.lastPayment.method}`
              : 'Sin movimientos'}
          </small>
        </article>
      </section>

      <section className="glass-card pay-hist-paybox">
        <h2>
          <Banknote size={16} /> {alDia ? 'Pagar cuota anticipada' : 'Pagar cuota pendiente'}
        </h2>
        <p>
          {alDia
            ? `Podés adelantar ${formatCurrency(summary.nextAmount)} y quedar al día hasta ${formatDate(summary.nextDue)}.`
            : `Saldo a abonar: ${formatCurrency(summary.outstanding)}. Simulación de cobro online (demo).`}
        </p>
        <div className="pay-hist-payrow">
          <select className="form-input" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="mercadopago">Mercado Pago</option>
            <option value="transferencia">Transferencia</option>
            <option value="debito">Débito automático</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="caja">Caja / Secretaría</option>
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={paying || !updateMember}
            onClick={handlePay}
          >
            {paying ? 'Procesando…' : alDia ? 'Anticipar cuota' : 'Pagar ahora'}
          </button>
        </div>
        {message && <div className="pay-hist-ok">{message}</div>}
        {error && <div className="pay-hist-alert">{error}</div>}
      </section>

      {!alDia && (
        <div className="pay-hist-alert">
          <AlertCircle size={16} />
          Tenés un saldo pendiente de {formatCurrency(summary.outstanding)}.
        </div>
      )}

      <section className="glass-card pay-hist-list-card">
        <div className="pay-hist-list-head">
          <h2>
            <Receipt size={16} /> Historial de pagos
          </h2>
          <span>{history.length} movimientos</span>
        </div>

        {history.length === 0 ? (
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
                    <Calendar size={12} /> {formatDate(pay.date)}
                    {pay.receipt ? ` · Comp. ${pay.receipt}` : ''}
                  </span>
                </div>
                <div className="pay-hist-side">
                  <strong>{formatCurrency(pay.amount)}</strong>
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

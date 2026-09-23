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
import { payMemberDues, payUpcomingDues } from '../domain/members/memberPayments';
import { downloadPaymentReceiptPdf } from '../domain/members/exportPaymentReceiptPdf';
import { useMemberDuesStanding } from '../hooks/useMemberDuesStanding';

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

export default function PaymentHistoryView({ member, setCurrentView, updateMember, onAccountEntry }) {
  const [method, setMethod] = useState('mercadopago');
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
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
  const alDia = !standingPending && !behind;
  const payable = alDia ? summary.nextAmount : summary.outstanding;
  const billingMember = useMemo(() => {
    if (!profile) return profile;
    return {
      ...profile,
      paymentHistory: history,
      outstandingBalance: summary.outstanding,
      nextDueDate: summary.nextDue || profile.nextDueDate,
    };
  }, [profile, history, summary.outstanding, summary.nextDue]);

  const handlePay = async () => {
    if (!updateMember) {
      setError('Pago no disponible en este momento.');
      return;
    }
    if (standingPending) return;
    const charge = Number(payable) || 0;
    if (charge <= 0) {
      setError('No se pudo calcular el importe de la cuota.');
      return;
    }
    setPaying(true);
    setError('');
    setMessage('');
    try {
      const billed = { ...billingMember, outstandingBalance: alDia ? 0 : charge };
      const result = alDia
        ? payUpcomingDues(billed, { method })
        : payMemberDues(billed, { method, amount: charge });
      updateMember(result.member);
      if (result.ledgerEntry) onAccountEntry?.(result.ledgerEntry);
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
            Pagos, historial y comprobantes · {profile?.name}
          </p>
        </div>
      </header>

      <section className="pay-hist-summary">
        <article className={`pay-hist-kpi${standingPending ? '' : alDia ? ' is-ok' : ' is-debt'}`}>
          <span>Situación actual</span>
          <strong>
            {standingPending ? '…' : alDia ? 'Al día' : (lateLabel || formatCurrency(summary.outstanding))}
          </strong>
          <small>
            {standingPending
              ? 'Confirmando vencimientos'
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
          {lateLabel ? (
            <small className="pay-hist-kpi-late">
              {lateLabel} · la cuota vence el 10 de cada mes
            </small>
          ) : null}
        </article>
      </section>

      <section className={`glass-card pay-hist-paybox${standingPending ? '' : alDia ? ' is-ok' : ' is-debt'}`}>
        <h2>
          <Banknote size={16} />
          {standingPending
            ? 'Estado de la cuota'
            : alDia
              ? 'Pagar cuota anticipada'
              : 'Pagar cuota pendiente'}
        </h2>
        <p>
          {standingPending
            ? 'Confirmando el estado de tu cuota…'
            : alDia
              ? `Podés adelantar ${formatCurrency(payable)} y quedar al día hasta ${formatDate(summary.nextDue)}.`
              : `${lateLabel ? `${lateLabel}. ` : ''}Saldo a abonar: ${formatCurrency(payable)}. La cuota vence el 10 de cada mes.`}
        </p>
        <div className="pay-hist-payrow">
          <select
            className="form-input"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            disabled={standingPending || paying}
          >
            <option value="mercadopago">Mercado Pago</option>
            <option value="transferencia">Transferencia</option>
            <option value="debito">Débito automático</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="caja">Caja / Secretaría</option>
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={standingPending || paying || !updateMember || payable <= 0}
            onClick={handlePay}
          >
            {paying ? 'Procesando…' : standingPending ? 'Un momento…' : alDia ? 'Anticipar cuota' : `Pagar ${formatCurrency(payable)}`}
          </button>
        </div>
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
                    <Calendar size={12} /> {formatDate(pay.date)}
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

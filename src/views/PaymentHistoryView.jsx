import { useEffect, useMemo, useState } from 'react';
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
import { collectionPeriodChoices, duesAmountForMember, duesDueDayForMember, isDuesExemptMember, quotaHeadline } from '../domain/members/dues';
import { duesChargeConcept, duesMonthLabel, duesMonthsPhrase } from '../domain/members/duesImputations';
import { accountPaymentPlan, duesPaymentSchedule } from '../domain/members/memberPayments';
import { money } from '../domain/money';
import { todayISODateAR } from '../lib/arDate';
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
  const dueDay = summary.dueDay || duesDueDayForMember(profile);
  const dueDayLabel = `la cuota vence el ${dueDay} de cada mes`;
  const standingForCharge = duesExempt ? profile : {
    ...profile,
    nextDueDate: summary.chargeDue || summary.nextDue || profile?.nextDueDate,
    lastPaymentDate: summary.lastDuesDate || profile?.lastPaymentDate,
    outstandingBalance: summary.outstanding != null ? summary.outstanding : profile?.outstandingBalance,
  };
  const surcharge = duesExempt || alDia ? 0 : (Number(summary.surcharge) || 0);
  const quotaDue = duesExempt ? 0 : (Number(summary.quota) || Number(summary.outstanding) || 0);
  const payable = duesExempt
    ? 0
    : (Number(summary.nextAmount) > 0
      ? Number(summary.nextAmount)
      : mpPayNowAmount(summary.outstanding, monthly));
  const [accountInput, setAccountInput] = useState('');
  const accountCharge = useMemo(() => {
    const text = accountInput.trim().replace(',', '.');
    if (!text) return { amount: money(payable), error: '' };
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) {
      return { amount: 0, error: 'El pago a cuenta tiene que ser mayor a cero.' };
    }
    const cash = money(value);
    if (cash > payable + 0.01) {
      return { amount: cash, error: 'El pago a cuenta no puede superar la deuda.' };
    }
    return { amount: cash, error: '' };
  }, [accountInput, payable]);
  const payAmount = accountCharge.amount;
  const accountPlan = !duesExempt && payAmount > 0
    ? accountPaymentPlan(standingForCharge, payAmount)
    : null;
  const subscribeAmount = duesExempt ? 0 : mpSubscribeAmount(monthly);
  const todayIso = todayISODateAR();
  const chargeDue = summary.chargeDue || summary.nextDue;
  const dueIsPast = Boolean(chargeDue && String(chargeDue).slice(0, 10) < todayIso);
  const dueVerb = dueIsPast ? 'Venció' : 'Vence';
  const debtAmount = payable > 0 ? payable : (Number(summary.outstanding) || 0);
  const debtMonthsLabel = duesMonthsPhrase(
    (summary.debtMonths || []).map((row) => row.dueOn),
  );
  const debtHint = !duesExempt && !alDia && !standingPending
    ? [
      debtMonthsLabel || null,
      `${dueVerb} el ${formatDate(chargeDue)} · ${formatCurrency(debtAmount)}`,
      surcharge > 0
        ? `(capital ${formatCurrency(quotaDue)} + recargo ${formatCurrency(surcharge)})`
        : null,
      Number(summary.unallocated) > 0
        ? `sin imputar ${formatCurrency(summary.unallocated)}`
        : null,
    ].filter(Boolean).join(' · ')
    : null;

  const noticeKey = `${method}:${profile?.memberId || ''}:${payAmount}:${receiptFile?.name || ''}`;

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
    if (accountCharge.error) {
      setError(accountCharge.error);
      return;
    }
    const charge = Number(payAmount) || 0;
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
            {standingPending ? '…' : duesExempt ? quota.title : alDia ? 'Al día' : formatCurrency(debtAmount)}
          </strong>
          <small>
            {standingPending
              ? 'Confirmando vencimientos'
              : duesExempt
                ? (quota.hint || 'No abona cuota social')
                : alDia
                  ? (Number(summary.nextAmount) > 0
                    ? `Cuota abierta ${formatDate(summary.nextDue)} · ${formatCurrency(summary.nextAmount)}`
                    : `Próximo vencimiento ${formatDate(summary.nextDue)} · sin cuota abierta`)
                  : `${lateLabel ? `${lateLabel}. ` : ''}${debtHint || ''}`}
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
              {lateLabel} · {dueDayLabel}
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
                ? (payable > 0 ? 'Pagar cuota del mes' : 'Al día')
                : 'Pagar cuota pendiente'}
        </h2>
        <p>
          {standingPending
            ? 'Confirmando el estado de tu cuota…'
            : duesExempt
              ? (quota.hint || 'Esta categoría no liquida cuota social.')
              : alDia
                ? (payable > 0
                  ? `Podés abonar ${formatCurrency(payable)} de la cuota ya abierta.`
                  : `No hay cuota abierta para pagar. Próximo vencimiento ${formatDate(summary.nextDue)}.`)
                : `${lateLabel ? `${lateLabel}. ` : ''}Saldo a abonar: ${formatCurrency(payable)}${surcharge > 0 ? ` (cuota ${formatCurrency(quotaDue)} + recargo ${formatCurrency(surcharge)})` : ''}. ${dueDayLabel.charAt(0).toUpperCase()}${dueDayLabel.slice(1)}.`}
        </p>
        {!duesExempt ? (
          <>
        {payable > 0 ? (
          <label className="form-group" style={{ display: 'block', margin: '0 0 0.85rem' }}>
            <span className="form-label">Pago a cuenta</span>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={accountInput}
              placeholder={String(Math.round(payable))}
              onChange={(event) => {
                setAccountInput(event.target.value);
                setError('');
                setMessage('');
                setNotifiedKey('');
              }}
            />
            <small style={{ display: 'block', marginTop: '0.35rem' }}>
              {accountPlan?.partial && accountPlan.touched[0]
                ? `Entra en ${duesMonthLabel(accountPlan.touched[0].dueOn)}${accountPlan.touched[0].capitalOpen > 0.009 ? `. Quedan ${formatCurrency(accountPlan.touched[0].capitalOpen)} de esa cuota.` : ' y sigue con la siguiente.'}`
                : 'Si el importe es menor, entra en la cuota más vieja y sigue con la siguiente.'}
            </small>
            {accountCharge.error ? (
              <small style={{ display: 'block', marginTop: '0.3rem' }}>{accountCharge.error}</small>
            ) : null}
          </label>
        ) : null}
        <div className="pay-hist-mp-grid">
          {payable > 0 ? (
          <article className="pay-hist-mp-card">
            <h3>Pagar ahora</h3>
            <p>
              {accountPlan?.partial
                ? `Pagás ${formatCurrency(payAmount)} a cuenta.`
                : `Regularizás ${formatCurrency(payable)} en un solo cobro.`}
            </p>
            <MercadoPagoCheckout
              kind="dues"
              amount={payAmount}
              schedule={duesPaymentSchedule(standingForCharge)}
              memberNumber={profile?.memberId}
              concept={accountPlan?.partial
                ? duesChargeConcept(duesMonthsPhrase(accountPlan.touched.map((row) => row.dueOn)), {
                  prefix: 'Cuota social · Pago a cuenta',
                  empty: `Cuota social · Pago a cuenta · ${profile?.name || 'socio'}`,
                })
                : duesChargeConcept(duesMonthsPhrase(collectionPeriodChoices(standingForCharge).map((row) => row.dueOn)), {
                  empty: `Cuota social · ${profile?.name || 'socio'}`,
                })}
              disabled={standingPending || payAmount <= 0 || Boolean(accountCharge.error)}
              onApproved={() => setMessage('Pago acreditado. Ya figura en tu cuenta.')}
            />
          </article>
          ) : null}
          <article className="pay-hist-mp-card">
            <h3>Débito cada mes</h3>
            <p>
              {subscribed
                ? `Ya estás adherido. Mercado Pago cobra la cuota el día ${dueDay}.`
                : `${formatCurrency(subscribeAmount)} el día ${dueDay}. La deuda anterior se paga aparte.`}
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
                onApproved={() => setMessage(`Adhesión lista. Mercado Pago debitará la cuota cada mes, el día ${dueDay}.`)}
              />
            )}
          </article>
        </div>
        {bank && payable > 0 ? (
          <div className="pay-hist-transfer">
            <h3>Transferencia al club</h3>
            <div className="pay-alias">
              <span className="pay-alias-label">Alias</span>
              <strong className="pay-alias-value">{bank.alias}</strong>
            </div>
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
                disabled={standingPending || paying || payAmount <= 0 || Boolean(accountCharge.error) || notifiedKey === noticeKey}
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

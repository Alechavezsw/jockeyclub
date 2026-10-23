import { useEffect, useMemo, useState } from 'react';
import { X, Banknote, Landmark, QrCode, CreditCard, Upload, Copy, Check, Split } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import MercadoPagoCheckout from '../MercadoPagoCheckout';
import {
  CLUB_BANK_ACCOUNTS,
  journalAccountForPayment,
} from '../../domain/members/clubBanks';
import { collectionPeriodChoices, isDuesExemptMember } from '../../domain/members/dues';
import {
  collectionPreview,
  duesMethodNeedsReceipt,
  MIXED_DUES_METHODS,
} from '../../domain/members/memberPayments';
import { billingAccountMember } from '../../domain/members/households';
import { activePaymentPlans } from '../../domain/system/paymentPlans';
import { uploadDuesReceipt } from '../../data/storage';
import { parseDuesReceipt } from '../../data/parseDuesReceipt';

const METHODS = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote, hint: 'Cobro en sede / caja' },
  { id: 'transferencia', label: 'Transferencia', icon: Landmark, hint: 'Bancos del club + comprobante' },
  { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard, hint: 'POS / voucher + comprobante' },
  { id: 'mixto', label: 'Mixto', icon: Split, hint: 'Combiná efectivo, transferencia y tarjeta' },
  { id: 'mercadopago', label: 'Mercado Pago', icon: QrCode, hint: 'QR de mostrador y acreditación automática' },
];

const MIX_METHOD_OPTIONS = MIXED_DUES_METHODS.map((id) => ({
  id,
  label: id === 'efectivo' ? 'Efectivo' : id === 'transferencia' ? 'Transferencia' : 'Tarjeta',
}));

function emptyMixLine(method = 'efectivo', amount = '') {
  return {
    key: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    method,
    amount,
    bankId: CLUB_BANK_ACCOUNTS[0]?.id || '',
    planId: '',
    receiptFile: null,
    receiptName: '',
    receiptPreview: '',
    receiptParse: null,
    reading: false,
  };
}

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

function ReceiptParsePanel({
  parse,
  reading,
  amount,
  formatCurrency,
  paymentTolerance = 1000,
  onChange,
}) {
  if (reading) {
    return (
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
        Gemini está leyendo el comprobante…
      </p>
    );
  }
  if (!parse) return null;
  const parsedAmount = parse.amount != null ? Number(parse.amount) : null;
  const mismatch = parsedAmount != null
    && Number.isFinite(parsedAmount)
    && Math.abs(parsedAmount - Number(amount || 0)) > Number(paymentTolerance || 0);
  return (
    <div style={{
      marginTop: 10,
      padding: '0.75rem 0.85rem',
      borderRadius: 10,
      border: mismatch ? '1px solid #ef4444' : '1px solid var(--border-glass)',
      background: 'rgba(255,255,255,0.02)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.55rem',
    }}>
      <div style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
        Desglose del comprobante
      </div>
      {mismatch ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#ef4444' }}>
          El comprobante marca {formatCurrency(parsedAmount)}; el cobro es {formatCurrency(amount)}.
        </p>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
        <label className="form-group" style={{ margin: 0 }}>
          <span className="form-label">Importe</span>
          <input
            className="form-input"
            type="number"
            step="0.01"
            value={parse.amount ?? ''}
            onChange={(e) => onChange({
              ...parse,
              amount: e.target.value === '' ? null : Number(e.target.value),
            })}
          />
        </label>
        <label className="form-group" style={{ margin: 0 }}>
          <span className="form-label">Fecha</span>
          <input
            className="form-input"
            type="date"
            value={parse.date || ''}
            onChange={(e) => onChange({ ...parse, date: e.target.value || null })}
          />
        </label>
        <label className="form-group" style={{ margin: 0 }}>
          <span className="form-label">Banco / tarjeta</span>
          <input
            className="form-input"
            value={parse.bankOrCard || ''}
            onChange={(e) => onChange({ ...parse, bankOrCard: e.target.value || null })}
          />
        </label>
        <label className="form-group" style={{ margin: 0 }}>
          <span className="form-label">Referencia</span>
          <input
            className="form-input"
            value={parse.reference || ''}
            onChange={(e) => onChange({ ...parse, reference: e.target.value || null })}
          />
        </label>
      </div>
      {parse.payerName ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Titular en el comprobante: {parse.payerName}
        </p>
      ) : null}
    </div>
  );
}

/** Modal de cobro de cuota: efectivo, transferencia, tarjeta o Mercado Pago (QR). */
export default function CollectDuesModal({
  member,
  members = [],
  formatCurrency,
  onClose,
  onConfirm,
  paymentPlans = [],
  paymentTolerance = 1000,
}) {
  const account = (() => {
    try {
      return billingAccountMember(member, members);
    } catch {
      return member;
    }
  })();
  const duesExempt = isDuesExemptMember(account);
  const periodChoices = useMemo(
    () => (duesExempt ? [] : collectionPeriodChoices(account)),
    [duesExempt, account?.memberId, account?.outstandingBalance, account?.nextDueDate, account?.lastPaymentDate, account?.tier],
  );
  const choiceKey = periodChoices.map((row) => row.dueOn).join('|');
  const [selectedDueOns, setSelectedDueOns] = useState([]);
  useEffect(() => {
    setSelectedDueOns(choiceKey ? choiceKey.split('|') : []);
  }, [choiceKey]);
  const split = useMemo(() => {
    if (duesExempt) {
      return { quota: 0, surcharge: 0, gross: 0, creditApplied: 0, cash: 0, leftover: 0, periods: [], choices: [] };
    }
    return collectionPreview(account, new Date(), { periodDueOns: selectedDueOns });
  }, [duesExempt, account, selectedDueOns]);
  const amount = duesExempt ? 0 : split.cash;
  const routed = account?.memberId && member?.memberId && account.memberId !== member.memberId;
  const methods = duesExempt ? METHODS.filter((row) => row.id !== 'mercadopago') : METHODS;
  const plans = useMemo(() => activePaymentPlans(paymentPlans), [paymentPlans]);
  const [method, setMethod] = useState('efectivo');
  const [bankId, setBankId] = useState(CLUB_BANK_ACCOUNTS[0]?.id || '');
  const [planId, setPlanId] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptName, setReceiptName] = useState('');
  const [receiptPreview, setReceiptPreview] = useState('');
  const [receiptParse, setReceiptParse] = useState(null);
  const [readingReceipt, setReadingReceipt] = useState(false);
  const [mixLines, setMixLines] = useState(() => [
    emptyMixLine('efectivo'),
    emptyMixLine('transferencia'),
  ]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const canPickMonths = periodChoices.length > 1;
  const needsReceipt = duesMethodNeedsReceipt(method);
  const isMixed = method === 'mixto';

  const selectedBank = CLUB_BANK_ACCOUNTS.find((b) => b.id === bankId) || CLUB_BANK_ACCOUNTS[0];
  const selectedPlan = plans.find((row) => row.id === planId) || null;
  const mixTotal = useMemo(
    () => mixLines.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [mixLines],
  );
  const mixReading = mixLines.some((row) => row.reading);

  useEffect(() => {
    if (method !== 'tarjeta') return;
    if (!plans.length) {
      setPlanId('');
      return;
    }
    if (!plans.some((row) => row.id === planId)) {
      setPlanId(plans[0].id);
    }
  }, [method, plans, planId]);

  useEffect(() => {
    if (!isMixed || !(amount > 0)) return;
    setMixLines((prev) => {
      if (prev.length < 2) return prev;
      const first = Number(prev[0].amount);
      if (Number.isFinite(first) && first > 0) return prev;
      const half = Math.round((amount / 2) * 100) / 100;
      return prev.map((row, index) => {
        if (index === 0) return { ...row, amount: String(half) };
        if (index === 1) return { ...row, amount: String(Math.round((amount - half) * 100) / 100) };
        return row;
      });
    });
  }, [isMixed, amount]);

  const clearReceipt = () => {
    setReceiptFile(null);
    setReceiptName('');
    setReceiptPreview('');
    setReceiptParse(null);
    setReadingReceipt(false);
  };

  const patchMixLine = (key, patch) => {
    setMixLines((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const togglePeriod = (dueOn) => {
    setError('');
    setSelectedDueOns((prev) => {
      const has = prev.includes(dueOn);
      if (has) {
        if (prev.length <= 1) return prev;
        return prev.filter((value) => value !== dueOn);
      }
      return [...prev, dueOn].sort();
    });
  };

  const handleReceipt = async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      clearReceipt();
      return;
    }
    setReceiptFile(file);
    setReceiptName(file.name);
    setReceiptParse(null);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setReceiptPreview(String(reader.result || ''));
      reader.readAsDataURL(file);
    } else {
      setReceiptPreview('');
    }
    setReadingReceipt(true);
    try {
      const parsed = await parseDuesReceipt(file, {
        expectedAmount: amount,
        methodHint: method,
      });
      setReceiptParse(parsed);
    } finally {
      setReadingReceipt(false);
    }
  };

  const handleMixReceipt = async (key, e) => {
    const file = e.target.files?.[0];
    if (!file) {
      patchMixLine(key, {
        receiptFile: null,
        receiptName: '',
        receiptPreview: '',
        receiptParse: null,
        reading: false,
      });
      return;
    }
    const line = mixLines.find((row) => row.key === key);
    const lineAmount = Number(line?.amount) || amount;
    patchMixLine(key, {
      receiptFile: file,
      receiptName: file.name,
      receiptParse: null,
      receiptPreview: '',
      reading: true,
    });
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => patchMixLine(key, { receiptPreview: String(reader.result || '') });
      reader.readAsDataURL(file);
    }
    try {
      const parsed = await parseDuesReceipt(file, {
        expectedAmount: lineAmount,
        methodHint: line?.method || 'mixto',
      });
      patchMixLine(key, { receiptParse: parsed, reading: false });
    } catch {
      patchMixLine(key, { reading: false });
    }
  };

  const handleConfirm = async () => {
    setError('');
    if (isDuesExemptMember(account)) {
      setError('Esta categoría no abona cuota social.');
      return;
    }
    if (!selectedDueOns.length) {
      setError('Marcá al menos un mes a cobrar.');
      return;
    }
    if (isMixed) {
      const filled = mixLines.filter((row) => Number(row.amount) > 0);
      if (filled.length < 2) {
        setError('El pago mixto necesita al menos dos medios con importe.');
        return;
      }
      for (const row of filled) {
        if (duesMethodNeedsReceipt(row.method) && !row.receiptFile) {
          setError(row.method === 'tarjeta'
            ? 'Adjunte el comprobante de la tarjeta en el mixto.'
            : 'Adjunte el comprobante de la transferencia en el mixto.');
          return;
        }
        if (row.method === 'tarjeta' && plans.length && !row.planId) {
          setError('Elegí el plan de tarjeta en la línea correspondiente.');
          return;
        }
      }
    } else {
      if (needsReceipt && !receiptFile) {
        setError(method === 'tarjeta'
          ? 'Adjunte el comprobante de la tarjeta.'
          : 'Adjunte el comprobante de la transferencia.');
        return;
      }
      if (method === 'tarjeta' && plans.length && !selectedPlan) {
        setError('Elegí el plan con la tarjeta.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isMixed) {
        const paymentSplits = [];
        for (const row of mixLines) {
          const lineAmount = Number(row.amount) || 0;
          if (!(lineAmount > 0)) continue;
          let receiptAttachment = null;
          if (duesMethodNeedsReceipt(row.method) && row.receiptFile) {
            receiptAttachment = await uploadDuesReceipt(
              row.receiptFile,
              account.memberId || member.memberId,
            );
          }
          const bank = CLUB_BANK_ACCOUNTS.find((b) => b.id === row.bankId) || CLUB_BANK_ACCOUNTS[0];
          const plan = plans.find((p) => p.id === row.planId) || null;
          paymentSplits.push({
            method: row.method,
            amount: lineAmount,
            bankId: row.method === 'transferencia' ? row.bankId : null,
            bankName: row.method === 'transferencia' ? bank?.name : null,
            journalAccount: journalAccountForPayment(row.method, row.bankId),
            paymentPlanId: row.method === 'tarjeta' ? (plan?.id || null) : null,
            paymentPlanLabel: row.method === 'tarjeta' ? (plan?.label || null) : null,
            receiptName: receiptAttachment?.name || row.receiptName || null,
            receiptAttachment,
            receiptParse: row.receiptParse,
          });
        }
        await onConfirm({
          method: 'mixto',
          amount,
          periodDueOns: selectedDueOns,
          paymentSplits,
        });
      } else {
        let receiptAttachment = null;
        if (needsReceipt) {
          receiptAttachment = await uploadDuesReceipt(receiptFile, account.memberId || member.memberId);
        }
        const journalAccount = journalAccountForPayment(method, bankId);
        await onConfirm({
          method,
          bankId: method === 'transferencia' ? bankId : null,
          bankName: method === 'transferencia' ? selectedBank?.name : null,
          journalAccount,
          receiptName: receiptAttachment?.name || receiptName || null,
          receiptAttachment,
          amount,
          periodDueOns: selectedDueOns,
          paymentPlanId: method === 'tarjeta' ? (selectedPlan?.id || null) : null,
          paymentPlanLabel: method === 'tarjeta' ? (selectedPlan?.label || null) : null,
          receiptParse: needsReceipt ? receiptParse : null,
        });
      }
    } catch (err) {
      setError(err?.message || 'No se pudo guardar el comprobante.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!member) return null;

  return (
    <ModalDialog
      onClose={onClose}
      labelledBy="collect-dues-title"
      contentClassName="modal-content glass-panel"
      contentStyle={{
        width: '92%',
        maxWidth: 560,
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
              {account.name} · {formatCurrency(amount)}
            </p>
            {routed ? (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                El pago de {member.name} entra en la cuenta del titular.
              </p>
            ) : null}
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

        {canPickMonths ? (
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 0.55rem', fontSize: '0.78rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              Meses del recibo
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.4rem' }}>
              {periodChoices.map((row) => {
                const checked = selectedDueOns.includes(row.dueOn);
                return (
                  <li key={row.dueOn}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.65rem',
                        padding: '0.55rem 0.7rem',
                        borderRadius: 8,
                        border: checked ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                        background: checked ? 'rgba(var(--primary-gold-rgb),0.1)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePeriod(row.dueOn)}
                      />
                      <span style={{ flex: 1 }}>
                        <strong style={{ display: 'block', color: 'var(--text-primary)' }}>{row.label}</strong>
                        <small style={{ color: 'var(--text-muted)' }}>
                          {row.kind === 'overdue' ? 'Atrasada' : 'Próxima'}
                          {row.surcharge > 0 ? ` · recargo ${formatCurrency(row.surcharge)}` : ''}
                        </small>
                      </span>
                      <b className="tabular-nums" style={{ color: 'var(--text-gold)' }}>{formatCurrency(row.payable)}</b>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {split.gross > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${1 + (split.surcharge > 0 ? 1 : 0) + (split.creditApplied > 0 ? 1 : 0) + (split.surcharge > 0 || split.creditApplied > 0 || canPickMonths ? 1 : 0)}, minmax(0, 1fr))`,
            gap: '0.45rem',
            marginBottom: '1rem',
          }}>
            <div style={{ padding: '0.55rem 0.65rem', borderRadius: 8, border: '1px solid var(--border-glass)' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Cuota</div>
              <div className="tabular-nums" style={{ fontWeight: 700 }}>{formatCurrency(split.quota)}</div>
            </div>
            {split.surcharge > 0 ? (
              <div style={{ padding: '0.55rem 0.65rem', borderRadius: 8, border: '1px solid var(--border-glass)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Recargo</div>
                <div className="tabular-nums" style={{ fontWeight: 700 }}>
                  {formatCurrency(split.surcharge)}
                </div>
              </div>
            ) : null}
            {split.creditApplied > 0 ? (
              <div style={{ padding: '0.55rem 0.65rem', borderRadius: 8, border: '1px solid var(--border-glass)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>A favor</div>
                <div className="tabular-nums" style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>
                  {formatCurrency(split.creditApplied)}
                </div>
              </div>
            ) : null}
            {split.surcharge > 0 || split.creditApplied > 0 || canPickMonths ? (
              <div style={{ padding: '0.55rem 0.65rem', borderRadius: 8, border: '1px solid var(--border-glass)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total</div>
                <div className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-gold)' }}>{formatCurrency(split.cash)}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        <p style={{ margin: '0 0 0.65rem', fontSize: '0.78rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
          Método de pago
        </p>
        <div className="collect-methods-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(methods.length, 2)}, minmax(0, 1fr))`, gap: '0.5rem', marginBottom: '1.1rem' }}>
          <style>{`
            @media (min-width: 520px) {
              .collect-methods-grid { grid-template-columns: repeat(${methods.length}, minmax(0, 1fr)) !important; }
            }
          `}</style>
          {methods.map((m) => {
            const Icon = m.icon;
            const active = method === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMethod(m.id);
                  setError('');
                  if (!duesMethodNeedsReceipt(m.id)) clearReceipt();
                  if (m.id === 'mixto') {
                    const half = amount > 0 ? Math.round((amount / 2) * 100) / 100 : '';
                    const rest = amount > 0 ? Math.round((amount - Number(half || 0)) * 100) / 100 : '';
                    setMixLines([
                      emptyMixLine('efectivo', half === '' ? '' : String(half)),
                      emptyMixLine('transferencia', rest === '' ? '' : String(rest)),
                    ]);
                  }
                }}
                style={{
                  padding: '0.75rem 0.5rem',
                  borderRadius: 10,
                  border: active ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                  background: active ? 'rgba(var(--primary-gold-rgb),0.12)' : 'rgba(255,255,255,0.02)',
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
          </div>
        )}

        {method === 'tarjeta' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Se registra en <strong style={{ color: 'var(--text-gold)' }}>Caja General</strong>. El plan es el acuerdo con la tarjeta; no financia la deuda del club.
            </p>
            {plans.length ? (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Plan con la tarjeta *</label>
                <select
                  className="form-input"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                >
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.label}
                      {plan.installments > 1 ? ` · ${plan.installments} cuotas` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                No hay planes activos. El superadmin los carga en Configuración.
              </p>
            )}
          </div>
        )}

        {isMixed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Combiná medios. La suma debe ser {formatCurrency(amount)}. Mercado Pago QR no entra en el mixto.
            </p>
            {mixLines.map((line, index) => {
              const lineNeedsReceipt = duesMethodNeedsReceipt(line.method);
              return (
                <div
                  key={line.key}
                  style={{
                    padding: '0.85rem',
                    borderRadius: 10,
                    border: '1px solid var(--border-glass)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.55rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <strong style={{ color: 'var(--text-gold)', fontSize: '0.82rem' }}>Medio {index + 1}</strong>
                    {mixLines.length > 2 ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setMixLines((prev) => prev.filter((row) => row.key !== line.key))}
                      >
                        Quitar
                      </button>
                    ) : null}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
                    <label className="form-group" style={{ margin: 0 }}>
                      <span className="form-label">Medio</span>
                      <select
                        className="form-input"
                        value={line.method}
                        onChange={(e) => patchMixLine(line.key, {
                          method: e.target.value,
                          receiptFile: null,
                          receiptName: '',
                          receiptPreview: '',
                          receiptParse: null,
                          planId: e.target.value === 'tarjeta' && plans[0] ? plans[0].id : '',
                        })}
                      >
                        {MIX_METHOD_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-group" style={{ margin: 0 }}>
                      <span className="form-label">Importe</span>
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.amount}
                        onChange={(e) => patchMixLine(line.key, { amount: e.target.value })}
                      />
                    </label>
                  </div>
                  {line.method === 'transferencia' ? (
                    <label className="form-group" style={{ margin: 0 }}>
                      <span className="form-label">Banco</span>
                      <select
                        className="form-input"
                        value={line.bankId}
                        onChange={(e) => patchMixLine(line.key, { bankId: e.target.value })}
                      >
                        {CLUB_BANK_ACCOUNTS.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {line.method === 'tarjeta' && plans.length ? (
                    <label className="form-group" style={{ margin: 0 }}>
                      <span className="form-label">Plan</span>
                      <select
                        className="form-input"
                        value={line.planId || plans[0]?.id || ''}
                        onChange={(e) => patchMixLine(line.key, { planId: e.target.value })}
                      >
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>{plan.label}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {lineNeedsReceipt ? (
                    <div>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '0.7rem 0.85rem',
                          borderRadius: 10,
                          border: '1px dashed var(--border-glass)',
                          cursor: 'pointer',
                          color: 'var(--text-secondary)',
                          fontSize: '0.82rem',
                        }}
                      >
                        <Upload size={14} color="var(--text-gold)" />
                        {line.receiptName || 'Comprobante *'}
                        <input
                          type="file"
                          accept="image/*,.pdf,application/pdf"
                          onChange={(e) => handleMixReceipt(line.key, e)}
                          style={{ display: 'none' }}
                        />
                      </label>
                      {line.receiptPreview ? (
                        <img
                          src={line.receiptPreview}
                          alt=""
                          style={{ marginTop: 8, maxWidth: '100%', maxHeight: 120, borderRadius: 8, border: '1px solid var(--border-glass)' }}
                        />
                      ) : null}
                      <ReceiptParsePanel
                        parse={line.receiptParse}
                        reading={line.reading}
                        amount={Number(line.amount) || 0}
                        formatCurrency={formatCurrency}
                        paymentTolerance={paymentTolerance}
                        onChange={(next) => patchMixLine(line.key, { receiptParse: next })}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setMixLines((prev) => [...prev, emptyMixLine('efectivo')])}
              >
                Agregar medio
              </button>
              <span style={{
                fontSize: '0.85rem',
                color: Math.abs(mixTotal - amount) > 0.009 ? '#ef4444' : 'var(--emerald-accent)',
              }}>
                Suma {formatCurrency(mixTotal)}
                {Math.abs(mixTotal - amount) > 0.009 ? ` · falta ${formatCurrency(amount - mixTotal)}` : ' · ok'}
              </span>
            </div>
          </div>
        ) : null}

        {needsReceipt && !isMixed ? (
          <div className="form-group" style={{ marginBottom: '1rem' }}>
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
            <ReceiptParsePanel
              parse={receiptParse}
              reading={readingReceipt}
              amount={amount}
              formatCurrency={formatCurrency}
              paymentTolerance={paymentTolerance}
              onChange={setReceiptParse}
            />
          </div>
        ) : null}

        {method === 'mercadopago' && (
          <div style={{ marginBottom: '1rem' }}>
            <MercadoPagoCheckout
              kind="dues"
              mode="qr"
              amount={amount}
              memberNumber={account.memberId}
              concept={`Cuota social · ${account.name || 'socio'}`}
              disabled={duesExempt || amount <= 0 || !selectedDueOns.length}
              onApproved={() => {
                onConfirm({
                  method: 'mercadopago',
                  alreadyApplied: true,
                  amount,
                  periodDueOns: selectedDueOns,
                });
              }}
            />
          </div>
        )}

        {error && (
          <p style={{ color: '#ef4444', margin: '0 0 0.75rem', fontSize: '0.88rem' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          {method === 'mercadopago' ? null : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={submitting || readingReceipt || mixReading || !selectedDueOns.length}
              style={{ minWidth: 160 }}
            >
              {submitting
                ? 'Guardando…'
                : (method === 'efectivo'
                  ? 'Acreditar efectivo'
                  : method === 'mixto'
                    ? 'Registrar pago mixto'
                    : 'Registrar con comprobante')}
            </button>
          )}
        </div>
    </ModalDialog>
  );
}

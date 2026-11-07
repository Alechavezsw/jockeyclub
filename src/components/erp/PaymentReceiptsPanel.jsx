import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Receipt,
  Search,
  X,
} from 'lucide-react';
import { formatCurrency as formatCurrencyDefault } from '../../domain/accounting/journal';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import { memberNumberOf, rankMemberSearchHit } from '../../domain/members/households';
import { duesMethodLabel } from '../../domain/members/memberPayments';
import { downloadPaymentReceiptPdf } from '../../domain/members/exportPaymentReceiptPdf';
import {
  paymentReceiptShareTargets,
  sendDuesReceiptMessage,
} from '../../domain/members/duesReceiptDelivery';
import { todayAR } from '../../lib/arDate';
import { isSupabaseConfigured } from '../../lib/supabase';
import * as repos from '../../data/repos';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function memberMatches(member, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  const digits = q.replace(/\D/g, '');
  const number = String(memberNumberOf(member) || member?.memberId || '').replace(/\D/g, '');
  const name = String(member?.name || member?.fullName || '').toLowerCase();
  const doc = String(member?.documentNumber || member?.dni || '').replace(/\D/g, '');
  if (digits.length >= 2 && (number.includes(digits) || doc.includes(digits))) return true;
  return name.includes(q);
}

function monthOptions(nowIso = todayAR()) {
  const y = Number(nowIso.slice(0, 4));
  const m = Number(nowIso.slice(5, 7));
  const rows = [{ value: 'all', label: 'Todos los meses' }];
  let year = y;
  let month = m;
  for (let i = 0; i < 24; i += 1) {
    const value = `${year}-${String(month).padStart(2, '0')}`;
    rows.push({ value, label: `${MONTHS_ES[month - 1]} ${year}` });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return rows;
}

function paymentMonthKey(payment) {
  const date = String(payment?.date || payment?.paidAt || '').slice(0, 10);
  if (/^\d{4}-\d{2}/.test(date)) return date.slice(0, 7);
  return '';
}

function isActivePayment(payment) {
  return payment && payment.status !== 'void' && !payment.voidedAt;
}

function paymentMethodText(payment) {
  return payment?.methodLabel || duesMethodLabel(payment?.method, payment?.bankName);
}

async function hydrateMemberWithPayments(row) {
  if (!isSupabaseConfigured) {
    return {
      ...row,
      paymentHistory: (row?.paymentHistory || []).filter(isActivePayment),
    };
  }
  const dbId = row?.id;
  const number = memberNumberOf(row) || row?.memberId;
  try {
    if (dbId && typeof repos.getMember === 'function') {
      const full = await repos.getMember(dbId, { withPayments: true });
      if (full) return full;
    }
    if (number && typeof repos.getMemberByNumber === 'function') {
      const full = await repos.getMemberByNumber(number, { withPayments: true });
      if (full) return full;
    }
  } catch {
    /* se usa el hit local */
  }
  return {
    ...row,
    paymentHistory: (row?.paymentHistory || []).filter(isActivePayment),
  };
}

function openExternal(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function PaymentReceiptsPanel({
  members = [],
  onBack,
  onSendMessage,
  formatCurrency = formatCurrencyDefault,
}) {
  const [query, setQuery] = useState('');
  const [remoteHits, setRemoteHits] = useState([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [member, setMember] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [monthKey, setMonthKey] = useState(() => todayAR().slice(0, 7));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const months = useMemo(() => monthOptions(), []);

  useEffect(() => {
    if (typeof repos.invalidateMemberSearchCache === 'function') {
      repos.invalidateMemberSearchCache();
    }
  }, []);

  useEffect(() => {
    if (member) {
      setRemoteHits([]);
      setRemoteBusy(false);
      return undefined;
    }
    const needle = query.trim();
    const digits = needle.replace(/\D/g, '');
    const enough = needle.length >= 2 || digits.length >= 3;
    if (!enough || !isSupabaseConfigured) {
      setRemoteHits([]);
      setRemoteBusy(false);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRemoteBusy(true);
      repos.searchMembersDirectory(needle, { limit: 14, signal: controller.signal })
        .then((rows) => {
          if (!cancelled) setRemoteHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setRemoteHits([]);
        })
        .finally(() => {
          if (!cancelled) setRemoteBusy(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, member]);

  const hits = useMemo(() => {
    if (member) return [];
    const q = query.trim();
    if (!q) return [];
    const local = (members || [])
      .filter((m) => memberMatches(m, q))
      .toSorted((a, b) => rankMemberSearchHit(a, q) - rankMemberSearchHit(b, q))
      .slice(0, 14);
    const byId = new Map(local.map((m) => [String(m.memberId), m]));
    for (const row of remoteHits) {
      const id = String(row.memberId || '');
      if (id && !byId.has(id)) byId.set(id, row);
    }
    return [...byId.values()]
      .toSorted((a, b) => rankMemberSearchHit(a, q) - rankMemberSearchHit(b, q))
      .slice(0, 14);
  }, [members, query, remoteHits, member]);

  const filteredPayments = useMemo(() => {
    const rows = (payments || []).filter(isActivePayment);
    if (monthKey === 'all') return rows;
    return rows.filter((p) => paymentMonthKey(p) === monthKey);
  }, [payments, monthKey]);

  const pickMember = async (row) => {
    setError('');
    setNotice('');
    setLoadingPayments(true);
    setMember(row);
    try {
      const fromPadron = (members || []).find((m) => String(m.memberId) === String(row.memberId));
      const full = await hydrateMemberWithPayments(fromPadron || row);
      setMember(full);
      setPayments((full.paymentHistory || []).filter(isActivePayment));
    } catch (err) {
      setError(err?.message || 'No se pudieron cargar los pagos.');
      setPayments([]);
    } finally {
      setLoadingPayments(false);
    }
  };

  const clearMember = () => {
    setMember(null);
    setPayments([]);
    setQuery('');
    setError('');
    setNotice('');
    setBusyKey('');
  };

  const runAction = async (payment, action) => {
    if (!member || !payment) return;
    const key = `${action}:${payment.id}`;
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      if (action === 'download') {
        await downloadPaymentReceiptPdf({ member, payment });
        setNotice('Comprobante descargado.');
        return;
      }
      if (action === 'whatsapp') {
        const share = paymentReceiptShareTargets(member, payment);
        if (!share.whatsappUrl) {
          setError('Este socio no tiene celular en la ficha.');
          return;
        }
        openExternal(share.whatsappUrl);
        setNotice('WhatsApp abierto con el texto del comprobante.');
        return;
      }
      if (action === 'mail' || action === 'md') {
        if (action === 'mail') {
          const share = paymentReceiptShareTargets(member, payment);
          if (!share.email) {
            setError('Este socio no tiene un mail real en la ficha.');
            return;
          }
        }
        if (action === 'md' && typeof onSendMessage !== 'function') {
          setError('La mensajería interna no está disponible.');
          return;
        }
        await sendDuesReceiptMessage({
          member,
          payment,
          onSendMessage: action === 'md' ? onSendMessage : undefined,
          channels: {
            md: action === 'md',
            email: action === 'mail',
          },
        });
        setNotice(action === 'mail'
          ? 'Comprobante enviado por mail.'
          : 'Comprobante enviado por MD al portal.');
      }
    } catch (err) {
      setError(err?.message || 'No se pudo completar la acción.');
    } finally {
      setBusyKey('');
    }
  };

  const nro = member ? (memberNumberOf(member) || member.memberId) : '';

  return (
    <div className="fade-in cuotas-panel payment-receipts-panel">
      <div className="cuotas-toolbar cuotas-toolbar--local">
        {onBack ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            <ArrowLeft size={14} /> Volver
          </button>
        ) : null}
        <h3 className="cuotas-title" style={{ margin: 0 }}>
          <Receipt size={18} aria-hidden="true" />
          Comprobantes de pago
        </h3>
      </div>

      {!member ? (
        <section className="payment-receipts-search">
          <label className="payment-receipts-search-label" htmlFor="payment-receipts-query">
            Buscar socio
          </label>
          <div className="payment-receipts-search-wrap">
            <Search size={22} aria-hidden="true" />
            <input
              id="payment-receipts-query"
              className="form-input payment-receipts-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre, Nº de socio o DNI"
              autoFocus
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                className="payment-receipts-search-clear"
                aria-label="Limpiar búsqueda"
                onClick={() => setQuery('')}
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
          <p className="payment-receipts-hint">
            Escribí al menos 2 letras o 3 dígitos. Elegí el socio y filtrá por mes para bajar o reenviar el recibo.
          </p>

          {remoteBusy ? (
            <p className="payment-receipts-status">
              <Loader2 size={14} className="spin" aria-hidden="true" /> Buscando…
            </p>
          ) : null}

          <ul className="payment-receipts-hits">
            {hits.map((row) => {
              const hitNro = memberNumberOf(row) || row.memberId;
              const doc = row.documentNumber || row.dni || '';
              return (
                <li key={String(row.memberId || hitNro)}>
                  <button type="button" className="payment-receipts-hit" onClick={() => pickMember(row)}>
                    <span className="payment-receipts-hit-main">
                      <strong>{row.name || row.fullName}</strong>
                      <small>
                        Nº {hitNro}
                        {doc ? ` · DNI ${doc}` : ''}
                      </small>
                    </span>
                    <span className="payment-receipts-hit-cta">Ver pagos</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {query.trim().length >= 2 && !remoteBusy && !hits.length ? (
            <p className="payment-receipts-status">Sin coincidencias.</p>
          ) : null}
        </section>
      ) : (
        <section className="payment-receipts-result">
          <div className="payment-receipts-member">
            <div>
              <p className="payment-receipts-kicker">Socio</p>
              <h4>{member.name || member.fullName}</h4>
              <p className="payment-receipts-meta">Nº {nro}</p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={clearMember}>
              Cambiar socio
            </button>
          </div>

          <div className="payment-receipts-filters">
            <label className="form-group" style={{ margin: 0 }}>
              <span className="form-label" htmlFor="payment-receipts-month">Mes del cobro</span>
              <select
                id="payment-receipts-month"
                className="form-input"
                value={monthKey}
                onChange={(e) => setMonthKey(e.target.value)}
              >
                {months.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          </div>

          {error ? <p className="ig-error" role="alert">{error}</p> : null}
          {notice ? <p className="payment-receipts-ok" role="status">{notice}</p> : null}

          {loadingPayments ? (
            <p className="payment-receipts-status">
              <Loader2 size={14} className="spin" aria-hidden="true" /> Cargando pagos…
            </p>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th>Período</th>
                    <th>Medio</th>
                    <th>Importe</th>
                    <th>Comprobante</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                        No hay pagos{monthKey === 'all' ? '' : ' en ese mes'}.
                      </td>
                    </tr>
                  ) : filteredPayments.map((payment) => {
                    const receiptNo = payment.receiptNumber || payment.receipt || '—';
                    const share = paymentReceiptShareTargets(member, payment);
                    const rowBusy = busyKey.endsWith(`:${payment.id}`);
                    return (
                      <tr key={payment.id}>
                        <td>{payment.date ? formatAccessinCashDate(payment.date) : '—'}</td>
                        <td>{payment.concept || 'Cuota social'}</td>
                        <td>{payment.period || '—'}</td>
                        <td>{paymentMethodText(payment)}</td>
                        <td style={{ fontWeight: 700 }}>{formatCurrency(payment.amount)}</td>
                        <td className="tabular-nums">{receiptNo}</td>
                        <td>
                          <div className="payment-receipts-actions" role="group" aria-label="Acciones del comprobante">
                            <button
                              type="button"
                              className="payment-receipts-chip tone-pdf"
                              disabled={rowBusy}
                              title="Descargar PDF"
                              aria-label="Descargar PDF"
                              onClick={() => runAction(payment, 'download')}
                            >
                              {busyKey === `download:${payment.id}`
                                ? <Loader2 size={13} className="spin" aria-hidden="true" />
                                : <Download size={13} aria-hidden="true" />}
                              <span>PDF</span>
                            </button>
                            <button
                              type="button"
                              className="payment-receipts-chip tone-wa"
                              disabled={rowBusy || !share.whatsappUrl}
                              title={share.whatsappUrl ? 'Abrir WhatsApp' : 'Sin celular en ficha'}
                              aria-label="Enviar por WhatsApp"
                              onClick={() => runAction(payment, 'whatsapp')}
                            >
                              <Phone size={13} aria-hidden="true" />
                              <span>WA</span>
                            </button>
                            <button
                              type="button"
                              className="payment-receipts-chip tone-mail"
                              disabled={rowBusy || !share.email}
                              title={share.email ? 'Enviar por mail' : 'Sin mail real en ficha'}
                              aria-label="Enviar por mail"
                              onClick={() => runAction(payment, 'mail')}
                            >
                              {busyKey === `mail:${payment.id}`
                                ? <Loader2 size={13} className="spin" aria-hidden="true" />
                                : <Mail size={13} aria-hidden="true" />}
                              <span>Mail</span>
                            </button>
                            <button
                              type="button"
                              className="payment-receipts-chip tone-md"
                              disabled={rowBusy || typeof onSendMessage !== 'function'}
                              title="Enviar por mensajería interna (MD)"
                              aria-label="Enviar por MD"
                              onClick={() => runAction(payment, 'md')}
                            >
                              {busyKey === `md:${payment.id}`
                                ? <Loader2 size={13} className="spin" aria-hidden="true" />
                                : <MessageSquare size={13} aria-hidden="true" />}
                              <span>MD</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

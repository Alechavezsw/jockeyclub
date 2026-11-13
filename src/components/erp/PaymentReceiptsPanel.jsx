import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  ChevronDown,
  Download,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Receipt,
  Search,
  X,
} from 'lucide-react';
import { formatCurrency as formatCurrencyDefault } from '../../domain/accounting/journal';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import { memberNumberOf, rankMemberSearchHit } from '../../domain/members/households';
import {
  downloadPaymentReceiptPdf,
  receiptMethodLabel,
} from '../../domain/members/exportPaymentReceiptPdf';
import {
  paymentReceiptShareTargets,
  sendDuesReceiptMessage,
} from '../../domain/members/duesReceiptDelivery';
import {
  EDITABLE_DUES_METHODS,
} from '../../domain/members/duesPaymentMethodChange';
import { CLUB_BANK_ACCOUNTS } from '../../domain/members/clubBanks';
import {
  DUES_METHOD_LABELS,
  persistDuesVoid,
  voidMemberDuesPayment,
} from '../../domain/members/memberPayments';
import { canVoidDuesPayment } from '../../domain/auth/roles';
import { useAuth } from '../../context/AuthContext';
import { formatInstantAR, todayAR } from '../../lib/arDate';
import { isSupabaseConfigured } from '../../lib/supabase';
import * as repos from '../../data/repos';

const METHOD_EDIT_OPTIONS = EDITABLE_DUES_METHODS.map((id) => ({
  id,
  label: DUES_METHOD_LABELS[id] || id,
}));

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

function paymentOperatorLabel(payment) {
  const name = String(payment?.recordedByName || '').trim();
  if (name) return name;
  return payment?.recordedBy ? 'Usuario del sistema' : '—';
}

function paymentVoidedByLabel(payment) {
  const name = String(payment?.voidedByName || '').trim();
  if (name) return name;
  const raw = String(payment?.voidedBy || '').trim();
  if (!raw) return '—';
  // En la base a veces queda el uuid del auth; no lo mostramos como “quién”.
  if (/^[0-9a-f-]{32,}$/i.test(raw.replace(/-/g, ''))) return 'Usuario del sistema';
  return raw;
}

function paymentOperationInstant(payment) {
  return formatInstantAR(
    payment?.paidAt || payment?.createdAt || payment?.date,
    payment?.time || undefined,
  );
}

async function hydrateMemberWithPayments(row) {
  if (!isSupabaseConfigured) {
    return {
      ...row,
      paymentHistory: Array.isArray(row?.paymentHistory) ? row.paymentHistory : [],
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
    paymentHistory: Array.isArray(row?.paymentHistory) ? row.paymentHistory : [],
  };
}

function openExternal(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function PaymentReceiptsPanel({
  members = [],
  setMembers,
  setJournalEntries,
  addJournalEntry,
  onBack,
  onSendMessage,
  formatCurrency = formatCurrencyDefault,
}) {
  const { user } = useAuth();
  const actorName = user?.fullName || user?.email || 'Administración';
  const canVoid = canVoidDuesPayment(user);
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
  const [openActionsId, setOpenActionsId] = useState(null);
  const [methodEditId, setMethodEditId] = useState(null);
  const [methodDraft, setMethodDraft] = useState('efectivo');
  const [methodBankId, setMethodBankId] = useState(CLUB_BANK_ACCOUNTS[0]?.id || '');
  const [methodReason, setMethodReason] = useState('');
  const [voidEditId, setVoidEditId] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [showVoided, setShowVoided] = useState(true);

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
    let rows = payments || [];
    if (!showVoided) rows = rows.filter(isActivePayment);
    if (monthKey === 'all') return rows;
    return rows.filter((p) => paymentMonthKey(p) === monthKey);
  }, [payments, monthKey, showVoided]);

  const pickMember = async (row) => {
    setError('');
    setNotice('');
    setLoadingPayments(true);
    setMember(row);
    try {
      const fromPadron = (members || []).find((m) => String(m.memberId) === String(row.memberId));
      const full = await hydrateMemberWithPayments(fromPadron || row);
      setMember(full);
      setPayments(full.paymentHistory || []);
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
    setOpenActionsId(null);
    setMethodEditId(null);
    setMethodReason('');
    setVoidEditId(null);
    setVoidReason('');
  };

  const openMethodEdit = (payment) => {
    const current = String(payment?.method || 'efectivo').toLowerCase();
    setVoidEditId(null);
    setVoidReason('');
    setMethodEditId(payment.id);
    setMethodDraft(EDITABLE_DUES_METHODS.includes(current) ? current : 'efectivo');
    setMethodBankId(payment.bankId || CLUB_BANK_ACCOUNTS[0]?.id || '');
    setMethodReason('');
    setError('');
    setNotice('');
  };

  const openVoidEdit = (payment) => {
    setMethodEditId(null);
    setMethodReason('');
    setVoidEditId(payment.id);
    setVoidReason('');
    setError('');
    setNotice('');
  };

  const applyVoidedMember = (nextMember, voidedPayment) => {
    const history = (nextMember.paymentHistory || []).map((row) => (
      String(row.id) === String(voidedPayment.id) ? { ...row, ...voidedPayment } : row
    ));
    if (!history.some((row) => String(row.id) === String(voidedPayment.id))) {
      history.unshift(voidedPayment);
    }
    const merged = { ...nextMember, paymentHistory: history };
    setMember(merged);
    setPayments(history);
    if (typeof setMembers === 'function' && merged?.memberId) {
      setMembers((prev) => (prev || []).map((row) => (
        String(row.memberId) === String(merged.memberId) ? { ...row, ...merged } : row
      )));
    }
  };

  const saveVoid = async (payment) => {
    if (!payment?.id || !member) return;
    const key = `void:${payment.id}`;
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      if (!canVoid) {
        throw new Error('Sin permiso para anular el cobro.');
      }
      const why = voidReason.trim();
      if (why.length < 8) {
        throw new Error('Falta el motivo de la anulación (mínimo 8 caracteres).');
      }
      const host = members.find((row) => String(row.memberId) === String(member.memberId)) || member;
      const withHistory = {
        ...host,
        paymentHistory: payments.length ? payments : (host.paymentHistory || member.paymentHistory || []),
        outstandingBalance: member.outstandingBalance ?? host.outstandingBalance,
        nextDueDate: member.nextDueDate ?? host.nextDueDate,
        lastPaymentDate: member.lastPaymentDate ?? host.lastPaymentDate,
        id: member.id || host.id,
      };
      const result = voidMemberDuesPayment(withHistory, payment.id, {
        voidedBy: actorName,
        voidedById: user?.id || null,
        reason: why,
      });
      const persisted = await persistDuesVoid(result, {
        setMembers,
        addJournalEntry: typeof addJournalEntry === 'function'
          ? addJournalEntry
          : async (entry) => {
            if (isSupabaseConfigured && typeof repos.insertJournalEntry === 'function') {
              const saved = await repos.insertJournalEntry(entry, { createdBy: user?.id || null });
              if (typeof setJournalEntries === 'function') {
                setJournalEntries((prev) => [saved, ...(prev || [])]);
              }
              return saved;
            }
            const local = { ...entry, id: entry.id || `je-void-${Date.now()}` };
            if (typeof setJournalEntries === 'function') {
              setJournalEntries((prev) => [local, ...(prev || [])]);
            }
            return local;
          },
      });
      let refreshed = persisted.member;
      try {
        refreshed = await hydrateMemberWithPayments(persisted.member);
      } catch {
        /* se usa el resultado local */
      }
      applyVoidedMember(refreshed, {
        ...payment,
        ...persisted.payment,
        status: 'void',
        voidReason: why,
        voidedByName: actorName,
        voidedAt: persisted.payment?.voidedAt || new Date().toISOString(),
      });
      setVoidEditId(null);
      setVoidReason('');
      setShowVoided(true);
      setNotice(`Cobro anulado · ${formatCurrency(payment.amount)} · ${actorName}. Saldo, imputaciones y caja revertidos.`);
    } catch (err) {
      setError(err?.message || 'No se pudo anular el cobro.');
    } finally {
      setBusyKey('');
    }
  };

  const saveMethodEdit = async (payment) => {
    if (!payment?.id) return;
    const key = `method:${payment.id}`;
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      if (!isSupabaseConfigured || typeof repos.updateMemberPaymentMethod !== 'function') {
        throw new Error('El cambio de medio requiere la nube.');
      }
      const bank = CLUB_BANK_ACCOUNTS.find((row) => row.id === methodBankId) || CLUB_BANK_ACCOUNTS[0];
      const saved = await repos.updateMemberPaymentMethod({
        paymentId: payment.id,
        method: methodDraft,
        bankId: (methodDraft === 'transferencia' || methodDraft === 'debito') ? (bank?.id || null) : null,
        bankName: (methodDraft === 'transferencia' || methodDraft === 'debito') ? (bank?.name || null) : null,
        reason: methodReason,
        changedByName: actorName,
      });
      setPayments((prev) => prev.map((row) => (row.id === saved.id ? { ...row, ...saved } : row)));
      setMember((prev) => {
        if (!prev) return prev;
        const history = (prev.paymentHistory || []).map((row) => (
          row.id === saved.id ? { ...row, ...saved } : row
        ));
        return { ...prev, paymentHistory: history };
      });
      if (typeof setMembers === 'function' && member?.memberId) {
        setMembers((prev) => (prev || []).map((row) => {
          if (String(row.memberId) !== String(member.memberId)) return row;
          const history = (row.paymentHistory || []).map((pay) => (
            pay.id === saved.id ? { ...pay, ...saved } : pay
          ));
          return { ...row, paymentHistory: history };
        }));
      }
      const sync = saved.accountingSync;
      if (typeof setJournalEntries === 'function' && sync?.journalEntryId) {
        const accountId = sync.treasuryAccountId || null;
        const accountName = sync.journalAccountName || null;
        setJournalEntries((prev) => (prev || []).map((entry) => {
          if (String(entry.id) !== String(sync.journalEntryId)) return entry;
          const nextLines = (entry.lines || []).map((line) => {
            if (!(Number(line.debit) > 0)) return line;
            const accName = String(line.account || line.accountName || '');
            const looksTreasury = /caja|banco|mercado/i.test(accName);
            if (!looksTreasury && accName) return line;
            if (!looksTreasury && !accountId) return line;
            return {
              ...line,
              ...(accountId ? { accountId } : {}),
              ...(accountName ? { account: accountName, accountName } : {}),
            };
          });
          return {
            ...entry,
            concept: sync.concept || entry.concept,
            description: sync.concept || entry.description,
            lines: nextLines,
          };
        }));
      }
      setMethodEditId(null);
      setMethodReason('');
      const syncNote = sync?.error
        ? ` · aviso: ${sync.error}`
        : (sync?.updatedLines || sync?.updatedMovements
          ? ' · asiento y caja alineados'
          : '');
      setNotice(`Medio actualizado a ${receiptMethodLabel(saved)} · ${saved.methodChangedByName || actorName}${syncNote}`);
    } catch (err) {
      setError(err?.message || 'No se pudo cambiar el medio de pago.');
    } finally {
      setBusyKey('');
    }
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
            <label className="payment-receipts-voided-toggle">
              <input
                type="checkbox"
                checked={showVoided}
                onChange={(e) => setShowVoided(e.target.checked)}
              />
              Mostrar anulados
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
                    const actionsOpen = openActionsId === payment.id;
                    const voided = !isActivePayment(payment);
                    return (
                      <tr key={payment.id} className={voided ? 'payment-receipts-row-void' : undefined}>
                        <td>{payment.date ? formatAccessinCashDate(payment.date) : '—'}</td>
                        <td>{payment.concept || 'Cuota social'}</td>
                        <td>{payment.period || '—'}</td>
                        <td>
                          <div className="payment-receipts-method-cell">
                            <strong>{receiptMethodLabel(payment)}</strong>
                            {voided ? (
                              <span className="payment-receipts-void-badge">
                                Anulado · {paymentVoidedByLabel(payment)}
                              </span>
                            ) : null}
                            {payment.methodChangedByName && !voided ? (
                              <small>
                                Cambió {payment.methodChangedByName}
                                {payment.methodChangedAt
                                  ? ` · ${formatInstantAR(payment.methodChangedAt)}`
                                  : ''}
                              </small>
                            ) : null}
                            {voided ? (
                              <small>
                                Anuló {paymentVoidedByLabel(payment)}
                                {payment.voidedAt ? ` · ${formatInstantAR(payment.voidedAt)}` : ''}
                                {payment.voidReason ? ` · ${payment.voidReason}` : ''}
                              </small>
                            ) : null}
                          </div>
                        </td>
                        <td style={{ fontWeight: 700 }}>{formatCurrency(payment.amount)}</td>
                        <td className="tabular-nums">{receiptNo}</td>
                        <td>
                          <div className={`payment-receipts-actions-wrap${actionsOpen ? ' is-open' : ''}`}>
                            <button
                              type="button"
                              className="payment-receipts-actions-toggle"
                              aria-expanded={actionsOpen}
                              aria-controls={`payment-actions-${payment.id}`}
                              onClick={() => setOpenActionsId(actionsOpen ? null : payment.id)}
                            >
                              <span>Acciones</span>
                              <ChevronDown size={14} aria-hidden="true" />
                            </button>
                            {actionsOpen ? (
                              <div
                                id={`payment-actions-${payment.id}`}
                                className="payment-receipts-actions-panel"
                              >
                                <dl className="payment-receipts-op-meta">
                                  <div>
                                    <dt>Hora</dt>
                                    <dd>{paymentOperationInstant(payment)}</dd>
                                  </div>
                                  <div>
                                    <dt>Usuario</dt>
                                    <dd>{paymentOperatorLabel(payment)}</dd>
                                  </div>
                                  {payment.methodChangedByName ? (
                                    <div>
                                      <dt>Medio editado</dt>
                                      <dd>
                                        {payment.methodChangedByName}
                                        {payment.methodChangeReason
                                          ? ` · ${payment.methodChangeReason}`
                                          : ''}
                                      </dd>
                                    </div>
                                  ) : null}
                                  {voided ? (
                                    <div>
                                      <dt>Anuló</dt>
                                      <dd>
                                        {paymentVoidedByLabel(payment)}
                                        {payment.voidedAt
                                          ? ` · ${formatInstantAR(payment.voidedAt)}`
                                          : ''}
                                        {payment.voidReason
                                          ? ` · ${payment.voidReason}`
                                          : ''}
                                      </dd>
                                    </div>
                                  ) : null}
                                </dl>
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
                                    disabled={rowBusy || voided || !share.whatsappUrl}
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
                                    disabled={rowBusy || voided || !share.email}
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
                                    disabled={rowBusy || voided || typeof onSendMessage !== 'function'}
                                    title="Enviar por mensajería interna (MD)"
                                    aria-label="Enviar por MD"
                                    onClick={() => runAction(payment, 'md')}
                                  >
                                    {busyKey === `md:${payment.id}`
                                      ? <Loader2 size={13} className="spin" aria-hidden="true" />
                                      : <MessageSquare size={13} aria-hidden="true" />}
                                    <span>MD</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="payment-receipts-chip tone-edit"
                                    disabled={rowBusy || voided || String(payment.method || '').toLowerCase() === 'mixto'}
                                    title={voided
                                      ? 'Cobro anulado'
                                      : (String(payment.method || '').toLowerCase() === 'mixto'
                                        ? 'Pago mixto: anulá y cobrá de nuevo'
                                        : 'Cambiar medio de pago')}
                                    aria-label="Cambiar medio de pago"
                                    onClick={() => openMethodEdit(payment)}
                                  >
                                    <Pencil size={13} aria-hidden="true" />
                                    <span>Medio</span>
                                  </button>
                                  {canVoid ? (
                                    <button
                                      type="button"
                                      className="payment-receipts-chip tone-void"
                                      disabled={rowBusy || voided}
                                      title={voided
                                        ? 'Ya está anulado'
                                        : 'Anular cobro · revierte saldo, imputaciones y caja'}
                                      aria-label="Anular cobro"
                                      onClick={() => openVoidEdit(payment)}
                                    >
                                      <Ban size={13} aria-hidden="true" />
                                      <span>Anular</span>
                                    </button>
                                  ) : null}
                                </div>
                                {methodEditId === payment.id ? (
                                  <form
                                    className="payment-receipts-method-form"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      void saveMethodEdit(payment);
                                    }}
                                  >
                                    <label className="form-group" style={{ margin: 0 }}>
                                      <span className="form-label">Nuevo medio</span>
                                      <select
                                        className="form-input"
                                        value={methodDraft}
                                        onChange={(e) => setMethodDraft(e.target.value)}
                                      >
                                        {METHOD_EDIT_OPTIONS.map((opt) => (
                                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                                        ))}
                                      </select>
                                    </label>
                                    {(methodDraft === 'transferencia' || methodDraft === 'debito') ? (
                                      <label className="form-group" style={{ margin: 0 }}>
                                        <span className="form-label">Banco</span>
                                        <select
                                          className="form-input"
                                          value={methodBankId}
                                          onChange={(e) => setMethodBankId(e.target.value)}
                                        >
                                          {CLUB_BANK_ACCOUNTS.map((bank) => (
                                            <option key={bank.id} value={bank.id}>{bank.name}</option>
                                          ))}
                                        </select>
                                      </label>
                                    ) : null}
                                    <label className="form-group" style={{ margin: 0 }}>
                                      <span className="form-label">Motivo del cambio</span>
                                      <textarea
                                        className="form-input"
                                        rows={2}
                                        value={methodReason}
                                        onChange={(e) => setMethodReason(e.target.value)}
                                        placeholder="Ej. se cargó efectivo por error; era transferencia"
                                        required
                                      />
                                    </label>
                                    <div className="payment-receipts-method-form-actions">
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        disabled={rowBusy}
                                        onClick={() => setMethodEditId(null)}
                                      >
                                        Cancelar
                                      </button>
                                      <button
                                        type="submit"
                                        className="btn btn-primary btn-sm"
                                        disabled={rowBusy || methodReason.trim().length < 8}
                                      >
                                        {busyKey === `method:${payment.id}`
                                          ? <Loader2 size={14} className="spin" aria-hidden="true" />
                                          : null}
                                        Guardar medio
                                      </button>
                                    </div>
                                  </form>
                                ) : null}
                                {voidEditId === payment.id ? (
                                  <form
                                    className="payment-receipts-method-form"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      void saveVoid(payment);
                                    }}
                                  >
                                    <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                      Anula el cobro por completo: vuelve el saldo, las imputaciones de meses,
                                      el vencimiento y registra el contraasiento en caja. El comprobante queda
                                      tachado con quién lo anuló y el motivo.
                                    </p>
                                    <label className="form-group" style={{ margin: 0 }}>
                                      <span className="form-label">Motivo de la anulación *</span>
                                      <textarea
                                        className="form-input"
                                        rows={2}
                                        value={voidReason}
                                        onChange={(e) => setVoidReason(e.target.value)}
                                        placeholder="Ej. cobro duplicado / medio equivocado / socio incorrecto"
                                        required
                                      />
                                    </label>
                                    <div className="payment-receipts-method-form-actions">
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        disabled={rowBusy}
                                        onClick={() => {
                                          setVoidEditId(null);
                                          setVoidReason('');
                                        }}
                                      >
                                        Cancelar
                                      </button>
                                      <button
                                        type="submit"
                                        className="btn btn-primary btn-sm"
                                        disabled={rowBusy || voidReason.trim().length < 8}
                                      >
                                        {busyKey === `void:${payment.id}`
                                          ? <Loader2 size={14} className="spin" aria-hidden="true" />
                                          : null}
                                        Confirmar anulación
                                      </button>
                                    </div>
                                  </form>
                                ) : null}
                              </div>
                            ) : null}
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

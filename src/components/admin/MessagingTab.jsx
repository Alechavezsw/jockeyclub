import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone,
  Inbox,
  Mail,
  MailOpen,
  MessageSquare,
  ExternalLink,
  FileText,
  Paperclip,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Bell,
} from 'lucide-react';
import {
  MAILBOX,
  getSent,
  markMessageRead,
  recipientLabel,
} from '../../domain/messaging/messages';
import { groupMailCampaigns } from '../../domain/messaging/clubNotice';
import { useAuth } from '../../context/AuthContext';
import { repos } from '../../data/bootstrap';
import NoticeComposeCard from './NoticeComposeCard';
import { CLUB_BANK_ACCOUNTS } from '../../domain/members/clubBanks';
import { signedDuesReceiptUrl } from '../../data/storage';

const SECTIONS = [
  { id: 'mail', label: 'Mail', Icon: Mail },
  { id: 'md', label: 'MD', Icon: MessageSquare },
  { id: 'whatsapp', label: 'WhatsApp', Icon: Phone },
];

const MAIL_PAGE_SIZE = 12;

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function normalizeMsgSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesMsgQuery(haystack, query) {
  const q = normalizeMsgSearch(query);
  if (!q) return true;
  const hay = normalizeMsgSearch(haystack);
  return q.split(/\s+/).filter(Boolean).every((token) => hay.includes(token));
}

function MdAttachment({ attachment }) {
  const [url, setUrl] = useState(attachment?.dataUrl || '');
  useEffect(() => {
    if (!attachment?.path) return undefined;
    let cancelled = false;
    signedDuesReceiptUrl(attachment.path).then((signed) => {
      if (!cancelled && signed) setUrl(signed);
    });
    return () => { cancelled = true; };
  }, [attachment?.path]);
  if (!attachment) return null;
  const name = attachment.name || 'Comprobante adjunto';
  const pdf = String(attachment.mime || '').includes('pdf')
    || /\.pdf$/i.test(name);
  return (
    <a
      className={pdf ? 'msg-pdf-card' : 'msg-attachment-link'}
      href={url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Abrir ${name}`}
      onClick={(e) => { if (!url) e.preventDefault(); }}
      style={pdf ? undefined : { display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}
    >
      {pdf ? (
        <>
          <span className="msg-pdf-mark" aria-hidden="true">
            <FileText size={22} strokeWidth={2.25} />
            <b>PDF</b>
          </span>
          <span className="msg-pdf-body">
            <span className="msg-pdf-kicker">Comprobante adjunto</span>
            <strong className="msg-pdf-name">{name}</strong>
            <span className="msg-pdf-cta">
              {url ? 'Abrir PDF' : 'Preparando enlace…'}
              <ExternalLink size={13} aria-hidden="true" />
            </span>
          </span>
        </>
      ) : (
        <>
          <Paperclip size={13} aria-hidden="true" />
          {url ? name : `${name} (preparando…)`}
        </>
      )}
    </a>
  );
}

/** Mensajería: Mail, MD y WhatsApp, cada uno en su sala. */
export default function MessagingTab({
  members,
  messages,
  setMessages,
  formatCurrency,
  onRefresh,
  onSendMessage,
}) {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState('mail');
  const [msgError, setMsgError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [replyToId, setReplyToId] = useState('');
  const [mdBox, setMdBox] = useState('in');
  const [searchQuery, setSearchQuery] = useState('');
  const [mailRows, setMailRows] = useState([]);
  const [mailError, setMailError] = useState('');
  const [mailBusy, setMailBusy] = useState(false);
  const [mailBox, setMailBox] = useState('in');
  const [inboxThreads, setInboxThreads] = useState([]);
  const [inboxTruncated, setInboxTruncated] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [threadEmails, setThreadEmails] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [mailPage, setMailPage] = useState(1);
  const [mdPage, setMdPage] = useState(1);
  const [mailArrivalNotice, setMailArrivalNotice] = useState('');
  const [mdArrivalNotice, setMdArrivalNotice] = useState('');
  const knownThreadIdsRef = useRef(null);
  const knownMdIdsRef = useRef(null);
  const locallyReadMailIdsRef = useRef(new Set());
  const [whatsappTemplate, setWhatsappTemplate] = useState(
    `Estimado/a *{nombre}*, le saludamos cordialmente de la Comisión Directiva del Jockey Club San Juan (Sede Rivadavia). Le recordamos amablemente que posee un saldo pendiente de cuota social de *{saldo}*. Puede regularizar su situación en la administración central o mediante transferencia al alias ${CLUB_BANK_ACCOUNTS[0].alias} ¡Muchas gracias!`
  );
  const [virtualSentLogs, setVirtualSentLogs] = useState([]);

  const loadMails = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setMailBusy(true);
    setMailError('');
    try {
      const [sent, received] = await Promise.all([
        repos.listClubMailSends({ limit: 800 }),
        repos.listClubInbox().then(
          (payload) => ({
            threads: Array.isArray(payload?.threads) ? payload.threads : [],
            truncated: Boolean(payload?.truncated),
            error: '',
          }),
          (err) => ({ threads: [], truncated: false, error: err?.message || 'No se pudo leer el mail recibido.' }),
        ),
      ]);
      setMailRows(sent);
      const nextThreads = received.threads;
      const known = knownThreadIdsRef.current;
      if (known) {
        const newcomers = nextThreads.filter((row) => row?.id && !known.has(String(row.id)));
        if (newcomers.length) {
          const numbered = [...nextThreads].toSorted((a, b) => (
            String(a.receivedAt || '').localeCompare(String(b.receivedAt || ''))
          ));
          const firstNro = numbered.findIndex((row) => String(row.id) === String(newcomers[0].id)) + 1;
          setMailArrivalNotice(
            newcomers.length === 1
              ? `Llegó 1 mail nuevo · Nº ${firstNro || newcomers.length}`
              : `Llegaron ${newcomers.length} mails nuevos · desde Nº ${firstNro || 1}`,
          );
          setMailPage(1);
          setMailBox('in');
        }
      }
      knownThreadIdsRef.current = new Set(nextThreads.map((row) => String(row.id)));
      const readLocal = locallyReadMailIdsRef.current;
      setInboxThreads(nextThreads.map((row) => (
        readLocal.has(String(row.id)) ? { ...row, unread: false } : row
      )));
      setInboxTruncated(Boolean(received.truncated));
      if (received.error) setMailError(received.error);
    } catch (err) {
      setMailError(err?.message || 'No se pudo leer la bandeja de mail.');
    } finally {
      if (!quiet) setMailBusy(false);
    }
  }, []);

  useEffect(() => {
    if (typeof onRefresh !== 'function') return undefined;
    void onRefresh();
    const onFocus = () => { void onRefresh(); };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => { void onRefresh(); }, 15000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [onRefresh]);

  useEffect(() => {
    if (section !== 'mail') return undefined;
    void loadMails();
    const timer = window.setInterval(() => { void loadMails({ quiet: true }); }, 20000);
    return () => window.clearInterval(timer);
  }, [section, loadMails]);

  useEffect(() => {
    setMailPage(1);
  }, [mailBox, searchQuery]);

  useEffect(() => {
    setMdPage(1);
  }, [mdBox, searchQuery]);

  useEffect(() => {
    if (replyToId) setSection('md');
  }, [replyToId]);

  const opsInbox = useMemo(() => (
    [...(messages || [])]
      .filter((m) => m.recipientId === MAILBOX.OPERATIONS)
      .sort((a, b) => {
        if (Boolean(a.isRead) !== Boolean(b.isRead)) return a.isRead ? 1 : -1;
        return String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date));
      })
  ), [messages]);

  const opsSent = useMemo(
    () => getSent(messages || [], {
      userId: user?.id,
      memberId: user?.memberId || null,
      role: role || 'admin',
    }),
    [messages, user?.id, user?.memberId, role],
  );

  useEffect(() => {
    const ids = opsInbox.map((m) => String(m.id));
    const known = knownMdIdsRef.current;
    if (known) {
      const newcomers = opsInbox.filter((m) => m?.id && !known.has(String(m.id)));
      if (newcomers.length) {
        const numbered = [...opsInbox].toSorted((a, b) => (
          String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || ''))
        ));
        const firstNro = numbered.findIndex((row) => String(row.id) === String(newcomers[0].id)) + 1;
        setMdArrivalNotice(
          newcomers.length === 1
            ? `Llegó 1 MD nuevo · Nº ${firstNro || newcomers.length}`
            : `Llegaron ${newcomers.length} MD nuevos · desde Nº ${firstNro || 1}`,
        );
        setMdBox('in');
        setMdPage(1);
      }
    }
    knownMdIdsRef.current = new Set(ids);
  }, [opsInbox]);

  const searchActive = Boolean(normalizeMsgSearch(searchQuery));

  const mdInboxNumbers = useMemo(() => {
    const ordered = [...opsInbox].toSorted((a, b) => (
      String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || ''))
      || String(a.id || '').localeCompare(String(b.id || ''))
    ));
    const map = new Map();
    ordered.forEach((msg, index) => map.set(String(msg.id), index + 1));
    return map;
  }, [opsInbox]);

  const mdSentNumbers = useMemo(() => {
    const ordered = [...opsSent].toSorted((a, b) => (
      String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || ''))
      || String(a.id || '').localeCompare(String(b.id || ''))
    ));
    const map = new Map();
    ordered.forEach((msg, index) => map.set(String(msg.id), index + 1));
    return map;
  }, [opsSent]);

  const mdNumbers = mdBox === 'out' ? mdSentNumbers : mdInboxNumbers;

  const mdList = useMemo(() => {
    const base = mdBox === 'out' ? opsSent : opsInbox;
    if (!searchActive) return base;
    return base.filter((msg) => matchesMsgQuery([
      msg.sender,
      msg.senderId,
      msg.recipientId,
      recipientLabel(msg.recipientId, members),
      msg.subject,
      msg.content,
      msg.date,
      mdNumbers.get(String(msg.id)),
    ].join(' '), searchQuery));
  }, [mdBox, opsSent, opsInbox, searchActive, searchQuery, members, mdNumbers]);

  const mdPageCount = Math.max(1, Math.ceil(mdList.length / MAIL_PAGE_SIZE));
  const safeMdPage = Math.min(mdPage, mdPageCount);
  const pagedMdList = useMemo(() => {
    const start = (safeMdPage - 1) * MAIL_PAGE_SIZE;
    return mdList.slice(start, start + MAIL_PAGE_SIZE);
  }, [mdList, safeMdPage]);

  const mailCampaigns = useMemo(() => groupMailCampaigns(mailRows), [mailRows]);

  const threadNumbers = useMemo(() => {
    const ordered = [...inboxThreads].toSorted((a, b) => (
      String(a.receivedAt || '').localeCompare(String(b.receivedAt || ''))
      || String(a.id || '').localeCompare(String(b.id || ''))
    ));
    const map = new Map();
    ordered.forEach((thread, index) => {
      map.set(String(thread.id), index + 1);
    });
    return map;
  }, [inboxThreads]);

  const campaignNumbers = useMemo(() => {
    const ordered = [...mailCampaigns].toSorted((a, b) => (
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      || String(a.id || '').localeCompare(String(b.id || ''))
    ));
    const map = new Map();
    ordered.forEach((camp, index) => {
      map.set(String(camp.id), index + 1);
    });
    return map;
  }, [mailCampaigns]);

  const filteredInboxThreads = useMemo(() => {
    if (!searchActive) return inboxThreads;
    return inboxThreads.filter((thread) => matchesMsgQuery(
      [thread.from, thread.subject, thread.preview, threadNumbers.get(String(thread.id))].join(' '),
      searchQuery,
    ));
  }, [inboxThreads, searchActive, searchQuery, threadNumbers]);

  const filteredMailCampaigns = useMemo(() => {
    if (!searchActive) return mailCampaigns;
    return mailCampaigns.filter((camp) => matchesMsgQuery(
      [
        camp.subject,
        ...(camp.rows || []).flatMap((row) => [row.email, row.error]),
      ].join(' '),
      searchQuery,
    ));
  }, [mailCampaigns, searchActive, searchQuery]);

  const mailList = mailBox === 'in' ? filteredInboxThreads : filteredMailCampaigns;
  const mailPageCount = Math.max(1, Math.ceil(mailList.length / MAIL_PAGE_SIZE));
  const safeMailPage = Math.min(mailPage, mailPageCount);
  const pagedMailList = useMemo(() => {
    const start = (safeMailPage - 1) * MAIL_PAGE_SIZE;
    return mailList.slice(start, start + MAIL_PAGE_SIZE);
  }, [mailList, safeMailPage]);

  const selectedCampaign = filteredMailCampaigns.find((row) => row.id === selectedCampaignId) || null;
  const selectedThread = filteredInboxThreads.find((row) => row.id === selectedThreadId) || null;
  const unreadInbox = inboxThreads.filter((row) => row.unread).length;
  const unreadOps = opsInbox.filter((m) => !m.isRead).length;
  const selected = mdList.find((m) => String(m.id) === String(selectedId)) || null;
  const debtors = useMemo(() => {
    const owing = (members || []).filter((m) => Number(m.outstandingBalance) > 0);
    if (!searchActive) return owing;
    return owing.filter((m) => matchesMsgQuery(
      [m.name, m.memberId, m.phone, m.documentNumber].join(' '),
      searchQuery,
    ));
  }, [members, searchActive, searchQuery]);

  const openInboxMessage = (msg) => {
    setSelectedId(msg.id);
    if (mdBox === 'in' && !msg.isRead) {
      setMessages((prev) => markMessageRead(prev, msg.id));
    }
  };

  const markMailThreadReadLocal = (threadId) => {
    const id = String(threadId || '');
    if (!id) return;
    locallyReadMailIdsRef.current.add(id);
    setInboxThreads((prev) => prev.map((row) => (
      String(row.id) === id ? { ...row, unread: false } : row
    )));
  };

  const replyToSelected = () => {
    if (!selected) return;
    const to = selected.senderId && selected.senderId !== MAILBOX.OPERATIONS
      ? selected.senderId
      : '';
    if (!to) {
      setMsgError('No se pudo determinar el socio remitente.');
      return;
    }
    setMsgError('');
    setSection('md');
    setReplyToId(to);
    window.setTimeout(() => {
      document.getElementById('ops-compose-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  };

  const handleSendWhatsAppRedirect = (memberItem) => {
    const rawMsg = whatsappTemplate
      .replace('{nombre}', memberItem.name)
      .replace('{saldo}', formatCurrency(memberItem.outstandingBalance));

    const encodedText = encodeURIComponent(rawMsg);
    const cleanPhone = String(memberItem.phone || '').replace(/[+\s-]/g, '');
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;

    window.open(waUrl, '_blank');

    const logItem = {
      id: Date.now(),
      time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      memberName: memberItem.name,
      phone: memberItem.phone,
      messagePreview: `${rawMsg.slice(0, 80)}...`,
      status: 'Redirected',
    };
    setVirtualSentLogs((prev) => [logItem, ...prev]);
  };

  const openSection = (id) => {
    setSection(id);
    setMsgError('');
  };

  const openThread = async (id) => {
    setSelectedThreadId(id);
    setThreadEmails([]);
    markMailThreadReadLocal(id);
    try {
      setThreadEmails(await repos.readClubInboxThread(id));
    } catch (err) {
      setMailError(err?.message || 'No se pudo abrir el mail.');
    }
  };

  return (
    <div className="ops-msg">
      <div className="page-header ops-msg-header">
        <div>
          <h1 className="page-title">Mensajería</h1>
          <p className="page-subtitle">Mail, MD internos y WhatsApp · buscá por socio, asunto o contenido</p>
        </div>
        <div className="ops-msg-search">
          <Search size={16} aria-hidden="true" />
          <label className="sr-only" htmlFor="ops-msg-search-input">Buscar mensajes</label>
          <input
            id="ops-msg-search-input"
            type="search"
            className="ops-msg-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Socio, asunto, mail, contenido…"
            autoComplete="off"
          />
          {searchQuery ? (
            <button
              type="button"
              className="ops-msg-search-clear"
              aria-label="Limpiar búsqueda"
              onClick={() => setSearchQuery('')}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="ops-msg-tabs" role="tablist" aria-label="Salas de mensajería">
        {SECTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className={`ops-msg-tab${section === id ? ' is-on' : ''}`}
            onClick={() => openSection(id)}
          >
            <Icon size={15} aria-hidden /> {label}
            {id === 'mail' && unreadInbox > 0 ? (
              <span className="ops-msg-tab-badge" aria-label={`${unreadInbox} sin leer`}>{unreadInbox}</span>
            ) : null}
            {id === 'md' && unreadOps > 0 ? (
              <span className="ops-msg-tab-badge" aria-label={`${unreadOps} sin leer`}>{unreadOps}</span>
            ) : null}
          </button>
        ))}
      </div>

      {section === 'mail' ? (
        <>
          <div className="glass-card fade-in ops-msg-pane">
            <div className="ops-msg-pane-head">
              <div>
                <h3 className="serif-font ops-msg-title">
                  <Inbox size={18} /> Bandeja de mail
                </h3>
                <p className="ops-msg-lead">
                  {mailBox === 'in'
                    ? `Lo que llega a socios@jockeyclubsj.com.ar · ${inboxThreads.length} hilo${inboxThreads.length === 1 ? '' : 's'}${unreadInbox ? ` · ${unreadInbox} sin leer` : ''} · hojas de ${MAIL_PAGE_SIZE}${inboxTruncated ? ' · hay más antiguos en Resend' : ''}.`
                    : `Comunicados enviados desde acá${mailCampaigns.length ? ` · ${mailCampaigns.length} envíos` : ''} · hojas de ${MAIL_PAGE_SIZE}.`}
                </p>
              </div>
              <div className="ops-msg-tabs" role="tablist" aria-label="Recibidos o enviados">
                <button
                  type="button"
                  className={`ops-msg-tab${mailBox === 'in' ? ' is-on' : ''}`}
                  onClick={() => setMailBox('in')}
                >
                  Recibidos
                  {unreadInbox > 0 ? ` (${unreadInbox})` : ''}
                </button>
                <button
                  type="button"
                  className={`ops-msg-tab${mailBox === 'out' ? ' is-on' : ''}`}
                  onClick={() => setMailBox('out')}
                >
                  Enviados
                </button>
              </div>
            </div>
            {mailArrivalNotice ? (
              <div className="ops-msg-arrival" role="status">
                <Bell size={15} aria-hidden="true" />
                <span>{mailArrivalNotice}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setMailArrivalNotice('')}
                >
                  Entendido
                </button>
              </div>
            ) : null}
            {mailError ? <div role="alert" className="ops-notice-err">{mailError}</div> : null}
            {mailBox === 'in' ? (
              mailBusy && inboxThreads.length === 0 ? (
                <p className="ops-msg-empty">Cargando recibidos…</p>
              ) : inboxThreads.length === 0 ? (
                <p className="ops-msg-empty">Todavía no llegó ningún mail a socios@jockeyclubsj.com.ar.</p>
              ) : filteredInboxThreads.length === 0 ? (
                <p className="ops-msg-empty">Ningún mail coincide con la búsqueda.</p>
              ) : (
                <>
                  <div className={`ops-msg-split${selectedThread ? ' has-detail' : ''}`}>
                    <div className="ops-msg-list">
                      {pagedMailList.map((thread) => {
                        const nro = threadNumbers.get(String(thread.id)) || '—';
                        return (
                          <button
                            key={thread.id}
                            type="button"
                            className={`ops-msg-row${selectedThreadId === thread.id ? ' is-on' : ''}`}
                            onClick={() => { void openThread(thread.id); }}
                          >
                            <div className="ops-msg-row-top">
                              <span>
                                <b className="ops-msg-nro">Nº {nro}</b>
                                {' · '}
                                {thread.from || 'Sin remitente'}
                              </span>
                              <span>{formatWhen(thread.receivedAt)}</span>
                            </div>
                            <div className={`ops-msg-row-subject${thread.unread ? ' is-new' : ''}`}>
                              {thread.unread ? <i /> : null}
                              {thread.subject}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {selectedThread ? (
                      <div className="ops-msg-detail">
                        <small>
                          Nº {threadNumbers.get(String(selectedThread.id)) || '—'}
                          {' · '}
                          {selectedThread.from}
                        </small>
                        <h4>{selectedThread.subject}</h4>
                        {threadEmails.length === 0 ? (
                          <p>Abriendo…</p>
                        ) : threadEmails.map((mail) => (
                          <div key={mail.id} className="ops-msg-letter">
                            <span>{mail.inbound ? 'Recibido' : 'Enviado'} · {formatWhen(mail.receivedAt)}</span>
                            <p className="ops-msg-body">{mail.text || '(sin texto)'}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {mailPageCount > 1 ? (
                    <div className="ops-msg-pager" role="navigation" aria-label="Hojas de recibidos">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={safeMailPage <= 1}
                        onClick={() => setMailPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft size={14} aria-hidden="true" /> Anterior
                      </button>
                      <span>
                        Hoja {safeMailPage} de {mailPageCount}
                        {' · '}
                        {filteredInboxThreads.length} mail{filteredInboxThreads.length === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={safeMailPage >= mailPageCount}
                        onClick={() => setMailPage((p) => Math.min(mailPageCount, p + 1))}
                      >
                        Siguiente <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </>
              )
            ) : mailBusy && mailCampaigns.length === 0 ? (
              <p className="ops-msg-empty">Cargando enviados…</p>
            ) : mailCampaigns.length === 0 ? (
              <p className="ops-msg-empty">Todavía no hay mails enviados desde acá.</p>
            ) : filteredMailCampaigns.length === 0 ? (
              <p className="ops-msg-empty">Ningún envío coincide con la búsqueda.</p>
            ) : (
              <>
                <div className={`ops-msg-split${selectedCampaign ? ' has-detail' : ''}`}>
                  <div className="ops-msg-list">
                    {pagedMailList.map((camp) => {
                      const nro = campaignNumbers.get(String(camp.id)) || '—';
                      return (
                        <button
                          key={camp.id}
                          type="button"
                          className={`ops-msg-row${selectedCampaignId === camp.id ? ' is-on' : ''}`}
                          onClick={() => setSelectedCampaignId(camp.id)}
                        >
                          <div className="ops-msg-row-top">
                            <span>
                              <b className="ops-msg-nro">Nº {nro}</b>
                              {' · '}
                              {camp.sent} enviados{camp.failed ? ` · ${camp.failed} no salieron` : ''}
                            </span>
                            <span>{formatWhen(camp.createdAt)}</span>
                          </div>
                          <div className="ops-msg-row-subject">{camp.subject}</div>
                        </button>
                      );
                    })}
                  </div>
                  {selectedCampaign ? (
                    <div className="ops-msg-detail">
                      <h4>{selectedCampaign.subject}</h4>
                      <p>
                        {selectedCampaign.sent} enviados
                        {selectedCampaign.failed ? ` · ${selectedCampaign.failed} no salieron` : ''}
                        {' · '}
                        {formatWhen(selectedCampaign.createdAt)}
                      </p>
                      <ul className="ops-msg-targets">
                        {selectedCampaign.rows.slice(0, 60).map((row) => (
                          <li key={row.id}>
                            <strong>{row.email}</strong>
                            <span>{row.sent ? 'Enviado' : (row.error || 'No salió')}</span>
                          </li>
                        ))}
                      </ul>
                      {selectedCampaign.rows.length > 60 ? (
                        <p className="ops-msg-more">y {selectedCampaign.rows.length - 60} más en este envío.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {mailPageCount > 1 ? (
                  <div className="ops-msg-pager" role="navigation" aria-label="Hojas de enviados">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={safeMailPage <= 1}
                      onClick={() => setMailPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft size={14} aria-hidden="true" /> Anterior
                    </button>
                    <span>
                      Hoja {safeMailPage} de {mailPageCount}
                      {' · '}
                      {filteredMailCampaigns.length} envío{filteredMailCampaigns.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={safeMailPage >= mailPageCount}
                      onClick={() => setMailPage((p) => Math.min(mailPageCount, p + 1))}
                    >
                      Siguiente <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
          <NoticeComposeCard
            members={members}
            onSendMessage={onSendMessage}
            senderName={user?.fullName || 'Administración Jockey Club'}
            channel="mail"
            onSent={() => { void loadMails(); }}
          />
        </>
      ) : null}

      {section === 'md' ? (
        <>
          <div className="glass-card fade-in ops-msg-pane">
            <div className="ops-msg-pane-head">
              <div>
                <h3 className="serif-font ops-msg-title">
                  <Inbox size={18} /> Bandeja de MD
                </h3>
                <p className="ops-msg-lead">
                  {mdBox === 'in'
                    ? `Mensajes internos que los socios envían a Secretaría · ${opsInbox.length} MD${unreadOps > 0 ? ` · ${unreadOps} sin leer` : ''} · hojas de ${MAIL_PAGE_SIZE}.`
                    : `Comprobantes, avisos y respuestas enviadas a socios · ${opsSent.length} MD · hojas de ${MAIL_PAGE_SIZE}.`}
                </p>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div className="ops-msg-tabs" role="tablist" aria-label="Recibidos o enviados">
                  <button
                    type="button"
                    className={`ops-msg-tab${mdBox === 'in' ? ' is-on' : ''}`}
                    onClick={() => {
                      setMdBox('in');
                      setSelectedId(null);
                    }}
                  >
                    Recibidos
                    {unreadOps > 0 ? ` (${unreadOps})` : ''}
                  </button>
                  <button
                    type="button"
                    className={`ops-msg-tab${mdBox === 'out' ? ' is-on' : ''}`}
                    onClick={() => {
                      setMdBox('out');
                      setSelectedId(null);
                    }}
                  >
                    Enviados
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate('/mensajes')}
                >
                  <ExternalLink size={14} /> Vista completa
                </button>
              </div>
            </div>

            {mdArrivalNotice ? (
              <div className="ops-msg-arrival" role="status">
                <Bell size={15} aria-hidden="true" />
                <span>{mdArrivalNotice}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setMdArrivalNotice('')}
                >
                  Entendido
                </button>
              </div>
            ) : null}

            {mdList.length === 0 ? (
              <p className="ops-msg-empty">
                {searchActive
                  ? 'Ningún MD coincide con la búsqueda.'
                  : mdBox === 'in'
                    ? 'Todavía no hay mensajes internos hacia administración.'
                    : 'Todavía no hay MD enviados desde acá.'}
              </p>
            ) : (
              <>
                <div className={`ops-msg-split${selected ? ' has-detail' : ''}`}>
                  <div className="ops-msg-list">
                    {pagedMdList.map((msg) => {
                      const nro = mdNumbers.get(String(msg.id)) || '—';
                      return (
                        <button
                          key={msg.id}
                          type="button"
                          className={`ops-msg-row${String(selectedId) === String(msg.id) ? ' is-on' : ''}`}
                          onClick={() => openInboxMessage(msg)}
                        >
                          <div className="ops-msg-row-top">
                            <span>
                              <b className="ops-msg-nro">Nº {nro}</b>
                              {' · '}
                              {mdBox === 'out'
                                ? recipientLabel(msg.recipientId, members)
                                : msg.sender}
                            </span>
                            <span>{msg.date}</span>
                          </div>
                          <div className={`ops-msg-row-subject${mdBox === 'out' || msg.isRead ? '' : ' is-new'}`}>
                            {mdBox === 'in' && !msg.isRead ? <i /> : null}
                            {msg.subject}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {selected ? (
                    <div className="ops-msg-detail">
                      <div className="ops-msg-detail-head">
                        <div>
                          <small>
                            Nº {mdNumbers.get(String(selected.id)) || '—'}
                            {' · '}
                            {mdBox === 'out'
                              ? `Para: ${recipientLabel(selected.recipientId, members)}`
                              : selected.sender}
                          </small>
                          <h4>{selected.subject}</h4>
                        </div>
                        <span>{selected.date}</span>
                      </div>
                      <p className="ops-msg-body">{selected.content}</p>
                      <MdAttachment attachment={selected.meta?.attachment} />
                      {mdBox === 'in' ? (
                        <button type="button" className="btn btn-primary btn-sm" onClick={replyToSelected}>
                          <MailOpen size={14} /> Responder
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {mdPageCount > 1 ? (
                  <div className="ops-msg-pager" role="navigation" aria-label="Hojas de MD">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={safeMdPage <= 1}
                      onClick={() => setMdPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft size={14} aria-hidden="true" /> Anterior
                    </button>
                    <span>
                      Hoja {safeMdPage} de {mdPageCount}
                      {' · '}
                      {mdList.length} MD
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={safeMdPage >= mdPageCount}
                      onClick={() => setMdPage((p) => Math.min(mdPageCount, p + 1))}
                    >
                      Siguiente <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {msgError ? (
            <div role="alert" className="ops-notice-err">{msgError}</div>
          ) : null}

          <NoticeComposeCard
            members={members}
            onSendMessage={onSendMessage}
            senderName={user?.fullName || 'Administración Jockey Club'}
            replyToId={replyToId}
            channel="dm"
          />
        </>
      ) : null}

      {section === 'whatsapp' ? (
        <div className="glass-card fade-in ops-msg-pane">
          <div>
            <h3 className="serif-font ops-msg-title">Cobranza vía WhatsApp</h3>
            <p className="ops-msg-lead">
              Recordatorios de saldo pendiente, directo al celular del socio.
            </p>
          </div>

          <div className="ops-msg-wa-tpl">
            <label className="form-label" htmlFor="ops-wa-tpl">Plantilla de WhatsApp</label>
            <textarea
              id="ops-wa-tpl"
              className="form-input"
              value={whatsappTemplate}
              onChange={(e) => setWhatsappTemplate(e.target.value)}
            />
            <span>
              Variables: <code>{'{nombre}'}</code> y <code>{'{saldo}'}</code>.
            </span>
          </div>

          <div className="ops-msg-wa-list">
            <h5 className="serif-font">Socios con cuotas pendientes</h5>
            {debtors.length === 0 ? (
              <p className="ops-msg-empty">
                {searchActive
                  ? 'Ningún deudor coincide con la búsqueda.'
                  : 'No hay socios con deuda social de momento.'}
              </p>
            ) : (
              debtors.map((debtor) => (
                <div key={debtor.memberId} className="ops-msg-wa-row">
                  <div>
                    <strong>{debtor.name}</strong>
                    <em>Deuda: {formatCurrency(debtor.outstandingBalance)}</em>
                    <span>Cel: {debtor.phone || 'No registrado'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSendWhatsAppRedirect(debtor)}
                    disabled={!debtor.phone}
                    className="btn btn-secondary btn-sm"
                  >
                    <Phone size={12} /> WhatsApp
                  </button>
                </div>
              ))
            )}
          </div>

          {virtualSentLogs.length > 0 ? (
            <div className="ops-msg-wa-log">
              <h5 className="serif-font">Avisos abiertos en esta sesión</h5>
              {virtualSentLogs.map((log) => (
                <div key={log.id}>
                  <span>A: <strong>{log.memberName}</strong></span>
                  <span>{log.time}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

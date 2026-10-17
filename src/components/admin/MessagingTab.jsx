import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, Inbox, Mail, MailOpen, MessageSquare, ExternalLink } from 'lucide-react';
import { MAILBOX, markMessageRead } from '../../domain/messaging/messages';
import { groupMailCampaigns } from '../../domain/messaging/clubNotice';
import { useAuth } from '../../context/AuthContext';
import { repos } from '../../data/bootstrap';
import NoticeComposeCard from './NoticeComposeCard';

const SECTIONS = [
  { id: 'mail', label: 'Mail', Icon: Mail },
  { id: 'md', label: 'MD', Icon: MessageSquare },
  { id: 'whatsapp', label: 'WhatsApp', Icon: Phone },
];

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState('mail');
  const [msgError, setMsgError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [replyToId, setReplyToId] = useState('');
  const [mailRows, setMailRows] = useState([]);
  const [mailError, setMailError] = useState('');
  const [mailBusy, setMailBusy] = useState(false);
  const [mailBox, setMailBox] = useState('in');
  const [inboxThreads, setInboxThreads] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [threadEmails, setThreadEmails] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [whatsappTemplate, setWhatsappTemplate] = useState(
    'Estimado/a *{nombre}*, le saludamos cordialmente de la Comisión Directiva del Jockey Club San Juan (Sede Rivadavia). Le recordamos amablemente que posee un saldo pendiente de cuota social de *{saldo}*. Puede regularizar su situación en la administración central o mediante transferencia al Banco Nación. ¡Muchas gracias!'
  );
  const [virtualSentLogs, setVirtualSentLogs] = useState([]);

  const loadMails = useCallback(async () => {
    setMailBusy(true);
    setMailError('');
    try {
      const [sent, received] = await Promise.all([
        repos.listClubMailSends({ limit: 800 }),
        repos.listClubInbox().then(
          (threads) => ({ threads, error: '' }),
          (err) => ({ threads: [], error: err?.message || 'No se pudo leer el mail recibido.' }),
        ),
      ]);
      setMailRows(sent);
      setInboxThreads(received.threads);
      if (received.error) setMailError(received.error);
    } catch (err) {
      setMailError(err?.message || 'No se pudo leer la bandeja de mail.');
    } finally {
      setMailBusy(false);
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
    return undefined;
  }, [section, loadMails]);

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

  const mailCampaigns = useMemo(() => groupMailCampaigns(mailRows), [mailRows]);
  const selectedCampaign = mailCampaigns.find((row) => row.id === selectedCampaignId) || null;
  const selectedThread = inboxThreads.find((row) => row.id === selectedThreadId) || null;
  const unreadInbox = inboxThreads.filter((row) => row.unread).length;
  const unreadOps = opsInbox.filter((m) => !m.isRead).length;
  const selected = opsInbox.find((m) => String(m.id) === String(selectedId)) || null;
  const debtors = useMemo(
    () => (members || []).filter((m) => Number(m.outstandingBalance) > 0),
    [members],
  );

  const openInboxMessage = (msg) => {
    setSelectedId(msg.id);
    if (!msg.isRead) {
      setMessages((prev) => markMessageRead(prev, msg.id));
    }
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
    try {
      setThreadEmails(await repos.readClubInboxThread(id));
    } catch (err) {
      setMailError(err?.message || 'No se pudo abrir el mail.');
    }
  };

  return (
    <div className="ops-msg">
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
                    ? `Lo que llega a socios@jockeyclubsj.com.ar${unreadInbox ? ` · ${unreadInbox} sin leer` : ''}.`
                    : `Comunicados enviados desde acá${mailCampaigns.length ? ` · ${mailCampaigns.length} envíos` : ''}.`}
                </p>
              </div>
              <div className="ops-msg-tabs" role="tablist" aria-label="Recibidos o enviados">
                <button
                  type="button"
                  className={`ops-msg-tab${mailBox === 'in' ? ' is-on' : ''}`}
                  onClick={() => setMailBox('in')}
                >
                  Recibidos
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
            {mailError ? <div role="alert" className="ops-notice-err">{mailError}</div> : null}
            {mailBox === 'in' ? (
              mailBusy && inboxThreads.length === 0 ? (
                <p className="ops-msg-empty">Cargando recibidos…</p>
              ) : inboxThreads.length === 0 ? (
                <p className="ops-msg-empty">Todavía no llegó ningún mail a socios@jockeyclubsj.com.ar.</p>
              ) : (
                <div className={`ops-msg-split${selectedThread ? ' has-detail' : ''}`}>
                  <div className="ops-msg-list">
                    {inboxThreads.map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        className={`ops-msg-row${selectedThreadId === thread.id ? ' is-on' : ''}`}
                        onClick={() => { void openThread(thread.id); }}
                      >
                        <div className="ops-msg-row-top">
                          <span>{thread.from || 'Sin remitente'}</span>
                          <span>{formatWhen(thread.receivedAt)}</span>
                        </div>
                        <div className={`ops-msg-row-subject${thread.unread ? ' is-new' : ''}`}>
                          {thread.unread ? <i /> : null}
                          {thread.subject}
                        </div>
                      </button>
                    ))}
                  </div>
                  {selectedThread ? (
                    <div className="ops-msg-detail">
                      <small>{selectedThread.from}</small>
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
              )
            ) : mailBusy && mailCampaigns.length === 0 ? (
              <p className="ops-msg-empty">Cargando enviados…</p>
            ) : mailCampaigns.length === 0 ? (
              <p className="ops-msg-empty">Todavía no hay mails enviados desde acá.</p>
            ) : (
              <div className={`ops-msg-split${selectedCampaign ? ' has-detail' : ''}`}>
                <div className="ops-msg-list">
                  {mailCampaigns.map((camp) => (
                    <button
                      key={camp.id}
                      type="button"
                      className={`ops-msg-row${selectedCampaignId === camp.id ? ' is-on' : ''}`}
                      onClick={() => setSelectedCampaignId(camp.id)}
                    >
                      <div className="ops-msg-row-top">
                        <span>{camp.sent} enviados{camp.failed ? ` · ${camp.failed} no salieron` : ''}</span>
                        <span>{formatWhen(camp.createdAt)}</span>
                      </div>
                      <div className="ops-msg-row-subject">{camp.subject}</div>
                    </button>
                  ))}
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
                  Mensajes internos que los socios envían a Secretaría
                  {unreadOps > 0 ? ` · ${unreadOps} sin leer` : ''}.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => navigate('/mensajes')}
              >
                <ExternalLink size={14} /> Vista completa
              </button>
            </div>

            {opsInbox.length === 0 ? (
              <p className="ops-msg-empty">Todavía no hay mensajes internos hacia administración.</p>
            ) : (
              <div className={`ops-msg-split${selected ? ' has-detail' : ''}`}>
                <div className="ops-msg-list">
                  {opsInbox.map((msg) => (
                    <button
                      key={msg.id}
                      type="button"
                      className={`ops-msg-row${String(selectedId) === String(msg.id) ? ' is-on' : ''}`}
                      onClick={() => openInboxMessage(msg)}
                    >
                      <div className="ops-msg-row-top">
                        <span>{msg.sender}</span>
                        <span>{msg.date}</span>
                      </div>
                      <div className={`ops-msg-row-subject${msg.isRead ? '' : ' is-new'}`}>
                        {msg.isRead ? null : <i />}
                        {msg.subject}
                      </div>
                    </button>
                  ))}
                </div>
                {selected ? (
                  <div className="ops-msg-detail">
                    <div className="ops-msg-detail-head">
                      <div>
                        <small>{selected.sender}</small>
                        <h4>{selected.subject}</h4>
                      </div>
                      <span>{selected.date}</span>
                    </div>
                    <p className="ops-msg-body">{selected.content}</p>
                    <button type="button" className="btn btn-primary btn-sm" onClick={replyToSelected}>
                      <MailOpen size={14} /> Responder
                    </button>
                  </div>
                ) : null}
              </div>
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
              <p className="ops-msg-empty">No hay socios con deuda social de momento.</p>
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

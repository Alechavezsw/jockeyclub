import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Phone, Inbox, MailOpen, ExternalLink } from 'lucide-react';
import {
  createMessage,
  MAILBOX,
  markMessageRead,
} from '../../domain/messaging/messages';
import { useAuth } from '../../context/AuthContext';

/** Mensajería interna: bandeja ops + envío al portal + cobranza WhatsApp. */
export default function MessagingTab({
  members,
  messages,
  setMessages,
  formatCurrency,
  onRefresh,
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [msgRecipient, setMsgRecipient] = useState(MAILBOX.ALL_MEMBERS);
  const [msgSubject, setMsgSubject] = useState('');
  const [msgContent, setMsgContent] = useState('');
  const [msgSuccess, setMsgSuccess] = useState(false);
  const [msgError, setMsgError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [whatsappTemplate, setWhatsappTemplate] = useState(
    'Estimado/a *{nombre}*, le saludamos cordialmente de la Comisión Directiva del Jockey Club San Juan (Sede Rivadavia). Le recordamos amablemente que posee un saldo pendiente de cuota social de *{saldo}*. Puede regularizar su situación en la administración central o mediante transferencia al Banco Nación. ¡Muchas gracias!'
  );
  const [virtualSentLogs, setVirtualSentLogs] = useState([]);

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

  const opsInbox = useMemo(() => (
    [...(messages || [])]
      .filter((m) => m.recipientId === MAILBOX.OPERATIONS)
      .sort((a, b) => {
        if (Boolean(a.isRead) !== Boolean(b.isRead)) return a.isRead ? 1 : -1;
        return String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date));
      })
  ), [messages]);

  const unreadOps = opsInbox.filter((m) => !m.isRead).length;
  const selected = opsInbox.find((m) => String(m.id) === String(selectedId)) || null;

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
    setMsgRecipient(to);
    setMsgSubject(selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`);
    setMsgContent('');
    setMsgError('');
    document.getElementById('ops-compose-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    setMsgError('');
    if (!msgSubject.trim() || !msgContent.trim()) return;

    const newMsg = createMessage({
      sender: user?.fullName || 'Administración Jockey Club',
      senderId: MAILBOX.OPERATIONS,
      recipientId: msgRecipient,
      subject: msgSubject,
      content: msgContent,
      parentId: selected && msgSubject.startsWith('Re:') ? selected.id : null,
    });

    setMessages((prev) => [newMsg, ...(prev || [])]);
    setMsgSubject('');
    setMsgContent('');
    setMsgSuccess(true);
    setTimeout(() => setMsgSuccess(false), 3000);
  };

  const handleSendWhatsAppRedirect = (memberItem) => {
    const rawMsg = whatsappTemplate
      .replace('{nombre}', memberItem.name)
      .replace('{saldo}', formatCurrency(memberItem.outstandingBalance));

    const encodedText = encodeURIComponent(rawMsg);
    const cleanPhone = memberItem.phone.replace(/[+\s-]/g, '');
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
    setVirtualSentLogs([logItem, ...virtualSentLogs]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Bandeja de entrada (socios → administración) */}
      <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <h3 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-gold)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Inbox size={18} /> Bandeja de administración
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Mensajes que los socios envían a Secretaría / Administración
              {unreadOps > 0 ? ` · ${unreadOps} sin leer` : ''}.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => navigate('/mensajes')}
          >
            <ExternalLink size={14} /> Vista completa
          </button>
        </div>

        {opsInbox.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.25rem 0.5rem' }}>
            Todavía no hay mensajes de socios hacia administración.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: selected ? 'minmax(220px, 1fr) 1.3fr' : '1fr', gap: 0, border: '1px solid var(--border-glass)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ maxHeight: 320, overflowY: 'auto', borderRight: selected ? '1px solid var(--border-glass)' : 'none' }}>
              {opsInbox.map((msg) => (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => openInboxMessage(msg)}
                  style={{
                    width: '100%',
                    background: String(selectedId) === String(msg.id) ? 'rgba(207,161,58,0.08)' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border-glass)',
                    borderLeft: String(selectedId) === String(msg.id) ? '3px solid var(--primary-gold)' : '3px solid transparent',
                    padding: '0.75rem 0.9rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: 'var(--text-primary)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-gold)', fontWeight: 700 }}>{msg.sender}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{msg.date}</span>
                  </div>
                  <div style={{ fontSize: '0.88rem', fontWeight: msg.isRead ? 500 : 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {!msg.isRead && (
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary-gold)', flexShrink: 0 }} />
                    )}
                    {msg.subject}
                  </div>
                </button>
              ))}
            </div>
            {selected && (
              <div style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-gold)', fontWeight: 700 }}>{selected.sender}</div>
                    <h4 style={{ margin: '0.2rem 0 0', fontSize: '1.05rem' }}>{selected.subject}</h4>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selected.date}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.55, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                  {selected.content}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={replyToSelected} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <MailOpen size={14} /> Responder
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem' }} className="responsive-form-grid">
        {/* Enviar Comunicados */}
        <div id="ops-compose-form" className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div>
            <h3 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-gold)', margin: 0 }}>Mailing & Mensajería Exclusiva</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Envíe avisos institucionales directamente al portal privado del socio.
            </p>
          </div>

          {msgSuccess && (
            <div role="status" style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--emerald-accent)', color: 'var(--emerald-accent)', padding: '0.6rem', borderRadius: '6px', fontSize: '0.8rem', textAlign: 'center' }}>
              Mensaje enviado. Quedará visible en la bandeja del destinatario.
            </div>
          )}
          {msgError && (
            <div role="alert" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-accent)', color: '#f87171', padding: '0.6rem', borderRadius: '6px', fontSize: '0.8rem' }}>
              {msgError}
            </div>
          )}

          <form onSubmit={handleSendMessage} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Destinatario del Mensaje</label>
              <select
                className="form-input"
                value={msgRecipient}
                onChange={(e) => setMsgRecipient(e.target.value)}
                style={{ padding: '0.5rem', fontSize: '0.85rem' }}
              >
                <option value="all" style={{ background: 'var(--bg-secondary)' }}>Todos los Socios (Broadcast Global)</option>
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId} style={{ background: 'var(--bg-secondary)' }}>
                    {m.name} (Cred: {m.memberId.slice(0, 6)}...)
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Asunto del Comunicado</label>
              <input
                type="text"
                placeholder="Ej: Modificación Horario de Canchas de Polo"
                className="form-input"
                value={msgSubject}
                onChange={(e) => setMsgSubject(e.target.value)}
                style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Cuerpo del Mensaje</label>
              <textarea
                placeholder="Escriba las directivas del comunicado..."
                className="form-input"
                value={msgContent}
                onChange={(e) => setMsgContent(e.target.value)}
                style={{ padding: '0.55rem', fontSize: '0.85rem', minHeight: '80px', fontFamily: 'inherit', resize: 'vertical' }}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 'bold' }}
            >
              <Send size={14} /> Enviar Mensaje Interno
            </button>
          </form>
        </div>

        {/* Módulo WhatsApp Direct Debtors */}
        <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div>
            <h3 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-gold)', margin: 0 }}>Cobranza vía WhatsApp</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Envíe recordatorios elegantes y pre-armados directamente a sus celulares.
            </p>
          </div>

          <div className="form-group" style={{ marginBottom: 0, background: 'rgba(0,0,0,0.1)', padding: '0.75rem', borderRadius: '6px' }}>
            <label className="form-label" style={{ fontSize: '0.72rem', color: 'var(--text-gold)' }}>Configurar Plantilla de WhatsApp</label>
            <textarea
              className="form-input"
              style={{ padding: '0.4rem', fontSize: '0.78rem', minHeight: '65px', fontFamily: 'inherit', background: 'rgba(0,0,0,0.2)' }}
              value={whatsappTemplate}
              onChange={(e) => setWhatsappTemplate(e.target.value)}
            />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
              Variables admitidas: <code>{'{nombre}'}</code> y <code>{'{saldo}'}</code>.
            </span>
          </div>

          <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
            <h5 className="serif-font" style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--warning-accent)' }}>Socios con Cuotas Pendientes</h5>

            {members.filter((m) => m.outstandingBalance > 0).length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
                No existen socios con deuda social de momento. ¡Excelente gestión!
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {members.filter((m) => m.outstandingBalance > 0).map((debtor) => (
                  <div
                    key={debtor.memberId}
                    style={{
                      background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-glass)',
                      padding: '0.6rem 0.8rem', borderRadius: '6px', display: 'flex',
                      justifyContent: 'space-between', alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.85rem', color: 'var(--text-strong)' }}>{debtor.name}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--warning-accent)' }}>Deuda: {formatCurrency(debtor.outstandingBalance)}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Cel: {debtor.phone || 'No registrado'}</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSendWhatsAppRedirect(debtor)}
                      disabled={!debtor.phone}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', borderColor: 'var(--emerald-accent)', color: 'var(--emerald-accent)' }}
                    >
                      <Phone size={12} /> WhatsApp
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {virtualSentLogs.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
              <h5 className="serif-font" style={{ fontSize: '0.9rem', color: 'var(--text-gold)', marginBottom: '0.4rem' }}>Log de Avisos Enviados (Sesión)</h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '110px', overflowY: 'auto' }}>
                {virtualSentLogs.map((log) => (
                  <div key={log.id} style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.01)', padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>A: <strong>{log.memberName}</strong> ({log.phone})</span>
                    <span style={{ color: 'var(--emerald-accent)' }}>{log.time} - {log.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
